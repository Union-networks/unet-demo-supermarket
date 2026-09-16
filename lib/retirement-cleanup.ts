import type { OfficialMessagingInboxStore } from '@u-net/server';
import { deleteAccountState } from './account-state';
import { deleteCheckoutState } from './checkout';

export async function cleanupSupermarketRetirement(
  scopedUserId: string, _operationId: string, signal: AbortSignal,
  inboxStore: Pick<OfficialMessagingInboxStore, 'retire'>,
) {
  signal.throwIfAborted();
  await deleteAccountState(scopedUserId);
  signal.throwIfAborted();
  await deleteCheckoutState(scopedUserId);
  signal.throwIfAborted();
  await inboxStore.retire(scopedUserId);
  signal.throwIfAborted();
}
