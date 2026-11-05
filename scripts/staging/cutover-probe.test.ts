import { describe, expect, it } from "vitest";
import {
  ProbeRefused,
  adultOnly,
  coarseLabel,
  exitCode,
  formatResults,
  probeTargetProblems,
  roundedTo2,
  runCutoverProbe,
  sanitize,
  type ProbeConfig,
} from "./cutover-probe";

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload: Record<string, unknown>) =>
  `${b64url({ alg: "HS256" })}.${b64url(payload)}.c2ln`;

const STAGING = "qkukefvzwlyusvspablz";
const PROD = "cpqihhcqeivbgxqbzatv";
const USER_ID = "11111111-2222-4333-8444-555555555555";
const HIDDEN = "99999999-8888-4777-8666-555555555555";
const anonKey = (ref: string) => jwt({ role: "anon", ref, iss: "supabase" });
const userJwt = (ref: string) =>
  jwt({ role: "authenticated", sub: USER_ID, iss: `https://${ref}.supabase.co/auth/v1` });
const recorded = {
  [STAGING]: { verified_by: "owner", verified_on: "2026-11-06", evidence: "ticket" },
};

/** A fake project. `closed` sets the state after every cutover; `open` the state before them. */
function project(state: "open" | "closed") {
  const calls: Array<{ method: string; url: string; auth: string }> = [];
  const games = [
    {
      id: "a",
      min_age: 18,
      max_age: null,
      neighborhood: "Downtown",
      location: "12 Main St",
      lat: 40.712812,
      lng: -74.006015,
    },
    state === "open"
      ? {
          id: "y",
          min_age: 10,
          max_age: 14,
          neighborhood: "Eastside",
          location: "Lincoln Middle School, 5 Oak Ave",
          lat: 40.7128,
          lng: -74.0061,
        }
      : {
          id: "y",
          min_age: 10,
          max_age: 14,
          neighborhood: "Eastside",
          location: "Eastside",
          lat: 40.71,
          lng: -74.01,
        },
    {
      id: "z",
      min_age: null,
      max_age: null,
      neighborhood: "",
      location: state === "open" ? "Park" : "Location shared after you join",
      lat: 40.7,
      lng: -74,
    },
  ];
  const json = (status: number, b: unknown) =>
    new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const h = (init?.headers ?? {}) as Record<string, string>;
    const method = init?.method ?? "GET";
    const isUser = h.authorization !== `Bearer ${h.apikey}`;
    calls.push({ method, url: url.pathname + url.search, auth: isUser ? "user" : "anon" });
    const p = url.pathname;
    if (p.startsWith("/rest/v1/")) {
      const table = p.slice("/rest/v1/".length);
      const select = url.searchParams.get("select") ?? "";
      const closedCols = ["host_id", "image", "host_snapshot", "reported_id", "reviewed_by"];
      if (state === "closed" && closedCols.includes(select))
        return json(isUser ? 403 : 401, {
          code: "42501",
          message: `permission denied for table ${table}`,
        });
      if (table === "hosted_games" && select.startsWith("id,")) {
        const rows = isUser ? games : games.filter((g) => adultOnly(g.min_age, g.max_age));
        return json(
          200,
          rows.map((g) => Object.fromEntries(select.split(",").map((c) => [c, (g as never)[c]]))),
        );
      }
      if (table === "hosted_game_private")
        return json(200, state === "open" && isUser ? [{ game_id: "y" }] : []);
      if (table === "app_settings") return json(200, []);
      return json(200, [{ [select]: USER_ID }]);
    }
    if (p === "/storage/v1/object/list/game-covers")
      return json(200, state === "open" ? [{ name: "cover.jpg" }] : []);
    if (p.startsWith("/storage/v1/object/") && method === "POST")
      return state === "open"
        ? json(200, { Key: p })
        : json(400, {
            statusCode: "403",
            error: "DIRECT_IMAGE_UPLOAD_CLOSED",
            message: "DIRECT_IMAGE_UPLOAD_CLOSED: pictures are uploaded through processing.",
          });
    if (p.startsWith("/storage/v1/object/") && method === "DELETE") return json(200, [{}]);
    return json(404, { message: "not found" });
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const cfg = (over: Partial<ProbeConfig> = {}): ProbeConfig => ({
  url: `https://${STAGING}.supabase.co`,
  publishableKey: anonKey(STAGING),
  userJwt: userJwt(STAGING),
  hiddenHostId: HIDDEN,
  ...over,
});

describe("cutover probe: target guard", () => {
  it("reads may run anywhere with a publishable key, production included", () => {
    expect(
      probeTargetProblems(
        cfg({
          url: `https://${PROD}.supabase.co`,
          publishableKey: anonKey(PROD),
          userJwt: userJwt(PROD),
        }),
      ),
    ).toEqual([]);
    expect(probeTargetProblems(cfg({ url: "http://127.0.0.1:54321", userJwt: undefined }))).toEqual(
      [],
    );
  });

  it("refuses a service-role or secret key, a non-user token, a token from another project, and a non-Supabase URL", () => {
    expect(
      probeTargetProblems(cfg({ publishableKey: jwt({ role: "service_role" }) })).join(),
    ).toMatch(/service-role/);
    expect(probeTargetProblems(cfg({ publishableKey: "sb_secret_abc" })).join()).toMatch(
      /service-role or secret/,
    );
    expect(probeTargetProblems(cfg({ userJwt: anonKey(STAGING) })).join()).toMatch(
      /signed-in user/,
    );
    expect(probeTargetProblems(cfg({ userJwt: userJwt(PROD) })).join()).toMatch(
      /not issued by the project/,
    );
    expect(probeTargetProblems(cfg({ url: "https://db.example.com" })).join()).toMatch(
      /not a Supabase project URL/,
    );
  });

  it("writes only on a local Supabase or a designated sandbox with a recorded isolation; never production", () => {
    expect(probeTargetProblems(cfg({ allowWrites: true }), {}).join()).toMatch(/isolation record/);
    expect(probeTargetProblems(cfg({ allowWrites: true }), recorded)).toEqual([]);
    expect(
      probeTargetProblems(
        cfg({
          url: `https://${PROD}.supabase.co`,
          publishableKey: anonKey(PROD),
          userJwt: userJwt(PROD),
          allowWrites: true,
        }),
        recorded,
      ).join(),
    ).toMatch(/refused against production/);
    expect(
      probeTargetProblems(
        cfg({
          url: "https://abcdefghijklmnopqrst.supabase.co",
          publishableKey: anonKey("abcdefghijklmnopqrst"),
          userJwt: userJwt("abcdefghijklmnopqrst"),
          allowWrites: true,
        }),
        recorded,
      ).join(),
    ).toMatch(/designated E2E sandbox/);
    expect(
      probeTargetProblems(cfg({ allowWrites: true, userJwt: undefined }), recorded).join(),
    ).toMatch(/needs PROBE_USER_JWT/);
    expect(
      probeTargetProblems(cfg({ url: "http://127.0.0.1:54321", allowWrites: true }), {}),
    ).toEqual([]);
  });

  it("a refused configuration makes no request at all", async () => {
    const p = project("closed");
    await expect(
      runCutoverProbe(cfg({ allowWrites: true }), { fetch: p.fetch, isolation: {} }),
    ).rejects.toBeInstanceOf(ProbeRefused);
    expect(p.calls).toHaveLength(0);
  });
});

describe("cutover probe: results", () => {
  it("after every cutover: all PASS, exit 0", async () => {
    const p = project("closed");
    const r = await runCutoverProbe(cfg({ allowWrites: true }), {
      fetch: p.fetch,
      isolation: recorded,
      now: () => 1,
    });
    expect(r.filter((x) => x.status !== "pass")).toEqual([]);
    expect(exitCode(r)).toBe(0);
    expect(r.map((x) => x.id)).toEqual(
      expect.arrayContaining([
        "F08 anon hosted_games.host_id",
        "F08 user hosted_games.host_snapshot",
        "F08 user hosted_games_public readable",
        "F08 user game-covers listing",
        "F07 user youth locations coarse",
        "F07 user private locations hidden",
        "F06 user direct upload refused (avatars)",
      ]),
    );
  });

  it("before the cutovers: each exposure is reported, the probe upload is deleted, exit 1", async () => {
    const p = project("open");
    const r = await runCutoverProbe(cfg({ allowWrites: true }), {
      fetch: p.fetch,
      isolation: recorded,
      now: () => 1,
    });
    const exposed = r.filter((x) => x.status === "exposed").map((x) => x.id);
    expect(exposed).toEqual(
      expect.arrayContaining([
        "F08 anon hosted_games.host_id",
        "F08 user join_requests.host_id",
        "F08 user game-covers listing",
        "F07 user youth locations coarse",
        "F07 user private locations hidden",
        "F06 user direct upload refused (avatars)",
      ]),
    );
    expect(r.find((x) => x.id === "F07 user youth locations coarse")?.detail).toMatch(
      /2 youth-inclusive game\(s\) visible, 2 with an exact/,
    );
    expect(r.find((x) => x.id === "F06 user direct upload refused (avatars)")?.detail).toMatch(
      /deleted/,
    );
    expect(p.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
    expect(exitCode(r)).toBe(1);
  });

  it("reads only by default: no write request is made", async () => {
    const p = project("open");
    const r = await runCutoverProbe(cfg(), { fetch: p.fetch, isolation: recorded });
    expect(p.calls.every((c) => c.method === "GET" || c.url.includes("/object/list/"))).toBe(true);
    expect(r.find((x) => x.id === "F06 user direct upload refused")?.status).toBe("skip");
  });

  it("without a user token only anonymous checks run; --only limits the findings", async () => {
    const p = project("closed");
    const r = await runCutoverProbe(cfg({ userJwt: undefined, only: ["F08"] }), { fetch: p.fetch });
    expect(r.every((x) => x.finding === "F08")).toBe(true);
    expect(p.calls.every((c) => c.auth === "anon")).toBe(true);
    expect(r.find((x) => x.id === "F08 user columns")?.status).toBe("skip");
  });

  it("output never carries a key, token or account id", async () => {
    const p = project("open");
    const c = cfg({ allowWrites: true });
    const text = formatResults(await runCutoverProbe(c, { fetch: p.fetch, isolation: recorded }));
    for (const secret of [c.publishableKey, c.userJwt as string, USER_ID, HIDDEN])
      expect(text).not.toContain(secret);
    expect(sanitize(`bad ${c.userJwt} for ${USER_ID} with sb_secret_xyz`)).toBe(
      "bad [token] for [id] with [key]",
    );
  });
});

describe("cutover probe: helpers match the database rules", () => {
  it("coarse label, rounding, adult-only", () => {
    expect(coarseLabel("  Eastside ")).toBe("Eastside");
    expect(coarseLabel("")).toBe("Location shared after you join");
    expect(coarseLabel(null)).toBe("Location shared after you join");
    expect([roundedTo2(40.71), roundedTo2(-74), roundedTo2("40.7100"), roundedTo2(null)]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect([roundedTo2(40.7128), roundedTo2("1e-7")]).toEqual([false, false]);
    expect([
      adultOnly(18, null),
      adultOnly(21, 30),
      adultOnly(17, null),
      adultOnly(null, null),
      adultOnly(20, 18),
    ]).toEqual([true, true, false, false, false]);
  });
});
