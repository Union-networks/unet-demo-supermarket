export const SERVICE_ID = "demo-supermarket";
export const SERVICE_NAME = "Demo Supermarket";
export const PROVIDER_NAME = "Demo Retail";

export const TRUST_PLANE_ORIGIN =
  process.env.NEXT_PUBLIC_UNET_TRUST_PLANE_ORIGIN?.replace(/\/$/, "") || "https://issuer.egress.live";

export const PUBLIC_SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://supermarket.egress.live";
