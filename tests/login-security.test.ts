import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore, createDirectLoginService, directLoginQrPayload } from '@u-net/server';

test('cookie-bound provider login and session security', async (t) => {
  process.env.UNET_PROVIDER_ORIGIN = 'https://provider.test';
  process.env.UNET_PROVIDER_SERVICE_ID = 'provider-test';
  process.env.UNET_PROVIDER_SESSION_SECRET = 'test-only-provider-session-secret-000000';
  const origin = process.env.UNET_PROVIDER_ORIGIN;
  const accountStore = new InMemoryDirectLoginAccountStore();
  const challengeStore = new InMemoryDirectLoginChallengeStore(accountStore);
  const service = createDirectLoginService({ serviceId: 'provider-test', origin, accountStore, challengeStore });
  let databaseUnavailable = false;
  let accountReads = 0;
  (globalThis as Record<string, unknown>).__unetSupermarketProviderPool = {
    query: async (sql: string, values: string[]) => {
      assert.match(sql, /unet_service_accounts_v2/);
      assert.match(sql, /status='active'/);
      accountReads++;
      if (databaseUnavailable) throw new Error('test_database_unavailable');
      const key = await accountStore.getPublicKey(values[0]);
      return { rows: key ? [{ account_public_key_pem: key }] : [] };
    },
  };
  const auth = await import('../lib/provider-session');
  const { supermarketLoginWebHandlers } = await import('../lib/login-web');
  const { createProviderChallenge, exchangeProviderChallenge, loginQrPayload } = await import('../lib/browser-login');
  const handlers = supermarketLoginWebHandlers(service, accountStore);
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const request = (path: string, body?: unknown, cookieHeader?: string, suppliedOrigin = origin) => new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { origin: suppliedOrigin, 'content-type': 'application/json', ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const createChallenge = async () => {
    const response = await handlers.challenge(request('/api/unet/login/challenge', {}));
    assert.equal(response.status, 200);
    const payload = await response.json();
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /Secure/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(payload).sort(), ['challenge', 'success']);
    assert.deepEqual(Object.keys(payload.challenge).sort(), ['approvalUrl','challenge','challengeUrl','expiresAtIso','origin','protocolVersion','requestRef','serviceId']);
    return { challenge: payload.challenge, cookie: setCookie.split(';')[0] };
  };
  const approve = async (challenge: Awaited<ReturnType<typeof createChallenge>>['challenge'], scopedUserId: string) => {
    const signedAtIso = new Date().toISOString();
    const approval = { protocolVersion: 2, requestRef: challenge.requestRef, serviceId: 'provider-test', origin, scopedUserId, accountPublicKeyPem: pem, signedAtIso };
    const canonical = ['unet-direct-login-v2', approval.serviceId, origin, challenge.requestRef,
      challenge.challenge, challenge.expiresAtIso, scopedUserId, pem, signedAtIso].join('\n');
    const response = await handlers.approve(request('/api/unet/login/approve', {
      ...approval, signature: sign(null, Buffer.from(canonical), privateKey).toString('base64url'),
    }));
    assert.equal(response.status, 200);
  };
  const principalRequest = (token: string) => new Request(origin, { headers: { cookie: 'unet_supermarket_session=' + token } });
  const signClaims = (claims: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return payload + '.' + createHmac('sha256', process.env.UNET_PROVIDER_SESSION_SECRET!).update(payload).digest('base64url');
  };

  await t.test('rejects cross-origin and non-JSON challenge creation', async () => {
    assert.equal((await handlers.challenge(request('/api/unet/login/challenge', {}, undefined, 'https://attacker.test'))).status, 403);
    assert.equal((await handlers.challenge(new Request(origin + '/api/unet/login/challenge', { method: 'POST' }))).status, 403);
    const nonJson = new Request(origin + '/api/unet/login/challenge', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '{}' });
    assert.notEqual((await handlers.challenge(nonJson)).status, 200);
  });

  await t.test('public challenge and QR never authorize poll or exchange; cookie exchange consumes once', async () => {
    const a = await createChallenge();
    const b = await createChallenge();
    assert.equal(loginQrPayload(a.challenge), directLoginQrPayload(a.challenge));
    const details = await handlers.challengeDetails(request('/api/unet/login/challenge?requestRef=' + a.challenge.requestRef));
    assert.deepEqual((await details.json()).challenge, a.challenge);
    await approve(a.challenge, 'scoped-user');
    const statusPath = '/api/unet/login/status?requestRef=' + a.challenge.requestRef;
    assert.equal((await handlers.challengeStatus(request(statusPath))).status, 403);
    assert.equal((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }))).status, 403);
    const wrongCookie = a.cookie.split('=')[0] + '=' + b.cookie.split('=')[1];
    assert.equal((await handlers.challengeStatus(request(statusPath, undefined, wrongCookie))).status, 403);
    assert.equal((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }, wrongCookie))).status, 403);
    assert.equal((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }, a.cookie, 'https://attacker.test'))).status, 403);
    const polled = await handlers.challengeStatus(request(statusPath, undefined, a.cookie));
    assert.deepEqual(await polled.json(), { success: true, state: 'approved' });
    assert.notEqual((await handlers.exchange(request('/api/unet/login/exchange', { sessionId: 'legacy-session' }, a.cookie))).status, 200);
    const responses = await Promise.all([
      handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }, a.cookie)),
      handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }, a.cookie)),
    ]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    const winner = responses.find((response) => response.status === 200)!;
    assert.deepEqual(await winner.json(), { success: true, scopedUserId: 'scoped-user' });
    const cookies = winner.headers.getSetCookie();
    assert.ok(cookies.some((value) => value.startsWith('unet_supermarket_session=')));
    assert.ok(cookies.some((value) => value.includes('Max-Age=0')));
    assert.notEqual((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: a.challenge.requestRef }, a.cookie))).status, 200);
  });

  await t.test('legacy, expired, malformed, duplicate and wrong-audience cookies fail closed', async () => {
    const legacy = { scopedUserId: 'scoped-user', expiresAt: Date.now() + 60_000 };
    assert.equal(await auth.readProviderSession(principalRequest(signClaims(legacy))), null);
    const valid = auth.createProviderSession('scoped-user');
    const claims = JSON.parse(Buffer.from(valid.split('.')[0], 'base64url').toString());
    assert.equal(await auth.readProviderSession(principalRequest(signClaims({ ...claims, expiresAt: 0 }))), null);
    assert.equal(await auth.readProviderSession(principalRequest(signClaims({ ...claims, audience: 'another-provider' }))), null);
    assert.equal(await auth.readProviderSession(principalRequest(valid + '.extra')), null);
    assert.equal(await auth.readProviderSession(principalRequest(valid.split('.')[0] + '.' + '\u00e9'.repeat(43))), null);
    assert.equal(await auth.readProviderSession(new Request(origin, { headers: { cookie: 'unet_supermarket_session=' + valid + '; unet_supermarket_session=' + valid } })), null);
  });

  await t.test('every authenticated request rechecks the active account; retirement immediately rejects its cookie', async () => {
    const token = auth.createProviderSession('scoped-user');
    const before = accountReads;
    assert.deepEqual(await auth.readProviderSession(principalRequest(token)), { scopedUserId: 'scoped-user' });
    assert.deepEqual(await auth.readProviderSession(principalRequest(token)), { scopedUserId: 'scoped-user' });
    assert.equal(accountReads, before + 2);
    databaseUnavailable = true;
    assert.equal(await auth.readProviderSession(principalRequest(token)), null);
    databaseUnavailable = false;
    const signedAtIso = new Date().toISOString();
    const operationId = 'retire-test-operation-0001';
    const canonical = ['unet-service-account-retirement-v2', 'provider-test', origin, 'scoped-user', operationId, signedAtIso].join('\n');
    await service.retire({ protocolVersion: 2, serviceId: 'provider-test', origin, scopedUserId: 'scoped-user', operationId, signedAtIso,
      signature: sign(null, Buffer.from(canonical), privateKey).toString('base64url') });
    assert.equal(await auth.readProviderSession(principalRequest(token)), null);
    assert.equal(await auth.readProviderSession(principalRequest(auth.createProviderSession('missing-user'))), null);
    assert.equal(await accountStore.getRetirementPublicKey('scoped-user'), pem);
  });

  await t.test('retirement between approval and exchange blocks redemption', async () => {
    const created = await createChallenge();
    await approve(created.challenge, 'retire-before-exchange');
    await accountStore.retire('retire-before-exchange');
    assert.notEqual((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: created.challenge.requestRef }, created.cookie))).status, 200);
  });

  await t.test('retired cookies are rejected by real session and account-state routes', async () => {
    const request = principalRequest(auth.createProviderSession('scoped-user'));
    const { GET: session } = await import('../app/api/session/route');
    const { GET: state, PATCH: mutate } = await import('../app/api/account-state/route');
    assert.equal((await session(request)).status, 401);
    assert.equal((await state(request)).status, 401);
    assert.equal((await mutate(request)).status, 401);
  });

  await t.test('browser helper sends same-origin JSON and exchanges only requestRef', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json(String(url).endsWith('/challenge')
        ? { success: true, challenge: { requestRef: 'public-ref' } }
        : { success: true, scopedUserId: 'helper-user' });
    }) as typeof fetch;
    try {
      const challenge = await createProviderChallenge();
      assert.deepEqual(await exchangeProviderChallenge(challenge.requestRef), { scopedUserId: 'helper-user' });
      assert.equal(calls[0].init?.credentials, 'same-origin');
      assert.equal(new Headers(calls[0].init?.headers).get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { requestRef: 'public-ref' });
      assert.equal(calls[1].init?.credentials, 'same-origin');
    } finally { globalThis.fetch = originalFetch; }
  });

  await t.test('maintenance remains default-on', async () => {
    const { proxy } = await import('../proxy');
    delete process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
    assert.equal(proxy().status, 503);
    process.env.UNET_LOGIN_SECURITY_MAINTENANCE = 'false';
    assert.equal(proxy().status, 200);
    delete process.env.UNET_LOGIN_SECURITY_MAINTENANCE;
  });

  await t.test('all login endpoints use hardened adapters and bridge never handles session IDs', () => {
    for (const route of ['challenge', 'status', 'exchange', 'approve']) {
      const source = readFileSync(new URL('../app/api/unet/login/' + route + '/route.ts', import.meta.url), 'utf8');
      assert.match(source, /supermarketLoginHandlers/);
      assert.doesNotMatch(source, /exchangeSession|createChallenge|\.poll\(/);
    }
    const client = readFileSync(new URL('../components/SupermarketApp.tsx', import.meta.url), 'utf8');
    assert.match(client, /requestRef: challenge.requestRef/);
    assert.doesNotMatch(client, /sessionId/);
    assert.match(client, /approved !== true/);
  });
});
