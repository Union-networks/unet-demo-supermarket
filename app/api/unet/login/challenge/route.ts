import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export async function POST(request: Request) {
  return runProviderRoute('login_challenge', async () => (await supermarketLoginHandlers()).challenge(request));
}

export async function GET(request: Request) {
  return runProviderRoute('login_challenge_details', async () => (await supermarketLoginHandlers()).challengeDetails(request));
}
