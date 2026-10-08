import { randomUUID } from 'node:crypto';

const operations = new Set([
  'login_challenge', 'login_challenge_details', 'login_approve',
  'login_status', 'login_exchange', 'account_retire', 'retirement_process',
  'attestation_acknowledge',
]);
type ProviderOperation = 'login_challenge' | 'login_challenge_details' | 'login_approve'
  | 'login_status' | 'login_exchange' | 'account_retire' | 'retirement_process'
  | 'attestation_acknowledge';

export function recordProviderFailure(
  operation: ProviderOperation,
  event: 'provider_route_failed' | 'official_message_delivery_failed' = 'provider_route_failed',
): void {
  // Accept no Error or Request object; runtime allowlists also protect JS callers.
  console.warn({
    event: event === 'official_message_delivery_failed' ? event : 'provider_route_failed',
    operation: operations.has(operation) ? operation : 'unknown',
    outcome: 'unavailable',
    diagnosticId: randomUUID(),
  });
}

export async function runProviderRoute(operation: ProviderOperation, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch {
    recordProviderFailure(operation);
    return Response.json({ success: false, error: 'provider_temporarily_unavailable' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}

