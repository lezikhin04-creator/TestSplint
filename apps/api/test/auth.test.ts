import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateTelegram, encrypt, decrypt } from '../src/crypto.js';
import { readConfig } from '../src/config.js';

const token = '12345:test-token-not-a-real-credential';
function signed(date: number, extras: Record<string, string> = {}) {
  const values = new URLSearchParams({ user: JSON.stringify({ id: 777, first_name: 'Test', username: 'test_user' }), auth_date: String(date), signature: 'signed-field-must-be-in-hmac', ...extras });
  const check = [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  values.set('hash', createHmac('sha256', secret).update(check).digest('hex')); return values.toString();
}
test('Telegram HMAC validates original serialized fields and rejects tampering, duplicate keys and expiry', () => {
  const now = 1_800_000_000_000; const input = signed(now / 1000);
  assert.equal(validateTelegram(input, token, now).id, '777');
  assert.throws(() => validateTelegram(input.replace('Test', 'Evil'), token, now));
  assert.throws(() => validateTelegram(`${input}&auth_date=${now / 1000}`, token, now));
  assert.throws(() => validateTelegram(signed(now / 1000 - 301), token, now));
  assert.throws(() => validateTelegram(signed(now / 1000 + 31), token, now));
  assert.throws(() => validateTelegram(signed(now / 1000, { auth_date: 'NaN' }), token, now));
  assert.throws(() => validateTelegram(input.replace('signed-field-must-be-in-hmac', 'tampered'), token, now));
  const reordered = new URLSearchParams([...new URLSearchParams(input).entries()].reverse());
  reordered.set('hash', reordered.get('hash')!.toUpperCase());
  assert.equal(validateTelegram(reordered.toString(), token, now).bootstrapFingerprint, validateTelegram(input, token, now).bootstrapFingerprint);
});
test('Bootstrap cache encryption detects changed ciphertext', () => {
  const key = 'only-test-key-32-characters-or-more'; const encrypted = encrypt('session-token', key);
  assert.equal(decrypt(encrypted, key), 'session-token');
  const changed = Buffer.from(encrypted, 'base64url'); changed[30] ^= 1;
  assert.throws(() => decrypt(changed.toString('base64url'), key));
});
test('Production refuses dev identity and requires secret configuration', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', ALLOW_DEV_AUTH: 'true' }), /forbidden/);
  assert.throws(() => readConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/test', APP_ORIGIN: 'https://splint.example' }), /SESSION_ENCRYPTION_KEY/);
});
