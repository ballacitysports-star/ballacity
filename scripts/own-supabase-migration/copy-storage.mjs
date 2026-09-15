#!/usr/bin/env node
/**
 * Copies every object in every Storage bucket from the source project to
 * the destination project, via the Storage REST API — not SQL. A
 * storage.objects row is just metadata; the bytes live in a separate blob
 * store, so the only way to recreate a working file on the destination is
 * to actually download it from the source and upload it to the destination.
 * Bucket definitions (public/private, size limits) already exist on the
 * destination from supabase/migrations/20260909220000_declare_storage_buckets.sql
 * and 20260912180000_app_assets_bucket.sql, applied by apply-schema.sh.
 *
 * Resumable: before uploading, lists what's already at the destination and
 * skips any object whose path and size already match, so a re-run after an
 * interruption only transfers what's missing. highlight-videos can hold
 * files up to 200MB each (see the bucket's file_size_limit), so both the
 * download and upload stream rather than buffering whole files in memory.
 *
 *   SOURCE_SUPABASE_URL=https://cpqihhcqeivbgxqbzatv.supabase.co \
 *   SOURCE_SERVICE_ROLE_KEY=... \
 *   DEST_SUPABASE_URL=https://olrbulvwexrkjcxddjxq.supabase.co \
 *   DEST_SERVICE_ROLE_KEY=... \
 *     node copy-storage.mjs
 *
 * Service-role keys are required — bucket ACLs restrict anon/authenticated
 * access, and only service_role can list/read every object regardless of
 * per-row storage policy.
 */

// Keep in sync with the two migrations named above.
const BUCKETS = [
  "avatars",
  "covers",
  "org-avatars",
  "org-covers",
  "team-avatars",
  "team-covers",
  "trainer-avatars",
  "game-covers",
  "payment-proofs",
  "message-attachments",
  "data-exports",
  "highlight-videos",
  "app-assets",
];

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    console.error(`Missing ${key}. See README.md for where to find it.`);
    process.exit(1);
  }
  return value.replace(/\/+$/, "");
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** Recursively lists every real object (never a folder placeholder) in a
 *  bucket, returning `{ path, size }[]` with paths relative to bucket root. */
async function listAllObjects(baseUrl, serviceKey, bucket) {
  const results = [];

  async function walk(prefix) {
    let offset = 0;
    const limit = 1000;
    for (;;) {
      const res = await fetch(`${baseUrl}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      });
      if (!res.ok) {
        throw new Error(`Listing ${bucket}/${prefix} failed: HTTP ${res.status} ${await res.text()}`);
      }
      const entries = await res.json();
      for (const entry of entries) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        // Supabase Storage represents a folder as an entry with no id/metadata.
        if (entry.id === null || entry.metadata === null || entry.metadata === undefined) {
          await walk(path);
        } else {
          results.push({ path, size: entry.metadata.size ?? 0 });
        }
      }
      if (entries.length < limit) break;
      offset += limit;
    }
  }

  await walk("");
  return results;
}

async function copyObject(sourceUrl, sourceKey, destUrl, destKey, bucket, path, contentType) {
  const downloadRes = await fetch(`${sourceUrl}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    headers: { authorization: `Bearer ${sourceKey}` },
  });
  if (!downloadRes.ok || !downloadRes.body) {
    throw new Error(`Download failed: HTTP ${downloadRes.status} ${await downloadRes.text().catch(() => "")}`);
  }

  const uploadRes = await fetch(`${destUrl}/storage/v1/object/${bucket}/${encodeURI(path)}`, {
    method: "POST",
    // @ts-expect-error -- Node's fetch requires this for a streaming request body.
    duplex: "half",
    headers: {
      authorization: `Bearer ${destKey}`,
      "content-type": contentType || downloadRes.headers.get("content-type") || "application/octet-stream",
      "x-upsert": "true",
    },
    body: downloadRes.body,
  });
  if (!uploadRes.ok) {
    throw new Error(`Upload failed: HTTP ${uploadRes.status} ${await uploadRes.text().catch(() => "")}`);
  }
}

async function main() {
  const sourceUrl = requireEnv("SOURCE_SUPABASE_URL");
  const sourceKey = requireEnv("SOURCE_SERVICE_ROLE_KEY");
  const destUrl = requireEnv("DEST_SUPABASE_URL");
  const destKey = requireEnv("DEST_SERVICE_ROLE_KEY");

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalBytes = 0;
  const failures = [];

  for (const bucket of BUCKETS) {
    console.log(`\n== ${bucket} ==`);
    const [sourceObjects, destObjects] = await Promise.all([
      listAllObjects(sourceUrl, sourceKey, bucket),
      listAllObjects(destUrl, destKey, bucket).catch(() => []), // bucket may not exist yet on first run
    ]);
    const destByPath = new Map(destObjects.map((o) => [o.path, o.size]));
    console.log(`  ${sourceObjects.length} object(s) at source`);

    for (const obj of sourceObjects) {
      if (destByPath.get(obj.path) === obj.size) {
        totalSkipped++;
        continue;
      }
      try {
        process.stdout.write(`  copying ${obj.path} (${formatBytes(obj.size)})... `);
        await copyObject(sourceUrl, sourceKey, destUrl, destKey, bucket, obj.path);
        console.log("done");
        totalCopied++;
        totalBytes += obj.size;
      } catch (err) {
        console.log("FAILED");
        failures.push({ bucket, path: obj.path, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  console.log(`\nCopied ${totalCopied} object(s), ${formatBytes(totalBytes)} total.`);
  console.log(`Skipped ${totalSkipped} object(s) already present at destination with a matching size.`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURE(S):`);
    for (const f of failures) console.log(`  ${f.bucket}/${f.path}: ${f.error}`);
    console.log("\nRe-run this script to retry — completed objects are skipped, only failures are retried.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
