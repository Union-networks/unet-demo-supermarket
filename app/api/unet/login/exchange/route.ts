import { supermarketLoginHandlers } from '../../../../../lib/direct-login';

export async function POST(request: Request) {
  return (await supermarketLoginHandlers()).exchange(request);
}
