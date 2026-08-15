# Remove the remaining hosted-startup blocker

## Verified current state

- The local development server currently returns HTTP 200 for `/`, and its latest logs contain warnings but no startup exception.
- The open hosted preview could not be inspected during this check because it was still rebuilding, so the exact current hosted error is not yet confirmed.
- The OG route still contains literal imports of `@cf-wasm/og` and `@cf-wasm/og/html-to-react`, even though they now run inside the request handler. A literal dynamic import remains discoverable and bundled at build time; it does not guarantee that an incompatible WASM package is absent from the hosted worker bundle.
- `@cf-wasm/og` also remains a production dependency. The existing regression test runs against the local development server, so it does not reproduce hosted worker startup or prove that the WASM asset can be deployed safely.
- The root watchdog and auth/onboarding gates already have bounded recovery paths. There is no current evidence that another timeout adjustment would fix this hosted startup failure.

## Plan

1. **Confirm the current hosted failure before editing**
   - Capture the authenticated preview response, worker/runtime error, and whether the client boot marker is reached after the rebuild settles.
   - Use that signal to distinguish a server-startup 500 from a client hydration or authenticated-route gate failure.

2. **Remove the incompatible renderer from the deployment graph**
   - Remove all imports and the production dependency on `@cf-wasm/og` rather than trying to lazy-load it.
   - Make the existing branded SVG renderer the canonical OG response for every supported size and card kind.
   - Preserve query parameters, dimensions, escaping, ETag handling, and cache behavior without any WASM/native asset.

3. **Validate the hosted runtime, not only local development**
   - Exercise the production-style worker bundle and fail the check if ordinary route startup references `resvg`, `@cf-wasm/og`, or an unresolved WASM module.
   - Verify `/`, `/profile`, and `/feed` reach a rendered or actionable signed-out state instead of remaining on the pre-hydration loading shell.
   - Verify `/api/public/og` still returns a valid image response in all supported dimensions.

4. **Strengthen regression coverage around the real boundary**
   - Replace the local-only “renderer isolated” assertion with coverage that proves the application bundle has no dependency on the incompatible renderer.
   - Keep the existing one-reload boot recovery tests unchanged unless the new runtime evidence identifies a separate watchdog defect.

5. **Only follow a second fault if evidence shows one**
   - If removing the renderer produces a healthy server response but the signed-in preview still stalls, trace the first unresolved client request or auth gate and fix that concrete path separately.
   - Do not modify profile behavior, onboarding rules, database schema, page design, or bundle chunking without a matching failure signal.

## Technical scope

Primary changes will be limited to the OG route, dependency manifest/lockfile, and focused startup/OG tests. The custom server entry, manual chunk configuration, root auth gate, and watchdog remain unchanged unless the current hosted logs directly implicate one of them.