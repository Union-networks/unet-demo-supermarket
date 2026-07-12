import { NextResponse } from "next/server";

import { CONFIGURED_AGE_CHECK_REQUEST_TYPE, VERIFIER_ORIGIN } from "../../../lib/config";

type VerificationCheck = {
  requestType?: string;
  label?: string;
  templateType?: string;
  proofProfileId?: string;
  predicateParams?: {
    minimumAge?: number;
    lowerBound?: number;
  };
};

export async function GET() {
  const response = await fetch(`${VERIFIER_ORIGIN}/v1/verification-checks`, { cache: "no-store" });
  const body = (await response.json().catch(() => ({}))) as {
    checks?: VerificationCheck[];
    message?: string;
  };
  if (!response.ok) {
    return NextResponse.json(
      { success: false, message: body.message || "Could not load U-net verification checks." },
      { status: response.status },
    );
  }

  const activeChecks = Array.isArray(body.checks) ? body.checks : [];
  const configured = CONFIGURED_AGE_CHECK_REQUEST_TYPE
    ? activeChecks.find((check) => check.requestType === CONFIGURED_AGE_CHECK_REQUEST_TYPE)
    : undefined;
  const check = configured ?? activeChecks.find((candidate) => {
    const minimumAge = Number(candidate.predicateParams?.minimumAge ?? candidate.predicateParams?.lowerBound);
    return candidate.templateType === "age" &&
      candidate.proofProfileId === "claim_range_v1" &&
      Number.isFinite(minimumAge) &&
      minimumAge >= 18;
  });

  if (!check?.requestType) {
    return NextResponse.json(
      { success: false, message: "No active over-18 attestation check is available." },
      { status: 503 },
    );
  }

  return NextResponse.json({ success: true, check });
}
