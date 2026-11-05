/**
 * Smoke test of a DEPLOYED image processor (staging validation, docs/release/audit-remediation-review-brief.md B2).
 * It talks to the service exactly as the Worker does: signed requests through the real client
 * (src/lib/image-runtime/node-service-client.ts), results checked against the result contract.
 *
 *   IMAGE_PROCESSOR_URL=https://… IMAGE_PROCESSOR_SECRET=… bun services/image-processor/scripts/smoke.ts [--json]
 *
 * Optional: SMOKE_BODY_TIMEOUT_MS, the service's body deadline (default 10000). The secret is never printed.
 * Exit code: 0 all PASS, 1 any FAIL, 2 refused to run.
 *
 * What it proves (audit F09/F14):
 *   - unauthenticated, forged and stalled requests are refused before they take a slot or have any of their body read;
 *   - a stalled signed body is cut off at the deadline (408);
 *   - real pictures are re-encoded without metadata, with every scan rendition their transparency requires;
 *   - animated pictures and decompression bombs are refused with their codes.
 * Run it from a host allowed to reach the service (the staging Worker's network) and from one that is not
 * (expect connection failures there: the service must not be publicly reachable).
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import sharp from "sharp";
import { inspectImageMetadata } from "@/lib/image-metadata";
import { ImageReencodeError, type ReencodeResult } from "@/lib/image-reencode.server";
import { MIN_SECRET_BYTES, signRequest } from "@/lib/image-runtime/hmac";
import {
  createImageProcessorReencoder,
  isAllowedProcessorUrl,
} from "@/lib/image-runtime/node-service-client";
import { PROCESSOR_PATH } from "@/lib/image-runtime/processor-protocol";
import { reencodeResultProblem } from "@/lib/image-runtime/reencode-contract";
import { alphaPng, solid, u8 } from "@/lib/image-runtime/test-support/fixtures";

export type SmokeConfig = { url: string; secret: string; bodyTimeoutMs?: number };
export type SmokeResult = { id: string; ok: boolean; ms: number; detail: string };

export function smokeConfigProblems(cfg: SmokeConfig): string[] {
  const problems: string[] = [];
  if (!isAllowedProcessorUrl(cfg.url))
    problems.push(
      "IMAGE_PROCESSOR_URL must be https (or http on loopback), with no credentials, query or fragment.",
    );
  if (new TextEncoder().encode(cfg.secret).byteLength < MIN_SECRET_BYTES)
    problems.push(`IMAGE_PROCESSOR_SECRET must be at least ${MIN_SECRET_BYTES} bytes.`);
  return problems;
}

/** A raw POST whose body is written in `chunks` and, unless `end`, left open. Resolves at the answer or `waitMs`. */
function rawPost(
  base: string,
  headers: Record<string, string>,
  chunks: Uint8Array[],
  end: boolean,
  waitMs: number,
): Promise<{ status: number | "timeout" | "error"; ms: number; abort: () => void }> {
  const u = new URL(PROCESSOR_PATH, base);
  const request = u.protocol === "https:" ? httpsRequest : httpRequest;
  const t0 = Date.now();
  return new Promise((resolve) => {
    const req = request(
      u,
      { method: "POST", headers: { "content-type": "application/octet-stream", ...headers } },
      (res) => {
        res.resume();
        clearTimeout(timer);
        resolve({ status: res.statusCode ?? 0, ms: Date.now() - t0, abort: () => req.destroy() });
      },
    );
    const timer = setTimeout(
      () => resolve({ status: "timeout", ms: Date.now() - t0, abort: () => req.destroy() }),
      waitMs,
    );
    req.on("error", () => {
      clearTimeout(timer);
      resolve({ status: "error", ms: Date.now() - t0, abort: () => undefined });
    });
    for (const c of chunks) req.write(c);
    if (end) req.end();
  });
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const t0 = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - t0 };
  } catch (error) {
    return { error, ms: Date.now() - t0 };
  }
}

const codeOf = (e: unknown) => (e instanceof ImageReencodeError ? e.code : "exception");

export async function runSmoke(cfg: SmokeConfig): Promise<SmokeResult[]> {
  const problems = smokeConfigProblems(cfg);
  if (problems.length) throw new SmokeRefused(problems);
  const bodyTimeoutMs = cfg.bodyTimeoutMs ?? 10_000;
  const out: SmokeResult[] = [];
  const reencode = createImageProcessorReencoder({ url: cfg.url, secret: cfg.secret });

  // 1. health
  const h = await timed(() => fetch(new URL("/healthz", cfg.url), { redirect: "error" }));
  out.push({
    id: "healthz",
    ok: h.value?.status === 200,
    ms: h.ms,
    detail: h.value
      ? `HTTP ${h.value.status}`
      : `unreachable: ${String((h.error as Error)?.message ?? h.error)}`,
  });

  // 2-4. refused before admission: unsigned, forged and malformed stalled bodies answer 401 at once
  const stalled: Array<{ abort: () => void }> = [];
  const forged = await signRequest("f".repeat(MIN_SECRET_BYTES + 8), {
    method: "POST",
    path: PROCESSOR_PATH,
    body: new Uint8Array(4000),
  });
  for (const [id, headers] of [
    ["unsigned stalled body refused at once", {}],
    ["forged stalled body refused at once", forged],
    ["second unsigned stalled body refused at once", {}],
    ["third unsigned stalled body refused at once", {}],
  ] as Array<[string, Record<string, string>]>) {
    const r = await rawPost(
      cfg.url,
      { ...headers, "content-length": "4000" },
      [new Uint8Array(16)],
      false,
      3_000,
    );
    stalled.push(r);
    out.push({ id, ok: r.status === 401 && r.ms < 2_000, ms: r.ms, detail: `answer ${r.status}` });
  }

  // 5. the Worker's own request still gets a slot while those connections hang
  const jpeg = u8(await solid(96, 64, "#336699").jpeg().toBuffer());
  const s = await timed(() => reencode(jpeg));
  out.push({
    id: "signed request served while unsigned connections hang",
    ok: !!s.value,
    ms: s.ms,
    detail: s.value ? "accepted" : `refused: ${codeOf(s.error)}`,
  });
  for (const r of stalled) r.abort();

  // 6. a phone photo: re-encoded, upright size, no metadata, no renditions
  const phone = u8(readFileSync("e2e/fixtures/exif/o6.jpg"));
  const p = await timed(() => reencode(phone));
  const pr = p.value as ReencodeResult | undefined;
  const report = pr ? inspectImageMetadata(pr.bytes) : null;
  out.push({
    id: "phone JPEG re-encoded without metadata",
    ok:
      !!pr &&
      !!report &&
      !report.hasExif &&
      !report.hasGps &&
      !report.hasXmp &&
      !report.orientation &&
      pr.transparency === "none" &&
      reencodeResultProblem(pr) === null,
    ms: p.ms,
    detail: pr
      ? `${pr.width}x${pr.height}, transparency ${pr.transparency}`
      : `refused: ${codeOf(p.error)}`,
  });

  // 7. partial transparency: white, black and alpha-dropped renditions
  const partialInput = await alphaPng();
  const partial = await timed(() => reencode(partialInput));
  const pa = partial.value;
  out.push({
    id: "partially transparent PNG has 3 scan renditions",
    ok:
      !!pa &&
      pa.transparency === "partial" &&
      pa.scanRenditions.length === 3 &&
      reencodeResultProblem(pa) === null,
    ms: partial.ms,
    detail: pa
      ? `transparency ${pa.transparency}, ${pa.scanRenditions.length} rendition(s)`
      : `refused: ${codeOf(partial.error)}`,
  });

  // 8. a picture drawn only in the alpha channel: flattened on white and on black
  const W = 64;
  const px = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++)
      px[(y * W + x) * 4 + 3] = x >= 16 && x < 48 && y >= 16 && y < 48 ? 255 : 0;
  const alphaOnly = u8(
    await sharp(px, { raw: { width: W, height: W, channels: 4 } })
      .png()
      .toBuffer(),
  );
  const b = await timed(() => reencode(alphaOnly));
  out.push({
    id: "alpha-only PNG has white and black renditions",
    ok: !!b.value && b.value.transparency === "binary" && b.value.scanRenditions.length === 2,
    ms: b.ms,
    detail: b.value
      ? `transparency ${b.value.transparency}, ${b.value.scanRenditions.length} rendition(s)`
      : `refused: ${codeOf(b.error)}`,
  });

  // 9-10. refusals travel as codes
  const frame = (c: string) => solid(64, 64, c).png().toBuffer();
  const animated = u8(
    await sharp([await frame("#f00"), await frame("#00f")], { join: { animated: true } })
      .webp()
      .toBuffer(),
  );
  const a = await timed(() => reencode(animated));
  out.push({
    id: "animated WEBP refused",
    ok: codeOf(a.error) === "animated",
    ms: a.ms,
    detail: `code ${codeOf(a.error)}`,
  });
  const bomb = u8(await solid(7000, 7000, "#000").png({ compressionLevel: 9 }).toBuffer());
  const t = await timed(() => reencode(bomb));
  out.push({
    id: "49 MP bomb refused",
    ok: codeOf(t.error) === "too_large",
    ms: t.ms,
    detail: `code ${codeOf(t.error)}`,
  });

  // 11. a signed body that stops arriving is cut off at the deadline
  const slowBody = new Uint8Array(4000);
  const signed = await signRequest(cfg.secret, {
    method: "POST",
    path: PROCESSOR_PATH,
    body: slowBody,
  });
  const slow = await rawPost(
    cfg.url,
    { ...signed, "content-length": "4000" },
    [slowBody.subarray(0, 16)],
    false,
    bodyTimeoutMs + 5_000,
  );
  slow.abort();
  out.push({
    id: "stalled signed body cut off at the deadline",
    ok: slow.status === 408,
    ms: slow.ms,
    detail: `answer ${slow.status} (deadline ${bodyTimeoutMs} ms)`,
  });
  return out;
}

export class SmokeRefused extends Error {
  constructor(readonly problems: string[]) {
    super(`image processor smoke test refused to run:\n  - ${problems.join("\n  - ")}`);
  }
}

export function formatSmoke(results: SmokeResult[]): string {
  return results
    .map((r) => `${r.ok ? "PASS" : "FAIL"} ${r.id} (${r.ms} ms): ${r.detail}`)
    .join("\n");
}

async function main(argv: string[], env: Record<string, string | undefined>) {
  const cfg: SmokeConfig = {
    url: env.IMAGE_PROCESSOR_URL ?? "",
    secret: env.IMAGE_PROCESSOR_SECRET ?? "",
    bodyTimeoutMs: env.SMOKE_BODY_TIMEOUT_MS ? Number(env.SMOKE_BODY_TIMEOUT_MS) : undefined,
  };
  try {
    const results = await runSmoke(cfg);
    console.log(argv.includes("--json") ? JSON.stringify(results, null, 2) : formatSmoke(results));
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  } catch (e) {
    if (e instanceof SmokeRefused) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(`image processor smoke test failed: ${String((e as Error)?.message ?? e)}`);
    process.exit(1);
  }
}

// Bun sets import.meta.main for the entry file; importing this module (tests) runs nothing.
if ((import.meta as { main?: boolean }).main) void main(process.argv.slice(2), process.env);
