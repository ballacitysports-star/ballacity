#!/usr/bin/env node
/**
 * Publishes the ffmpeg wasm core to the `app-assets` Storage bucket.
 *
 * The browser re-encodes highlight reels to H.264 with ffmpeg.wasm, because the
 * Cloudflare Workers runtime has no encoder. That core used to be fetched from
 * unpkg.com on every upload, so a CDN outage meant reels stopped converting —
 * and since conversion failure now rejects the upload, it means they stop
 * uploading. Shipping the wasm as a static asset is not possible either: it is
 * ~30.7 MiB against Cloudflare's 25 MiB per-file limit. So it lives in Storage,
 * which we control and which has no such cap.
 *
 * Run once per Supabase project, and again whenever FFMPEG_CORE_VERSION changes
 * in src/lib/video-transcode.ts. Idempotent — safe to re-run.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-ffmpeg-core.mjs
 *
 * The service-role key is required because the bucket is public to READ but
 * writable only by service_role; see 20260912180000_app_assets_bucket.sql for
 * why no client-writable policy exists.
 */
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Keep in step with FFMPEG_CORE_VERSION in src/lib/video-transcode.ts. */
const VERSION = "0.12.10";
const PKG = "@ffmpeg/core";
const BUCKET = "app-assets";

/** Version lives in the path, so an upgrade is a new upload, never a mutation
 *  of an object that clients may have cached for a year. */
const PREFIX = `ffmpeg/${VERSION}`;

const FILES = [
  { name: "ffmpeg-core.js", contentType: "text/javascript" },
  { name: "ffmpeg-core.wasm", contentType: "application/wasm" },
];

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}. Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.`);
    process.exit(1);
  }
  return value.replace(/\/+$/, "");
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  // Resolve the tarball through the registry rather than hardcoding a URL, so
  // this keeps working if npm changes its CDN layout.
  const metaRes = await fetch(`https://registry.npmjs.org/${PKG}/${VERSION}`);
  if (!metaRes.ok) throw new Error(`Could not resolve ${PKG}@${VERSION}: HTTP ${metaRes.status}`);
  const tarballUrl = (await metaRes.json())?.dist?.tarball;
  if (!tarballUrl) throw new Error(`Registry returned no tarball URL for ${PKG}@${VERSION}`);

  const dir = await mkdtemp(join(tmpdir(), "ffmpeg-core-"));
  try {
    const tgz = join(dir, "core.tgz");
    const tarRes = await fetch(tarballUrl);
    if (!tarRes.ok) throw new Error(`Downloading ${tarballUrl} failed: HTTP ${tarRes.status}`);
    await pipeline(tarRes.body, createWriteStream(tgz));
    await execFileAsync("tar", ["xzf", tgz, "-C", dir]);

    for (const file of FILES) {
      const bytes = await readFile(join(dir, "package", "dist", "umd", file.name));
      const target = `${PREFIX}/${file.name}`;

      const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${target}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceKey}`,
          "content-type": file.contentType,
          // A year: the version is in the path, so the bytes never change.
          "cache-control": "max-age=31536000, immutable",
          // Makes a re-run overwrite rather than fail on "already exists".
          "x-upsert": "true",
        },
        body: bytes,
      });
      if (!res.ok) {
        throw new Error(`Upload of ${target} failed: HTTP ${res.status} ${await res.text()}`);
      }
      const size = (bytes.byteLength / 1024 / 1024).toFixed(1);
      console.log(`uploaded ${target} (${size} MiB)`);
      console.log(`  ${supabaseUrl}/storage/v1/object/public/${BUCKET}/${target}`);
    }

    console.log(
      "\nDone. Open both URLs above to confirm they serve, then upload a non-H.264 clip to test conversion end to end.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
