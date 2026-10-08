import { supermarketLoginHandlers } from '../../../../../lib/direct-login';
import { runProviderRoute } from '../../../../../lib/provider-route';

export async function POST(request: Request) {
  return runProviderRoute('account_retire', async () => (await supermarketLoginHandlers()).retire(request));
}
