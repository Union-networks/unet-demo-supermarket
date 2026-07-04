import { NextResponse } from "next/server";
import { PROVIDER_NAME, PUBLIC_SITE_ORIGIN, SERVICE_ID, SERVICE_NAME } from "../../../lib/config";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
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
      permissions: ["identity.scoped", "attestations.request", "notifications.send"],
      notificationCategories: ["service", "security", "marketing"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
