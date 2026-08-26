import { NextResponse } from "next/server";
import { supermarketDirectLogin } from "../../../../../lib/direct-login";
import { createProviderSession, providerSessionCookie } from "../../../../../lib/provider-session";

export async function POST(request: Request) {
  const body = await request.json() as { sessionId?: string };
  if (!body.sessionId) return NextResponse.json({ success: false, message: "sessionId is required" }, { status: 400 });
  try {
    const claims = await (await supermarketDirectLogin()).exchangeSession(body.sessionId);
    const response = NextResponse.json({ success: true, scopedUserId: claims.scopedUserId, sessionId: body.sessionId });
    response.headers.set("set-cookie", providerSessionCookie(createProviderSession(claims.scopedUserId)));
    return response;
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "direct_login_exchange_failed" }, { status: 401 });
  }
}
