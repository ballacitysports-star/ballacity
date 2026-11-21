/**
 * superadminUserDetail feeds the user sheet in the superadmin Users tab. It reads profiles with the service role, so
 * whatever it selects reaches the superadmin's browser. It must name the columns the sheet shows instead of `*`:
 * a guardian's emergency contact, a birthday and any column added later stay on the server. These run the real
 * server function with the database faked. A server function is its handler here: validate the input, then run it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

// Every column a profiles row can carry that the sheet has no use for, private ones first.
const PRIVATE_COLUMNS = {
  birthday: "2012-04-02",
  emergency_contact_name: "Pat Example",
  emergency_contact_phone: "+1 555 0100",
  emergency_contact_relationship: "grandparent",
  avatar_url_private: "private/avatar.png",
  moderation_state: "clear",
  age_category: "13-15",
};

const h = vi.hoisted(() => ({ selects: {} as Record<string, string[]> }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (d: unknown) => d;
    const b = {
      middleware() {
        return b;
      },
      inputValidator(fn: (d: unknown) => unknown) {
        validate = fn;
        return b;
      },
      handler(fn: (ctx: { data: unknown; context: unknown }) => unknown) {
        return (arg: { data: unknown; context: unknown }) =>
          fn({ data: validate(arg.data), context: arg.context });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

vi.mock("@/integrations/supabase/client.server", () => {
  const profile = {
    id: USER,
    display_name: "Sam Example",
    username: "sam",
    bio: "Point guard",
    city: "Atlanta",
    sport: "Basketball",
    account_type: "parent",
    avatar_url: null,
    cover_url: null,
    graduating_class: null,
    search_radius_mi: 10,
    suspended_at: "2026-11-01T00:00:00Z",
    suspended_reason: "spam",
    ...PRIVATE_COLUMNS,
  } as Record<string, unknown>;

  // Like PostgREST: "*" returns the whole row, a column list returns those columns.
  const project = (row: Record<string, unknown>, cols: string) =>
    cols.trim() === "*"
      ? { ...row }
      : Object.fromEntries(
          cols
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
            .map((c) => [c, row[c]]),
        );

  type Query = {
    select(c: string): Query;
    eq(): Query;
    or(): Query;
    order(): Query;
    limit(): Query;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null }>;
    then(resolve: (v: unknown) => unknown): unknown;
  };
  const query = (table: string) => {
    let cols = "*";
    const q: Query = {
      select(c: string) {
        cols = c;
        (h.selects[table] ??= []).push(c);
        return q;
      },
      eq: () => q,
      or: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: table === "profiles" ? project(profile, cols) : null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [] }),
    };
    return q;
  };

  return {
    supabaseAdmin: {
      from: query,
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "sam@example.com", last_sign_in_at: null } },
          }),
        },
      },
    },
  };
});

import { superadminUserDetail } from "./superadmin.functions";

const context = {
  userId: ADMIN,
  supabase: { rpc: async () => ({ data: true, error: null }) },
};

async function detail() {
  const run = superadminUserDetail as unknown as (arg: {
    data: unknown;
    context: unknown;
  }) => Promise<{ profile: Record<string, unknown> | null }>;
  return run({ data: { userId: USER }, context });
}

describe("superadminUserDetail profile columns", () => {
  beforeEach(() => {
    h.selects = {};
  });

  it("names its profile columns instead of selecting *", async () => {
    await detail();
    expect(h.selects.profiles).toHaveLength(1);
    expect(h.selects.profiles[0].trim()).not.toBe("*");
    expect(h.selects.profiles[0]).not.toContain("*");
  });

  it("keeps the emergency contact, the birthday and other private columns off the response", async () => {
    const { profile } = await detail();
    expect(profile).not.toBeNull();
    for (const col of Object.keys(PRIVATE_COLUMNS)) {
      expect(profile, col).not.toHaveProperty(col);
    }
  });

  it("still returns everything the user sheet shows", async () => {
    const { profile } = await detail();
    // UsersTab: the title, its EDITABLE list and the suspension card.
    const shown = [
      "display_name",
      "username",
      "bio",
      "city",
      "sport",
      "account_type",
      "graduating_class",
      "search_radius_mi",
      "suspended_at",
      "suspended_reason",
    ];
    for (const col of shown) expect(profile, col).toHaveProperty(col);
    expect(profile?.suspended_reason).toBe("spam");
  });
});
