import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkServerIdentity } from 'node:tls';

// Local-only, disposable acceptance. Never reads .env, reuses a service, or
// touches provider tables, keys, ledger/audit artifacts or remote databases.
assert.deepEqual(process.argv.slice(2), ['--execute-local-disposable']);
assert.equal(process.platform, 'win32');
const provider = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(provider, 'package.json'));
const { Client } = require('pg');
const pg = 'C:/Program Files/PostgreSQL/18/bin';
const openssl = 'C:/Program Files/Git/usr/bin/openssl.exe';
const opensslConfig = 'C:/Program Files/Git/usr/ssl/openssl.cnf';
for (const tool of ['initdb.exe', 'pg_ctl.exe']) assert.ok(existsSync(join(pg, tool)));
assert.ok(existsSync(openssl)); assert.ok(existsSync(opensslConfig));
const temporary = realpathSync(tmpdir());
const root = realpathSync(mkdtempSync(join(temporary, 'unet-binding-pg-')));
const owner = randomBytes(16).toString('hex'), password = randomBytes(24).toString('hex');
const data = join(root, 'data'), caFile = join(root, 'server.pem'), keyFile = join(root, 'server.key');
const verifyRoot = () => {
  assert.equal(realpathSync(root), root);
  assert.equal(dirname(root).toLowerCase(), temporary.toLowerCase());
  assert.match(basename(root), /^unet-binding-pg-[A-Za-z0-9]+$/);
  assert.equal(relative(root, resolve(data)), 'data');
  assert.equal(readFileSync(join(root, 'owner'), 'utf8'), owner);
};
const environment = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  COMSPEC: process.env.COMSPEC, USERNAME: process.env.USERNAME,
  PATH: `${pg};${dirname(process.execPath)}`, TEMP: root, TMP: root, TMPDIR: root,
  HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
  NODE_ENV: 'test', TSX_DISABLE_CACHE: '1', NO_COLOR: '1' };
const command = (tool, args) => execFileSync(tool, args, { env: environment, windowsHide: true,
  stdio: basename(tool) === 'pg_ctl.exe' ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  timeout: 60_000, maxBuffer: 1024 * 1024 });
let started = false, client, failed = false, stage = 'preflight';
writeFileSync(join(root, 'owner'), owner, { mode: 0o600 });
try {
  verifyRoot();
  const listener = createServer();
  await new Promise((ok, fail) => { listener.once('error', fail); listener.listen(0, '127.0.0.1', ok); });
  const port = listener.address().port;
  await new Promise(ok => listener.close(ok));
  writeFileSync(join(root, 'password'), password, { mode: 0o600 });
  stage = 'certificate';
  command(openssl, ['req', '-config', opensslConfig, '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyFile, '-out', caFile]);
  stage = 'initialize';
  command(join(pg, 'initdb.exe'), ['-D', data, '-U', 'binding_scram', '-A', 'scram-sha-256',
    '--pwfile', join(root, 'password'), '--no-locale', '--encoding=UTF8']);
  writeFileSync(join(data, 'postgresql.auto.conf'), [
    "listen_addresses='127.0.0.1'", `port=${port}`, 'ssl=on',
    `ssl_cert_file='${caFile.replaceAll('\\', '/')}'`, `ssl_key_file='${keyFile.replaceAll('\\', '/')}'`,
    'max_connections=10', "shared_buffers='32MB'", "log_min_messages='warning'", "log_statement='none'",
  ].join('\n') + '\n');
  writeFileSync(join(data, 'pg_hba.conf'), [
    'host all binding_trust 127.0.0.1/32 trust',
    'host all binding_md5 127.0.0.1/32 md5',
    'host all binding_password 127.0.0.1/32 password',
    'host all all 127.0.0.1/32 scram-sha-256',
  ].join('\n') + '\n');
  stage = 'start';
  command(join(pg, 'pg_ctl.exe'), ['-D', data, '-l', join(root, 'postgres.log'), '-w', '-t', '30', 'start']);
  started = true;
  const ca = readFileSync(caFile, 'utf8');
  client = new Client({ host: '127.0.0.1', port, user: 'binding_scram', database: 'postgres', password,
    ssl: { ca, rejectUnauthorized: true, checkServerIdentity: (_host, cert) => checkServerIdentity('127.0.0.1', cert) },
    connectionTimeoutMillis: 8000, statement_timeout: 8000 });
  stage = 'roles';
  await client.connect();
  await client.query("SET password_encryption='md5'");
  // Only generated hex is interpolated into this owned disposable database.
  for (const role of ['binding_trust', 'binding_md5', 'binding_password']) {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
  }
  await client.end(); client = undefined;
  stage = 'integration';
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', pathToFileURL(require.resolve('tsx')).href,
    '--test', 'tests/provider-channel-binding.postgres.test.ts', 'tests/login-postgres.test.ts'], { cwd: provider, windowsHide: true, encoding: 'utf8',
    env: { ...environment, UNET_CHANNEL_BINDING_TEST_DATABASE_URL: `postgresql://binding_scram:${password}@127.0.0.1:${port}/postgres`,
      UNET_CHANNEL_BINDING_TEST_CA: caFile,
      // Existing login semantics acceptance uses only this same owned loopback cluster.
      UNET_PROVIDER_TEST_DATABASE_URL: `postgresql://binding_scram:${password}@127.0.0.1:${port}/postgres`,
    }, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  assert.equal(result.error, undefined); assert.equal(result.status, 0, 'channel_binding_postgres_acceptance_failed');
} catch {
  failed = true;
  process.stderr.write(JSON.stringify({ stage, category: 'channel_binding_disposable_acceptance_failed' }) + '\n');
} finally {
  if (client) await client.end().catch(() => { failed = true; });
  verifyRoot();
  if (started || existsSync(join(data, 'postmaster.pid'))) {
    assert.equal(readFileSync(join(data, 'PG_VERSION'), 'utf8').trim(), '18');
    try { command(join(pg, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', '-t', '30', 'stop']); }
    catch { failed = true; }
  }
  if (!existsSync(join(data, 'postmaster.pid'))) {
    verifyRoot(); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    process.stdout.write('channel_binding_disposable_postgres_cleanup_complete\n');
  } else { failed = true; process.stderr.write('channel_binding_disposable_postgres_cleanup_requires_attention\n'); }
}
process.exitCode = failed ? 1 : 0;
