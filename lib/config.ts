export const SERVICE_ID = "demo-supermarket";
export const SERVICE_NAME = "Demo Supermarket";
export const PROVIDER_NAME = "Demo Retail";

export const TRUST_PLANE_ORIGIN =
  process.env.NEXT_PUBLIC_UNET_TRUST_PLANE_ORIGIN?.replace(/\/$/, "") || "https://issuer.egress.live";

export const VERIFIER_ORIGIN =
  process.env.UNET_VERIFIER_ORIGIN?.replace(/\/$/, "") ||
  process.env.NEXT_PUBLIC_UNET_VERIFIER_ORIGIN?.replace(/\/$/, "") ||
  "https://verifier.egress.live";

export const PUBLIC_SITE_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_ORIGIN?.replace(/\/$/, "") || "https://supermarket.egress.live";

export const CONFIGURED_AGE_CHECK_REQUEST_TYPE =
  process.env.UNET_AGE_CHECK_REQUEST_TYPE?.trim() ||
  process.env.NEXT_PUBLIC_UNET_AGE_CHECK_REQUEST_TYPE?.trim() ||
  "";
