import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function encrypt(value: string, secret: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), iv);
  const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
}
export function decrypt(value: string, secret: string): string {
  const bytes = Buffer.from(value, 'base64url'); const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(secret).digest(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
export interface TelegramIdentity { id: string; displayName: string; username: string | null; avatarUrl: string | null }
export function validateTelegram(initData: string, botToken: string, now = Date.now()): TelegramIdentity & { bootstrapFingerprint: string } {
  const reject = () => new ApiError(401, 'TELEGRAM_AUTH_INVALID', 'Откройте приложение заново из Telegram.');
  if (typeof initData !== 'string' || !initData || Buffer.byteLength(initData) > 16384) throw reject();
  const values = new URLSearchParams(initData); const keys = [...values.keys()];
  if (new Set(keys).size !== keys.length) throw reject();
  const hash = values.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) throw reject();
  values.delete('hash');
  const data = [...values.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(data).digest('hex');
  if (!equalSecret(expected, hash.toLowerCase())) throw reject();
  const date = values.get('auth_date');
  if (!date || !/^\d+$/.test(date)) throw reject();
  const age = now / 1000 - Number(date);
  if (age > 300 || age < -30) throw reject();
  let user: Record<string, unknown>;
  try { user = JSON.parse(values.get('user') || 'null'); } catch { throw reject(); }
  if (!user || !Number.isSafeInteger(user.id) || Number(user.id) <= 0 || typeof user.first_name !== 'string') throw reject();
  const displayName = [user.first_name, typeof user.last_name === 'string' ? user.last_name : ''].filter(Boolean).join(' ').slice(0, 200);
  // Fingerprint the verified signature, not its URL encoding or parameter order.
  // Equivalent serializations of one Telegram launch must share one replay fence.
  return { id: String(user.id), displayName, username: typeof user.username === 'string' ? user.username.slice(0, 100) : null, avatarUrl: null, bootstrapFingerprint: digest(expected) };
}
