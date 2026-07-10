import { NextResponse } from "next/server";
import { PROVIDER_NAME, PUBLIC_SITE_ORIGIN, SERVICE_ID, SERVICE_NAME } from "../../../lib/config";
import { getProviderDomainClaim } from "../../../lib/domain-claim";

export const dynamic = "force-dynamic";

export function GET() {
  const manifest: Record<string, unknown> = {
    serviceId: SERVICE_ID,
    miniProgramId: SERVICE_ID,
    name: SERVICE_NAME,
    provider: PROVIDER_NAME,
    description:
      "A U-net demo supermarket with scoped login, favorites, basket state, and over-18 checkout verification.",
    category: "Shopping",
    icon: "🛒",
    origin: PUBLIC_SITE_ORIGIN,
    launchUrl: PUBLIC_SITE_ORIGIN,
    permissions: ["identity.scoped", "attestations.request"],
    notificationCategories: [],
  };
  const domainClaim = getProviderDomainClaim();
  if (domainClaim) manifest.domainClaim = domainClaim;

  return NextResponse.json(
    manifest,
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
