import { createDirectLoginWebHandlers, type DirectLoginAccountStore, type DirectLoginService } from '@u-net/server';
import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from './config';
import { createProviderSession, providerSessionCookie } from './provider-session';

export function supermarketLoginWebHandlers(service: DirectLoginService, accountStore: DirectLoginAccountStore) {
  return createDirectLoginWebHandlers({
    serviceId: SERVICE_ID, origin: PUBLIC_SITE_ORIGIN, service, accountStore,
    exchange: async ({ scopedUserId }) => new Response(JSON.stringify({ success: true, scopedUserId }), {
      headers: { 'content-type': 'application/json', 'set-cookie': providerSessionCookie(createProviderSession(scopedUserId)) },
    }),
  });
}
