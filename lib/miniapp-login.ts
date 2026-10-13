import { runMiniappLogin, type MiniappLoginApproval } from '@u-net/web-login';
import { readInitialAccountState } from './account-bootstrap';
import { createProviderChallenge, exchangeProviderChallenge } from './browser-login';
import type { AccountState, SessionState } from './types';

export type SupermarketHostRequest = <T>(action: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;

export function runSupermarketMiniappLogin(
  origin: string, callHost: SupermarketHostRequest, signal: AbortSignal,
  installState: (scopedUserId: string, state: AccountState) => void,
): Promise<SessionState> {
  return runMiniappLogin({
    origin, signal, timeoutMs: 60_000,
    createChallenge: createProviderChallenge,
    approve: (challenge, stepSignal, context) => callHost<MiniappLoginApproval>('host.createServiceSession', {
      requestRef: challenge.requestRef, publicChallenge: challenge, loginDeadlineMs: context.expiresAtMs,
    }, stepSignal),
    exchange: (challenge, stepSignal) => exchangeProviderChallenge(challenge.requestRef, stepSignal),
    initialize: async (exchanged, stepSignal) => {
      const authoritative = await readInitialAccountState(exchanged.scopedUserId, stepSignal);
      if (stepSignal.aborted) throw new Error('miniapp_login_aborted');
      installState(exchanged.scopedUserId, authoritative);
      return exchanged;
    },
    complete: (payload, stepSignal) => callHost('host.completeLaunch', { ...payload }, stepSignal),
  });
}
