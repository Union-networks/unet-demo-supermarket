import { createHash, createHmac } from "node:crypto";

import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from "./config";

export function getProviderDomainClaim() {
  const claimId = process.env.UNET_PROVIDER_CLAIM_ID;
  const challenge = process.env.UNET_PROVIDER_CLAIM_CHALLENGE;
  const claimToken = process.env.UNET_PROVIDER_CLAIM_TOKEN;
  if (!claimId || !challenge || !claimToken) return null;

  const origin = PUBLIC_SITE_ORIGIN.replace(/\/+$/, "");
  const claimTokenHash = createHash("sha256").update(claimToken).digest("hex");
  const proof = createHmac("sha256", claimTokenHash)
    .update(`${claimId}.${SERVICE_ID}.${origin}.${challenge}`)
    .digest("base64url");

  return { serviceId: SERVICE_ID, origin, claimId, challenge, proof };
}
