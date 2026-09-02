import { providerPool } from "./provider-db";
import { PRODUCTS } from "./products";
import type { AccountState, BasketItem } from "./types";

export type AccountStateMutation =
  | { operation: "set_favorite"; productId: string; favorite: boolean }
  | { operation: "set_basket_quantity"; productId: string; quantity: number }
  | { operation: "clear_basket" }
  | { operation: "remove_basket_products"; productIds: string[] }
  | { operation: "import_local_state_if_empty"; state: AccountState };

export type VersionedAccountState = AccountState & {
  revision: number;
  updatedAt: string;
};

const knownProductIds = new Set(PRODUCTS.map((product) => product.productId));
const runtime = globalThis as typeof globalThis & { __unetSupermarketAccountStateReady?: Promise<void> };

const normalizeFavorites = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.map(String).filter((productId) => knownProductIds.has(productId)))].slice(0, PRODUCTS.length)
    : [];

const normalizeBasket = (value: unknown): BasketItem[] => {
  if (!Array.isArray(value)) return [];
  const quantities = new Map<string, number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const productId = String((item as { productId?: unknown }).productId ?? "");
    const quantity = Math.max(0, Math.min(99, Math.floor(Number((item as { quantity?: unknown }).quantity))));
    if (knownProductIds.has(productId) && quantity > 0) quantities.set(productId, quantity);
  }
  return [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
};

const mapRow = (row: Record<string, unknown>): VersionedAccountState => ({
  favorites: normalizeFavorites(row.favorites),
  basket: normalizeBasket(row.basket),
  revision: Number(row.revision ?? 0),
  updatedAt: new Date(String(row.updated_at)).toISOString(),
});

export async function ensureAccountStateSchema(): Promise<void> {
  runtime.__unetSupermarketAccountStateReady ??= providerPool.query(`
    CREATE TABLE IF NOT EXISTS supermarket_account_states_v2 (
      scoped_user_id TEXT PRIMARY KEY,
      favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
      basket JSONB NOT NULL DEFAULT '[]'::jsonb,
      revision BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).then(() => undefined);
  await runtime.__unetSupermarketAccountStateReady;
}

export async function getAccountState(scopedUserId: string): Promise<VersionedAccountState> {
  await ensureAccountStateSchema();
  const result = await providerPool.query(
    `INSERT INTO supermarket_account_states_v2 (scoped_user_id)
     VALUES ($1)
     ON CONFLICT (scoped_user_id) DO UPDATE SET scoped_user_id=EXCLUDED.scoped_user_id
     RETURNING favorites,basket,revision,updated_at`,
    [scopedUserId],
  );
  return mapRow(result.rows[0]);
}

export async function mutateAccountState(scopedUserId: string, mutation: AccountStateMutation): Promise<VersionedAccountState> {
  await ensureAccountStateSchema();
  const client = await providerPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO supermarket_account_states_v2 (scoped_user_id) VALUES ($1)
       ON CONFLICT (scoped_user_id) DO NOTHING`,
      [scopedUserId],
    );
    const currentResult = await client.query(
      `SELECT favorites,basket,revision,updated_at
       FROM supermarket_account_states_v2 WHERE scoped_user_id=$1 FOR UPDATE`,
      [scopedUserId],
    );
    const current = mapRow(currentResult.rows[0]);
    let favorites = current.favorites;
    let basket = current.basket;

    if (mutation.operation === "set_favorite") {
      if (!knownProductIds.has(mutation.productId)) throw new Error("unknown_product");
      favorites = mutation.favorite
        ? [...new Set([...favorites, mutation.productId])]
        : favorites.filter((productId) => productId !== mutation.productId);
    } else if (mutation.operation === "set_basket_quantity") {
      if (!knownProductIds.has(mutation.productId)) throw new Error("unknown_product");
      const quantity = Math.max(0, Math.min(99, Math.floor(mutation.quantity)));
      basket = basket.filter((item) => item.productId !== mutation.productId);
      if (quantity > 0) basket.push({ productId: mutation.productId, quantity });
    } else if (mutation.operation === "clear_basket") {
      basket = [];
    } else if (mutation.operation === "remove_basket_products") {
      const removed = new Set(mutation.productIds.filter((productId) => knownProductIds.has(productId)));
      basket = basket.filter((item) => !removed.has(item.productId));
    } else if (current.revision === 0 && favorites.length === 0 && basket.length === 0) {
      favorites = normalizeFavorites(mutation.state.favorites);
      basket = normalizeBasket(mutation.state.basket);
    }

    const updated = await client.query(
      `UPDATE supermarket_account_states_v2
       SET favorites=$2::jsonb,basket=$3::jsonb,revision=revision+1,updated_at=now()
       WHERE scoped_user_id=$1
       RETURNING favorites,basket,revision,updated_at`,
      [scopedUserId, JSON.stringify(favorites), JSON.stringify(basket)],
    );
    await client.query("COMMIT");
    return mapRow(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAccountState(scopedUserId: string): Promise<void> {
  await ensureAccountStateSchema();
  await providerPool.query("DELETE FROM supermarket_account_states_v2 WHERE scoped_user_id=$1", [scopedUserId]);
}
