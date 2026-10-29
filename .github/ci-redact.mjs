/**
 * CLI for ci-redact-lib.mjs. Always runs (no entrypoint detection).
 *
 *   node .github/ci-redact.mjs --tail 80 < dev-server.log      filtered stdout, exit 0
 *   node .github/ci-redact.mjs --in report.json --out clean.json
 *   some-command 2>&1 | node .github/ci-redact.mjs --stream       line by line, all of it
 *
 * Log mode never prints raw input: on any error it prints a fixed notice.
 *
 * If the consumer of stdout goes away (EPIPE) or stdout cannot be written, every mode
 * prints one fixed line to stderr and exits 1; there is no stack trace and no input in it.
 *
 * Stream mode redacts each line as it arrives (so a long test run is visible while it
 * runs) with the exact values in this process's environment plus the shape rules. On any
 * error it prints one fixed line to stderr and exits 1; it never prints the offending
 * line. Run it as the right-hand side of a pipe under `pipefail` so its failure fails the
 * step and the left-hand command's exit status is preserved.
 *
 * File mode reads --in and writes a DIFFERENT file, --out. The input must be valid JSON
 * and so must the redacted output. On any failure it removes --out, prints one fixed
 * message (never the error, never content) and exits 1. It does not depend on being able
 * to overwrite the original, and the caller must gate any upload on this process's
 * success, so a failure cannot leave an unredacted file at the upload path.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { makeRedactor, redact, sanitizeLog } from "./ci-redact-lib.mjs";

// A downstream consumer that closes early (`... | head -1`, or a runner that stopped reading)
// makes stdout emit EPIPE. Without a listener Node prints an uncaught-exception stack trace.
// Treat any failure to deliver output as a failure: say so once, with a fixed message that
// carries no input and no stack, and exit 1. A broken stderr is ignored, because there is
// then nowhere left to report to; the exit code still carries the failure.
process.stderr.on("error", () => {});
process.stdout.on("error", (error) => {
  try {
    console.error(
      error && error.code === "EPIPE"
        ? "ci-redact: the output was closed by its consumer; stopping."
        : "ci-redact: the output could not be written; stopping.",
    );
  } catch {
    /* nowhere left to report; the exit code carries the failure */
  }
  process.exit(1);
});

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

if (argv.includes("--stream")) {
  try {
    if (argv.length !== 1) throw new Error("bad arguments");
    const redactLine = makeRedactor(process.env);
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let failed = false;
    rl.on("line", (line) => {
      if (failed) return;
      try {
        process.stdout.write(`${redactLine(line)}\n`);
      } catch {
        failed = true;
        console.error("ci-redact: could not redact the output stream; output stopped.");
        process.exitCode = 1;
        rl.close();
        process.stdin.destroy();
      }
    });
  } catch {
    console.error("ci-redact: could not redact the output stream; output stopped.");
    process.exit(1);
  }
} else if (argv.includes("--in") || argv.includes("--out")) {
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
