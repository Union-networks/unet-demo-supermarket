import { NextResponse } from "next/server";
import type { DirectLoginApproval } from "@u-net/server";
import { supermarketDirectLogin } from "../../../../../lib/direct-login";

export async function POST(request: Request) {
  try {
    await (await supermarketDirectLogin()).approve(await request.json() as DirectLoginApproval);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "direct_login_rejected" }, { status: 400 });
  }
}
