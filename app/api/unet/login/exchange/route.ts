import { createUnetProtocolOptionsHandler } from '@u-net/server';
import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export const OPTIONS = createUnetProtocolOptionsHandler({
  methods: ['POST'],
  capabilities: ['direct_login'],
});

export async function POST(request: Request) {
  return runProviderRoute('login_exchange', async () => (await supermarketLoginHandlers()).exchange(request));
}
