import { readConfig } from './config.js';
import { createPool, migrate, transaction } from './db.js';
import { createMediaStore } from './media.js';
import { seedCatalog } from './seed.js';

async function main() {
  const command = process.argv[2];
  if (!['migrate', 'seed', 'support:list', 'support:resolve', 'catalog:restrict', 'catalog:unpublish', 'inbox:list'].includes(command || '')) throw new Error('Unknown command.');
  const config = readConfig(); const pool = createPool(config.databaseUrl);
  try {
    if (command === 'migrate') { await migrate(pool); console.log('Database migrations applied.'); }
    if (command === 'seed') {
      await seedCatalog(pool, createMediaStore(config));
      console.log('Original stage A catalog seeded without replacing existing artworks.');
    }
    if (command === 'support:list') console.log(JSON.stringify((await pool.query("SELECT id,kind,message,work_id,created_at FROM support_tickets WHERE status='open' ORDER BY created_at LIMIT 100")).rows, null, 2));
    if (command === 'inbox:list') console.log(JSON.stringify((await pool.query("SELECT bot_id,update_id,status,error_code,created_at FROM telegram_inbox WHERE status IN ('unknown','failed') ORDER BY created_at LIMIT 100")).rows, null, 2));
    if (['support:resolve', 'catalog:restrict', 'catalog:unpublish'].includes(command!)) {
      const [subject, ...reasonParts] = process.argv.slice(3); const reason = reasonParts.join(' '); const actor = process.env.STAFF_ACTOR;
      if (!subject || !reason || !actor) throw new Error('Management action requires STAFF_ACTOR, subject and reason.');
      await transaction(pool, async client => {
        const result = command === 'support:resolve' ? await client.query("UPDATE support_tickets SET status='closed',resolved_at=now(),resolution=$2 WHERE id=$1 RETURNING id", [subject, reason]) : await client.query(`UPDATE artworks SET ${command === 'catalog:restrict' ? 'restricted=true' : 'published=false'} WHERE id=$1 RETURNING id`, [subject]);
        if (!result.rowCount) throw new Error('Subject not found.');
        await client.query('INSERT INTO audit_events(actor,action,subject,detail) VALUES($1,$2,$3,$4)', [actor, command, subject, { reason }]);
      }); console.log('Management action recorded.');
    }
  } finally { await pool.end(); }
}
main().catch(() => { console.error('Command failed. Check configuration, database state and arguments. Sensitive error details are suppressed.'); process.exitCode = 1; });
