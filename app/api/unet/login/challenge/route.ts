import { supermarketLoginHandlers } from '../../../../../lib/direct-login';

export async function POST(request: Request) {
  return (await supermarketLoginHandlers()).challenge(request);
}

export async function GET(request: Request) {
  return (await supermarketLoginHandlers()).challengeDetails(request);
}
