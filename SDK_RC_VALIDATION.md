# SDK 2.0.0-rc.2 Registry Consumer Validation

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

## Published Artifact Identity

Reference: [GitHub SDK rc.2 release](https://github.com/Union-networks/unet-sdk/releases/tag/sdk-v2.0.0-rc.2).

| Package | Registry/GitHub SHA-256 |
| --- | --- |
| @u-net/contracts | cb6eab289823d54ecf4bb9b0861731979200b7f819c67c84cc6122b9d0ed3adf |
| @u-net/client | 4ac22fb3909cebb1b637641d2c0df81e8d021a837d36c6d64d85618e8c8686f5 |
| @u-net/issuer | a70ecacd9afc690eae8918b7a23d8ea49995fb258021e02594e430a614dcd227 |
| @u-net/server | 884a236250b53ad308c2b9d56fd43babe6eba48a05d870fb0c9501b812707863 |

All four installed packages resolve from https://registry.npmjs.org/ at 2.0.0-rc.2.
Provider lock SHA-256 (unchanged): `5c0ccfff4c7f119a7dd6563c310335bcafdc28b07070ccb2abcd68a32d9ef93d`.

## Evidence And Reproduction

The ignored local runner is safety-current/.release-validation/run-registry-checks.mjs;
it accepts either provider directory. It verifies installed versions, paths and
registry provenance, probes the authorized test database, and runs npm ls, test,
typecheck and build with isolated child-process configuration. Local results are
in each provider's .release-validation/registry-check-results.json. Cross-provider
artifact comparisons are in safety-current/.release-validation/registry-provenance.json.
These ignored files are local evidence, not release source or deployment inputs.

To reproduce, use the exact npm ci command above in each provider, then enable
UNET_PROVIDER_TEST_DATABASE_URL only for the authorized isolated test database
when running npm test. Safety's full policy suite additionally needs
UNET_POLICY_TEST_DATABASE_URL for that same test database. Never copy production
environment files into validation runs. Run npm run typecheck and npm run build
with synthetic settings and an unreachable build database.

The older tests/verify-sdk-release.mjs is a local-pack harness, not proof of a
registry-only install. Its rc.1 commands below are historical and must not be
used to validate the published rc.2 release.

## Remaining Gates

- Main owns Android native integration: real HTTPS WebView approval must bind to
  exactly the supplied requestRef, then exchange with the same WebView cookie.
- Keep maintenance enabled. Validate authenticated retirement scheduling only
  as part of a separately authorized deployment; each invocation leases one job.
- Registry install/provenance and local provider test/build gates are now passed.
  This does not authorize deployment or clearing the remaining integration gates.

## Historical rc.1 Evidence

Everything below describes the previous local-pack run, not current installed
versions, locks or release readiness. Its unpublished/blocked claims are superseded
by the published rc.2 results above; historical hashes are not rc.2 references.

## Result

2026-09-16: a fresh consumer snapshot with no node_modules installed the four
canonical packed SDK packages together, using no workspace imports or symlinks.
All 117 installed SDK files matched the tarball contents byte-for-byte. npm ls
confirmed one coherent rc.1 dependency tree (issuer -> client -> contracts, plus
server). 12 provider tests, TypeScript checking and the Next production build
passed. The login/retirement integration test used a newly initialized disposable
PostgreSQL 18 cluster on 127.0.0.1:55330; the cluster was stopped afterward.

No .env files were copied into consumers. Builds had an unreachable loopback
database URL. Test accounts, keys, schema and state were synthetic. Both
maintenance proxies remain unchanged and default-on.

## Canonical Pack Identity

These are the newer manifest hashes actually installed and tested, not the
earlier hashes observed before the SDK packs were regenerated.

| Package | SHA-256 |
| --- | --- |
| @u-net/contracts | 169f58996edd9e71ff9eb21bb2b4ae2ee39e17258418b5e6603e3875e21acf56 |
| @u-net/client | 5a58629d601cd61d4af236819bfa3178483436fe9dad53cd8624a673cae827d1 |
| @u-net/issuer | 52179c75956a78bc98636e98c7feda6d6fe42815c633bf7ac3468058b8ed8eaa |
| @u-net/server | e397b5a031dae718d06b1dda9169ce42433232a8e4f5355f8baf4bade40b4ca8 |

All four versions are 2.0.0-rc.1. Test manifests use local tarball paths only in
ignored disposable snapshots. Source package.json declares exact registry
versions for issuer and server. Local repository node_modules also has these
packs installed using --no-save --package-lock=false --ignore-scripts.

## Lock And Publication Gate

The SDK manifest says packed-unpublished. Existing package-lock.json is retained
unchanged by this retargeting pass and still resolves SDK 1.0.0. It deliberately
does not pretend to resolve unpublished rc.1 registry packages. Consequently,
package.json and package-lock.json are not release-coherent yet: a registry-only
npm ci is NOT validated or ready. Do not merge/deploy this staged dependency
retarget as a completed release.

Coordinator ordering (not performed by this task):

1. Freeze the manifest and publish these exact immutable tarballs under an
   explicit prerelease dist-tag. Publish contracts first, then client, then
   issuer; server is independent and can publish before the consumers.
2. For the full SDK set, publish verification and web-login after client, react
   after those packages, and setup after issuer. Verify registry metadata and
   downloaded tarball hashes against the frozen manifest.
3. In each provider regenerate package-lock.json with npm against the canonical
   published registry, without local file paths, workspace links, overrides or
   fabricated resolved URLs/integrity values. Review SDK version convergence and
   unrelated dependency changes before accepting the new locks.
4. Run fresh registry-only npm ci in clean consumers, then repeat tests,
   disposable PostgreSQL coverage, typecheck and build. Publication alone does
   not authorize deployment or removal of maintenance.

If any tarball changes, invalidate this result and rerun both consumers against
the new frozen manifest. This task performed no publication, commits, pushes,
deployment, reset, production database access or production-chain writes.

## Reproduction

The harness is safety-current/tests/verify-sdk-release.mjs and can validate
either provider. From safety-current:

```powershell
node tests/verify-sdk-release.mjs ../unet-sdk/artifacts/2.0.0-rc.1-manifest.json .
node tests/verify-sdk-release.mjs ../unet-sdk/artifacts/2.0.0-rc.1-manifest.json ../supermarket-current
```

Set UNET_PROVIDER_TEST_DATABASE_URL only to an explicitly disposable loopback
PostgreSQL instance to include the real database case. The harness sanitizes
application environment variables, ignores .env files, pins other direct
dependencies to the existing provider lock, and creates an empty ignored
.release-validation/rc-consumer-* snapshot. Each successful snapshot retains an
rc-validation.json result with hashes and check names. The harness checks pack
hashes again after the build and fails if they changed during validation.

## Remaining Integration Gates

- Registry publication, real registry locks and clean npm ci as described above.
- Real HTTPS native WebView approval of exactly the supplied requestRef, followed
  by cookie-bound exchange in that same WebView.
- Provision and validate the authenticated retirement scheduler at eventual
  deployment; each invocation leases one job.
