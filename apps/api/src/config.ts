import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
  production: boolean; databaseUrl: string; origin: string; port: number; host: string;
  allowDevAuth: boolean; botToken?: string; botUsername?: string; webhookSecret?: string;
  sessionKey: string; storageMode: 'local' | 'r2'; localMediaDir: string;
  r2?: { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string };
  staticDir: string;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const allowDevAuth = env.ALLOW_DEV_AUTH === 'true';
  if (production && allowDevAuth) throw new Error('Development authentication is forbidden in production.');
  const databaseUrl = env.DATABASE_URL || env.postgres;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const origin = env.APP_ORIGIN || (!production ? 'http://localhost:5173' : '');
  if (!origin || new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) throw new Error('APP_ORIGIN must be an exact origin (HTTPS in production).');
  const sessionKey = env.SESSION_ENCRYPTION_KEY || (!production ? 'local-development-key-do-not-deploy' : '');
  if (sessionKey.length < 32) throw new Error('SESSION_ENCRYPTION_KEY must contain at least 32 characters.');
  const storageMode = env.MEDIA_STORAGE === 'local' ? 'local' : env.MEDIA_STORAGE === 'r2' || production ? 'r2' : 'local';
  if (production && storageMode === 'local') throw new Error('Production requires private R2 media storage.');
  const botToken = env.BOT_TOKEN || env.bot_token;
  if (production && (!botToken || !env.WEBHOOK_SECRET)) throw new Error('Production requires BOT_TOKEN and WEBHOOK_SECRET.');
  let r2: Config['r2'];
  if (storageMode === 'r2') {
    if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET) throw new Error('R2 configuration is incomplete.');
    if (!env.R2_ENDPOINT.startsWith('https://')) throw new Error('R2_ENDPOINT requires HTTPS.');
    r2 = { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };
  }
  return { production, databaseUrl, origin, port: Number(env.PORT || 3000), host: env.HOST || '0.0.0.0', allowDevAuth, botToken, botUsername: env.BOT_USERNAME?.replace(/^@/, ''), webhookSecret: env.WEBHOOK_SECRET, sessionKey, storageMode, localMediaDir: resolve(env.LOCAL_MEDIA_DIR || resolve(repositoryRoot, '.local-media')), r2, staticDir: resolve(env.STATIC_DIR || resolve(repositoryRoot, 'apps/miniapp/dist')) };
}
