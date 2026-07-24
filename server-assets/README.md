# Server assets

`barretenberg-threads.wasm.gz` is the pinned Barretenberg runtime used only by
server-side credential construction. `next.config.mjs` explicitly includes it
in the domain-administration callback function deployed by Vercel.
