import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export async function POST(request: Request) {
  return runProviderRoute('login_exchange', async () => (await supermarketLoginHandlers()).exchange(request));
}
