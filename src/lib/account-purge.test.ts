import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * purgeUserAccount is the one place an account's data is erased, for both
 * self-service deletion and a guardian deleting a managed child. The admin
 * client is a recording stand-in, so these pin what is erased, for whom, and in
 * what order — not what the database does with it.
 *
 * Found on the live database: deleting a managed child left one notifications
 * row and one session_activity row behind. Neither table has a foreign key to
 * auth.users, so deleting the auth user never reached them.
 */

const log = vi.hoisted(() => [] as string[]);
// A small in-memory Storage and the three tables the attachment purge reads (final review 780eaf8f, finding 4).
const db = vi.hoisted(() => ({
  objects: new Map<string, Set<string>>(), // bucket -> object names
  tables: {} as Record<string, Record<string, unknown>[]>,
  listCalls: [] as { bucket: string; prefix: string; limit?: number; offset?: number }[],
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const table = (name: string) => ({
    // The up-front "does this account manage a child?" check reads counts (none here); the attachment lookups page rows.
    select: (columns?: string) => {
      const filters: [string, string, unknown][] = [];
      const q: any = {
        eq: (c: string, v: unknown) => (filters.push(["eq", c, v]), q),
        not: (c: string, _op: string, _v: unknown) => (filters.push(["notnull", c, null]), q),
        order: () => q,
        range: async (from: number, to: number) => {
          const rows = (db.tables[name] ?? []).filter((r) =>
            filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : r[c] != null)),
          );
          const cols = (columns ?? "*").split(",").map((c) => c.trim());
          return {
            data: rows
              .slice(from, to + 1)
              .map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))),
            error: null,
          };
        },
        then: (resolve: (r: unknown) => unknown) => resolve({ count: 0, error: null }),
      };
      return q;
    },
    update: () => ({
      eq: async () => {
        log.push(`update ${name}`);
        return { error: null };
      },
    }),
    delete: () => ({
      eq: async (column: string, value: string) => {
        log.push(`delete ${name}.${column}=${value}`);
        return { error: null };
      },
    }),
  });
  return {
    supabaseAdmin: {
      from: table,
      storage: {
        from: (bucket: string) => ({
          // Like Storage: the entries directly under `prefix/`, folders with id null, at most `limit` per call.
          list: async (prefix: string, o: { limit?: number; offset?: number } = {}) => {
            log.push(`list ${bucket}`);
            db.listCalls.push({ bucket, prefix, ...o });
            const names = [...(db.objects.get(bucket) ?? [])]
              .filter((n) => n.startsWith(`${prefix}/`))
              .map((n) => n.slice(prefix.length + 1))
              .sort();
            const entries = [...new Set(names.map((n) => n.split("/")[0]))].map((n) => ({
              name: n,
              id: names.includes(n) ? `id-${n}` : null,
            }));
            const off = o.offset ?? 0;
            return { data: entries.slice(off, off + (o.limit ?? 100)), error: null };
          },
          remove: async (paths: string[]) => {
            log.push(`remove ${bucket}`);
            if (paths.length > 1000) return { data: null, error: { message: "too many" } };
            for (const p of paths) db.objects.get(bucket)?.delete(p);
            return { data: [], error: null };
          },
        }),
      },
      auth: {
        admin: {
          deleteUser: async (id: string) => {
            log.push(`auth.deleteUser ${id}`);
            return { error: null };
          },
        },
      },
    },
  };
});

import { purgeUserAccount } from "./account-purge.server";

const USER = "11111111-1111-4111-8111-111111111111";

// Keyed by user_id with no foreign key to auth.users, so the final delete of the
// auth user never reaches them.
const NOT_CASCADED = [
  "account_profiles",
  "notifications",
  "scheduled_notifications",
  "session_activity",
];

describe("purgeUserAccount", () => {
  beforeEach(() => {
    log.length = 0;
    db.objects.clear();
    db.tables = {};
    db.listCalls.length = 0;
  });

  it.each(NOT_CASCADED)("removes the account's %s rows itself", async (table) => {
    await purgeUserAccount(USER);
    expect(log).toContain(`delete ${table}.user_id=${USER}`);
  });

  it("L1: also clears the private image-staging bucket, before it deletes the auth user", async () => {
    await purgeUserAccount(USER);
    const listed = log.indexOf("list image-staging");
    expect(listed).toBeGreaterThanOrEqual(0);
    expect(listed).toBeLessThan(log.indexOf(`auth.deleteUser ${USER}`));
  });

  it("removes them before it deletes the auth user, and deletes that last", async () => {
    await purgeUserAccount(USER);
    const last = log.indexOf(`auth.deleteUser ${USER}`);
    expect(last).toBe(log.length - 1);
    for (const table of NOT_CASCADED) {
      expect(log.indexOf(`delete ${table}.user_id=${USER}`)).toBeGreaterThanOrEqual(0);
      expect(log.indexOf(`delete ${table}.user_id=${USER}`)).toBeLessThan(last);
    }
  });

  it("only ever erases rows belonging to the account it was given", async () => {
    await purgeUserAccount(USER);
    const erasing = log.filter((entry) => entry.startsWith("delete ") || entry.startsWith("auth."));
    expect(erasing.length).toBeGreaterThan(NOT_CASCADED.length);
    for (const entry of erasing)
      expect(entry.endsWith(`=${USER}`) || entry.endsWith(` ${USER}`)).toBe(true);
  });
  describe("finding 4: chat attachments and paged listings", () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const CONV = "33333333-3333-4333-8333-333333333333";
    const CONV2 = "44444444-4444-4444-8444-444444444444";
    const put = (bucket: string, ...names: string[]) => {
      const set = db.objects.get(bucket) ?? new Set<string>();
      for (const n of names) set.add(n);
      db.objects.set(bucket, set);
    };

    it("removes every attachment the account sent (they live under the conversation's folder), and nobody else's", async () => {
      const sent = `${CONV}/${USER}/1700000000000-photo.jpg`;
      const sentOnlyChecked = `${CONV2}/${USER}/1700000000001-scan.pdf`; // checked but the message was already gone
      const notSentYet = `${CONV}/${USER}/1700000000002-video.mp4`;
      const theirs = `${CONV}/${OTHER}/1700000000003-reply.jpg`;
      put("message-attachments", sent, sentOnlyChecked, notSentYet, theirs);
      db.tables.messages = [
        { id: 1, sender_id: USER, attachment_path: sent },
        { id: 2, sender_id: USER, attachment_path: null },
        { id: 3, sender_id: OTHER, attachment_path: theirs },
      ];
      db.tables.message_attachment_checks = [
        { path: sent, user_id: USER },
        { path: sentOnlyChecked, user_id: USER },
        { path: notSentYet, user_id: USER },
        { path: theirs, user_id: OTHER },
      ];
      await purgeUserAccount(USER);
      const left = [...(db.objects.get("message-attachments") ?? [])];
      expect(left.filter((p) => p.split("/")[1] === USER)).toEqual([]);
      expect(left).toEqual([theirs]);
      // collected before the messages are scrubbed (which clears attachment_path)
      expect(log.indexOf("remove message-attachments")).toBeLessThan(
        log.indexOf("update messages"),
      );
    });

    it("keeps an attachment that has a quarantine record (evidence)", async () => {
      const flagged = `${CONV}/${USER}/1700000000000-flagged.jpg`;
      const plain = `${CONV}/${USER}/1700000000001-ok.jpg`;
      put("message-attachments", flagged, plain);
      db.tables.message_attachment_checks = [
        { path: flagged, user_id: USER },
        { path: plain, user_id: USER },
      ];
      db.tables.image_quarantine_items = [
        { id: "q1", source_bucket: "message-attachments", source_path: flagged, uploader_id: USER },
      ];
      await purgeUserAccount(USER);
      expect([...(db.objects.get("message-attachments") ?? [])]).toEqual([flagged]);
    });

    it("pages every listing: 1001 avatar files are all removed", async () => {
      const names = Array.from(
        { length: 1001 },
        (_, i) => `${USER}/a-${String(i).padStart(4, "0")}.jpg`,
      );
      put("avatars", ...names, `${OTHER}/keep.jpg`);
      await purgeUserAccount(USER);
      expect([...(db.objects.get("avatars") ?? [])]).toEqual([`${OTHER}/keep.jpg`]);
      expect(db.listCalls.filter((c) => c.bucket === "avatars").length).toBeGreaterThan(1);
    });
  });
});
