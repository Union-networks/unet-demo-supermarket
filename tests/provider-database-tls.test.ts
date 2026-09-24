import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createServer as createNetServer, type Socket } from 'node:net';
import { createServer as createTlsServer } from 'node:tls';
import test from 'node:test';
import { Client } from 'pg';
import { providerDatabaseOptions } from '../lib/provider-database-options';

// Actual pg + Node TLS handshake, not a SQL/database semantics test.
test('pg rejects foreign CA and wrong hostname before sending startup credentials', { timeout: 30_000 }, async (t) => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'unet-provider-tls-'));
  const openssl = process.env.UNET_TEST_OPENSSL ?? (process.platform === 'win32'
    ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const sockets = new Set<Socket>();
  async function fixture(name: string, san: string) {
    const key = join(directory, name + '.key'), cert = join(directory, name + '.pem');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-days', '1', '-subj', '/CN=unet-disposable-tls', '-addext', 'subjectAltName=' + san],
      { stdio: 'ignore', windowsHide: true, timeout: 10_000 });
    let startupPackets = 0;
    const tls = createTlsServer({ key: readFileSync(key), cert: readFileSync(cert) }, socket => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      socket.once('data', () => {
        startupPackets++;
        // AuthenticationOk + ReadyForQuery; no SQL request or database state.
        socket.write(Buffer.from('5200000008000000005a0000000549', 'hex'));
      });
    });
    tls.on('tlsClientError', () => undefined);
    const server = createNetServer(socket => {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => sockets.delete(socket));
      socket.once('data', packet => {
        if (packet.toString('hex') !== '0000000804d2162f') { socket.destroy(); return; }
        socket.write('S', () => tls.emit('connection', socket));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return { server, ca: readFileSync(cert, 'utf8'), url: 'postgresql://fixture:SYNTHETIC_SECRET@127.0.0.1:' + address.port + '/fixture?sslmode=require',
      startups: () => startupPackets };
  }
  const servers: Awaited<ReturnType<typeof fixture>>[] = [];
  try {
    const valid = await fixture('valid', 'DNS:localhost,IP:127.0.0.1');
    servers.push(valid);
    const wrongHost = await fixture('wrong', 'DNS:wrong.invalid');
    servers.push(wrongHost);
    await t.test('unknown issuer rejected with no startup packet', async () => {
      const client = new Client(providerDatabaseOptions(valid.url, { NODE_ENV: 'production' }));
      try { await assert.rejects(client.connect(), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }); }
      finally { await client.end(); }
      assert.equal(valid.startups(), 0);
    });
    await t.test('matching provider CA and hostname accepted', async () => {
      const client = new Client(providerDatabaseOptions(valid.url, { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: valid.ca }));
      try { await client.connect(); assert.equal(valid.startups(), 1); }
      finally { await client.end(); }
    });
    await t.test('trusted certificate with wrong hostname rejected with no startup packet', async () => {
      const client = new Client(providerDatabaseOptions(wrongHost.url, { NODE_ENV: 'production', UNET_PROVIDER_DATABASE_CA: wrongHost.ca }));
      try { await assert.rejects(client.connect(), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }); }
      finally { await client.end(); }
      assert.equal(wrongHost.startups(), 0);
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const { server } of servers) await new Promise<void>(resolve => server.close(() => resolve()));
    if (!directory.startsWith(root + sep) || !directory.includes('unet-provider-tls-')) throw new Error('unsafe_fixture_cleanup');
    rmSync(directory, { recursive: true, force: true });
  }
});

