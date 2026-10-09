import { createUnetProtocolOptionsHandler } from '@u-net/server';
import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export const OPTIONS = createUnetProtocolOptionsHandler({
  methods: ['GET'],
  capabilities: ['direct_login'],
});

export async function GET(request: Request) {
  return runProviderRoute('login_status', async () => (await supermarketLoginHandlers()).challengeStatus(request));
}
