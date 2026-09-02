import { createHash } from 'node:crypto';
import {
  fetchUnetControlPublicKeys,
  verifyDomainAdminControlAuthorizationV2,
} from '@u-net/issuer';
import { providerPool } from './provider-db';

let schemaReady: Promise<void> | undefined;

async function ensureControlAuthorizationSchema(): Promise<void> {
  schemaReady ??= providerPool.query(`
    CREATE TABLE IF NOT EXISTS supermarket_control_nonces (
      nonce_hash text PRIMARY KEY,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS supermarket_control_nonces_expiry
      ON supermarket_control_nonces(expires_at);
    DELETE FROM supermarket_control_nonces WHERE expires_at <= now();
  `).then(() => undefined);
  await schemaReady;
}

async function consumeControlNonce(nonce: string): Promise<boolean> {
  await ensureControlAuthorizationSchema();
  const nonceHash = createHash('sha256').update(nonce).digest('hex');
  const result = await providerPool.query(
    `INSERT INTO supermarket_control_nonces(nonce_hash,expires_at)
     VALUES($1,now() + interval '10 minutes')
     ON CONFLICT DO NOTHING
     RETURNING nonce_hash`,
    [nonceHash],
  );
  return result.rowCount === 1;
}

export async function verifyControlAuthorization(input: {
  body: unknown;
  authorization?: string;
  path: string;
  audience: string;
}): Promise<boolean> {
  const publicKeys = await fetchUnetControlPublicKeys();
  const result = verifyDomainAdminControlAuthorizationV2({
    body: input.body,
    authorization: input.authorization,
    publicKeys,
    method: 'POST',
    path: input.path,
    audience: input.audience,
  });
  return Boolean(result.valid && result.payload && await consumeControlNonce(result.payload.nonce));
}

export async function domainAdminControlAuthorization() {
  return {
    publicKeys: await fetchUnetControlPublicKeys(),
    consumeNonce: consumeControlNonce,
  };
}
