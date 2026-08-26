import { NextResponse } from "next/server";
import { directLoginQrPayload } from "@union-networks/server";
import { supermarketDirectLogin } from "../../../../../lib/direct-login";

export async function POST() {
  try {
    const challenge = await (await supermarketDirectLogin()).createChallenge({
      challengeUrl: "/api/unet/login/challenge",
      approvalUrl: "/api/unet/login/approve",
    });
    return NextResponse.json({ success: true, challenge, qrPayload: directLoginQrPayload(challenge) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "direct_login_unavailable" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const requestRef = new URL(request.url).searchParams.get("requestRef");
  if (!requestRef) return NextResponse.json({ success: false, message: "requestRef is required" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, challenge: await (await supermarketDirectLogin()).getChallenge(requestRef) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "direct_login_not_found" }, { status: 404 });
  }
}
