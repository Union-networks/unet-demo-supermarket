import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { proxy, config } from '../proxy';

const loginPaths = ['challenge', 'approve', 'status', 'exchange'];

test('static Direct Login OPTIONS advertises exact methods without database or network access', async t => {
  const saved = new Map(['NODE_ENV', 'UNET_PROVIDER_DATABASE_URL', 'UNET_PROVIDER_DATABASE_DATABASE_URL',
    'UNET_PROVIDER_DATABASE_CA', 'UNET_LOGIN_SECURITY_MAINTENANCE'].map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, { NODE_ENV: 'production' });
  delete process.env.UNET_PROVIDER_DATABASE_DATABASE_URL;
  delete process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
  const query = t.mock.method(Pool.prototype, 'query', () => { throw new Error('unexpected_database_query'); });
  const connect = t.mock.method(Pool.prototype, 'connect', () => { throw new Error('unexpected_database_connection'); });
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected_network_request'); });
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const routes = [
    ['/api/unet/login/challenge', await import('../app/api/unet/login/challenge/route'), 'OPTIONS, GET, POST'],
    ['/api/unet/login/approve', await import('../app/api/unet/login/approve/route'), 'OPTIONS, POST'],
    ['/api/unet/login/status', await import('../app/api/unet/login/status/route'), 'OPTIONS, GET'],
    ['/api/unet/login/exchange', await import('../app/api/unet/login/exchange/route'), 'OPTIONS, POST'],
    ['/api/unet/account/retire', await import('../app/api/unet/account/retire/route'), 'OPTIONS, POST'],
  ] as const;
  for (const database of [undefined, 'CANARY_INVALID_DATABASE_URL']) {
    if (database === undefined) delete process.env.UNET_PROVIDER_DATABASE_URL;
    else process.env.UNET_PROVIDER_DATABASE_URL = database;
    process.env.UNET_PROVIDER_DATABASE_CA = 'CANARY_INVALID_CA';
    for (const [path, route, allow] of routes) {
      const response = await route.OPTIONS();
      assert.equal(response.status, 204, path);
      assert.equal(await response.text(), '');
      assert.equal(response.headers.get('x-unet-protocol-version'), '2');
      assert.equal(response.headers.get('allow'), allow);
      assert.equal(response.headers.get('x-unet-capabilities'), 'direct_login');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      const implemented = Object.keys(route).filter(key => ['OPTIONS', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(key));
      assert.deepEqual(implemented.sort(), allow.split(', ').sort());
      if (path.startsWith('/api/unet/login/')) {
        assert.equal(proxy(new Request('https://provider.test' + path, { method: 'OPTIONS' })).headers.get('x-middleware-next'), '1');
      }
    }
  }
  assert.equal(query.mock.callCount(), 0);
  assert.equal(connect.mock.callCount(), 0);
  assert.equal(network.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 0);
  assert.equal(error.mock.callCount(), 0);
  const { providerPool } = await import('../lib/provider-db');
  assert.throws(() => providerPool.query('SELECT 1'), { message: 'provider_database_configuration_invalid' });
  assert.equal(query.mock.callCount(), 0);
});

test('maintenance bypass permits only known login OPTIONS metadata, never login operations', async t => {
  const saved = process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
  t.after(() => {
    if (saved === undefined) delete process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
    else process.env.UNET_LOGIN_SECURITY_MAINTENANCE = saved;
  });
  assert.deepEqual(config.matcher, ['/api/unet/login/:path*']);
  for (const flag of [undefined, 'true', 'FALSE', '']) {
    if (flag === undefined) delete process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
    else process.env.UNET_LOGIN_SECURITY_MAINTENANCE = flag;
    for (const path of loginPaths) {
      for (const suffix of ['', '/', '?requestRef=CANARY']) {
        const response = proxy(new Request('https://provider.test/api/unet/login/' + path + suffix, { method: 'OPTIONS' }));
        assert.equal(response.headers.get('x-middleware-next'), '1');
      }
      for (const method of ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
        const response = proxy(new Request('https://provider.test/api/unet/login/' + path, { method }));
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('x-middleware-next'), null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(response.headers.get('retry-after'), '300');
        assert.equal((await response.json()).error, 'login_temporarily_unavailable');
      }
    }
    for (const path of ['/api/unet/login', '/api/unet/login/unknown', '/api/unet/login/challenge/nested',
      '/api/unet/login/Challenge', '/api/unet/login/%63hallenge', '/api/unet/account/retire']) {
      assert.equal(proxy(new Request('https://provider.test' + path, { method: 'OPTIONS' })).status, 503);
    }
  }
  process.env.UNET_LOGIN_SECURITY_MAINTENANCE = 'false';
  for (const method of ['GET', 'POST']) {
    assert.equal(proxy(new Request('https://provider.test/api/unet/login/challenge', { method })).headers.get('x-middleware-next'), '1');
  }
});
