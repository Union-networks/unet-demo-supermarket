import { NextResponse } from "next/server";
import type { OfficialMessagingInboxRegistration } from "@union-networks/server";
import { registerSupermarketOfficialInbox } from "../../../../lib/direct-login";

export async function POST(request: Request) {
  try {
    await registerSupermarketOfficialInbox(await request.json() as OfficialMessagingInboxRegistration);
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "official_inbox_registration_rejected" }, { status: 400 });
  }
}
