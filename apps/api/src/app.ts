import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync } from 'node:fs';
import type pg from 'pg';
import type { Config } from './config.js';
import { Repository, type Auth } from './repository.js';
import { createMediaStore, renderPng, type MediaStore } from './media.js';
import { equalSecret, validateTelegram } from './crypto.js';
import { ApiError, invalid } from './errors.js';
import { acceptUpdate } from './telegram.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workId = /^[a-zA-Z0-9_-]{1,100}$/;
function object(body: unknown): Record<string, any> { if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid(); return body as Record<string, any>; }
function emptyObject(body: unknown): void { if (Object.keys(object(body)).length) throw invalid(); }
function runId(request: FastifyRequest) { const id = (request.params as { id: string }).id; if (!uuid.test(id)) throw invalid(); return id; }
function workParam(request: FastifyRequest) { const id = (request.params as { id?: string; workId?: string }).id || (request.params as { workId: string }).workId; if (!workId.test(id)) throw invalid(); return id; }

export async function buildApp(config: Config, pool: pg.Pool, options: { media?: MediaStore; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'], serializers: { req: request => ({ method: request.method, url: request.url.split('?')[0], id: request.id }) } } : false, bodyLimit: 1024 * 1024, disableRequestLogging: true, trustProxy: false });
  const repository = new Repository(pool, options.media || createMediaStore(config), config.sessionKey);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const authenticate = async (request: FastifyRequest): Promise<Auth> => {
    const authorization = request.headers.authorization;
    // A working HttpOnly cookie outlives the short fallback credential. Prefer it
    // even when a client still has the now-expired fallback in memory.
    const bearer = !request.cookies.splint_session && (authorization?.startsWith('Bearer ') || false);
    const auth = await repository.authenticate(bearer ? authorization!.slice(7) : request.cookies.splint_session, bearer);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== config.origin || typeof request.headers['x-csrf-token'] !== 'string' || !equalSecret(request.headers['x-csrf-token'], auth.csrf)) throw new ApiError(403, 'CSRF_INVALID', 'Обновите приложение и повторите действие.');
    }
    return auth;
  };
  const originOnly = (request: FastifyRequest) => { if (request.headers.origin !== config.origin) throw new ApiError(403, 'ORIGIN_INVALID', 'Недопустимый источник запроса.'); };
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer').header('cache-control', reply.getHeader('cache-control') || 'no-store');
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) return reply.status(error.statusCode).send({ error: { code: error.statusCode === 429 ? 'RATE_LIMITED' : 'INVALID_REQUEST', message: error.statusCode === 429 ? 'Слишком много запросов. Попробуйте позже.' : 'Проверьте данные запроса.' } });
    // Do not serialize exception messages: database/HTTP errors can include credentials.
    request.log.error({ code: 'INTERNAL_ERROR', requestId: request.id }, 'Request failed');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить действие. Попробуйте ещё раз.' } });
  });
  app.get('/health/live', async () => ({ ok: true }));
  app.get('/health/ready', async (_request, reply) => { try { await pool.query('SELECT 1 FROM schema_migrations LIMIT 1'); return { ok: true }; } catch { return reply.status(503).send({ ok: false }); } });
  app.get('/api/v1/config', async () => ({ devAuthEnabled: config.allowDevAuth && !config.production, ...(config.botUsername ? { botUsername: config.botUsername } : {}) }));
  app.post('/api/v1/auth/telegram', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    originOnly(request); const body = object(request.body);
    if (typeof body.initData !== 'string' || typeof body.bootstrapRequestId !== 'string' || !uuid.test(body.bootstrapRequestId)) throw invalid();
    if (!config.botToken) throw new ApiError(503, 'TELEGRAM_UNAVAILABLE', 'Вход Telegram пока не настроен.');
    const identity = validateTelegram(body.initData, config.botToken);
    const result = await repository.login(identity, 'telegram', { fingerprint: identity.bootstrapFingerprint, requestId: body.bootstrapRequestId });
    reply.setCookie('splint_session', result.token, { path: '/', httpOnly: true, secure: config.production || config.origin.startsWith('https://'), sameSite: config.production ? 'none' : 'lax', maxAge: 7 * 86400 });
    return result.response;
  });
  app.post('/api/v1/auth/dev', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (config.production || !config.allowDevAuth) throw new ApiError(404, 'NOT_FOUND', 'Объект недоступен.');
    originOnly(request); emptyObject(request.body);
    const result = await repository.login({ id: '900000000000001', displayName: 'Гость мастерской', username: null, avatarUrl: null }, 'demo');
    reply.setCookie('splint_session', result.token, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 7 * 86400 }); return result.response;
  });
  app.get('/api/v1/me', async request => repository.me(await authenticate(request)));
  app.post('/api/v1/auth/logout', async (request, reply) => { await repository.logout(await authenticate(request)); reply.clearCookie('splint_session', { path: '/' }); return { ok: true }; });
  app.post('/api/v1/me/consent', async request => { const auth = await authenticate(request); if (object(request.body).version !== 'test-v1') throw invalid(); return repository.consent(auth); });
  app.patch('/api/v1/me/preferences', async request => { const auth = await authenticate(request); const body = object(request.body); if (typeof body.notifications !== 'boolean' || typeof body.shareName !== 'boolean') throw invalid(); return repository.preferences(auth, body.notifications, body.shareName); });
  app.get('/api/v1/catalog', async request => { const auth = await authenticate(request); const query = request.query as Record<string, unknown>; if (Object.values(query).some(value => typeof value !== 'string') || typeof query.q === 'string' && query.q.length > 100 || query.sort && !['curated', 'new'].includes(String(query.sort))) throw invalid(); return { items: await repository.catalog(auth, query as Record<string, string>) }; });
  app.get('/api/v1/works/:id', async request => ({ work: await repository.work(await authenticate(request), workParam(request)) }));
  app.post('/api/v1/works/:id/start', async request => { const auth = await authenticate(request); emptyObject(request.body); return repository.start(auth, workParam(request)); });
  app.get('/api/v1/runs/:id', async request => repository.run(await authenticate(request), runId(request)));
  app.patch('/api/v1/runs/:id/progress', async request => {
    const auth = await authenticate(request); const id = runId(request); const body = object(request.body);
    if (typeof body.mutationId !== 'string' || !uuid.test(body.mutationId) || !Array.isArray(body.cells) || !body.cells.length || body.cells.length > 65536 || body.cells.some((cell: any) => !cell || !Number.isInteger(cell.index) || cell.index < 0 || cell.index >= 65536 || !Number.isInteger(cell.color) || cell.color < 0 || cell.color >= 256)) throw invalid();
    return { run: await repository.progress(auth, id, body.mutationId, body.cells) };
  });
  app.post('/api/v1/runs/:id/restart', async request => { const auth = await authenticate(request); emptyObject(request.body); return repository.restart(auth, runId(request)); });
  app.get('/api/v1/me/library', async request => repository.library(await authenticate(request)));
  app.get('/api/v1/runs/:id/export', async (request, reply) => { const auth = await authenticate(request); const { row, grid } = await repository.completed(auth, runId(request)); const session = await repository.me(auth); const attribution = `Работа: ${row.author}${session.user.shareName ? ` · Раскрасил(а): ${session.user.displayName}` : ''}`; const bytes = await renderPng(grid, attribution); reply.header('cache-control', 'private, no-store').header('content-disposition', `attachment; filename="splint-${row.work_id}.png"`).type('image/png'); return reply.send(bytes); });
  app.post('/api/v1/runs/:id/share', async request => { const auth = await authenticate(request); emptyObject(request.body); const { row } = await repository.completed(auth, runId(request)); return { url: config.botUsername ? `https://t.me/${encodeURIComponent(config.botUsername)}?startapp=work_${encodeURIComponent(row.work_id)}` : '' }; });
  app.get('/api/v1/media/:workId/preview.png', async (request, reply) => { const row = await repository.publicWork(workParam(request)); const bytes = await renderPng(await repository.grid(row)); return reply.header('cache-control', 'public, max-age=60').type('image/png').send(bytes); });
  app.post('/api/v1/support', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async request => { const auth = await authenticate(request); const body = object(request.body); if (!['help', 'content_report', 'deletion'].includes(body.kind) || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 4000 || body.workId !== undefined && (typeof body.workId !== 'string' || !workId.test(body.workId))) throw invalid(); return repository.support(auth, body.kind, body.message.trim(), body.workId); });
  app.post('/integrations/telegram/test/updates', async (request, reply) => {
    const secret = request.headers['x-telegram-bot-api-secret-token'];
    if (!config.webhookSecret || typeof secret !== 'string' || !equalSecret(secret, config.webhookSecret)) throw new ApiError(403, 'WEBHOOK_FORBIDDEN', 'Запрос отклонён.');
    const body = object(request.body); if (!Number.isSafeInteger(body.update_id) || body.update_id < 0) throw invalid();
    await acceptUpdate(pool, config, body); return reply.send({ ok: true });
  });
  if (existsSync(config.staticDir)) {
    await app.register(staticPlugin, { root: config.staticDir, wildcard: false, setHeaders: reply => { reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'"); } });
    app.setNotFoundHandler((request, reply) => { if (request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/integrations/')) return reply.sendFile('index.html'); return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Объект недоступен.' } }); });
  } else app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Объект недоступен.' } }));
  return app;
}
