/**
 * Server-only helpers for image moderation. Loaded inside server-fn handlers.
 */
import { isPublicImageBucket } from "@/lib/image-moderation";

/** Columns that may reference an uploaded image URL, cleared when it is removed. */
const REFERENCES: Array<{ table: string; columns: string[]; jsonColumns?: string[] }> = [
  { table: "profiles", columns: ["avatar_url", "cover_url"] },
  { table: "teams", columns: ["avatar", "avatar_url", "cover"] },
  {
    table: "trainer_orgs",
    columns: ["avatar", "avatar_url", "cover_url"],
    jsonColumns: ["photos"],
  },
  { table: "hosted_games", columns: ["image"] },
  { table: "team_posts", columns: ["image_url"] },
];

/** Clear every DB reference pointing at `bucket/path`. Returns rows touched. */
export async function clearImageReferences(admin: any, bucket: string, path: string) {
  const marker = `${bucket}/${path}`;
  let touched = 0;

  for (const ref of REFERENCES) {
    for (const col of ref.columns) {
      const { data: hits } = await admin.from(ref.table).select("id").like(col, `%${marker}%`);
      if (hits?.length) {
        await admin
          .from(ref.table)
          .update({ [col]: null })
          .in(
            "id",
            hits.map((h: any) => h.id),
          );
        touched += hits.length;
      }
    }
    for (const col of ref.jsonColumns ?? []) {
      const { data: rows } = await admin.from(ref.table).select(`id, ${col}`);
      for (const row of rows ?? []) {
        const arr = (row as any)[col];
        if (!Array.isArray(arr)) continue;
        const next = arr.filter(
          (item: any) =>
            !(typeof item === "string"
              ? item.includes(marker)
              : typeof item?.url === "string" && item.url.includes(marker)),
        );
        if (next.length !== arr.length) {
          await admin
            .from(ref.table)
            .update({ [col]: next })
            .eq("id", (row as any).id);
          touched += 1;
        }
      }
    }
  }
  return touched;
}

/** A browser-usable URL for a stored object (public URL or short-lived signed URL). */
export async function imageObjectUrl(admin: any, bucket: string, path: string) {
  if (isPublicImageBucket(bucket)) {
    return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl as string;
  }
  const { data } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return (data?.signedUrl as string | undefined) ?? null;
}
