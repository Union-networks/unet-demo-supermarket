import { NextResponse } from 'next/server';

export function proxy() {
  if (process.env.UNET_LOGIN_SECURITY_MAINTENANCE === 'false') return NextResponse.next();
  return NextResponse.json({ success: false, error: 'login_temporarily_unavailable', message: 'Sign-in is paused for a security update. Please try again later.' }, {
    status: 503, headers: { 'retry-after': '300', 'cache-control': 'no-store' },
  });
}

export const config = { matcher: ['/api/unet/login/:path*'] };
