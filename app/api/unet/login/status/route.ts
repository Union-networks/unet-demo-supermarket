import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export async function GET(request: Request) {
  return runProviderRoute('login_status', async () => (await supermarketLoginHandlers()).challengeStatus(request));
}
