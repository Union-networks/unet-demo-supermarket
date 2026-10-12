import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { runSupermarketMiniappLogin, type SupermarketHostRequest } from '../lib/miniapp-login';
import type { AccountState } from '../lib/types';
import { GET as serviceManifest } from '../app/.well-known/unet-service.json/route';

const origin = 'https://shop.example';
const launchToken = 'a'.repeat(64);
const challenge = { protocolVersion: 2, serviceId: 'shop', origin, requestRef: 'test-request', challenge: 'test-challenge',
  challengeUrl: `${origin}/api/unet/login/challenge`, approvalUrl: `${origin}/api/unet/login/approve`, expiresAtIso: new Date(Date.now() + 600_000).toISOString() };
const state: AccountState = { favorites: ['apples'], basket: [{ productId: 'apples', quantity: 2 }] };

test('supermarket service manifest advertises same-document launch readiness', async () => {
  const body = await (await serviceManifest()).json();
  assert.deepEqual(body.miniapp, { launchReadinessVersion: 1 });
  assert.equal(body.endpoints.exchange, `${body.origin}/api/unet/login/exchange`);
});

function harness(t: TestContext, change: { exchangeAccount?: string; stateAccount?: string; unavailable?: boolean; malformed?: boolean; deferred?: Promise<void>; ack?: unknown } = {}) {
  const calls: string[] = [];
  const completions: Record<string, unknown>[] = [];
  const installed: { scopedUserId: string; state: AccountState }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.endsWith('/challenge')) return Response.json({ success: true, challenge });
    if (url.endsWith('/exchange')) {
      assert.deepEqual(JSON.parse(options.body as string), { requestRef: challenge.requestRef });
      return Response.json({ success: true, scopedUserId: change.exchangeAccount ?? 'approved-account' });
    }
    if (url === '/api/account-state') {
      if (change.deferred) await change.deferred;
      if (change.unavailable) return Response.json({ success: false }, { status: 503 });
      return Response.json({ success: true, scopedUserId: change.stateAccount ?? 'approved-account', state: change.malformed ? { favorites: [], basket: [null] } : state });
    }
    throw new Error('unexpected_fetch');
  });
  const host: SupermarketHostRequest = async <T>(action: string, payload: Record<string, unknown>): Promise<T> => {
    if (action === 'host.createServiceSession') {
      calls.push('approve');
      assert.deepEqual(payload, { challenge });
      return { requestRef: challenge.requestRef, approved: true, scopedUserId: 'approved-account',
        launchReadiness: { version: 1, launchToken, expiresAtMs: Date.now() + 20_000 } } as T;
    }
    assert.equal(action, 'host.completeLaunch');
    calls.push('complete');
    completions.push(payload);
    return (Object.hasOwn(change, 'ack') ? change.ack : { completed: true }) as T;
  };
  return { calls, completions, installed, run: () => runSupermarketMiniappLogin(origin, host, new AbortController().signal, (scopedUserId, authoritative) => {
    calls.push('install');
    installed.push({ scopedUserId, state: authoritative });
  }) };
}

test('initial cart and favorites use the exchanged ID and install before exact ready completion', async t => {
  const flow = harness(t);
  assert.deepEqual(await flow.run(), { scopedUserId: 'approved-account' });
  assert.deepEqual(flow.installed, [{ scopedUserId: 'approved-account', state }]);
  assert.deepEqual(flow.calls, ['/api/unet/login/challenge', 'approve', '/api/unet/login/exchange', '/api/account-state', 'install', 'complete']);
  assert.deepEqual(flow.completions, [{ requestRef: challenge.requestRef, launchToken, state: 'ready', stage: 'initial_status', outcome: 'success' }]);
});

test('no readiness or cached state is installed while the authoritative read is pending', async t => {
  let release!: () => void;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  const flow = harness(t, { deferred });
  const result = flow.run();
  while (!flow.calls.includes('/api/account-state')) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(flow.installed.length, 0);
  assert.equal(flow.completions.length, 0);
  release();
  await result;
  assert.equal(flow.completions[0].state, 'ready');
});

for (const change of [{ exchangeAccount: 'old-cookie-account' }, { stateAccount: 'old-cookie-account' }, { unavailable: true }, { malformed: true }]) {
  test(`mismatch or outage does not install stale state or auto-retry: ${JSON.stringify(change)}`, async t => {
    const flow = harness(t, change);
    await assert.rejects(flow.run());
    assert.deepEqual(flow.installed, []);
    assert.deepEqual(flow.completions, [{ requestRef: challenge.requestRef, launchToken, state: 'failed', stage: 'initial_status', outcome: 'unavailable' }]);
    assert.equal(flow.calls.filter(path => path.endsWith('/challenge')).length, 1);
  });
}

for (const ack of [null, {}, { completed: false }, { success: true }]) {
  test(`ready requires explicit host acknowledgement without contradictory failure: ${JSON.stringify(ack)}`, async t => {
    const flow = harness(t, { ack });
    await assert.rejects(flow.run());
    assert.equal(flow.completions.length, 1);
    assert.equal(flow.completions[0].state, 'ready');
  });
}

test('fresh startup skips old cookies and ready tasks remain stable with only user-driven retry', () => {
  const client = readFileSync(new URL('../components/SupermarketApp.tsx', import.meta.url), 'utf8');
  assert.match(client, /if \(readMiniAppMode\(\)\) return;\s*let cancelled/);
  assert.match(client, /if \(!readMiniAppMode\(\) \|\| miniAppAttempted.current\) return/);
  assert.match(client, /if \(miniAppReady.current\) return/);
  assert.match(client, /miniAppAttempts.current >= 3/);
  assert.doesNotMatch(client, /\.then\(\(\) => loadState\(\)\)|loadState\(\)/);
  const adapter = readFileSync(new URL('../lib/miniapp-login.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(adapter, /localStorage|sessionStorage|location\.|for \(/);
});
