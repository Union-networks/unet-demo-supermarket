import { NextResponse } from 'next/server';
import { getCheckout, updateCheckout } from '../../../../lib/checkout';
import { readProviderSession } from '../../../../lib/provider-session';
import { VERIFIER_ORIGIN } from '../../../../lib/config';

export async function GET(request: Request, context: { params: Promise<{ checkoutId: string }> }) {
  const principal = readProviderSession(request);
  if (!principal) return NextResponse.json({ success: false, message: 'login_required' }, { status: 401 });
  const { checkoutId } = await context.params;
  let checkout = await getCheckout(checkoutId, principal.scopedUserId);
  if (!checkout) return NextResponse.json({ success: false, message: 'not_found' }, { status: 404 });
  if (checkout.status === 'pending_verification' && checkout.verificationSessionId) {
    if (checkout.expiresAt && Date.parse(checkout.expiresAt) <= Date.now()) checkout = (await updateCheckout(checkout.checkoutId, 'expired', 'session_expired')) ?? checkout;
    else {
      const response = await fetch(`${VERIFIER_ORIGIN}/v1/verification-sessions/${encodeURIComponent(checkout.verificationSessionId)}`, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
      const status = await response.json().catch(() => ({})) as { status?: string; aggregateOutcome?: string; reasonCode?: string };
      if (response.ok && status.status === 'verified' && status.aggregateOutcome === 'passed') checkout = (await updateCheckout(checkout.checkoutId, 'completed')) ?? checkout;
      else if (response.ok && ['denied', 'rejected', 'expired', 'unavailable'].includes(status.status ?? '')) checkout = (await updateCheckout(checkout.checkoutId, status.status === 'expired' ? 'expired' : 'failed', status.reasonCode ?? status.status)) ?? checkout;
    }
  }
  return NextResponse.json({ success: true, checkout });
}
