import { NextResponse } from "next/server";
import { supermarketDirectLogin } from "../../../../../lib/direct-login";

export async function GET(request: Request) {
  const requestRef = new URL(request.url).searchParams.get("requestRef");
  if (!requestRef) return NextResponse.json({ success: false, message: "requestRef is required" }, { status: 400 });
  try {
    return NextResponse.json({ success: true, ...await (await supermarketDirectLogin()).poll(requestRef) });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "direct_login_status_failed" }, { status: 404 });
  }
}
