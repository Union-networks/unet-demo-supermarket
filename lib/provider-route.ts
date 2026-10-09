import { randomUUID } from 'node:crypto';

const operations = new Set([
  'login_challenge', 'login_challenge_details', 'login_approve',
  'login_status', 'login_exchange', 'account_retire', 'retirement_process',
  'attestation_acknowledge',
]);
type ProviderOperation = 'login_challenge' | 'login_challenge_details' | 'login_approve'
  | 'login_status' | 'login_exchange' | 'account_retire' | 'retirement_process'
  | 'attestation_acknowledge';

const databaseFailures = new Set([
  'provider_database_configuration_missing', 'provider_database_configuration_invalid',
  'provider_database_tls_required', 'provider_database_ca_invalid',
  'provider_database_channel_binding_required', 'provider_database_channel_binding_driver_unsupported',
]);
const configurationReasons = new Set([
  'malformed_url', 'invalid_target', 'invalid_channel_binding', 'unsupported_parameter', 'duplicate_parameter',
]);
const tlsCodes = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

function providerFailureCategory(error: unknown): string {
  if (!(error instanceof Error)) return 'dependency_unavailable';
  const reason = (error as Error & { configurationReason?: unknown }).configurationReason;
  if (error.message === 'provider_database_configuration_invalid' && typeof reason === 'string' &&
    configurationReasons.has(reason)) return 'provider_database_configuration_invalid_' + reason;
  if (databaseFailures.has(error.message)) return error.message;
  const code = (error as Error & { code?: unknown }).code;
  if (code === '28P01' || code === '28000') return 'database_authentication_failed';
  if (code === '42501') return 'database_permission_denied';
  if (code === '42P01' || code === '42703' || code === '42710' || code === '23514') return 'database_schema_invalid';
  if (typeof code === 'string' && tlsCodes.has(code)) return 'database_tls_verification_failed';
  if (code === 'ETIMEDOUT') return 'dependency_timeout';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET') return 'database_connection_failed';
  return 'dependency_unavailable';
}

export function recordProviderFailure(
  operation: ProviderOperation,
  event: 'provider_route_failed' | 'official_message_delivery_failed' = 'provider_route_failed',
  error?: unknown,
): void {
  // Only fixed categories reach logs, never the error, SQL, URL or its values.
  console.warn({
    event: event === 'official_message_delivery_failed' ? event : 'provider_route_failed',
    operation: operations.has(operation) ? operation : 'unknown',
    outcome: 'unavailable',
    failureCategory: providerFailureCategory(error),
    diagnosticId: randomUUID(),
  });
}

export async function runProviderRoute(operation: ProviderOperation, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    recordProviderFailure(operation, 'provider_route_failed', error);
    return Response.json({ success: false, error: 'provider_temporarily_unavailable' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

