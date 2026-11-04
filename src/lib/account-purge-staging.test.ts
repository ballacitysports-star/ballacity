import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));

import { purgeImageStaging } from "./account-purge.server";

/**
 * SEC-7 item 7: account deletion removes the account's staged image uploads (`image-staging/{userId}/...`), but never a file under a
 * hold: a quarantined original is child-safety evidence and stays.
 */
const USER = "22222222-2222-4222-8222-222222222222";

function admin(opts: {
  files: { name: string; id: string | null }[];
  moderation?: { path: string; status: string }[];
  moderationError?: boolean;
  listError?: boolean;
}) {
  const removed: string[][] = [];
  const deletedRows: string[][] = [];
  const listed: { bucket: string; prefix: string }[] = [];
  const a = {
    storage: {
      from: (bucket: string) => ({
        list: async (prefix: string) => {
          listed.push({ bucket, prefix });
          return opts.listError
            ? { data: null, error: { message: "Bucket not found" } }
            : { data: opts.files, error: null };
        },
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          in: async () =>
            opts.moderationError
              ? { data: null, error: { message: "down" } }
              : { data: table === "image_moderation" ? (opts.moderation ?? []) : [], error: null },
        }),
      }),
      delete: () => ({
        eq: () => ({
          in: async (_col: string, paths: string[]) => {
            deletedRows.push(paths);
            return { error: null };
          },
        }),
      }),
    }),
  };
  return { a, removed, deletedRows, listed };
}

describe("purgeImageStaging", () => {
  it("lists the account's own folder in image-staging", async () => {
    const { a, listed } = admin({ files: [] });
    await purgeImageStaging(a, USER);
    expect(listed).toEqual([{ bucket: "image-staging", prefix: USER }]);
  });

  it("removes staged files but never a quarantined one", async () => {
    const { a, removed, deletedRows } = admin({
      files: [
        { name: "a.jpg", id: "1" },
        { name: "b.png", id: "2" },
        { name: "c.webp", id: "3" },
        { name: "nested", id: null },
      ],
      moderation: [
        { path: `${USER}/b.png`, status: "quarantined" },
        { path: `${USER}/c.webp`, status: "pending" },
      ],
    });
    const out = await purgeImageStaging(a, USER);
    expect(removed).toEqual([[`${USER}/a.jpg`, `${USER}/c.webp`]]);
    expect(deletedRows).toEqual([[`${USER}/a.jpg`, `${USER}/c.webp`]]);
    expect(out).toEqual({ removed: 2, held: 1 });
  });

  it("removes nothing when the hold check fails", async () => {
    const { a, removed } = admin({ files: [{ name: "a.jpg", id: "1" }], moderationError: true });
    await expect(purgeImageStaging(a, USER)).rejects.toThrow();
    expect(removed).toEqual([]);
  });

  it("does nothing when the bucket is missing in this environment", async () => {
    const { a, removed } = admin({ files: [], listError: true });
    expect(await purgeImageStaging(a, USER)).toEqual({ removed: 0, held: 0 });
    expect(removed).toEqual([]);
  });
});
