import { privateJson, privateFailure, readPrivateBody } from '../../../../lib/private-route-response';
import type { OfficialMessagingInboxRegistration } from "@u-net/server";
import { registerSupermarketOfficialInbox } from "../../../../lib/direct-login";

export async function POST(request: Request) {
  try {
    await registerSupermarketOfficialInbox(await readPrivateBody<OfficialMessagingInboxRegistration>(request));
    return privateJson({ success: true }, { status: 201 });
  } catch (error) {
    return privateFailure(error, 'inbox');
  }
}
