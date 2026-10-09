import assert from 'node:assert/strict';
import { format } from 'node:util';
import test from 'node:test';

test('actual provider routes sanitize initialization failures and preserve SDK responses', async (t) => {
  process.env.UNET_PROVIDER_ORIGIN = 'https://provider.test';
  process.env.UNET_PROVIDER_SERVICE_ID = 'provider-test';
  process.env.UNET_PROVIDER_SESSION_SECRET = 'test-only-provider-session-secret-000000';
  process.env.CRON_SECRET = 'test-only-cron-secret';
  const state = globalThis as Record<string, unknown>;
  const canary = 'SYNTHETIC_DB_PASSWORD_QUERY_PROOF_CANARY';
  const failure = Object.assign(new Error(canary, { cause: new Error(canary) }), {
    detail: { scopedUserId: canary, capability: canary, sql: canary },
  });
  let mode: 'sync' | 'async' | 'ready' = 'sync';
  let schemaAttempts = 0;
  state.__unetSupermarketProviderPool = {
    query: () => {
      schemaAttempts++;
      if (mode === 'sync') throw failure;
      if (mode === 'async') return Promise.reject(failure);
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    connect: () => { throw new Error('unexpected_database_connection'); },
  };
  delete state.__unetSupermarketDirectLoginReady;
  delete state.__unetSupermarketDirectLogin;
  const captured: string[] = [];
  const warn = t.mock.method(console, 'warn', (...args: unknown[]) => { captured.push(format(...args)); });
  t.mock.method(console, 'error', (...args: unknown[]) => { captured.push(format(...args)); });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected_network_request'); });

  const challenge = await import('../app/api/unet/login/challenge/route');
  const approval = await import('../app/api/unet/login/approve/route');
  const status = await import('../app/api/unet/login/status/route');
  const exchange = await import('../app/api/unet/login/exchange/route');
  const retirement = await import('../app/api/unet/account/retire/route');
  const worker = await import('../app/api/internal/retirements/process/route');
  const { supermarketLoginHandlers } = await import('../lib/direct-login');
  const { runProviderRoute, recordProviderFailure } = await import('../lib/provider-route');
  const routes = [
    ['login_challenge', challenge.POST, 'POST'],
    ['login_challenge_details', challenge.GET, 'GET'],
    ['login_approve', approval.POST, 'POST'],
    ['login_status', status.GET, 'GET'],
    ['login_exchange', exchange.POST, 'POST'],
    ['account_retire', retirement.POST, 'POST'],
  ] as const;
  const request = (method: string) => new Request('https://provider.test/api/fixture?secret=' + canary, {
    method, headers: { origin: 'https://wrong-origin.test', 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

  for (const [operation, invoke, method] of routes) {
    await t.test(operation + ' catches real schema initialization rejection', async () => {
      for (const failureMode of ['sync', 'async'] as const) {
        mode = failureMode;
        const before = schemaAttempts;
        const warnings = warn.mock.callCount();
        const response = await invoke(request(method));
        assert.equal(response.status, 503);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), { success: false, error: 'provider_temporarily_unavailable' });
        assert.equal(schemaAttempts, before + 1, 'a failed initialization must be retried, not cached forever');
        assert.equal(state.__unetSupermarketDirectLoginReady, undefined);
        assert.equal(warn.mock.callCount(), warnings + 1);
        const record = warn.mock.calls.at(-1)!.arguments[0] as Record<string, unknown>;
        assert.equal(record.operation, operation);
        assert.equal(record.event, 'provider_route_failed');
        assert.match(String(record.diagnosticId), /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
      }
    });
  }

  await t.test('scheduled worker authentication remains unchanged and initialized failure is contained', async () => {
    const before = schemaAttempts;
    const denied = await worker.GET(new Request('https://provider.test/api/internal/retirements/process'));
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { success: false, error: 'unauthorized' });
    assert.equal(schemaAttempts, before);
    const failed = await worker.GET(new Request('https://provider.test/api/internal/retirements/process', {
      headers: { authorization: 'Bearer test-only-cron-secret' },
    }));
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { success: false, error: 'provider_temporarily_unavailable' });
  });

  await t.test('recovered initialization reaches actual SDK handlers with identical status/body/headers', async () => {
    mode = 'ready';
    const handlers = await supermarketLoginHandlers();
    const direct = [handlers.challenge, handlers.challengeDetails, handlers.approve, handlers.challengeStatus, handlers.exchange, handlers.retire];
    for (const [index, [, invoke, method]] of routes.entries()) {
      const expected = await direct[index](request(method));
      const actual = await invoke(request(method));
      assert.equal(actual.status, expected.status);
      assert.deepEqual(await actual.json(), await expected.json());
      assert.deepEqual([...actual.headers], [...expected.headers]);
    }
  });

  await t.test('successful and controlled SDK responses are returned without reconstruction', async () => {
    for (const code of [200, 400, 401, 403, 404, 409, 500, 503]) {
      const response = new Response('unchanged-sdk-body', { status: code, headers: { 'set-cookie': 'synthetic=value; HttpOnly', 'cache-control': 'no-store' } });
      assert.equal(await runProviderRoute('login_exchange', async () => response), response);
    }
    const failed = await runProviderRoute('login_exchange', async () => { await Promise.resolve(); throw failure; });
    assert.equal(failed.status, 503);
  });

  await t.test('diagnostic runtime allowlists reject arbitrary strings and extra error fields', () => {
    recordProviderFailure(canary as never, canary as never);
    const record = warn.mock.calls.at(-1)!.arguments[0] as Record<string, unknown>;
    assert.deepEqual(Object.keys(record).sort(), ['diagnosticId', 'event', 'failureCategory', 'operation', 'outcome']);
    assert.equal(record.operation, 'unknown');
    assert.equal(record.event, 'provider_route_failed');
  });

  assert.equal(network.mock.callCount(), 0);
  assert.ok(!captured.join('\n').includes(canary));
  const ids = warn.mock.calls.map(call => (call.arguments[0] as Record<string, unknown>).diagnosticId);
  assert.equal(new Set(ids).size, ids.length);
});

