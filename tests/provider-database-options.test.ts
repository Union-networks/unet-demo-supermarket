import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { providerDatabaseOptions } from '../lib/provider-database-options';
import { RequiredChannelBindingClient } from '../lib/provider-channel-binding';
import { checkServerIdentity, type ConnectionOptions, type PeerCertificate } from 'node:tls';

const database = 'postgresql://fixture:CANARY_PASSWORD@database.invalid/provider';

function assertVerifiedTls(ssl: unknown, ca?: string): void {
  assert.ok(ssl && typeof ssl === 'object');
  const { checkServerIdentity, ...options } = ssl as ConnectionOptions;
  assert.equal(typeof checkServerIdentity, 'function');
  assert.deepEqual(options, { rejectUnauthorized: true, ...(ca ? { ca } : {}) });
}
test('configuration diagnostics classify failures without retaining unknown parameter names or values', () => {
  for (const [url, reason] of [
    ['CANARY_PASSWORD', 'malformed_url'],
    [database + '#CANARY_PASSWORD', 'invalid_target'],
    [database + '?channel_binding=CANARY_PASSWORD', 'invalid_channel_binding'],
    [database + '?channel_binding=require&channel_binding=disable', 'duplicate_parameter'],
    [database + '?CANARY_PASSWORD=CANARY_PASSWORD', 'unsupported_parameter'],
    [database + '?ssl=true&ssl=false', 'duplicate_parameter'],
  ]) {
    assert.throws(() => providerDatabaseOptions(url, { NODE_ENV: 'production' }), error => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { configurationReason?: string }).configurationReason, reason);
      assert.equal(error.message, 'provider_database_configuration_invalid');
      assert.ok(!JSON.stringify(error).includes('CANARY_PASSWORD'));
      return true;
    });
  }
});
test('channel binding modes are explicit and required binding selects the guarded pg client', () => {
  for (const mode of ['require', 'prefer', 'disable']) {
    const config = providerDatabaseOptions(database + '?sslmode=require&channel_binding=' + mode, { NODE_ENV: 'production' });
    assert.equal(config.enableChannelBinding, mode !== 'disable');
    assert.equal(config.Client, mode === 'require' ? RequiredChannelBindingClient : undefined);
    assert.equal(new URL(config.connectionString!).searchParams.has('channel_binding'), false);
    const client = mode === 'require' ? new RequiredChannelBindingClient(config) : new Client(config);
    assertVerifiedTls(client.ssl);
  }
  assert.equal(providerDatabaseOptions(database, { NODE_ENV: 'production' }).enableChannelBinding, false);
  const local = database.replace('database.invalid', 'localhost');
  assertVerifiedTls(providerDatabaseOptions(local + '?channel_binding=require', { NODE_ENV: 'test' }).ssl);
  for (const query of ['sslmode=disable', 'ssl=false', 'ssl=0']) {
    assert.throws(() => providerDatabaseOptions(local + '?channel_binding=require&' + query, { NODE_ENV: 'test' }),
      { message: 'provider_database_tls_required' });
  }
  for (const mode of ['', 'required', 'REQUIRE', 'true']) {
    assert.throws(() => providerDatabaseOptions(database + '?channel_binding=' + mode, { NODE_ENV: 'production' }),
      error => (error as Error & { configurationReason: string }).configurationReason === 'invalid_channel_binding');
  }
});

test('production pg connection uses certificate verification even for sslmode=require', () => {
  for (const query of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full', '?ssl=true']) {
    const config = providerDatabaseOptions(database + query, { NODE_ENV: 'production' });
    const client = new Client(config);
    assertVerifiedTls(client.ssl);
    assert.equal(new URL(config.connectionString!).searchParams.has('sslmode'), false);
    assert.equal(config.connectionTimeoutMillis, 10_000);
  }
});

test('only literal loopback development databases may use plaintext', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = database.replace('database.invalid', host);
    assert.equal(providerDatabaseOptions(url, { NODE_ENV: 'test' }).ssl, false);
    assertVerifiedTls(providerDatabaseOptions(url, { NODE_ENV: 'production' }).ssl);
    assertVerifiedTls(providerDatabaseOptions(url + '?sslmode=require', { NODE_ENV: 'test' }).ssl);
  }
  for (const url of [database.replace('CANARY_PASSWORD', 'localhost'), database + '?application_name=127.0.0.1',
    database.replace('database.invalid', 'localhost.attacker.invalid')]) {
    assertVerifiedTls(providerDatabaseOptions(url, { NODE_ENV: 'development' }).ssl);
  }
});

test('TLS and pg host override attempts cannot weaken transport', () => {
  for (const query of ['sslmode=no-verify', 'sslmode=disable', 'sslmode=prefer', 'ssl=false',
    'sslmode=require&sslmode=no-verify', 'sslmode=require&uselibpqcompat=true',
    'host=localhost', 'sslrootcert=/tmp/attacker.pem', 'sslcert=/tmp/client.pem', 'ssl=1&ssl=0']) {
    assert.throws(() => providerDatabaseOptions(database + '?' + query, { NODE_ENV: 'production' }),
      error => error instanceof Error && /^provider_database_(configuration_invalid|tls_required)$/.test(error.message));
  }
});

test('provider-owned CA is preserved through the actual pg configuration parser', () => {
  const ca = '-----BEGIN CERTIFICATE-----\nSYNTHETIC_PUBLIC_CA\n-----END CERTIFICATE-----';
  for (const mode of ['', '&channel_binding=require', '&channel_binding=prefer', '&channel_binding=disable']) {
    const config = providerDatabaseOptions(database + '?sslmode=require' + mode, { NODE_ENV: 'production',
      UNET_PROVIDER_DATABASE_CA: ca.replace(/\n/g, '\\n') });
    assertVerifiedTls(new Client(config).ssl, ca);
  }
});

test('certificate identity checks always use the configured DNS or IP target, not a TLS fallback host', () => {
  for (const [host, subjectaltname] of [['database.invalid', 'DNS:database.invalid'],
    ['127.0.0.1', 'IP Address:127.0.0.1']]) {
    const config = providerDatabaseOptions(database.replace('database.invalid', host), { NODE_ENV: 'production' });
    const ssl = config.ssl as ConnectionOptions;
    const certificate = { subject: { CN: 'synthetic' }, subjectaltname } as PeerCertificate;
    assert.equal(ssl.checkServerIdentity!('wrong-tls-fallback.invalid', certificate), undefined);
    const wrong = { subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost' } as PeerCertificate;
    assert.equal((ssl.checkServerIdentity!('localhost', wrong) as NodeJS.ErrnoException).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
  }
});

test('IPv6 identity checking delegates to Node TLS without an insecure runtime workaround', () => {
  const config = providerDatabaseOptions(database.replace('database.invalid', '[::1]'), { NODE_ENV: 'production' });
  const certificate = { subject: {}, subjectaltname: 'IP Address:0:0:0:0:0:0:0:1' } as PeerCertificate;
  const callback = (config.ssl as ConnectionOptions).checkServerIdentity!;
  // Node 24.18.0 has a known fail-closed IPv6 regression; fixed runtimes may pass.
  assert.equal((callback('localhost', certificate) as NodeJS.ErrnoException | undefined)?.code,
    (checkServerIdentity('::1', certificate) as NodeJS.ErrnoException | undefined)?.code);
  const wrong = { subject: {}, subjectaltname: 'DNS:localhost' } as PeerCertificate;
  assert.equal((callback('localhost', wrong) as NodeJS.ErrnoException).code, 'ERR_TLS_CERT_ALTNAME_INVALID');
});

test('configuration failures reveal no supplied database credentials', () => {
  for (const url of ['CANARY_PASSWORD', 'http://fixture:CANARY_PASSWORD@database.invalid/provider',
    database + '#CANARY_PASSWORD']) {
    assert.throws(() => providerDatabaseOptions(url, { NODE_ENV: 'production' }),
      error => error instanceof Error && error.message === 'provider_database_configuration_invalid');
  }
  assert.throws(() => providerDatabaseOptions(database, { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: 'CANARY_PASSWORD' }),
    { message: 'provider_database_ca_invalid' });
  assert.throws(() => providerDatabaseOptions(undefined, { NODE_ENV: 'production' }),
    { message: 'provider_database_configuration_missing' });
  assert.throws(() => providerDatabaseOptions(undefined, { NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }),
    { message: 'provider_database_configuration_missing' });
});

test('schema and application options survive without TLS downgrades', () => {
  const config = providerDatabaseOptions(database + '?options=-c%20search_path%3Dtest_schema&application_name=acceptance', { NODE_ENV: 'production' });
  const url = new URL(config.connectionString!);
  assert.equal(url.searchParams.get('options'), '-c search_path=test_schema');
  assert.equal(url.searchParams.get('application_name'), 'acceptance');
  assertVerifiedTls(new Client(config).ssl);
});

