import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { InMemoryDirectLoginAccountStore, InMemoryDirectLoginChallengeStore, createDirectLoginService } from '@u-net/server';

test('durable retirement cleanup is retryable, idempotent and abort-aware', async (t) => {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  (globalThis as Record<string, unknown>).__unetSupermarketProviderPool = {
    query: async (sql: string, values?: unknown[]) => { statements.push({ sql, values }); return { rows: [], rowCount: 1 }; },
  };
  const { cleanupSupermarketRetirement: cleanup } = await import('../lib/retirement-cleanup');
  const inboxCalls: string[] = [];
  let failInbox = true;
  const inbox = { retire: async (id: string) => {
    inboxCalls.push(id);
    if (failInbox) throw new Error('test_inbox_unavailable');
  } };
  const accounts = new InMemoryDirectLoginAccountStore();
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const callbacks: Array<{ operationId: string; signal: AbortSignal }> = [];
  const service = createDirectLoginService({
    serviceId: 'cleanup-test', origin: 'https://cleanup.test',
    accountStore: accounts, challengeStore: new InMemoryDirectLoginChallengeStore(accounts),
    onAccountRetired: (id, operationId, signal) => { callbacks.push({ operationId, signal }); return cleanup(id, operationId, signal, inbox); },
  });
  const retire = async (id: string, operationId: string) => {
    await accounts.bindPublicKey(id, publicKey);
    const signedAtIso = new Date().toISOString();
    const message = ['unet-service-account-retirement-v2', 'cleanup-test', 'https://cleanup.test', id, operationId, signedAtIso].join('\n');
    await service.retire({ protocolVersion: 2, serviceId: 'cleanup-test', origin: 'https://cleanup.test',
      scopedUserId: id, operationId, signedAtIso,
      signature: sign(null, Buffer.from(message), keys.privateKey).toString('base64url') });
  };
  await retire('cleanup-user', 'cleanup-operation-0001');
  assert.equal(callbacks.length, 0, 'the HTTP retirement path only commits the durable job');
  assert.equal(await accounts.getPublicKey('cleanup-user'), undefined);
  assert.deepEqual(await service.retryRetirementCleanup(), { completed: 0, pending: 1 });
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].operationId, 'cleanup-operation-0001');
  assert.equal(callbacks[0].signal instanceof AbortSignal, true);
  assert.equal((await accounts.pendingRetirements(10)).length, 1);
  failInbox = false;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 10_000 });
  try {
    assert.deepEqual(await service.retryRetirementCleanup(), { completed: 1, pending: 0 });
  } finally { t.mock.timers.reset(); }
  assert.equal((await accounts.pendingRetirements(10)).length, 0);
  assert.deepEqual(inboxCalls, ['cleanup-user', 'cleanup-user']);
  const deletions = statements.filter(({ sql }) => sql.startsWith('DELETE FROM supermarket_account_states_v2'));
  assert.equal(deletions.length, 2);
  assert.deepEqual(deletions[0].values, ['cleanup-user']);
  assert.equal(statements.filter(({ sql }) => sql.startsWith('DELETE FROM supermarket_checkout_verifications_v2')).length, 2);
  assert.ok(statements.every(({ sql }) => !sql.includes('DELETE FROM unet_service_accounts')));

  const beforeAbort = statements.length;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cleanup('cleanup-user', 'cleanup-operation-0001', controller.signal, inbox), { name: 'AbortError' });
  assert.equal(statements.length, beforeAbort);
  await retire('cleanup-user-2', 'cleanup-operation-0002');
  await retire('cleanup-user-3', 'cleanup-operation-0003');
  const beforeBatch = callbacks.length;
  await service.retryRetirementCleanup();
  assert.equal(callbacks.length, beforeBatch + 1, 'one leased job per worker call');
  assert.equal((await accounts.pendingRetirements(10)).length, 1);
});
