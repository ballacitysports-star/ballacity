import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  fetchManagedProfileNames,
  fetchProfileNameBits,
  isMissingFunctionError,
  withManagedProfileNames,
} from "@/lib/managed-profile-names";

/**
 * A block or a suspension hides a profile row (20261125100000). A host's
 * screens keep the names of the people in their games by filling the ids the
 * profiles read left out from managed_profile_names.
 */

const named = (id: string, name: string) => ({
  id,
  display_name: name,
  username: name.toLowerCase(),
  avatar_initials: name.slice(0, 2).toUpperCase(),
  avatar_url: null,
});

/** A row as managed_profile_names returns it: no username (see the migration, 5.). */
const managedRow = (id: string, name: string) => {
  const { username: _username, ...rest } = named(id, name);
  return rest;
};

/** What the helpers hand a screen for a managed row: the row with `username: null`. */
const filled = (id: string, name: string) => ({ ...managedRow(id, name), username: null });

function clientAnswering(answer: { data: unknown; error: unknown } | Error) {
  const rpc = vi.fn(function (this: unknown) {
    // The real client reads `this`; the helper must call it bound.
    expect(this).toBe(client);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  const client = { rpc };
  return client;
}

describe("withManagedProfileNames", () => {
  it("fills only the ids the profiles read left out", async () => {
    const client = clientAnswering({ data: [managedRow("b", "Bob")], error: null });
    const rows = await withManagedProfileNames(client, ["a", "b"], [named("a", "Ann")]);
    expect(rows).toEqual([named("a", "Ann"), filled("b", "Bob")]);
    expect(client.rpc).toHaveBeenCalledWith("managed_profile_names", { _ids: ["b"] });
  });

  it("asks nothing when every row came back", async () => {
    const client = clientAnswering({ data: [], error: null });
    const rows = await withManagedProfileNames(client, ["a"], [named("a", "Ann")]);
    expect(rows).toHaveLength(1);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("never duplicates a row the read already returned", async () => {
    const client = clientAnswering({
      data: [managedRow("a", "Other"), managedRow("b", "Bob")],
      error: null,
    });
    const rows = await withManagedProfileNames(client, ["a", "b"], [named("a", "Ann")]);
    expect(rows.map((r) => r.display_name)).toEqual(["Ann", "Bob"]);
  });

  it("fills nothing while the function is missing (before the migration, after its rollback)", async () => {
    const client = clientAnswering({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const rows = await withManagedProfileNames(client, ["a", "b"], [named("a", "Ann")]);
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("fills nothing on any other failure, without throwing", async () => {
    await expect(
      withManagedProfileNames(clientAnswering(new TypeError("Failed to fetch")), ["b"], []),
    ).resolves.toEqual([]);
    await expect(
      withManagedProfileNames(
        clientAnswering({ data: null, error: { code: "42501", message: "permission denied" } }),
        ["b"],
        null,
      ),
    ).resolves.toEqual([]);
  });
});

describe("fetchManagedProfileNames", () => {
  it("sends each id once, at most 500", async () => {
    const client = clientAnswering({ data: [], error: null });
    const ids = Array.from({ length: 600 }, (_, i) => `id-${i}`);
    await fetchManagedProfileNames(client, [...ids, "id-0", ""]);
    const sent = (client.rpc.mock.calls[0] as unknown[])[1] as { _ids: string[] };
    expect(sent._ids).toHaveLength(500);
    expect(new Set(sent._ids).size).toBe(500);
    expect(sent._ids).not.toContain("");
  });

  it("asks nothing for no ids", async () => {
    const client = clientAnswering({ data: [], error: null });
    await expect(fetchManagedProfileNames(client, [])).resolves.toEqual([]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("never hands on a username, whatever the server sends", async () => {
    // The function names private accounts too (so its answer cannot tell a block from a private profile), and a
    // username is not something visible_avatars gives out; an older server that still sent one is not passed on.
    const client = clientAnswering({ data: [named("b", "Bob")], error: null });
    await expect(fetchManagedProfileNames(client, ["b"])).resolves.toEqual([filled("b", "Bob")]);
  });
});

describe("isMissingFunctionError", () => {
  it("knows PostgREST's and Postgres's codes for a missing function", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883" })).toBe(true);
    expect(isMissingFunctionError({ code: "42501" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

/** A client whose profiles read answers `row` (or throws) and whose rpc answers `managed`. */
function nameClient(row: unknown, managed: { data: unknown; error: unknown }) {
  const eq = vi.fn(() => ({
    maybeSingle: () =>
      row instanceof Error ? Promise.reject(row) : Promise.resolve({ data: row, error: null }),
  }));
  const select = vi.fn(() => ({ eq }));
  const client = {
    from: vi.fn(function (this: unknown, table: string) {
      expect(this).toBe(client);
      expect(table).toBe("profiles");
      return { select };
    }),
    rpc: vi.fn(function (this: unknown) {
      expect(this).toBe(client);
      return Promise.resolve(managed);
    }),
  };
  return { client, select, eq };
}

const bits = (name: string) => {
  const { id: _id, ...rest } = named("x", name);
  return rest;
};

describe("fetchProfileNameBits (one person on a host's screen)", () => {
  it("uses the profile row when the host can read it, and asks nothing else", async () => {
    const { client, eq } = nameClient(bits("Ann"), { data: [], error: null });
    await expect(fetchProfileNameBits(client, "a")).resolves.toEqual(bits("Ann"));
    expect(eq).toHaveBeenCalledWith("id", "a");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("fills a row hidden by a block or a suspension from managed_profile_names", async () => {
    const { client } = nameClient(null, { data: [managedRow("b", "Bob")], error: null });
    await expect(fetchProfileNameBits(client, "b")).resolves.toEqual({
      ...bits("Bob"),
      username: null,
    });
    expect(client.rpc).toHaveBeenCalledWith("managed_profile_names", { _ids: ["b"] });
  });

  it("falls back the same way when the profiles read fails", async () => {
    const { client } = nameClient(new TypeError("Failed to fetch"), {
      data: [managedRow("b", "Bob")],
      error: null,
    });
    await expect(fetchProfileNameBits(client, "b")).resolves.toEqual({
      ...bits("Bob"),
      username: null,
    });
  });

  it("answers null when neither names the person, so the screen keeps its fallback", async () => {
    const { client } = nameClient(null, { data: [], error: null });
    await expect(fetchProfileNameBits(client, "c")).resolves.toBeNull();
    const missing = nameClient(null, { data: null, error: { code: "PGRST202" } });
    await expect(fetchProfileNameBits(missing.client, "c")).resolves.toBeNull();
  });
});

describe("the host's list screens fill hidden names", () => {
  // Each bulk caller reads profiles, fills the ids that read left out through withManagedProfileNames, and builds its
  // name map from what that call returns. Dropping the fill would show "Player" for anyone who blocked the host or is
  // suspended, and no other test would notice (their stubs have no rpc, which withManagedProfileNames treats as "fill
  // nothing").
  it.each([
    ["src/lib/game-roster.ts", "rows", /rows\.forEach\(\(p\) => map\.set\(/],
    ["src/components/GamePaymentsPanel.tsx", "profs", /for \(const p of profs as/],
    ["src/components/WaitlistManager.tsx", "data", /for \(const p of data\) next\[p\.id\] = p;/],
    [
      "src/components/payments/UnpaidPlayersPanel.tsx",
      "profs",
      /new Map\(\(profs \?\? \[\]\)\.map\(/,
    ],
  ] as const)("%s builds its names from withManagedProfileNames", (file, result, use) => {
    const src = readFileSync(file, "utf8");
    const fill = new RegExp(
      `const ${result} = (?:\\w+\\.length \\? )?await withManagedProfileNames\\(supabase, \\w+, (read|data)\\b`,
    );
    const call = fill.exec(src);
    expect(call).not.toBeNull();
    // the bare read is passed in, and only the filled result is turned into names
    expect(src).toMatch(use);
    expect(src).not.toMatch(
      new RegExp(`for \\(const p of ${call![1]}\\b|\\(${call![1]} \\?\\? \\[\\]\\)\\.map`),
    );
  });
});

describe("the host's one-person screens fill hidden names", () => {
  it.each([
    "src/components/game-detail/RosterPlayerRow.tsx",
    "src/components/game-detail/HostRequestRows.tsx",
    "src/routes/payments.tsx",
  ])("%s reads the name through fetchProfileNameBits, not a bare profiles read", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/fetchProfileNameBits\(supabase, (req|sub)\.player_id\)/);
    expect(src).not.toMatch(/from\("profiles"\)[\s\S]{0,120}\.eq\("id", (req|sub)\.player_id\)/);
  });
});
