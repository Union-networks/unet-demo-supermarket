import { supermarketDirectLogin } from '../../../../../lib/direct-login';

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }
  // The SDK leases one job for 120 seconds and bounds its callback to 30 seconds.
  const result = await (await supermarketDirectLogin()).retryRetirementCleanup();
  return Response.json({ success: true, ...result }, { headers: { 'cache-control': 'no-store' } });
}
