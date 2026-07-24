# U-net Demo Supermarket

Standalone demo service for U-net scoped login, miniapp launch, basket/favorite state, and checkout-bound over-18 verification.

The storefront is hosted separately from the U-net web app. Trust-plane still owns the security-sensitive APIs:

- scoped supermarket session creation;
- basket and favorites storage;
- checkout-bound holder matching;
- age verification evaluation.

## Local Development

```bash
pnpm install
pnpm dev
```

Useful environment variables:

```bash
NEXT_PUBLIC_UNET_TRUST_PLANE_ORIGIN=https://issuer.egress.live
NEXT_PUBLIC_SITE_ORIGIN=https://supermarket.egress.live
```

`NEXT_PUBLIC_SITE_ORIGIN` must match the deployed origin registered for the `demo-supermarket` U-net service.

## U-net Integration

The app supports two modes:

- Browser mode: QR login through `@union-networks/web-login`.
- U-net miniapp mode: automatic bridge login through `host.createMiniProgramSession`.

Restricted checkout uses:

- Browser mode: checkout-bound verification QR through `@union-networks/verification`.
- U-net miniapp mode: native `host.requestVerification`, which opens the app's holder-controlled verification panel.

The miniapp manifest is served at:

```text
/.well-known/unet-miniapp.json
```

The service and miniapp IDs must stay fixed as `demo-supermarket` so scoped IDs remain stable.

## Domain Owner And Admin Credentials

The supermarket can issue its own U-net domain Owner and Admin credentials through
the server-only callback:

```text
https://supermarket.egress.live/api/unet/domain-admin/issue
```

Generate a separate domain-administration signer locally:

```bash
node --input-type=module -e "import { generateDomainAdminSignerEnv } from '@union-networks/issuer'; console.log(await generateDomainAdminSignerEnv({ serviceId: 'demo-supermarket' }))"
```

Store the generated `UNET_DOMAIN_ADMIN_*` values as server-only Vercel variables.
Never prefix private-key variables with `NEXT_PUBLIC_`. Register the generated
public keys and callback URL from the domain's Keys page in the U-net dashboard.

The callback validates the domain, role, invitation challenge, and canonical
claims before creating a holder-bound credential. Credential contents are
encrypted to the holder before leaving the supermarket server.
