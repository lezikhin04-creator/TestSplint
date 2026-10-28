#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.local/postgres-runtime');
const dataDir = path.join(root, '.local/postgres-data');
const configPath = path.join(runtime, 'local-config.json');
const envPath = path.join(root, '.local/postgres.env');
const version = '18.4.0-beta.17';
const action = process.argv[2] ?? 'start';
const exists = async (file) => access(file).then(() => true, () => false);
const run = (cmd, args, cwd = root) => {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(cmd)} failed (exit ${result.status}).`);
};

if (process.getuid?.() === 0) throw new Error('Run local PostgreSQL as a regular user. This helper never creates OS accounts.');
if (!['setup', 'start', 'stop', 'status'].includes(action)) throw new Error('Usage: node scripts/local-postgres.mjs setup|start|stop|status');

await mkdir(runtime, { recursive: true, mode: 0o700 });
const platformPackage = path.join(runtime, 'node_modules', '@embedded-postgres', `${process.platform}-${process.arch}`);
if (action === 'setup') {
  // Keep the optional test tool outside the application manifests and lockfile.
  // Disable arbitrary install scripts; run only the pinned native package's symlink hydrator.
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', runtime, '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', `embedded-postgres@${version}`]);
  const hydrator = path.join(platformPackage, 'scripts/hydrate-symlinks.js');
  if (await exists(hydrator)) run(process.execPath, [hydrator], platformPackage);
  console.log(`Installed embedded-postgres ${version} in ignored .local/. No global packages installed.`);
}

if (!(await exists(path.join(runtime, 'node_modules/embedded-postgres/dist/index.js')))) {
  throw new Error('Local PostgreSQL binary is missing. Run: node scripts/local-postgres.mjs setup');
}
let config;
if (await exists(configPath)) {
  config = JSON.parse(await readFile(configPath, 'utf8'));
} else {
  config = { port: 55432, user: 'splint_local', password: randomBytes(24).toString('hex') };
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
}
const url = (db) => `postgresql://${config.user}:${config.password}@127.0.0.1:${config.port}/${db}`;
await writeFile(envPath, `DATABASE_URL=${url('splint_dev')}\nTEST_DATABASE_URL=${url('splint_test')}\n`, { mode: 0o600 });
await chmod(envPath, 0o600);
if (action === 'setup') {
  console.log('Local connection settings written to .local/postgres.env (not printed). Start with: node scripts/local-postgres.mjs start');
  process.exit(0);
}

const { pg_ctl: pgCtl } = await import(pathToFileURL(path.join(platformPackage, 'dist/index.js')).href);
await chmod(pgCtl, 0o755);
if (action === 'stop' || action === 'status') {
  run(pgCtl, ['-D', dataDir, ...(action === 'stop' ? ['stop', '-m', 'fast', '-w'] : ['status'])]);
  process.exit(0);
}

const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(runtime, 'node_modules/embedded-postgres/dist/index.js')).href);
const db = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: config.port,
  user: config.user,
  password: config.password,
  authMethod: 'scram-sha-256',
  persistent: true,
  createPostgresUser: false,
  postgresFlags: ['-h', '127.0.0.1', '-c', 'unix_socket_directories=', '-c', 'max_connections=40'],
  onLog: () => {},
  onError: (error) => console.error(String(error).replaceAll(config.password, '[redacted]')),
});

try {
  if (!(await exists(path.join(dataDir, 'PG_VERSION')))) await db.initialise();
  await db.start();
  const client = db.getPgClient();
  await client.connect();
  try {
    for (const database of ['splint_dev', 'splint_test']) {
      const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      if (result.rowCount === 0) await client.query(`CREATE DATABASE "${database}"`);
    }
    const result = await client.query('SHOW server_version');
    console.log(`PostgreSQL ${result.rows[0].server_version} ready on 127.0.0.1:${config.port}.`);
    console.log('Dev/test URLs are in .local/postgres.env. Leave this terminal running; Ctrl-C stops PostgreSQL without deleting data.');
  } finally {
    await client.end();
  }
  // embedded-postgres registers process signal cleanup. Also exit if pg_ctl stops it externally.
  db.process?.once('close', () => process.exit(0));
  await new Promise(() => {});
} catch (error) {
  await db.stop().catch(() => {});
  console.error(error instanceof Error ? error.message.replaceAll(config.password, '[redacted]') : 'Local PostgreSQL failed.');
  process.exitCode = 1;
}
