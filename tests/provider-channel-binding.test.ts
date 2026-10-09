import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { TLSSocket } from 'node:tls';
import { Client } from 'pg';
import pgPackage from 'pg/package.json';
import { RequiredChannelBindingClient } from '../lib/provider-channel-binding';

const config = { host: 'localhost', user: 'synthetic', password: 'CANARY_PASSWORD', ssl: { rejectUnauthorized: true } };
type Session = { mechanism: string; message: string; serverSignature: string };
type FixtureClient = RequiredChannelBindingClient & {
  _connecting: boolean;
  _connected: boolean;
  _connectionCallback: (error?: Error | null) => void;
  _attachListeners(connection: FixtureClient['connection']): void;
  saslSession: Session | null;
  connection: RequiredChannelBindingClient['connection'] & {
    sendSASLInitialResponseMessage(mechanism: string, response: string): void;
    password(password: string): void;
    query(sql: string): void;
  };
};

function fixture(t: TestContext, tls: Partial<TLSSocket> = {}) {
  const client = new RequiredChannelBindingClient(config) as FixtureClient;
  const errors: Error[] = [], sent: string[] = [];
  const destroy = t.mock.fn();
  client.connection.stream = { encrypted: true, authorized: true,
    getPeerCertificate: () => ({ raw: Buffer.from('synthetic-public-certificate') }), destroy, ...tls } as TLSSocket;
  t.mock.method(client.connection, 'sendSASLInitialResponseMessage', (mechanism: string) => sent.push(mechanism));
  t.mock.method(client.connection, 'password', () => sent.push('PASSWORD'));
  t.mock.method(client.connection, 'query', () => sent.push('QUERY'));
  client._connecting = true;
  client._connectionCallback = error => { if (error) errors.push(error); };
  client._attachListeners(client.connection);
  return { client, errors, sent, destroy };
}

test('required client refuses unverified TLS, absent passwords and unreviewed pg versions', t => {
  for (const ssl of [false, true, {}, { rejectUnauthorized: false }]) {
    assert.throws(() => new RequiredChannelBindingClient({ ...config, ssl }), { message: 'provider_database_channel_binding_required' });
  }
  assert.throws(() => new RequiredChannelBindingClient({ ...config, password: '' }), { message: 'provider_database_channel_binding_required' });
  const version = pgPackage.version;
  t.after(() => { pgPackage.version = version; });
  pgPackage.version = '8.23.0';
  assert.throws(() => new RequiredChannelBindingClient(config), { message: 'provider_database_channel_binding_driver_unsupported' });
});

test('actual pg event listeners reject trust, cleartext, MD5 and unbound SCRAM before sending secrets or queries', async t => {
  for (const [event, message] of [
    ['authenticationCleartextPassword', {}], ['authenticationMD5Password', { salt: Buffer.alloc(4) }],
    ['authenticationSASL', { mechanisms: ['SCRAM-SHA-256'] }], ['readyForQuery', { status: 'I' }],
  ] as const) {
    await t.test(event, t => {
      const { client, errors, sent, destroy } = fixture(t);
      client.connection.emit(event, message);
      client.connection.emit('readyForQuery', { status: 'I' });
      assert.equal(errors.length, 1);
      assert.equal(errors[0].message, 'provider_database_channel_binding_required');
      assert.equal(client._connected, false);
      assert.deepEqual(sent, []);
      assert.equal(destroy.mock.callCount(), 1);
    });
  }
});

test('PLUS offers cannot bypass TLS authorization or certificate availability', async t => {
  for (const tls of [{ encrypted: false }, { authorized: false },
    { getPeerCertificate: () => ({ raw: Buffer.alloc(0) }) }, { getPeerCertificate: undefined }]) {
    await t.test(JSON.stringify(tls), t => {
      const { client, errors, sent } = fixture(t, tls as Partial<TLSSocket>);
      client.connection.emit('authenticationSASL', { mechanisms: ['SCRAM-SHA-256-PLUS'] });
      assert.equal(errors[0].message, 'provider_database_channel_binding_required');
      assert.deepEqual(sent, []);
    });
  }
});

test('pg selects PLUS, but cannot become ready without the verified server final', t => {
  const { client, errors, sent } = fixture(t);
  client.connection.emit('authenticationSASL', { mechanisms: ['SCRAM-SHA-256', 'SCRAM-SHA-256-PLUS'] });
  assert.deepEqual(sent, ['SCRAM-SHA-256-PLUS']);
  assert.equal(client.saslSession?.mechanism, 'SCRAM-SHA-256-PLUS');
  client.connection.emit('readyForQuery', { status: 'I' });
  assert.equal(errors[0].message, 'provider_database_channel_binding_required');
  assert.equal(client._connected, false);
});

test('wrong-order and repeated authentication messages fail closed', async t => {
  for (const event of ['authenticationSASL', 'authenticationSASLFinal', 'authenticationCleartextPassword', 'authenticationMD5Password']) {
    await t.test(event, t => {
      const { client, errors, sent } = fixture(t);
      client.connection.emit('authenticationSASL', { mechanisms: ['SCRAM-SHA-256-PLUS'] });
      client.connection.emit(event, { mechanisms: ['SCRAM-SHA-256-PLUS'], data: 'v=invalid' });
      assert.equal(errors[0].message, 'provider_database_channel_binding_required');
      assert.deepEqual(sent, ['SCRAM-SHA-256-PLUS']);
    });
  }
});

test('pg rejects bad server signatures and never releases a failed connection', async t => {
  // Only the expensive continuation is stubbed. Final proof validation is pg's
  // actual implementation; the disposable PostgreSQL test covers the full flow.
  t.mock.method(Client.prototype as unknown as { _handleAuthSASLContinue(): Promise<void> },
    '_handleAuthSASLContinue', async function (this: FixtureClient) {
      this.saslSession!.message = 'SASLResponse';
      this.saslSession!.serverSignature = Buffer.alloc(32, 1).toString('base64');
    });
  const { client, errors } = fixture(t);
  client.connection.emit('authenticationSASL', { mechanisms: ['SCRAM-SHA-256-PLUS'] });
  await client._handleAuthSASLContinue({ data: 'synthetic' });
  client.connection.emit('authenticationSASLFinal', { data: 'v=' + Buffer.alloc(32, 2).toString('base64') });
  client.connection.emit('readyForQuery', { status: 'I' });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /server signature does not match/);
  assert.equal(client._connected, false);
});

test('a ready message during async SCRAM computation cannot release the connection or revive a failed handshake', async t => {
  let finish!: () => void;
  t.mock.method(Client.prototype as unknown as { _handleAuthSASLContinue(): Promise<void> },
    '_handleAuthSASLContinue', async function (this: FixtureClient) {
      await new Promise<void>(resolve => { finish = resolve; });
      this.saslSession!.message = 'SASLResponse';
    });
  const { client, errors, sent } = fixture(t);
  client.connection.emit('authenticationSASL', { mechanisms: ['SCRAM-SHA-256-PLUS'] });
  const pending = client._handleAuthSASLContinue({ data: 'synthetic' });
  client.connection.emit('readyForQuery', { status: 'I' });
  finish(); await pending;
  client.connection.emit('authenticationSASLFinal', { data: 'v=invalid' });
  client.connection.emit('readyForQuery', { status: 'I' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'provider_database_channel_binding_required');
  assert.equal(client._connected, false);
  assert.deepEqual(sent, ['SCRAM-SHA-256-PLUS']);
});
