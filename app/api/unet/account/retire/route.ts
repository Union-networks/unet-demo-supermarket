import { NextResponse } from "next/server";
import type { ServiceAccountRetirement } from "@union-networks/server";
import { supermarketDirectLogin } from "../../../../../lib/direct-login";

export async function POST(request: Request) {
  try {
    await (await supermarketDirectLogin()).retire(await request.json() as ServiceAccountRetirement);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "account_retirement_rejected" }, { status: 400 });
  }
}
