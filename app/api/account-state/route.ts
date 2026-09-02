import { NextResponse } from "next/server";
import { getAccountState, mutateAccountState, type AccountStateMutation } from "../../../lib/account-state";
import { readProviderSession } from "../../../lib/provider-session";

const unauthorized = () => NextResponse.json({ success: false, message: "login_required" }, { status: 401 });

export async function GET(request: Request) {
  const principal = readProviderSession(request);
  if (!principal) return unauthorized();
  const state = await getAccountState(principal.scopedUserId);
  return NextResponse.json({ success: true, state }, { headers: { "cache-control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const principal = readProviderSession(request);
  if (!principal) return unauthorized();
  const body = await request.json().catch(() => null) as AccountStateMutation | null;
  if (!body || !["set_favorite", "set_basket_quantity", "clear_basket", "remove_basket_products", "import_local_state_if_empty"].includes(body.operation)) {
    return NextResponse.json({ success: false, message: "invalid_account_state_operation" }, { status: 400 });
  }
  try {
    const state = await mutateAccountState(principal.scopedUserId, body);
    return NextResponse.json({ success: true, state }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "account_state_update_failed";
    return NextResponse.json({ success: false, message }, { status: message === "unknown_product" ? 400 : 500 });
  }
}
