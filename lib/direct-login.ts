import {
  PostgresDirectLoginAccountStore,
  PostgresDirectLoginChallengeStore,
  PostgresOfficialMessagingInboxStore,
  createDirectLoginService,
  ensureDirectLoginSchema,
  ensureOfficialMessagingInboxSchema,
  registerOfficialMessagingInbox,
  type OfficialMessagingInboxRegistration,
} from "@u-net/server";
import { PUBLIC_SITE_ORIGIN, SERVICE_ID } from "./config";
import { providerPool } from "./provider-db";
import { supermarketLoginWebHandlers } from "./login-web";
import { cleanupSupermarketRetirement } from "./retirement-cleanup";

const state = globalThis as typeof globalThis & {
  __unetSupermarketDirectLoginReady?: Promise<void>;
  __unetSupermarketDirectLogin?: ReturnType<typeof createDirectLoginService>;
};

export async function supermarketDirectLogin() {
  state.__unetSupermarketDirectLoginReady ??= ensureDirectLoginSchema(providerPool).then(() => ensureOfficialMessagingInboxSchema(providerPool)).catch((error) => {
    state.__unetSupermarketDirectLoginReady = undefined;
    throw error;
  });
  await state.__unetSupermarketDirectLoginReady;
  const accountStore = new PostgresDirectLoginAccountStore(providerPool);
  const inboxStore = new PostgresOfficialMessagingInboxStore(providerPool);
  state.__unetSupermarketDirectLogin ??= createDirectLoginService({
    serviceId: SERVICE_ID,
    origin: PUBLIC_SITE_ORIGIN,
    challengeStore: new PostgresDirectLoginChallengeStore(providerPool),
    accountStore,
    onAccountRetired: (scopedUserId, operationId, signal) =>
      cleanupSupermarketRetirement(scopedUserId, operationId, signal, inboxStore),
    challengeTtlSeconds: 120,
    sessionTtlSeconds: 15 * 60,
  });
  return state.__unetSupermarketDirectLogin;
}

export async function supermarketLoginHandlers() {
  return supermarketLoginWebHandlers(await supermarketDirectLogin(), new PostgresDirectLoginAccountStore(providerPool));
}

export async function registerSupermarketOfficialInbox(registration: OfficialMessagingInboxRegistration) {
  await supermarketDirectLogin();
  return registerOfficialMessagingInbox({
    serviceId: SERVICE_ID,
    origin: PUBLIC_SITE_ORIGIN,
    registration,
    accountStore: new PostgresDirectLoginAccountStore(providerPool),
    inboxStore: new PostgresOfficialMessagingInboxStore(providerPool),
  });
}

export async function resolveSupermarketOfficialMessagingRecipient(scopedUserId: string) {
  await supermarketDirectLogin();
  return new PostgresOfficialMessagingInboxStore(providerPool).resolve(scopedUserId);
}
