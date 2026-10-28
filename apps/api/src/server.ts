import { readConfig } from './config.js';
import { createPool } from './db.js';
import { buildApp } from './app.js';
import { processInbox } from './telegram.js';

async function main() {
  const config = readConfig(); const pool = createPool(config.databaseUrl);
  pool.on('error', () => { console.error('PostgreSQL pool connection failed.'); });
  const app = await buildApp(config, pool, { logger: true });
  let processing = false;
  const timer = setInterval(async () => { if (processing) return; processing = true; try { await processInbox(pool, config); } catch { app.log.error({ code: 'INBOX_WORKER_FAILED' }, 'Inbox processing failed'); } finally { processing = false; } }, 2000);
  timer.unref();
  const stop = async () => { clearInterval(timer); await app.close(); await pool.end(); };
  process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
  await app.listen({ port: config.port, host: config.host });
}
main().catch(() => { console.error('Startup failed. Check required configuration and service health; no secrets are logged.'); process.exitCode = 1; });
