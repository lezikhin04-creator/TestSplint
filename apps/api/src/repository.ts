import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { PoolClient } from 'pg';
import type { ArtworkSummary, PixelGrid, RunState, SessionResponse } from '@splint/shared';
import { transaction } from './db.js';
import { digest, encrypt, decrypt, randomToken, type TelegramIdentity } from './crypto.js';
import { ApiError, missing } from './errors.js';
import { loadGrid, type MediaStore } from './media.js';

type Row = Record<string, any>;
export interface Auth { sessionId: string; userId: string; csrf: string; mode: 'telegram' | 'demo'; bearer: boolean }
export class Repository {
  constructor(public pool: pg.Pool, public media: MediaStore, private sessionKey: string) {}
  async login(identity: TelegramIdentity, mode: 'telegram' | 'demo', bootstrap?: { fingerprint: string; requestId: string }): Promise<{ token: string; response: SessionResponse }> {
    return transaction(this.pool, async client => {
      if (bootstrap) {
        const hash = bootstrap.fingerprint;
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`bootstrap:${hash}`]);
        const prior = (await client.query('SELECT b.*,s.revoked_at FROM auth_bootstraps b JOIN sessions s ON s.id=b.session_id WHERE b.digest=$1', [hash])).rows[0];
        if (prior) {
          if (prior.request_id !== bootstrap.requestId.toLowerCase() || prior.expires_at.getTime() <= Date.now() || prior.revoked_at) throw new ApiError(409, 'AUTH_REPLAY', 'Переоткройте приложение из Telegram.');
          const credentials = JSON.parse(decrypt(prior.encrypted_token, this.sessionKey)) as { cookie: string; bearer: string };
          return { token: credentials.cookie, response: await this.sessionResponse(client, prior.session_id, credentials.bearer) };
        }
      }
      const user = (await client.query('INSERT INTO users(id,telegram_id,display_name,username,avatar_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name,username=excluded.username RETURNING *', [randomUUID(), identity.id, identity.displayName, identity.username, identity.avatarUrl])).rows[0];
      if (user.disabled) throw new ApiError(403, 'ACCOUNT_DISABLED', 'Доступ к аккаунту ограничен.');
      const token = randomToken(); const bearerToken = randomToken(); const sessionId = randomUUID();
      await client.query("INSERT INTO sessions(id,token_hash,bearer_token_hash,user_id,csrf_token,mode,expires_at,bearer_expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '7 days',now()+interval '15 minutes')", [sessionId, digest(token), digest(bearerToken), user.id, randomToken(), mode]);
      if (bootstrap) await client.query("INSERT INTO auth_bootstraps(digest,request_id,session_id,encrypted_token,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')", [bootstrap.fingerprint, bootstrap.requestId, sessionId, encrypt(JSON.stringify({ cookie: token, bearer: bearerToken }), this.sessionKey)]);
      return { token, response: await this.sessionResponse(client, sessionId, bearerToken) };
    });
  }
  async authenticate(token: string | undefined, bearer: boolean): Promise<Auth> {
    if (!token || token.length > 256) throw new ApiError(401, 'UNAUTHENTICATED', 'Войдите через Telegram.');
    const row = (await this.pool.query("UPDATE sessions s SET last_seen=now() FROM users u WHERE (CASE WHEN $2::boolean THEN s.bearer_token_hash ELSE s.token_hash END)=$1 AND s.user_id=u.id AND s.revoked_at IS NULL AND NOT u.disabled AND s.expires_at>now() AND s.last_seen>now()-interval '24 hours' AND ($2::boolean=false OR s.bearer_expires_at>now()) RETURNING s.*", [digest(token), bearer])).rows[0];
    if (!row) throw new ApiError(401, 'SESSION_EXPIRED', 'Переоткройте приложение из Telegram.');
    return { sessionId: row.id, userId: row.user_id, csrf: row.csrf_token, mode: row.mode, bearer };
  }
  async sessionResponse(query: Pick<PoolClient, 'query'>, sessionId: string, token?: string): Promise<SessionResponse> {
    const row = (await query.query('SELECT u.*,s.csrf_token,s.mode FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND NOT u.disabled AND s.revoked_at IS NULL', [sessionId])).rows[0];
    if (!row) throw new ApiError(401, 'SESSION_EXPIRED', 'Переоткройте приложение из Telegram.');
    return { user: { id: row.id, displayName: row.display_name, username: row.username, avatarUrl: row.avatar_url, notifications: row.notifications, shareName: row.share_name }, csrfToken: row.csrf_token, ...(token ? { accessToken: token } : {}), consentRequired: row.consent_version !== 'test-v1', mode: row.mode };
  }
  me(auth: Auth) { return this.sessionResponse(this.pool, auth.sessionId); }
  async logout(auth: Auth) { await this.pool.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [auth.sessionId]); }
  async consent(auth: Auth) { await this.pool.query("UPDATE users SET consent_version='test-v1' WHERE id=$1", [auth.userId]); return this.me(auth); }
  async preferences(auth: Auth, notifications: boolean, shareName: boolean) { await this.pool.query('UPDATE users SET notifications=$2,share_name=$3 WHERE id=$1', [auth.userId, notifications, shareName]); return this.me(auth); }
  private summary(row: Row): ArtworkSummary {
    const status = row.run_status === 'completed' ? 'completed' : row.run_status === 'active' ? 'in_progress' : 'available';
    return { id: row.id, versionId: row.version_id, title: row.title, description: row.description, author: row.author, width: row.width, height: row.height, colorCount: row.color_count, previewUrl: `/api/v1/media/${row.id}/preview.png`, category: row.category, status, progress: row.run_status === 'completed' ? 100 : Math.min(99.9, (row.filled_count || 0) * 100 / row.total), ...(row.run_id ? { runId: row.run_id } : {}), featured: row.featured, publishedAt: row.published_at.toISOString() };
  }
  private state(row: Row): RunState { return { id: row.id, workId: row.work_id, versionId: row.version_id, status: row.status, filled: row.filled, total: row.total, progress: row.status === 'completed' ? 100 : Math.min(99.9, row.filled.length * 100 / row.total), revision: row.revision, completedAt: row.completed_at?.toISOString() || null }; }
  async catalog(auth: Auth, options: { q?: string; size?: string; sort?: string } = {}) {
    const rows = (await this.pool.query(`SELECT a.*,r.id AS run_id,r.status AS run_status,cardinality(r.filled) AS filled_count FROM artworks a LEFT JOIN LATERAL (SELECT * FROM runs WHERE user_id=$1 AND version_id=a.version_id ORDER BY ordinal DESC LIMIT 1) r ON true WHERE a.published AND NOT a.restricted AND ($2::text='' OR a.title ILIKE '%'||$2||'%' OR a.author ILIKE '%'||$2||'%') ORDER BY ${options.sort === 'new' ? 'a.published_at DESC' : 'a.featured DESC,a.published_at,a.id'}`, [auth.userId, options.q || ''])).rows;
    return rows.filter(row => !options.size || options.size === 'all' || options.size === String(row.width) || options.size === `${row.width}x${row.height}`).map(row => this.summary(row));
  }
  async work(auth: Auth, id: string) {
    const row = (await this.pool.query('SELECT a.*,r.id AS run_id,r.status AS run_status,cardinality(r.filled) AS filled_count FROM artworks a LEFT JOIN LATERAL (SELECT * FROM runs WHERE user_id=$1 AND version_id=a.version_id ORDER BY ordinal DESC LIMIT 1) r ON true WHERE a.id=$2 AND NOT a.restricted AND (a.published OR EXISTS(SELECT 1 FROM grants g WHERE g.version_id=a.version_id AND g.user_id=$1 AND g.revoked_at IS NULL))', [auth.userId, id])).rows[0];
    if (!row) throw missing(); return this.summary(row);
  }
  async publicWork(id: string): Promise<Row> { const row = (await this.pool.query('SELECT * FROM artworks WHERE id=$1 AND published AND NOT restricted', [id])).rows[0]; if (!row) throw missing(); return row; }
  async grid(row: Row) { return loadGrid(this.media, row.grid_key, row.grid_sha256); }
  private async lockUser(client: PoolClient, auth: Auth) { const row = (await client.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [auth.userId])).rows[0]; if (!row || row.disabled) throw new ApiError(403, 'ACCOUNT_DISABLED', 'Доступ ограничен.'); if (row.consent_version !== 'test-v1') throw new ApiError(403, 'CONSENT_REQUIRED', 'Подтвердите условия тестовой версии.'); }
  private async accessibleRun(client: Pick<PoolClient, 'query'>, auth: Auth, id: string): Promise<Row> {
    const row = (await client.query('SELECT r.*,a.id AS work_id,a.total,a.grid_key,a.grid_sha256,a.author,a.title FROM runs r JOIN artworks a ON a.version_id=r.version_id JOIN grants g ON g.version_id=r.version_id AND g.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2 AND g.revoked_at IS NULL AND NOT a.restricted FOR SHARE OF a,g', [id, auth.userId])).rows[0]; if (!row) throw missing(); return row;
  }
  async start(auth: Auth, workId: string) {
    const result = await transaction(this.pool, async client => {
      await this.lockUser(client, auth);
      const work = (await client.query('SELECT * FROM artworks WHERE id=$1 AND NOT restricted FOR SHARE', [workId])).rows[0]; if (!work) throw missing();
      const grant = (await client.query('SELECT * FROM grants WHERE user_id=$1 AND version_id=$2 FOR SHARE', [auth.userId, work.version_id])).rows[0];
      if (grant?.revoked_at) throw new ApiError(403, 'ACCESS_REVOKED', 'Доступ к этой работе ограничен. Обратитесь в поддержку.');
      if (!grant) { if (!work.published) throw missing(); await client.query('INSERT INTO grants(user_id,version_id) VALUES($1,$2)', [auth.userId, work.version_id]); }
      let run = (await client.query('SELECT * FROM runs WHERE user_id=$1 AND version_id=$2 ORDER BY ordinal DESC LIMIT 1', [auth.userId, work.version_id])).rows[0];
      if (!run) run = (await client.query('INSERT INTO runs(id,user_id,version_id) VALUES($1,$2,$3) RETURNING *', [randomUUID(), auth.userId, work.version_id])).rows[0];
      return { ...run, total: work.total, work_id: work.id, grid_key: work.grid_key, grid_sha256: work.grid_sha256 };
    }); return { run: this.state(result), grid: await this.grid(result) };
  }
  async run(auth: Auth, id: string) { const row = await this.accessibleRun(this.pool, auth, id); return { run: this.state(row), grid: await this.grid(row) }; }
  async progress(auth: Auth, id: string, mutationId: string, cells: Array<{ index: number; color: number }>) {
    const canonical = await this.run(auth, id);
    return transaction(this.pool, async client => {
      await this.lockUser(client, auth); const row = await this.accessibleRun(client, auth, id);
      const hash = digest(JSON.stringify(cells));
      const mutation = (await client.query('SELECT request_digest FROM progress_mutations WHERE run_id=$1 AND mutation_id=$2', [id, mutationId])).rows[0];
      if (mutation) { if (mutation.request_digest !== hash) throw new ApiError(409, 'MUTATION_CONFLICT', 'Идентификатор сохранения уже использован.'); return this.state(row); }
      const newer = (await client.query('SELECT 1 FROM runs WHERE user_id=$1 AND version_id=$2 AND ordinal>$3', [auth.userId, row.version_id, row.ordinal])).rowCount;
      if (newer || row.status === 'interrupted') throw new ApiError(409, 'RUN_REPLACED', 'Открыто новое прохождение. Обновите холст.');
      for (const cell of cells) if (!canonical.grid.mask[cell.index] || canonical.grid.cells[cell.index] !== cell.color) throw new ApiError(422, 'WRONG_COLOR', 'Цвет не совпадает с номером клетки.');
      const filled = [...new Set<number>([...row.filled, ...cells.map(cell => cell.index)])].sort((a, b) => a - b);
      const completed = filled.length === row.total;
      const changed = filled.length !== row.filled.length;
      const updated = (await client.query("UPDATE runs SET filled=$2,revision=revision+$3,status=$4,completed_at=CASE WHEN $4='completed' THEN COALESCE(completed_at,now()) ELSE NULL END WHERE id=$1 RETURNING *", [id, filled, changed ? 1 : 0, completed ? 'completed' : 'active'])).rows[0];
      await client.query('INSERT INTO progress_mutations(run_id,mutation_id,request_digest) VALUES($1,$2,$3)', [id, mutationId, hash]);
      if (completed) await client.query('INSERT INTO collection(user_id,version_id,run_id) VALUES($1,$2,$3) ON CONFLICT(user_id,version_id) DO UPDATE SET run_id=excluded.run_id', [auth.userId, row.version_id, id]);
      return this.state({ ...updated, work_id: row.work_id, total: row.total });
    });
  }
  async restart(auth: Auth, id: string) {
    const row = await transaction(this.pool, async client => {
      await this.lockUser(client, auth); const old = await this.accessibleRun(client, auth, id);
      const latest = (await client.query('SELECT * FROM runs WHERE user_id=$1 AND version_id=$2 ORDER BY ordinal DESC LIMIT 1', [auth.userId, old.version_id])).rows[0];
      if (latest.id !== id) return { ...old, ...latest };
      await client.query("UPDATE runs SET status='interrupted',revision=revision+1 WHERE id=$1 AND status='active'", [id]);
      const created = (await client.query('INSERT INTO runs(id,user_id,version_id) VALUES($1,$2,$3) RETURNING *', [randomUUID(), auth.userId, old.version_id])).rows[0];
      return { ...old, ...created };
    }); return { run: this.state(row), grid: await this.grid(row) };
  }
  async library(auth: Auth) {
    const works = (await this.pool.query('SELECT a.*,r.id AS run_id,r.status AS run_status,cardinality(r.filled) AS filled_count FROM grants g JOIN artworks a ON a.version_id=g.version_id LEFT JOIN LATERAL(SELECT * FROM runs WHERE user_id=$1 AND version_id=a.version_id ORDER BY ordinal DESC LIMIT 1) r ON true WHERE g.user_id=$1 AND g.revoked_at IS NULL AND NOT a.restricted ORDER BY g.created_at DESC', [auth.userId])).rows;
    const inProgress = []; const collection = [];
    for (const work of works) {
      if (work.run_status === 'active') { const row = await this.accessibleRun(this.pool, auth, work.run_id); inProgress.push({ work: this.summary(work), run: this.state(row) }); }
      const completed = (await this.pool.query('SELECT c.run_id FROM collection c WHERE c.user_id=$1 AND c.version_id=$2', [auth.userId, work.version_id])).rows[0];
      if (completed) { const row = await this.accessibleRun(this.pool, auth, completed.run_id); collection.push({ work: this.summary({ ...work, run_id: row.id, run_status: 'completed' }), run: this.state(row) }); }
    }
    return { available: works.map(row => this.summary(row)), inProgress, collection };
  }
  async completed(auth: Auth, id: string) { const row = await this.accessibleRun(this.pool, auth, id); if (row.status !== 'completed') throw new ApiError(409, 'NOT_COMPLETED', 'Сначала завершите раскрашивание.'); return { row, grid: await this.grid(row) }; }
  async support(auth: Auth, kind: string, message: string, workId?: string) { if (workId) await this.work(auth, workId); const id = randomUUID(); await this.pool.query('INSERT INTO support_tickets(id,user_id,kind,message,work_id) VALUES($1,$2,$3,$4,$5)', [id, auth.userId, kind, message, workId || null]); return { id, status: 'open' as const }; }
}
