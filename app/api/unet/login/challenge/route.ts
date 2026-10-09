import { createUnetProtocolOptionsHandler } from '@u-net/server';
import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export const OPTIONS = createUnetProtocolOptionsHandler({
  methods: ['GET', 'POST'],
  capabilities: ['direct_login'],
});

export async function POST(request: Request) {
  return runProviderRoute('login_challenge', async () => (await supermarketLoginHandlers()).challenge(request));
}

export async function GET(request: Request) {
  return runProviderRoute('login_challenge_details', async () => (await supermarketLoginHandlers()).challengeDetails(request));
}
