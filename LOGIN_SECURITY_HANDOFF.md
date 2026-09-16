# Supermarket Login Security Handoff

## Published rc.2 Validation (2026-09-16)

This section supersedes the historical rc.1/local-pack results below.

- Exact-lock `npm ci --prefer-online --ignore-scripts --no-audit --no-fund --fetch-retries=1 --cache .release-validation/npm-cache` passed. The sandbox initially returned EACCES; the authorized elevated retry succeeded. Lifecycle scripts stayed disabled.
- Both installed issuer/server packages were stale rc.1 before this run. Installed contracts, client, issuer and server now all report 2.0.0-rc.2, have no workspace links, and their installed-lock registry URLs/integrities match package-lock.json. `npm ls --all` for these four packages passed.
- Downloaded registry tarballs matched the actual GitHub `sdk-v2.0.0-rc.2` release assets byte-for-byte, the GitHub asset SHA-256 digests, npm metadata, and both provider locks' SHA-512 integrity values. No Windows local packs were used as references.
- `npm test`: 12 passed, zero failed/cancelled/skipped. `npm run typecheck` and `npm run build` both passed (Next 16.2.10; Node 24.18.0; npm 11.16.0).
- Real PostgreSQL tests used only 127.0.0.1:55439 / unet_security_test / unet_test. Random provider/policy test schemas were removed; a post-run query found zero matching schemas. The existing shared test server was left running.
- No environment files or persisted environment values changed. The validation runner supplied only synthetic child-process settings and the authorized test connection; builds used an unreachable loopback database. No production service was targeted.
- No functional rc.2 compatibility bug surfaced. The concrete issues found were stale installed SDKs and obsolete handoff release-gate claims, both corrected by this pass. Native HTTPS WebView approval/exchange and deployed scheduler behavior remain unvalidated.
- package.json, package-lock.json, application/test source, maintenance proxies and Git indexes are unchanged. No commit, deployment, publication or production data write was performed.

## Implemented

- All login and retirement HTTP routes use the staged SDK's createDirectLoginWebHandlers.
- Browser/WebView challenge creation is same-origin JSON POST. Only the public challenge is returned.
- Polling authenticates the per-challenge HttpOnly cookie and returns state only.
- Exchange sends requestRef and the browser cookie. The SDK consumes the approval atomically; session-ID-only exchange is rejected.
- QR data is rebuilt in the browser from public challenge fields.
- Miniapps create the challenge in the WebView, call host.createServiceSession({requestRef}), require a matching approved response, then exchange in the WebView. No native session ID or native polling is used.
- Provider sessions carry the cookie-bound-login-2026-09 security epoch and provider audience. Legacy cookies fail closed. Every authenticated request checks the active account in the provider store; there is no active-account cache.
- Account keys, scoped IDs and SDK account tables are not reset or dropped.
- The default-on proxy.ts maintenance switch is unchanged.
- GET /api/internal/retirements/process requires CRON_SECRET bearer authorization and calls retryRetirementCleanup once. Vercel cron configuration invokes it every minute. The SDK owns the 120-second lease, 30-second callback timeout, operation ID and retry backoff.
- Cleanup honors AbortSignal before and after asynchronous steps. All side effects are idempotent and the SDK job is not acknowledged until they succeed.
- Retirement deletes provider-owned basket/favorite and checkout state and retires the inbox. State and checkout writes lock the active account, preventing in-flight requests from recreating state after retirement.
- UI session restoration now checks the provider cookie, not a persisted session ID. Logout clears the provider cookie.
- tsx was added as a development-only test runner. Package type is module to match the SDK's ESM-only exports.

## Historical Pre-rc.2 Verification

- npm test: mocked provider tests cover cross-origin rejection, cookie theft across challenges, state-only polling, one-use concurrent exchange, legacy/expired/malformed/duplicate/wrong-audience cookies, retired and missing accounts, database failure, QR equivalence, frontend request bodies, and default maintenance.
- Retirement tests exercise SDK retry failure/success, the operation ID and AbortSignal callback, idempotent repeated cleanup, and one job per worker call.
- npm run typecheck and npm run build pass with the staged SDK installed locally.
- An ephemeral local HTTP server confirmed login maintenance returns 503, unauthenticated cleanup returns 401, and even a correctly signed legacy session cookie returns 401. The smoke server was stopped.
- Builds and HTTP smoke tests used an unreachable loopback database URL. Unit tests use memory/fake stores; the provider PostgreSQL integration test also passed against a newly initialized, disposable PostgreSQL 18 cluster bound to loopback. It verifies concurrent approval/redemption, real account rejection, 120-second leases, stale-token fencing, lease recovery, callback retry, deletion of basket/favorite/checkout state, and rejection of state recreation. The test schema was dropped and the cluster was stopped.
- With UNET_PROVIDER_TEST_DATABASE_URL set to that disposable instance, all 12 tests passed using the actual locally installed SDK package. No production database, ledger or messaging service was accessed.

## Published SDK And Release Gates

Both provider manifests, locks and installed SDKs now use published 2.0.0-rc.2.
Registry-only npm ci, GitHub release artifact comparison, real isolated PostgreSQL
tests, typecheck and production builds passed. Keep maintenance enabled.
See [SDK_RC_VALIDATION.md](SDK_RC_VALIDATION.md) for current hashes and exact results.

Unresolved release/integration checks:

- Registry publication/install validation is complete. Do not disable maintenance until native and deployment integration gates are explicitly cleared.
- Validate the coordinated native host build end-to-end in a real HTTPS WebView: it must approve exactly the supplied requestRef and return {requestRef, approved:true, scopedUserId}.
- Rerun the provider PostgreSQL test against any later SDK change using UNET_PROVIDER_TEST_DATABASE_URL pointing to an explicitly disposable loopback database. Current installed-SDK PostgreSQL checks passed.
- Provision CRON_SECRET and enable/verify the cron scheduler in the eventual deployment. No scheduler was deployed or invoked against production. Each invocation processes one retirement; monitor queue throughput.

## Changed Files

Paths below are relative to this repository. This list covers this task's edits.

- app/api/account-state/route.ts
- app/api/checkout-verifications/[checkoutId]/route.ts
- app/api/checkout-verifications/route.ts
- app/api/session/route.ts
- app/api/unet/account/retire/route.ts
- app/api/unet/login/approve/route.ts
- app/api/unet/login/challenge/route.ts
- app/api/unet/login/exchange/route.ts
- app/api/unet/login/status/route.ts
- app/api/internal/retirements/process/route.ts
- components/SupermarketApp.tsx
- lib/account-state.ts
- lib/browser-login.ts
- lib/checkout.ts
- lib/direct-login.ts
- lib/login-web.ts
- lib/provider-session.ts
- lib/retirement-cleanup.ts
- lib/types.ts
- package.json
- package-lock.json
- vercel.json
- tests/login-security.test.ts
- tests/login-postgres.test.ts
- tests/retirement-cleanup.test.ts
- LOGIN_SECURITY_HANDOFF.md
- .gitignore
- SDK_RC_VALIDATION.md
