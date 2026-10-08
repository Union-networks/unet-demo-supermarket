import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { createLazyProviderPool } from '../lib/provider-database-options';

const database = 'postgresql://fixture:CANARY_PASSWORD@database.invalid/provider?sslmode=require';

test('static imports defer invalid DB configuration; real login requests fail closed', async (t) => {
  const keys = ['NODE_ENV', 'NEXT_PHASE', 'UNET_PROVIDER_DATABASE_URL', 'UNET_PROVIDER_DATABASE_DATABASE_URL',
    'UNET_PROVIDER_DATABASE_CA', 'UNET_PROVIDER_ORIGIN', 'UNET_PROVIDER_SERVICE_ID', 'UNET_PROVIDER_SESSION_SECRET'];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  Object.assign(process.env, { NODE_ENV: 'production' });
  process.env.NEXT_PHASE = 'phase-production-build';
  process.env.UNET_PROVIDER_DATABASE_URL = 'CANARY_PASSWORD';
  delete process.env.UNET_PROVIDER_DATABASE_DATABASE_URL;
  delete process.env.UNET_PROVIDER_DATABASE_CA;
  process.env.UNET_PROVIDER_ORIGIN = 'https://provider.test';
  process.env.UNET_PROVIDER_SERVICE_ID = 'provider-test';
  process.env.UNET_PROVIDER_SESSION_SECRET = 'test-only-provider-session-secret-000000';
  const warnings: unknown[] = [];
  t.mock.method(console, 'warn', (record: unknown) => { warnings.push(record); });
  const query = t.mock.method(Pool.prototype, 'query', () => { throw new Error('unexpected_database_query'); });
  const connect = t.mock.method(Pool.prototype, 'connect', () => { throw new Error('unexpected_database_connection'); });
  const { providerPool: pool } = await import('../lib/provider-db');
  const { POST } = await import('../app/api/unet/login/challenge/route');

  for (const [url, ca, code] of [
    [undefined, undefined, 'provider_database_configuration_missing'],
    ['CANARY_PASSWORD', undefined, 'provider_database_configuration_invalid'],
    [database + '&ssl=false', undefined, 'provider_database_tls_required'],
    [database, 'CANARY_PASSWORD', 'provider_database_ca_invalid'],
  ]) {
    if (url === undefined) delete process.env.UNET_PROVIDER_DATABASE_URL;
    else process.env.UNET_PROVIDER_DATABASE_URL = url;
    if (ca === undefined) delete process.env.UNET_PROVIDER_DATABASE_CA;
    else process.env.UNET_PROVIDER_DATABASE_CA = ca;
    assert.throws(() => pool.query('SELECT 1'), { message: code });
    assert.throws(() => pool.connect(), { message: code });
    const response = await POST(new Request('https://provider.test/api/unet/login/challenge', {
      method: 'POST', headers: { origin: 'https://provider.test', 'content-type': 'application/json' }, body: '{}',
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { success: false, error: 'provider_temporarily_unavailable' });
  }
  assert.equal(query.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(warnings.length, 4);
  assert.ok(!JSON.stringify(warnings).includes('CANARY_PASSWORD'));
});

test('lazy pool initializes once and binds query, connect and event methods to the real pool', async (t) => {
  let reads = 0;
  const pool = createLazyProviderPool(() => { reads++; return database; });
  assert.equal(reads, 0);
  const result = { rows: [{ value: 1 }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
  const client = { release() {} } as PoolClient;
  let actual: Pool | undefined;
  t.mock.method(Pool.prototype, 'query', function (this: Pool) {
    actual = this;
    assert.ok(this instanceof Pool);
    assert.equal(new URL(this.options.connectionString!).hostname, 'database.invalid');
    assert.deepEqual(this.options.ssl, { rejectUnauthorized: true });
    return Promise.resolve(result);
  });
  t.mock.method(Pool.prototype, 'connect', function (this: Pool) {
    assert.equal(this, actual);
    return Promise.resolve(client);
  });
  assert.equal(await pool.query('SELECT 1'), result);
  assert.equal(await pool.connect(), client);
  let observed = false;
  pool.on('connect', () => { observed = true; });
  pool.emit('connect', client);
  assert.equal(observed, true);
  assert.equal(reads, 1);
  await pool.end();
});

test('failed lazy initialization is not cached and can retry corrected configuration', async (t) => {
  let connection = 'CANARY_PASSWORD';
  let reads = 0;
  const pool = createLazyProviderPool(() => { reads++; return connection; });
  assert.throws(() => pool.query('SELECT 1'), { message: 'provider_database_configuration_invalid' });
  assert.equal(reads, 1);
  connection = database;
  t.mock.method(Pool.prototype, 'query', () => Promise.resolve({ rows: [], rowCount: 0 }));
  await pool.query('SELECT 1');
  assert.equal(reads, 2);
  await pool.query('SELECT 1');
  assert.equal(reads, 2);
  await pool.end();
});
