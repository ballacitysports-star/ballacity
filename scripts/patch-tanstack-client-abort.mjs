import { readFile, writeFile } from "node:fs/promises";

// Visitors leaving mid-render (or preview restarts) close the socket, and
// TanStack Start rethrows that abort as an unhandled 500 "Error: aborted".
// Turn it into a quiet 499 instead. Handles both older (`response`) and
// newer (`result`) variable names in TanStack's handler.
const files = [
  "node_modules/@tanstack/start-server-core/src/createStartHandler.ts",
  "node_modules/@tanstack/start-server-core/dist/esm/createStartHandler.js",
];

const pattern =
  /(\n([ \t]*)responseOwnsCleanup = (\w+)\.serverSsrCleanup === ["']stream["'];?\n[ \t]*return \3\.response;?\n)([ \t]*)\} finally \{/;

for (const path of files) {
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    continue;
  }
  if (source.includes("Client Closed Request")) continue;
  if (!pattern.test(source)) {
    console.warn(`Skipping TanStack client-abort patch (pattern not found) for ${path}`);
    continue;
  }
  const next = source.replace(
    pattern,
    (_m, body, _indent, _v, close) =>
      `${body}${close}} catch (err) {\n${close}\tif (request.signal.aborted || (err && (err.code === "ECONNRESET" || err?.cause?.code === "ECONNRESET" || err.name === "AbortError"))) return new Response(null, { status: 499, statusText: "Client Closed Request" });\n${close}\tthrow err;\n${close}} finally {`,
  );
  await writeFile(path, next);
}
