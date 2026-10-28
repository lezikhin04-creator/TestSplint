import type pg from 'pg';
import type { Config } from './config.js';
import { transaction } from './db.js';

export async function botCall(config: Config, method: string, body: unknown): Promise<void> {
  if (!config.botToken) throw new Error('BOT_NOT_CONFIGURED');
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000) });
  const data = await response.json() as { ok?: boolean };
  if (!response.ok || !data.ok) throw new Error('BOT_API_REJECTED');
}
export async function acceptUpdate(pool: pg.Pool, config: Config, update: Record<string, any>): Promise<void> {
  const botId = config.botToken?.split(':')[0] || 'test';
  await pool.query('INSERT INTO telegram_inbox(bot_id,update_id,payload) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [botId, update.update_id, update]);
  // Test stage never approves a purchase. Repeating this negative answer cannot charge a user.
  if (update.pre_checkout_query?.id) {
    try { await botCall(config, 'answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: false, error_message: 'В тестовой версии Splint покупки отключены.' }); await pool.query("UPDATE telegram_inbox SET status='done',processed_at=now() WHERE bot_id=$1 AND update_id=$2", [botId, update.update_id]); }
    catch { await pool.query("UPDATE telegram_inbox SET status='failed',error_code='PRECHECKOUT_REPLY_FAILED' WHERE bot_id=$1 AND update_id=$2", [botId, update.update_id]); }
  }
}
export async function processInbox(pool: pg.Pool, config: Config, send: typeof botCall = botCall): Promise<void> {
  if (!config.botToken) return;
  const botId = config.botToken.split(':')[0];
  const row = await transaction(pool, async client => {
    // A crashed sender may already have sent its message; never blindly replay that RPC.
    await client.query("UPDATE telegram_inbox SET status='unknown',error_code='SENDER_INTERRUPTED' WHERE bot_id=$1 AND status='processing' AND lease_until<now()", [botId]);
    const item = (await client.query("SELECT * FROM telegram_inbox WHERE bot_id=$1 AND status='pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1", [botId])).rows[0];
    if (!item) return null;
    await client.query("UPDATE telegram_inbox SET status='processing',attempts=attempts+1,lease_until=now()+interval '30 seconds' WHERE bot_id=$1 AND update_id=$2", [item.bot_id, item.update_id]); return item;
  });
  if (!row) return;
  let status = 'done'; let errorCode: string | null = null;
  const message = row.payload.message;
  if (message?.successful_payment || message?.refunded_payment) { status = 'failed'; errorCode = 'UNEXPECTED_FINANCIAL_EVENT'; }
  else if (message?.chat?.type === 'private' && typeof message.text === 'string' && /^\/(start|help|paysupport)(?:\s|@|$)/.test(message.text)) {
    const text = message.text.startsWith('/paysupport') ? 'Покупки в этой тестовой версии отключены. Для обращения откройте Splint → Профиль → Поддержка. Номер обращения появится после отправки.' : message.text.startsWith('/help') ? 'Выберите работу в каталоге, раскрашивайте клетки по номерам и собирайте завершённые работы. Поддержка находится в профиле.' : 'Splint — раскрашивайте, создавайте свою коллекцию и делитесь результатом. Сейчас открыта тестовая версия с бесплатными работами.';
    try { await send(config, 'sendMessage', { chat_id: message.chat.id, text, reply_markup: { inline_keyboard: [[{ text: 'Открыть Splint', web_app: { url: config.origin } }]] } }); }
    catch { status = 'unknown'; errorCode = 'SEND_OUTCOME_UNKNOWN'; }
  }
  await pool.query('UPDATE telegram_inbox SET status=$3,error_code=$4,processed_at=now(),lease_until=NULL WHERE bot_id=$1 AND update_id=$2', [row.bot_id, row.update_id, status, errorCode]);
}
