import type { AccountState } from './types';

export async function readInitialAccountState(scopedUserId: string, signal?: AbortSignal): Promise<AccountState> {
  if (!scopedUserId) throw new Error('login_required');
  const response = await fetch('/api/account-state', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  const body = await response.json();
  const state = body.state;
  if (!response.ok || body.success !== true || body.scopedUserId !== scopedUserId
    || !Array.isArray(state?.favorites) || !state.favorites.every((id: unknown) => typeof id === 'string')
    || !Array.isArray(state?.basket) || !state.basket.every((item: { productId?: unknown; quantity?: unknown } | null) =>
      item && typeof item.productId === 'string' && typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity >= 0)) {
    throw new Error('Account state is temporarily unavailable. Please try again.');
  }
  return { favorites: state.favorites, basket: state.basket };
}
