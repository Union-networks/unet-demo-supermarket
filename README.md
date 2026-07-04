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
