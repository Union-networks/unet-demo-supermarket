import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresDirectLoginAccountStore, PostgresDirectLoginChallengeStore, PostgresOfficialMessagingInboxStore,
  createDirectLoginService, ensureDirectLoginSchema, ensureOfficialMessagingInboxSchema } from '@u-net/server';

const connectionString = process.env.UNET_PROVIDER_TEST_DATABASE_URL;
test('real PostgreSQL cookie exchange, retirement leases and provider cleanup', { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'use a disposable loopback PostgreSQL instance');
  const schema = 'provider_login_' + randomBytes(8).toString('hex');
  const admin = new Pool({ connectionString, max: 1 });
  const pool = new Pool({ connectionString, options: '-c search_path=' + schema, max: 6 });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  try {
    process.env.UNET_PROVIDER_ORIGIN = 'https://pg-provider.test';
    process.env.UNET_PROVIDER_SERVICE_ID = 'pg-provider';
    process.env.UNET_PROVIDER_SESSION_SECRET = 'test-only-postgres-session-secret-0000';
    (globalThis as Record<string, unknown>).__unetSupermarketProviderPool = pool;
    const origin = process.env.UNET_PROVIDER_ORIGIN;
    await ensureDirectLoginSchema(pool);
    await ensureOfficialMessagingInboxSchema(pool);
    const accounts = new PostgresDirectLoginAccountStore(pool);
    const inbox = new PostgresOfficialMessagingInboxStore(pool);
    const { cleanupSupermarketRetirement: cleanup } = await import('../lib/retirement-cleanup');
    let failInbox = true;
    const service = createDirectLoginService({
      serviceId: 'pg-provider', origin, accountStore: accounts, challengeStore: new PostgresDirectLoginChallengeStore(pool),
      onAccountRetired: (id, operationId, signal) => cleanup(id, operationId, signal, {
        retire: async (scopedUserId) => { if (failInbox) throw new Error('test_retry_inbox'); await inbox.retire(scopedUserId); },
      }),
    });
    const { supermarketLoginWebHandlers } = await import('../lib/login-web');
    const auth = await import('../lib/provider-session');
    const handlers = supermarketLoginWebHandlers(service, accounts);
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const request = (path: string, body?: unknown, cookie?: string) => new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const challenge = async () => {
      const response = await handlers.challenge(request('/api/unet/login/challenge', {}));
      assert.equal(response.status, 200);
      return { challenge: (await response.json()).challenge, cookie: response.headers.getSetCookie()[0].split(';')[0] };
    };
    const approve = async (created: Awaited<ReturnType<typeof challenge>>) => {
      const c = created.challenge;
      const signedAtIso = new Date().toISOString();
      const canonical = ['unet-direct-login-v2', 'pg-provider', origin, c.requestRef, c.challenge, c.expiresAtIso, 'pg-user', publicKey, signedAtIso].join('\n');
      const body = { protocolVersion: 2, serviceId: 'pg-provider', origin, requestRef: c.requestRef, scopedUserId: 'pg-user',
        accountPublicKeyPem: publicKey, signedAtIso, signature: sign(null, Buffer.from(canonical), keys.privateKey).toString('base64url') };
      return handlers.approve(request('/api/unet/login/approve', body));
    };
    const first = await challenge();
    const approvals = await Promise.all([approve(first), approve(first)]);
    assert.equal(approvals.filter(value => value.status === 200).length, 1, 'one atomic approval');
    const statusPath = '/api/unet/login/status?requestRef=' + first.challenge.requestRef;
    assert.equal((await handlers.challengeStatus(request(statusPath))).status, 403);
    assert.deepEqual(await (await handlers.challengeStatus(request(statusPath, undefined, first.cookie))).json(), { success: true, state: 'approved' });
    assert.equal((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: first.challenge.requestRef }))).status, 403);
    const exchanged = await Promise.all(Array.from({ length: 4 }, () =>
      handlers.exchange(request('/api/unet/login/exchange', { requestRef: first.challenge.requestRef }, first.cookie))));
    assert.equal(exchanged.filter(value => value.status === 200).length, 1, 'one atomic redemption in PostgreSQL');
    const winner = exchanged.find(value => value.status === 200)!;
    const sessionCookie = winner.headers.getSetCookie().find(value => value.startsWith('unet_supermarket_session='))!.split(';')[0];
    assert.deepEqual(await auth.readProviderSession(request('/api/session', undefined, sessionCookie)), { scopedUserId: 'pg-user' });
    const second = await challenge();
    assert.equal((await approve(second)).status, 200);
    await pool.query(`INSERT INTO unet_official_inboxes_v2
      (scoped_user_id,mailbox_address,recipient_encryption_public_key,send_capability,recipient_reference,status)
      VALUES('pg-user','test-mailbox','test-public-key','test-capability',repeat('d',64),'active')`);

    const state = await import('../lib/account-state');
    const checkouts = await import('../lib/checkout');
    await state.getAccountState('pg-user');
    await checkouts.createCheckout({ scopedUserId: 'pg-user', status: 'completed', requiredChecks: [], restrictedResourceIds: [] });

    const operationId = 'pg-retirement-operation-0001';
    const signedAtIso = new Date().toISOString();
    const canonical = ['unet-service-account-retirement-v2','pg-provider',origin,'pg-user',operationId,signedAtIso].join('\n');
    await service.retire({ protocolVersion: 2, serviceId: 'pg-provider', origin, scopedUserId: 'pg-user', operationId, signedAtIso,
      signature: sign(null, Buffer.from(canonical), keys.privateKey).toString('base64url') });
    assert.equal(await auth.readProviderSession(request('/api/session', undefined, sessionCookie)), null);
    assert.notEqual((await handlers.exchange(request('/api/unet/login/exchange', { requestRef: second.challenge.requestRef }, second.cookie))).status, 200);
    assert.equal(await accounts.getRetirementPublicKey('pg-user'), publicKey, 'retirement preserves the bound key');
    const leases = (await Promise.all([accounts.claimRetirements(1), accounts.claimRetirements(1)])).flat();
    assert.equal(leases.length, 1);
    const lease = leases[0];
    const duration = await pool.query("SELECT extract(epoch FROM (lease_until-clock_timestamp()))::float AS seconds FROM unet_account_retirement_jobs_v2 WHERE operation_id=$1", [operationId]);
    assert.ok(duration.rows[0].seconds > 100 && duration.rows[0].seconds <= 120);
    await assert.rejects(accounts.completeRetirementCleanup(operationId, 'stale-lease'), /retirement_cleanup_lease_lost/);
    await pool.query("UPDATE unet_account_retirement_jobs_v2 SET lease_until=clock_timestamp()-interval '1 second' WHERE operation_id=$1", [operationId]);
    const replacement = (await accounts.claimRetirements(1))[0];
    assert.ok(replacement);
    assert.notEqual(replacement.leaseToken, lease.leaseToken);
    await accounts.failRetirementCleanup(operationId, lease.leaseToken);
    assert.equal((await pool.query('SELECT lease_token FROM unet_account_retirement_jobs_v2 WHERE operation_id=$1',[operationId])).rows[0].lease_token, replacement.leaseToken);
    await accounts.failRetirementCleanup(operationId, replacement.leaseToken);
    await pool.query('UPDATE unet_account_retirement_jobs_v2 SET next_attempt_at=clock_timestamp() WHERE operation_id=$1', [operationId]);
    assert.deepEqual(await service.retryRetirementCleanup(), { completed: 0, pending: 1 });
    failInbox = false;
    await pool.query('UPDATE unet_account_retirement_jobs_v2 SET next_attempt_at=clock_timestamp() WHERE operation_id=$1', [operationId]);
    assert.deepEqual(await service.retryRetirementCleanup(), { completed: 1, pending: 0 });
    assert.equal(await inbox.resolve('pg-user'), undefined);

    assert.equal((await pool.query('SELECT count(*)::int AS count FROM supermarket_account_states_v2')).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM supermarket_checkout_verifications_v2')).rows[0].count, 0);
    await assert.rejects(state.getAccountState('pg-user'), /service_account_retired/);
    await assert.rejects(state.mutateAccountState('pg-user', { operation: 'clear_basket' }), /service_account_retired/);
    await assert.rejects(checkouts.createCheckout({ scopedUserId: 'pg-user', status: 'completed', requiredChecks: [], restrictedResourceIds: [] }), /service_account_retired/);

  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA "' + schema + '" CASCADE');
    await admin.end();
  }
});
