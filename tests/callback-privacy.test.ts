import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import test from 'node:test';

if (!process.execArgv.includes('--experimental-test-module-mocks')) {
  test('isolated actual-route privacy and signed callback regressions', () => {
    const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', 'tsx', '--test', fileURLToPath(import.meta.url)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 90_000,
      env: Object.fromEntries(Object.entries({ SystemRoot: process.env.SystemRoot, PATH: process.env.PATH,
        TEMP: process.env.TEMP, TMP: process.env.TMP, NODE_ENV: 'test' }).filter((entry) => entry[1] !== undefined)) as NodeJS.ProcessEnv,
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
  });
} else {
  test('actual route exports: no-store privacy, V2-only authorization, signed replay and unchanged success', async (t) => {
    const safety = import.meta.url.includes('/safety-current/');
    const sdk = await import('@u-net/issuer');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const canary = 'SYNTHETIC_capability_mismatch_ledger_SQL_PEM_mailbox_SECRET';
    const captured: string[] = [];
    t.mock.method(console, 'warn', (...args: unknown[]) => captured.push(format(...args)));
    t.mock.method(console, 'error', (...args: unknown[]) => captured.push(format(...args)));
    const effects: string[] = [];
    const nonces = new Set<string>();
    let failureStage = '';
    let thrown: unknown = new Error(canary, { cause: new Error(canary) });
    let sequence = 0;
    const effect = (stage: string) => { effects.push(stage); if (failureStage === stage) throw thrown; };
    const consumeNonce = async (nonce: string) => {
      effect('nonce');
      if (nonces.has(nonce)) return false;
      nonces.add(nonce);
      return true;
    };
    const canonical = (value: unknown): string => {
      if (!value || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
    };
    const signer = { issuerId: 'fixture-issuer', keyId: 'fixture-key', privateKeyPem };
    t.mock.module(new URL('../lib/config.ts', import.meta.url).href, { namedExports: {
      serviceId: 'fixture', appOrigin: 'https://provider.test',
      SERVICE_ID: 'fixture', PUBLIC_SITE_ORIGIN: 'https://provider.test',
    } });
    t.mock.module(new URL(safety ? '../lib/issuer-server.ts' : '../lib/domain-admin-issuer.ts', import.meta.url).href, {
      namedExports: {
        configureCredentialRuntime: () => effect('runtime'),
        domainAdminSigner: () => { effect('signer'); return signer; },
      },
    });
    t.mock.module('@u-net/issuer', { namedExports: {
      ...sdk,
      createCredentialEnvelopeV2: async (input: { schemaId: string }) => {
        effect('credential');
        assert.equal(input.schemaId, 'unet.provider.domain-admin.v1');
        return { attestationCommitment: 'a'.repeat(64), schemaId: input.schemaId,
          schemaIdField: 'fixture-schema', issuerCredentialKeyId: 'fixture-credential-key',
          issuerKeyHash: 'fixture-key-hash', statusEpoch: 1 };
      },
      encryptCredentialEnvelopeV2: () => { effect('encryption'); return { synthetic: true }; },
      anchorLedgerV2CredentialFromEnv: async () => { effect('anchor'); return { transactionHash: 'fixture-tx', issuerIdHash: 'fixture-issuer-hash' }; },
      revokeLedgerV2CredentialFromEnv: async () => { effect('ledger-revoke'); return { transactionHash: 'fixture-revoke-tx', issuerIdHash: 'fixture-issuer-hash' }; },
      resolveCredentialValidity: () => ({ validUntilEpoch: 2_000_000_000 }),
    } });
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      assert.equal(String(input), 'https://control.test/.well-known/unet-control-keys.json');
      effect('keys');
      return Response.json({ keys: [{ keyId: 'control', algorithm: 'Ed25519', publicKeyPem }] });
    });
    process.env.UNET_CONTROL_PLANE_URL = 'https://control.test';
    const query = async (sql: string, params?: string[]) => {
      if (sql.includes('INSERT INTO supermarket_control_nonces')) return { rowCount: await consumeNonce(params![0]) ? 1 : 0, rows: [] };
      if (sql.includes('supermarket_control_nonces')) { effect('nonce-schema'); return { rows: [], rowCount: 0 }; }
      effect('database');
      return { rows: [{ scoped_user_id: 'fixture-account', status: 'active', attestation_hash: 'a'.repeat(64), credential_expires_at: new Date() }], rowCount: 1 };
    };
    t.mock.module(new URL('../lib/provider-db.ts', import.meta.url).href, { namedExports: { providerPool: { query } } });
    t.mock.module(new URL('../lib/direct-login.ts', import.meta.url).href, { namedExports: {
      [safety ? 'registerSafetyOfficialInbox' : 'registerSupermarketOfficialInbox']: async () => effect('inbox'),
    } });
    const issue = (await import('../app/api/unet/domain-admin/issue/route')).POST;
    const revoke = (await import('../app/api/unet/domain-admin/revoke/route')).POST;
    const inbox = (await import('../app/api/unet/official-inbox/route')).POST;
    const callbackBody = (action = 'issue'): Record<string, unknown> => ({
      version: 2, action: 'domain-admin.' + action, serviceId: 'fixture', origin: 'https://provider.test',
      issuerId: 'fixture-issuer', invitationId: 'fixture-invite-' + sequence++, role: 'owner',
      schemaId: 'unet.provider.domain-admin.v1', claims: { domain_role: 'fixture:owner', service_id: 'fixture', role: 'owner' },
      requestType: 'fixture-domain-admin', holderBinding: '123', deliveryPublicKey: 'fixture-delivery-key',
      clientRequestId: 'fixture-client', holderRevocationSigner: '0x' + 'a'.repeat(40),
      challenge: 'challenge-' + sequence++, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      attestationHash: 'a'.repeat(64), requestId: 'fixture-revoke', reason: 'fixture',
    });
    const authorization = (body: unknown, action: string, nonce = 'fixture_nonce_' + String(sequence++).padStart(8, '0')) =>
      sdk.createDomainAdminControlAuthorizationV2({ body, privateKeyPem, keyId: 'control', method: 'POST',
        path: '/api/unet/domain-admin/' + action, audience: 'fixture', nonce });
    const request = (body: unknown, action = 'issue', auth?: string) => new Request('https://provider.test/api/unet/domain-admin/' + action, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-unet-domain-admin-challenge': String((body as Record<string, unknown>)?.challenge ?? ''),
        ...(auth ? { 'x-unet-control-authorization': auth } : {}) }, body: JSON.stringify(body),
    });
    const inspect = async (response: Response, status: number, code?: string) => {
      assert.equal(response.status, status);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
      const text = await response.text();
      assert.ok(!text.includes(canary));
      const body = JSON.parse(text);
      if (code) {
        assert.equal(body.errorCode ?? body.error ?? body.message, code);
        if (body.errorCode) assert.equal(body.message, code);
      }
      assert.ok(!captured.join('\n').includes(canary));
      return body;
    };

    for (const [action, route] of [['issue', issue], ['revoke', revoke]] as const) {
      await t.test(action + ': v1 rejects before keys, signer, encryption, ledger or storage', async () => {
        effects.length = 0;
        await inspect(await route(request({ ...callbackBody(action), version: 1 }, action)), 426, 'protocol_upgrade_required');
        assert.deepEqual(effects, []);
      });
      for (const expiry of ['invalid-date', '', '2000-01-01T00:00:00Z']) {
        await t.test(action + ': rejects expiry ' + JSON.stringify(expiry), async () => {
          effects.length = 0;
          await inspect(await route(request({ ...callbackBody(action), expiresAt: expiry }, action)), 400,
            action === 'issue' ? 'domain_admin_invitation_expired' : 'domain_admin_callback_expired');
          assert.deepEqual(effects, []);
        });
      }
      for (const auth of [undefined, 'v1=' + 'a'.repeat(64), 'v2.invalid.invalid', 'v2.YQ.Yg, v2.YQ.Yg']) {
        await t.test(action + ': rejects missing/invalid/legacy/duplicate authorization ' + String(auth), async () => {
          effects.length = 0;
          await inspect(await route(request(callbackBody(action), action, auth)), 400, 'domain_admin_control_authorization_invalid');
          assert.ok(!effects.some((stage) => ['runtime', 'signer', 'credential', 'encryption', 'anchor', 'ledger-revoke', 'nonce', 'database'].includes(stage)));
        });
      }
      await t.test(action + ': rejects a cryptographically wrong key and signed wrong path/audience/body', async () => {
        const body = callbackBody(action);
        const wrongKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        for (const patch of [{ privateKeyPem: wrongKey }, { audience: 'other-provider' },
          { path: '/wrong-path' }, { body: { ...body, challenge: 'different-body' } }]) {
          const auth = sdk.createDomainAdminControlAuthorizationV2({ body, privateKeyPem, keyId: 'control', method: 'POST',
            path: '/api/unet/domain-admin/' + action, audience: 'fixture', ...patch });
          effects.length = 0;
          await inspect(await route(request(body, action, auth)), 400, 'domain_admin_control_authorization_invalid');
          assert.ok(!effects.some((stage) => ['runtime', 'signer', 'credential', 'encryption', 'anchor', 'ledger-revoke', 'nonce'].includes(stage)));
        }
      });
      await t.test(action + ': signed authorization with failing nonce store is sanitized', async () => {
        const body = callbackBody(action);
        failureStage = 'nonce'; thrown = new Error(canary, { cause: new Error(canary) });
        await inspect(await route(request(body, action, authorization(body, action))),
          503, 'provider_temporarily_unavailable');
        failureStage = '';
      });
      await t.test(action + ': real signed control nonce replay rejects before issuance/revocation', async () => {
        const nonce = 'replay_fixture_' + action;
        const first = callbackBody(action);
        const accepted = await inspect(await route(request(first, action, authorization(first, action, nonce))), 200);
        assert.ok(verify(null, Buffer.from(canonical(accepted.payload)), publicKey, Buffer.from(accepted.signature, 'base64url')));
        if (action === 'issue') assert.equal(accepted.payload.credentialPublicMetadata.schemaId, 'unet.provider.domain-admin.v1');
        const second = callbackBody(action);
        effects.length = 0;
        await inspect(await route(request(second, action, authorization(second, action, nonce))), 400,
          !safety && action === 'issue' ? 'domain_admin_control_authorization_replayed' : 'domain_admin_control_authorization_invalid');
        assert.ok(effects.includes('nonce'));
        assert.ok(!effects.some((stage) => ['runtime', 'signer', 'credential', 'encryption', 'anchor', 'ledger-revoke'].includes(stage)));
      });
      for (const stage of (action === 'issue' ? ['runtime', 'signer', 'credential', 'anchor', 'encryption'] : ['runtime', 'signer', 'ledger-revoke'])) {
        await t.test(action + ': sanitizes ' + stage + ' failure', async () => {
          failureStage = stage;
          thrown = Object.assign(new Error(canary, { cause: new Error(canary) }), { response: { capability: canary } });
          const body = callbackBody(action);
          await inspect(await route(request(body, action, authorization(body, action))), 503, 'provider_temporarily_unavailable');
          failureStage = '';
        });
      }
      await t.test(action + ': malformed and null body', async () => {
        await inspect(await route(request(null)), 400, 'request_body_invalid');
        await inspect(await route(new Request('https://provider.test', { method: 'POST', body: '{' })), 400, 'request_body_invalid');
      });
    }
    await t.test('issue: required holder revocation and duplicate challenge fail before side effects', async () => {
      for (const patch of [{ holderRevocationSigner: undefined }, { clientRequestId: '' }, { challenge: 'a, a' }]) {
        effects.length = 0;
        await inspect(await issue(request({ ...callbackBody(), ...patch })), 400);
        assert.deepEqual(effects, []);
      }
    });
    const inboxCodes = ['official_inbox_registration_mismatch', 'official_inbox_recipient_reference_invalid',
      'official_inbox_mailbox_invalid', 'official_inbox_capability_invalid', 'official_inbox_registration_stale',
      'official_inbox_account_unavailable', 'official_inbox_registration_bad_signature', 'official_inbox_retired', 'official_inbox_already_registered'];
    await t.test('inbox: exact expected errors stay 400, success 201, unknown error/string generic 503', async () => {
      await inspect(await inbox(request({ synthetic: true })), 201);
      failureStage = 'inbox';
      for (const code of inboxCodes) { thrown = new Error(code); await inspect(await inbox(request({})), 400, code); }
      for (const value of [new Error(canary), canary, new Error('official_inbox_retired:' + canary), new Error('request_body_invalid:' + canary)]) {
        thrown = value; await inspect(await inbox(request({})), 503, 'provider_temporarily_unavailable');
      }
      failureStage = '';
      await inspect(await inbox(request(null)), 400, 'request_body_invalid');
      await inspect(await inbox(new Request('https://provider.test', { method: 'POST', body: '{' })), 400, 'request_body_invalid');
    });
    assert.deepEqual(captured, []);
  });
}
