import { Pool } from "pg";

const connectionString =
  process.env.UNET_PROVIDER_DATABASE_URL ??
  process.env.UNET_PROVIDER_DATABASE_DATABASE_URL;
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
if (process.env.NODE_ENV === "production" && !isProductionBuild && !connectionString) {
  throw new Error("UNET_PROVIDER_DATABASE_URL is required in production");
}

const state = globalThis as typeof globalThis & { __unetSupermarketProviderPool?: Pool };
export const providerPool = state.__unetSupermarketProviderPool ?? new Pool({
  connectionString: connectionString || "postgresql://postgres:postgres@127.0.0.1:5432/unet_supermarket",
  ssl: connectionString?.includes("localhost") || connectionString?.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
  max: 5,
});
if (process.env.NODE_ENV !== "production") state.__unetSupermarketProviderPool = providerPool;
