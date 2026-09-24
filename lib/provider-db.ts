import { Pool } from "pg";
import { providerDatabaseOptions } from "./provider-database-options";

const connectionString =
  process.env.UNET_PROVIDER_DATABASE_URL ??
  process.env.UNET_PROVIDER_DATABASE_DATABASE_URL;
const state = globalThis as typeof globalThis & { __unetSupermarketProviderPool?: Pool };
export const providerPool = state.__unetSupermarketProviderPool ?? new Pool(providerDatabaseOptions(connectionString));
if (process.env.NODE_ENV !== "production") state.__unetSupermarketProviderPool = providerPool;
