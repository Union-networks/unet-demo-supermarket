import { supermarketLoginHandlers } from '../../../../../lib/direct-login';

export async function GET(request: Request) {
  return (await supermarketLoginHandlers()).challengeStatus(request);
}
