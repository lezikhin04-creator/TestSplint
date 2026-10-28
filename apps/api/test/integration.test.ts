import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { migrate } from '../src/db.js';
import { Repository, type Auth } from '../src/repository.js';
import { LocalMediaStore } from '../src/media.js';
import { digest } from '../src/crypto.js';
import { readConfig, type Config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { seedCatalog } from '../src/seed.js';
import { acceptUpdate, processInbox } from '../src/telegram.js';

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const allowed = !!url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const schema = `splint_test_${randomUUID().replaceAll('-', '')}`;
let pool: pg.Pool; let base: pg.Pool; let media: LocalMediaStore; let directory: string; let repository: Repository; let config: Config;
const grid = { width: 2, height: 2, palette: ['#112233', '#aabbcc'], cells: [0, 1, 0, 1], mask: [true, true, true, true] };
const integration = allowed ? test : test.skip;
before(async () => {
  if (!allowed) return;
  base = new pg.Pool({ connectionString: url }); await base.query(`CREATE SCHEMA ${schema}`);
  pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 15 }); await migrate(pool);
  directory = await mkdtemp(join(tmpdir(), 'splint-api-test-')); media = new LocalMediaStore(directory);
  const bytes = Buffer.from(JSON.stringify(grid)); await media.put('canonical/test.json', bytes);
  await pool.query("INSERT INTO artworks(id,version_id,title,description,author,category,width,height,color_count,total,grid_key,grid_sha256,published_at) VALUES('test-work','test-version','Test artwork','Test description','Splint','test',2,2,2,4,'canonical/test.json',$1,now())", [digest(bytes)]);
  config = readConfig({ NODE_ENV: 'test', DATABASE_URL: url, APP_ORIGIN: 'http://127.0.0.1:5173', ALLOW_DEV_AUTH: 'true', LOCAL_MEDIA_DIR: directory, STATIC_DIR: join(directory, 'no-static'), BOT_TOKEN: '12345:test-credential', WEBHOOK_SECRET: 'test-webhook-secret' });
  repository = new Repository(pool, media, config.sessionKey);
});
after(async () => { if (!allowed) return; await pool.end(); await base.query(`DROP SCHEMA ${schema} CASCADE`); await base.end(); await rm(directory, { recursive: true, force: true }); });
let identityCounter = 1000;
async function user(): Promise<{ auth: Auth; token: string }> {
  const result = await repository.login({ id: String(identityCounter++), displayName: 'Tester', username: null, avatarUrl: null }, 'demo');
  const auth = await repository.authenticate(result.token, false); await repository.consent(auth); return { auth, token: result.token };
}
integration('free grant does not create collection; wrong color rejected; concurrent saves union and complete once', async () => {
  const { auth } = await user(); const initial = await repository.start(auth, 'test-work');
  assert.equal(initial.run.filled.length, 0); assert.equal((await repository.library(auth)).collection.length, 0);
  await assert.rejects(repository.progress(auth, initial.run.id, randomUUID(), [{ index: 0, color: 1 }]), { code: 'WRONG_COLOR' });
  const partial = await repository.progress(auth, initial.run.id, randomUUID(), [{ index: 0, color: 0 }]); assert.equal(partial.progress, 25);
  const mutationId = randomUUID(); const last = [{ index: 3, color: 1 }];
  await Promise.all([repository.progress(auth, initial.run.id, randomUUID(), [{ index: 1, color: 1 }]), repository.progress(auth, initial.run.id, randomUUID(), [{ index: 2, color: 0 }]), repository.progress(auth, initial.run.id, mutationId, last)]);
  const complete = await repository.run(auth, initial.run.id); assert.equal(complete.run.status, 'completed'); assert.deepEqual(complete.run.filled, [0, 1, 2, 3]);
  const repeated = await repository.progress(auth, initial.run.id, mutationId, last); assert.equal(repeated.revision, complete.run.revision);
  assert.equal((await repository.library(auth)).collection.length, 1);
  await assert.rejects(repository.progress(auth, initial.run.id, mutationId, [{ index: 0, color: 0 }]), { code: 'MUTATION_CONFLICT' });
});
integration('restart races create one new run; delayed old saves cannot change current run or erase collection', async () => {
  const { auth } = await user(); const first = await repository.start(auth, 'test-work');
  await repository.progress(auth, first.run.id, randomUUID(), grid.cells.map((color, index) => ({ index, color })));
  const [a, b] = await Promise.all([repository.restart(auth, first.run.id), repository.restart(auth, first.run.id)]);
  assert.equal(a.run.id, b.run.id); assert.equal(a.run.filled.length, 0);
  await assert.rejects(repository.progress(auth, first.run.id, randomUUID(), [{ index: 0, color: 0 }]), { code: 'RUN_REPLACED' });
  assert.equal((await repository.library(auth)).collection.length, 1);
  assert.equal((await repository.run(auth, a.run.id)).run.filled.length, 0);
});
integration('another account cannot access run, mutate progress or export; content restriction overrides old grant', async () => {
  const owner = await user(); const stranger = await user(); const run = await repository.start(owner.auth, 'test-work');
  await assert.rejects(repository.run(stranger.auth, run.run.id), { code: 'NOT_FOUND' });
  await assert.rejects(repository.progress(stranger.auth, run.run.id, randomUUID(), [{ index: 0, color: 0 }]), { code: 'NOT_FOUND' });
  await assert.rejects(repository.completed(stranger.auth, run.run.id), { code: 'NOT_FOUND' });
  await pool.query("UPDATE artworks SET published=false WHERE id='test-work'");
  assert.equal((await repository.run(owner.auth, run.run.id)).run.id, run.run.id);
  await pool.query("UPDATE artworks SET restricted=true WHERE id='test-work'");
  await assert.rejects(repository.run(owner.auth, run.run.id), { code: 'NOT_FOUND' });
  await pool.query("UPDATE artworks SET published=true,restricted=false WHERE id='test-work'");
});
integration('session exchange retries return same token; replay and logged-out retries are rejected', async () => {
  const identity = { id: String(identityCounter++), displayName: 'Repeat', username: null, avatarUrl: null }; const bootstrap = { fingerprint: digest(randomUUID()), requestId: randomUUID().toUpperCase() };
  const [a, b] = await Promise.all([repository.login(identity, 'telegram', bootstrap), repository.login(identity, 'telegram', bootstrap)]);
  assert.equal(a.token, b.token);
  assert.equal(a.response.accessToken, b.response.accessToken);
  assert.notEqual(a.token, a.response.accessToken);
  await assert.rejects(repository.login(identity, 'telegram', { ...bootstrap, requestId: randomUUID() }), { code: 'AUTH_REPLAY' });
  const auth = await repository.authenticate(a.token, false); await repository.logout(auth);
  await assert.rejects(repository.login(identity, 'telegram', bootstrap), { code: 'AUTH_REPLAY' });
});
integration('HTTP origin/CSRF enforcement, completion/export, persisted reload, and durable webhook dedupe', async () => {
  const app = await buildApp(config, pool, { media });
  try {
    const rejected = await app.inject({ method: 'POST', url: '/api/v1/auth/dev', headers: { origin: 'https://untrusted.invalid' }, payload: {} }); assert.equal(rejected.statusCode, 403);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/dev', headers: { origin: config.origin }, payload: {} }); assert.equal(login.statusCode, 200);
    const session = login.json(); const cookie = login.cookies.map(item => `${item.name}=${item.value}`).join('; ');
    const headers = { cookie, origin: config.origin, 'x-csrf-token': session.csrfToken };
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/me/consent', headers: { cookie, origin: config.origin }, payload: { version: 'test-v1' } }); assert.equal(noCsrf.statusCode, 403);
    await app.inject({ method: 'POST', url: '/api/v1/me/consent', headers, payload: { version: 'test-v1' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/works/test-work/start', headers, payload: {} }); assert.equal(started.statusCode, 200); const run = started.json().run;
    const saved = await app.inject({ method: 'PATCH', url: `/api/v1/runs/${run.id}/progress`, headers, payload: { mutationId: randomUUID(), cells: grid.cells.map((color, index) => ({ index, color })) } }); assert.equal(saved.statusCode, 200); assert.equal(saved.json().run.progress, 100);
    const refreshed = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}`, headers: { cookie } }); assert.equal(refreshed.json().run.status, 'completed');
    const png = await app.inject({ method: 'GET', url: `/api/v1/runs/${run.id}/export`, headers: { cookie } }); assert.equal(png.statusCode, 200); assert.equal(png.headers['content-type'], 'image/png'); assert.equal(png.rawPayload.subarray(1, 4).toString(), 'PNG');
    const noSecret = await app.inject({ method: 'POST', url: '/integrations/telegram/test/updates', payload: { update_id: 42 } }); assert.equal(noSecret.statusCode, 403);
    for (let n = 0; n < 2; n++) assert.equal((await app.inject({ method: 'POST', url: '/integrations/telegram/test/updates', headers: { 'x-telegram-bot-api-secret-token': config.webhookSecret }, payload: { update_id: 42 } })).statusCode, 200);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM telegram_inbox WHERE update_id=42')).rows[0].n, 1);
  } finally { await app.close(); }
});
integration('HTTP Telegram uses only valid signed identity and production has no development login', async () => {
  const values = new URLSearchParams({ user: JSON.stringify({ id: identityCounter++, first_name: 'Signed' }), auth_date: String(Math.floor(Date.now() / 1000)) });
  const secret = createHmac('sha256', 'WebAppData').update(config.botToken!).digest(); const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n'); values.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const app = await buildApp({ ...config, production: true, allowDevAuth: false }, pool, { media });
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/dev', headers: { origin: config.origin }, payload: {} })).statusCode, 404);
    const bootstrapRequestId = randomUUID();
    const authenticated = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', headers: { origin: config.origin }, payload: { initData: values.toString(), bootstrapRequestId } });
    assert.equal(authenticated.statusCode, 200);
    const reordered = new URLSearchParams([...values.entries()].reverse()); reordered.set('hash', reordered.get('hash')!.toUpperCase());
    const repeated = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', headers: { origin: config.origin }, payload: { initData: reordered.toString(), bootstrapRequestId } });
    assert.equal(repeated.statusCode, 200); assert.equal(repeated.json().accessToken, authenticated.json().accessToken);
    const replayed = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', headers: { origin: config.origin }, payload: { initData: reordered.toString(), bootstrapRequestId: randomUUID() } });
    assert.equal(replayed.statusCode, 409); assert.equal(replayed.json().error.code, 'AUTH_REPLAY');
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', headers: { origin: config.origin }, payload: { initData: values.toString().replace('Signed', 'Forged'), bootstrapRequestId: randomUUID() } })).statusCode, 401);
  } finally { await app.close(); }
});
integration('cookie and fallback credentials cannot be interchanged; a live cookie wins after fallback expiry', async () => {
  const login = await repository.login({ id: String(identityCounter++), displayName: 'Fallback', username: null, avatarUrl: null }, 'demo');
  const accessToken = login.response.accessToken!;
  const auth = await repository.authenticate(login.token, false);
  assert.equal((await repository.authenticate(accessToken, true)).userId, auth.userId);
  await assert.rejects(repository.authenticate(accessToken, false), { code: 'SESSION_EXPIRED' });
  await assert.rejects(repository.authenticate(login.token, true), { code: 'SESSION_EXPIRED' });
  await pool.query("UPDATE sessions SET bearer_expires_at=now()-interval '1 minute' WHERE id=$1", [auth.sessionId]);
  const app = await buildApp(config, pool, { media });
  try {
    const bearerOnly = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${accessToken}` } });
    assert.equal(bearerOnly.statusCode, 401);
    const both = await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `splint_session=${login.token}`, authorization: `Bearer ${accessToken}` } });
    assert.equal(both.statusCode, 200); assert.equal(both.json().user.id, auth.userId);
    assert.equal(both.json().accessToken, undefined);
    await repository.logout(auth);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: `splint_session=${login.token}` } })).statusCode, 401);
  } finally { await app.close(); }
});
integration('revoked grants cannot be resurrected by starting again', async () => {
  const { auth } = await user(); const first = await repository.start(auth, 'test-work');
  await pool.query('UPDATE grants SET revoked_at=now() WHERE user_id=$1 AND version_id=$2', [auth.userId, first.run.versionId]);
  await assert.rejects(repository.start(auth, 'test-work'), { code: 'ACCESS_REVOKED' });
  await assert.rejects(repository.restart(auth, first.run.id), { code: 'NOT_FOUND' });
  assert.equal((await repository.library(auth)).available.length, 0);
  assert.ok((await pool.query('SELECT revoked_at FROM grants WHERE user_id=$1 AND version_id=$2', [auth.userId, first.run.versionId])).rows[0].revoked_at);
});
integration('HTTP summaries never expose canonical grids; malformed save/start bodies make no progress', async () => {
  const { auth, token } = await user(); const app = await buildApp(config, pool, { media });
  const headers = { cookie: `splint_session=${token}`, origin: config.origin, 'x-csrf-token': auth.csrf };
  try {
    for (const path of ['/api/v1/catalog', '/api/v1/works/test-work', '/api/v1/me/library']) {
      const response = await app.inject({ method: 'GET', url: path, headers }); assert.equal(response.statusCode, 200);
      assert.doesNotMatch(response.body, /"(?:grid|grid_key|grid_sha256|cells|mask|palette)"/);
    }
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM grants WHERE user_id=$1', [auth.userId])).rows[0].n, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/canonical/test.json', headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/works/test-work/start', headers, payload: [] })).statusCode, 400);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM grants WHERE user_id=$1', [auth.userId])).rows[0].n, 0);
    const started = await app.inject({ method: 'POST', url: '/api/v1/works/test-work/start', headers, payload: {} });
    const id = started.json().run.id; assert.deepEqual(started.json().grid, grid);
    for (const cells of [[], [null], [{ index: '0', color: 0 }], [{ index: -1, color: 0 }], [{ index: 65536, color: 0 }], [{ index: 0, color: 256 }]]) {
      assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/runs/${id}/progress`, headers, payload: { mutationId: randomUUID(), cells } })).statusCode, 400);
    }
    assert.deepEqual((await repository.run(auth, id)).run.filled, []);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v1/runs/${id}/restart`, headers, payload: { confirmed: true } })).statusCode, 400);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM runs WHERE user_id=$1', [auth.userId])).rows[0].n, 1);
  } finally { await app.close(); }
});
integration('static files and SPA fallback carry CSP; unknown API paths stay JSON 404', async () => {
  const staticDir = join(directory, 'static-regression'); await mkdir(staticDir);
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>Splint regression</title>');
  await writeFile(join(staticDir, 'test.js'), 'window.staticRegression=true;');
  const app = await buildApp({ ...config, staticDir }, pool, { media });
  try {
    for (const path of ['/', '/test.js', '/app/deep/link']) {
      const response = await app.inject({ method: 'GET', url: path }); assert.equal(response.statusCode, 200);
      assert.match(String(response.headers['content-security-policy']), /script-src 'self' https:\/\/telegram.org/);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
    }
    for (const path of ['/api/v1/unknown', '/integrations/unknown']) {
      const response = await app.inject({ method: 'GET', url: path }); assert.equal(response.statusCode, 404);
      assert.match(String(response.headers['content-type']), /application\/json/); assert.equal(response.json().error.code, 'NOT_FOUND');
    }
  } finally { await app.close(); }
});
integration('reseed restores missing immutable media without resetting metadata or replacing a changed grid', async () => {
  const work = { id: 'reseed-work', versionId: 'reseed-version', title: 'Reseed test', description: 'Restoration fixture', author: 'Splint', category: 'test', featured: false, publishedAt: new Date().toISOString(), grid };
  await seedCatalog(pool, media, [work]);
  const original = (await pool.query('SELECT * FROM artworks WHERE id=$1', [work.id])).rows[0];
  await pool.query('UPDATE artworks SET published=false,title=$2 WHERE id=$1', [work.id, 'Staff title']);
  await rm(join(directory, original.grid_key));
  await seedCatalog(pool, media, [work]);
  assert.deepEqual(JSON.parse((await media.get(original.grid_key)).toString()), grid);
  const restored = (await pool.query('SELECT * FROM artworks WHERE id=$1', [work.id])).rows[0];
  assert.equal(restored.title, 'Staff title'); assert.equal(restored.published, false); assert.equal(restored.grid_sha256, original.grid_sha256);
  await assert.rejects(seedCatalog(pool, media, [{ ...work, grid: { ...grid, cells: [1, 0, 1, 0] } }]), /refuses replacement/);
  assert.deepEqual(JSON.parse((await media.get(original.grid_key)).toString()), grid);
});
integration('durable inbox isolates bot identity and never retries an unknown message delivery', async () => {
  const botConfig = { ...config, botToken: '987654321:test-only-token' };
  const update = { update_id: 8801, message: { chat: { id: 123, type: 'private' }, text: '/start' } };
  await acceptUpdate(pool, botConfig, update); await acceptUpdate(pool, botConfig, update);
  await acceptUpdate(pool, { ...config, botToken: '987654322:other-test-token' }, update);
  let sends = 0;
  const interruptedSender = async () => { sends++; throw new Error('Simulated unknown delivery outcome'); };
  await Promise.all([processInbox(pool, botConfig, interruptedSender), processInbox(pool, botConfig, interruptedSender)]);
  await processInbox(pool, botConfig, interruptedSender);
  assert.equal(sends, 1);
  const rows = (await pool.query('SELECT bot_id,status,attempts,error_code FROM telegram_inbox WHERE update_id=8801 ORDER BY bot_id')).rows;
  assert.deepEqual(rows, [{ bot_id: '987654321', status: 'unknown', attempts: 1, error_code: 'SEND_OUTCOME_UNKNOWN' }, { bot_id: '987654322', status: 'pending', attempts: 0, error_code: null }]);
  await acceptUpdate(pool, botConfig, { update_id: 8802, message: { successful_payment: { currency: 'XTR', total_amount: 1 } } });
  await processInbox(pool, botConfig, interruptedSender);
  assert.equal(sends, 1);
  const financial = (await pool.query('SELECT status,error_code FROM telegram_inbox WHERE bot_id=$1 AND update_id=8802', ['987654321'])).rows[0];
  assert.deepEqual(financial, { status: 'failed', error_code: 'UNEXPECTED_FINANCIAL_EVENT' });
});
if (!allowed) test('PostgreSQL integration configuration', { skip: true }, () => { /* Set TEST_DATABASE_URL to an isolated loopback PostgreSQL 17/18 database. */ });
