import { readProviderSession, providerSessionCookie } from '../../../lib/provider-session';
import { PUBLIC_SITE_ORIGIN } from '../../../lib/config';

export async function GET(request: Request) {
  const principal = await readProviderSession(request);
  return Response.json(principal ? { success: true, ...principal } : { success: false, error: 'login_required' }, {
    status: principal ? 200 : 401, headers: { 'cache-control': 'no-store' },
  });
}

export async function DELETE(request: Request) {
  if (request.headers.get('origin') !== new URL(PUBLIC_SITE_ORIGIN).origin) {
    return Response.json({ success: false, error: 'origin_mismatch' }, { status: 403 });
  }
  return Response.json({ success: true }, {
    headers: { 'set-cookie': providerSessionCookie('', 0), 'cache-control': 'no-store' },
  });
}
