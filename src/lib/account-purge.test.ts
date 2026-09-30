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

vi.mock("@/integrations/supabase/client.server", () => {
  const table = (name: string) => ({
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
      storage: { from: () => ({ list: async () => ({ data: [] }), remove: async () => ({}) }) },
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
  });

  it.each(NOT_CASCADED)("removes the account's %s rows itself", async (table) => {
    await purgeUserAccount(USER);
    expect(log).toContain(`delete ${table}.user_id=${USER}`);
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
});
