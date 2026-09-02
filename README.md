# U-net Demo Supermarket

Standalone provider for U-net Direct Login V2, miniapp launch, provider-owned
basket/favorite state, and checkout-bound over-18 verification. The
supermarket owns its scoped profiles, login challenges, sessions, replay
protection, and official inbox registrations in its own Postgres database.

## Local Development

```bash
pnpm install
pnpm dev
```

Useful environment variables:

```bash
NEXT_PUBLIC_UNET_TRUST_PLANE_ORIGIN=https://issuer.egress.live
NEXT_PUBLIC_SITE_ORIGIN=https://supermarket.egress.live
UNET_PROVIDER_DATABASE_URL=postgresql://...
UNET_PROVIDER_SESSION_SECRET=a-random-secret-with-at-least-32-characters
```

`NEXT_PUBLIC_SITE_ORIGIN` must match the deployed origin registered for the `demo-supermarket` U-net service.

## U-net Integration

The app supports two modes:

- Browser mode: a provider-hosted Direct Login V2 QR ceremony.
- U-net miniapp mode: the same provider challenge through `host.createServiceSession`.

Restricted checkout uses:

- Browser mode: checkout-bound verification QR through `@u-net/verification`.
- U-net miniapp mode: native `host.requestVerification`, which opens the app's holder-controlled verification panel.

The miniapp manifest is served at:

```text
/.well-known/unet-miniapp.json
```

The Direct Login manifest is served at:

```text
/.well-known/unet-service.json
```

The supermarket can remain absent from Browse. Once its domain claim and V2
readiness checks pass, U-net may still open it as a verified unlisted miniapp.

## Domain Claim

Register `https://supermarket.egress.live` through the ordinary dashboard flow
using service ID `demo-supermarket`, then install the returned values as:

```bash
UNET_PROVIDER_CLAIM_ID=...
UNET_PROVIDER_CLAIM_CHALLENGE=...
UNET_PROVIDER_CLAIM_TOKEN=...
```

The deployed `/.well-known/unet-provider-claim.json` route derives the public
proof without exposing the claim token.

The service and miniapp IDs must stay fixed as `demo-supermarket` so scoped IDs remain stable.

## Domain Owner And Admin Credentials

The supermarket can issue its own U-net domain Owner and Admin credentials through
the server-only callback:

```text
https://supermarket.egress.live/api/unet/domain-admin/issue
```

Generate a separate domain-administration signer locally:

```bash
node --input-type=module -e "import { generateDomainAdminSignerEnv } from '@u-net/issuer'; console.log(await generateDomainAdminSignerEnv({ serviceId: 'demo-supermarket' }))"
```

Store the generated `UNET_DOMAIN_ADMIN_*` values as server-only Vercel variables.
Never prefix private-key variables with `NEXT_PUBLIC_`. Register the generated
public keys and callback URL from the domain's Keys page in the U-net dashboard.

The callback validates the domain, role, invitation challenge, and canonical
claims before creating a holder-bound credential. Credential contents are
encrypted to the holder before leaving the supermarket server.
