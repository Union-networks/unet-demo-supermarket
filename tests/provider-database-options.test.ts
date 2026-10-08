import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { providerDatabaseOptions } from '../lib/provider-database-options';

const database = 'postgresql://fixture:CANARY_PASSWORD@database.invalid/provider';
test('production pg connection uses certificate verification even for sslmode=require', () => {
  for (const query of ['', '?sslmode=require', '?sslmode=verify-ca', '?sslmode=verify-full', '?ssl=true']) {
    const config = providerDatabaseOptions(database + query, { NODE_ENV: 'production' });
    const client = new Client(config);
    assert.deepEqual(client.ssl, { rejectUnauthorized: true });
    assert.equal(new URL(config.connectionString!).searchParams.has('sslmode'), false);
    assert.equal(config.connectionTimeoutMillis, 10_000);
  }
});

test('only literal loopback development databases may use plaintext', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const url = database.replace('database.invalid', host);
    assert.equal(providerDatabaseOptions(url, { NODE_ENV: 'test' }).ssl, false);
    assert.deepEqual(providerDatabaseOptions(url, { NODE_ENV: 'production' }).ssl, { rejectUnauthorized: true });
    assert.deepEqual(providerDatabaseOptions(url + '?sslmode=require', { NODE_ENV: 'test' }).ssl, { rejectUnauthorized: true });
  }
  for (const url of [database.replace('CANARY_PASSWORD', 'localhost'), database + '?application_name=127.0.0.1',
    database.replace('database.invalid', 'localhost.attacker.invalid')]) {
    assert.deepEqual(providerDatabaseOptions(url, { NODE_ENV: 'development' }).ssl, { rejectUnauthorized: true });
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
  const config = providerDatabaseOptions(database + '?sslmode=require', { NODE_ENV: 'production',
    UNET_PROVIDER_DATABASE_CA: ca.replace(/\n/g, '\\n') });
  assert.deepEqual(new Client(config).ssl, { rejectUnauthorized: true, ca });
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
  assert.deepEqual(new Client(config).ssl, { rejectUnauthorized: true });
});

