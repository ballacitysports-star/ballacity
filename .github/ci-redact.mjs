/**
 * CLI for ci-redact-lib.mjs. Always runs (no entrypoint detection).
 *
 *   node .github/ci-redact.mjs --tail 80 < dev-server.log      filtered stdout, exit 0
 *   node .github/ci-redact.mjs --in report.json --out clean.json
 *
 * Log mode never prints raw input: on any error it prints a fixed notice.
 *
 * File mode reads --in and writes a DIFFERENT file, --out. The input must be valid JSON
 * and so must the redacted output. On any failure it removes --out, prints one fixed
 * message (never the error, never content) and exits 1. It does not depend on being able
 * to overwrite the original, and the caller must gate any upload on this process's
 * success, so a failure cannot leave an unredacted file at the upload path.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { redact, sanitizeLog } from "./ci-redact-lib.mjs";

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes("--in") || argv.includes("--out")) {
  const input = arg("--in");
  const output = arg("--out");
  try {
    if (!input || !output || resolve(input) === resolve(output)) throw new Error("bad paths");
    rmSync(output, { force: true });
    const raw = readFileSync(input, "utf8");
    JSON.parse(raw);
    const clean = redact(raw, process.env);
    JSON.parse(clean);
    writeFileSync(output, clean);
  } catch {
    try {
      if (output) rmSync(output, { force: true });
    } catch {
      /* the exit code and the caller's gate carry the failure */
    }
    console.error("ci-redact: the report could not be sanitized; nothing will be uploaded.");
    process.exit(1);
  }
} else {
  try {
    const t = arg("--tail");
    const tail = t === undefined ? 80 : Number.parseInt(t, 10);
    if (!Number.isInteger(tail) || tail < 1) throw new Error("bad tail");
    process.stdout.write(`${sanitizeLog(readFileSync(0, "utf8"), process.env, tail)}\n`);
  } catch {
    console.log("(output withheld: the redactor could not process it)");
  }
}
