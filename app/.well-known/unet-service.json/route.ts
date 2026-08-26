import { NextResponse } from "next/server";
import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from "../../../lib/config";

export async function GET() {
  return NextResponse.json({
    protocolVersion: 2,
    serviceId: SERVICE_ID,
    origin: PUBLIC_SITE_ORIGIN,
    accountPolicy: { mode: "single", maxAccounts: 1, policyVersion: 2 },
    endpoints: {
      challenge: `${PUBLIC_SITE_ORIGIN}/api/unet/login/challenge`,
      approval: `${PUBLIC_SITE_ORIGIN}/api/unet/login/approve`,
      status: `${PUBLIC_SITE_ORIGIN}/api/unet/login/status`,
      exchange: `${PUBLIC_SITE_ORIGIN}/api/unet/login/exchange`,
      retirement: `${PUBLIC_SITE_ORIGIN}/api/unet/account/retire`,
      officialInbox: `${PUBLIC_SITE_ORIGIN}/api/unet/official-inbox`,
    },
  }, { headers: { "cache-control": "public, max-age=300" } });
}
