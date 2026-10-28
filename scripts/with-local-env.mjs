#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('Usage: node scripts/with-local-env.mjs npm run dev');
const inherited = { ...process.env };
// .env is explicit local configuration; ignored helper credentials fill only absent values.
for (const name of ['.env', '.local/postgres.env']) {
  const file = path.join(root, name);
  if (existsSync(file)) process.loadEnvFile(file);
}
// Shell-supplied variables always take priority over local files.
Object.assign(process.env, inherited);
const child = spawn(command, args, { cwd: root, env: process.env, stdio: 'inherit', shell: false });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
