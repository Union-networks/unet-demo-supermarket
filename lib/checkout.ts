import { randomBytes } from 'node:crypto';
import { providerPool } from './provider-db';

export type ProviderCheckout = {
  checkoutId: string;
  scopedUserId: string;
  status: 'completed' | 'pending_verification' | 'failed' | 'expired';
  requiredChecks: string[];
  restrictedResourceIds: string[];
  verificationSessionId?: string;
  verificationSessionRef?: string;
  failureReason?: string;
  expiresAt?: string;
};

let ready: Promise<void> | undefined;
export function ensureCheckoutSchema() {
  ready ??= providerPool.query(`
    CREATE TABLE IF NOT EXISTS supermarket_checkout_verifications_v2 (
      checkout_id TEXT PRIMARY KEY,
      scoped_user_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('completed','pending_verification','failed','expired')),
      required_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
      restricted_resource_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      verification_session_id TEXT,
      verification_session_ref TEXT,
      failure_reason TEXT,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS supermarket_checkout_owner_idx ON supermarket_checkout_verifications_v2(scoped_user_id,created_at DESC);
  `).then(() => undefined);
  return ready;
}

const fromRow = (row: Record<string, unknown>): ProviderCheckout => ({
  checkoutId: String(row.checkout_id),
  scopedUserId: String(row.scoped_user_id),
  status: row.status as ProviderCheckout['status'],
  requiredChecks: Array.isArray(row.required_checks) ? row.required_checks.map(String) : [],
  restrictedResourceIds: Array.isArray(row.restricted_resource_ids) ? row.restricted_resource_ids.map(String) : [],
  ...(row.verification_session_id ? { verificationSessionId: String(row.verification_session_id) } : {}),
  ...(row.verification_session_ref ? { verificationSessionRef: String(row.verification_session_ref) } : {}),
  ...(row.failure_reason ? { failureReason: String(row.failure_reason) } : {}),
  ...(row.expires_at ? { expiresAt: new Date(String(row.expires_at)).toISOString() } : {}),
});

export async function createCheckout(input: Omit<ProviderCheckout, 'checkoutId'>) {
  await ensureCheckoutSchema();
  const checkoutId = `checkout_${randomBytes(18).toString('base64url')}`;
  const result = await providerPool.query(
    `INSERT INTO supermarket_checkout_verifications_v2(
       checkout_id,scoped_user_id,status,required_checks,restricted_resource_ids,
       verification_session_id,verification_session_ref,failure_reason,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [checkoutId, input.scopedUserId, input.status, input.requiredChecks, input.restrictedResourceIds, input.verificationSessionId ?? null, input.verificationSessionRef ?? null, input.failureReason ?? null, input.expiresAt ?? null],
  );
  return fromRow(result.rows[0]);
}

export async function getCheckout(checkoutId: string, scopedUserId: string) {
  await ensureCheckoutSchema();
  const result = await providerPool.query('SELECT * FROM supermarket_checkout_verifications_v2 WHERE checkout_id=$1 AND scoped_user_id=$2', [checkoutId, scopedUserId]);
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}

export async function updateCheckout(checkoutId: string, status: ProviderCheckout['status'], failureReason?: string) {
  const result = await providerPool.query(
    'UPDATE supermarket_checkout_verifications_v2 SET status=$2,failure_reason=$3,updated_at=now() WHERE checkout_id=$1 RETURNING *',
    [checkoutId, status, failureReason ?? null],
  );
  return result.rows[0] ? fromRow(result.rows[0]) : undefined;
}
