import type { DirectLoginChallenge } from '@u-net/server';

export async function createProviderChallenge(): Promise<DirectLoginChallenge> {
  const response = await fetch('/api/unet/login/challenge', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: '{}',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success || !result.challenge?.requestRef) {
    throw new Error(result.error || 'Could not create login challenge.');
  }
  return result.challenge;
}

export async function exchangeProviderChallenge(requestRef: string): Promise<{ scopedUserId: string }> {
  const response = await fetch('/api/unet/login/exchange', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestRef }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success || typeof result.scopedUserId !== 'string' || !result.scopedUserId) {
    throw new Error(result.error || 'Provider login exchange failed.');
  }
  return { scopedUserId: result.scopedUserId };
}

export function loginQrPayload(challenge: DirectLoginChallenge): string {
  return `unet://service-login?payload=${encodeURIComponent(JSON.stringify({
    kind: 'unet_service_login', version: 2, serviceId: challenge.serviceId,
    origin: challenge.origin, requestRef: challenge.requestRef,
    challengeUrl: challenge.challengeUrl, expiresAtIso: challenge.expiresAtIso,
  }))}`;
}
