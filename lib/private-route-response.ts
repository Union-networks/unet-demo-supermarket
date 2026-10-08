import { NextResponse } from 'next/server';

const domainErrors = [
  'domain_admin_callback_invalid', 'domain_admin_callback_action_invalid',
  'domain_admin_callback_service_mismatch', 'domain_admin_role_invalid',
  'domain_admin_schema_invalid', 'domain_admin_challenge_invalid',
  'domain_admin_invitation_expired', 'domain_admin_holder_revocation_invalid',
  'domain_admin_control_authorization_invalid', 'domain_admin_claims_invalid',
  'domain_admin_callback_expired', 'domain_admin_control_authorization_replayed',
  'domain_admin_challenge_replayed',
];
const inboxErrors = [
  'official_inbox_registration_mismatch', 'official_inbox_recipient_reference_invalid',
  'official_inbox_mailbox_invalid', 'official_inbox_capability_invalid',
  'official_inbox_registration_stale', 'official_inbox_account_unavailable',
  'official_inbox_registration_bad_signature', 'official_inbox_retired',
  'official_inbox_already_registered',
];
const statuses: Record<string, ReadonlyMap<string, number>> = {
  domain: new Map([...domainErrors.map((code) => [code, 400] as const),
    ['protocol_upgrade_required', 426], ['request_body_invalid', 400]]),
  inbox: new Map([...inboxErrors.map((code) => [code, 400] as const), ['request_body_invalid', 400]]),
};

export function privateJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'no-store');
  return NextResponse.json(body, { ...init, headers });
}

export async function readPrivateBody<T>(request: Request): Promise<T> {
  const body: unknown = await request.json().catch(() => { throw new Error('request_body_invalid'); });
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('request_body_invalid');
  return body as T;
}

export function privateFailure(error: unknown, operation: 'domain' | 'inbox') {
  const known = error instanceof Error ? statuses[operation].get(error.message) : undefined;
  const code = known === undefined ? 'provider_temporarily_unavailable' : (error as Error).message;
  const body = operation === 'domain' ? { success: false, errorCode: code, message: code }
    : { success: false, message: code };
  return privateJson(body, { status: known ?? 503 });
}
