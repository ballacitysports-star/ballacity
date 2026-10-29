/**
 * CLI for the E2E target preflight. Always runs the checks: there is no
 * "am I the entrypoint" test that could be wrong. Exits nonzero on any failure,
 * including an unexpected error. Logic and documentation: e2e-preflight-lib.mjs.
 *
 *   node .github/e2e-preflight.mjs             gate: E2E_* inputs
 *   node .github/e2e-preflight.mjs --runtime   steps that build or serve the app
 *   node .github/e2e-preflight.mjs --service   the step that seeds fixtures
 */
import { run } from "./e2e-preflight-lib.mjs";

process.exit(
  run(process.argv.slice(2), process.env, {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  }),
);
