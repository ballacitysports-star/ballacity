# Restore app startup by isolating the broken OG renderer

## Verified diagnosis

- The live preview tab is stalled at the pre-hydration **“Loading…”** shell with the client boot marker unset, so React never starts.
- Preview runtime logs show `GET /` returning HTTP 500 with the concrete error: `No such module "wasm/resvg-a7e702bc5ba92272.wasm"`.
- `src/routes/api/public/og.ts` imports `@cf-wasm/og` and its HTML adapter at module scope. The generated server route tree imports that route while starting the application, so the unavailable WASM dependency can crash every route—not only `/api/public/og`.
- The local development server succeeds because its runtime can resolve the package differently; the hosted preview runtime is where the missing bundled WASM module fails.

## Plan

1. **Remove the OG renderer from global startup**
   - Eliminate module-scope imports of `@cf-wasm/og` from the route module.
   - Load image-rendering code only inside the OG request handler, after input validation and cache checks, so `/`, `/profile`, and all normal pages do not evaluate it.

2. **Make the OG endpoint fail safely**
   - Catch renderer loading and rendering failures inside `/api/public/og`.
   - Return a valid lightweight branded fallback response with appropriate no-cache/error handling instead of allowing the server process to fail.
   - Keep the existing dimensions, query parameters, ETag behavior, and successful PNG path unchanged when the renderer is available.

3. **Add regression coverage**
   - Verify the app root can start even when the OG renderer cannot load.
   - Verify an OG-renderer failure remains contained to `/api/public/og` and returns the fallback response.
   - Retain existing boot-recovery tests; no further watchdog timeout changes are needed for this failure.

4. **Validate the real failure signal**
   - Confirm `/` returns 200 in the hosted-style runtime and the client boot marker is set after hydration.
   - Check `/profile` and the home page render rather than remaining on “Loading…”.
   - Confirm runtime logs no longer report the missing `resvg` module during ordinary page requests.

## Technical scope

Primary changes stay in `src/routes/api/public/og.ts` plus focused tests. If transform-safe separation is required, the renderer implementation will move to a server-only helper that is dynamically imported by the handler. No auth, profile, database, UI, or watchdog behavior changes are included.
