import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createCheckout } from '../../../lib/checkout';
import { readProviderSession } from '../../../lib/provider-session';
import { SERVICE_ID, VERIFIER_ORIGIN } from '../../../lib/config';

type VerificationCheck = Record<string, unknown> & { requestType?: string };

export async function POST(request: Request) {
  const principal = readProviderSession(request);
  if (!principal) return NextResponse.json({ success: false, message: 'login_required' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { requiredChecks?: string[]; restrictedResourceIds?: string[]; ttlSeconds?: number };
  const requiredChecks = Array.isArray(body.requiredChecks) ? [...new Set(body.requiredChecks.map(String).filter(Boolean))].slice(0, 8) : [];
  const restrictedResourceIds = Array.isArray(body.restrictedResourceIds) ? [...new Set(body.restrictedResourceIds.map(String).filter(Boolean))].slice(0, 100) : [];
  if (!requiredChecks.length) {
    const checkout = await createCheckout({ scopedUserId: principal.scopedUserId, status: 'completed', requiredChecks: [], restrictedResourceIds: [] });
    return NextResponse.json({ success: true, requiresVerification: false, checkout });
  }
  const catalogResponse = await fetch(`${VERIFIER_ORIGIN}/v1/verification-checks`, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  const catalog = await catalogResponse.json().catch(() => ({})) as { checks?: VerificationCheck[] };
  if (!catalogResponse.ok) return NextResponse.json({ success: false, message: 'verification_catalog_unavailable' }, { status: 503 });
  const activeByType = new Map((catalog.checks ?? []).map((check) => [check.requestType, check]));
  const checks = requiredChecks.map((requestType) => activeByType.get(requestType)).filter((check): check is VerificationCheck => Boolean(check));
  if (checks.length !== requiredChecks.length) return NextResponse.json({ success: false, message: 'check_unavailable' }, { status: 409 });
  const sessionResponse = await fetch(`${VERIFIER_ORIGIN}/v1/verification-sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      verifierId: SERVICE_ID,
      verifierDisplayName: 'Demo Supermarket',
      requestType: requiredChecks[0],
      requestedChecks: checks,
      session_profile: { title: 'Checkout verification', subtitle: 'Demo Supermarket', description: 'Required before completing this checkout.' },
      ttlSeconds: Math.max(30, Math.min(Math.floor(body.ttlSeconds ?? 300), 1_800)),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const session = await sessionResponse.json().catch(() => ({})) as { sessionId?: string; sessionRef?: string; nonce?: string; expiresAt?: string; requestedChecks?: unknown[]; message?: string };
  if (!sessionResponse.ok || !session.sessionId || !session.sessionRef || !session.expiresAt) return NextResponse.json({ success: false, message: session.message ?? 'verification_session_unavailable' }, { status: 503 });
  const checkout = await createCheckout({
    scopedUserId: principal.scopedUserId,
    status: 'pending_verification',
    requiredChecks,
    restrictedResourceIds,
    verificationSessionId: session.sessionId,
    verificationSessionRef: session.sessionRef,
    expiresAt: session.expiresAt,
  });
  const qrPayload = `unet://verify?session_ref=${encodeURIComponent(session.sessionRef)}`;
  return NextResponse.json({
    success: true,
    requiresVerification: true,
    checkout,
    verification: { ...session, qrPayload, qrDataUrl: await QRCode.toDataURL(qrPayload) },
  });
}
