import { NextResponse } from "next/server";

import { getProviderDomainClaim } from "../../../lib/domain-claim";

export const dynamic = "force-dynamic";

export function GET() {
  const claim = getProviderDomainClaim();
  if (!claim) {
    return NextResponse.json(
      { success: false, message: "Domain claim is not configured." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }
  return NextResponse.json(claim, { headers: { "cache-control": "no-store" } });
}
