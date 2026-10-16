import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST_BLOCKED_MESSAGE, blockedMessage, heldNotice } from "./post-moderation";

type Outcome = { verdict: "allow" | "review" | "block"; unavailable: boolean };
const moderateAiText = vi.fn(
  async (
    _admin: unknown,
    _input: { text: string; target: { field: string } },
  ): Promise<Outcome> => ({
    verdict: "allow",
    unavailable: false,
  }),
);
vi.mock("@/lib/ai/moderation.server", () => ({ moderateAiText }));

const { screenPostText, settlePostModeration } = await import("./post-moderation.server");

function input(fields: Record<string, string | null | undefined>) {
  return { userId: "u1", table: "team_posts" as const, context: "ctx", fields };
}

beforeEach(() => moderateAiText.mockClear());

describe("screenPostText", () => {
  it("checks every field in one labelled call, skipping empty ones", async () => {
    await screenPostText({}, input({ title: "Tryouts", body: "", location: " Gym 4 " }));
    expect(moderateAiText).toHaveBeenCalledTimes(1);
    const call = moderateAiText.mock.calls[0][1];
    expect(call.text).toBe("title: Tryouts\n\nlocation: Gym 4");
    expect(call.target.field).toBe("title,body,location");
  });

  it.each([
    [{ verdict: "allow", unavailable: false }, "allow"],
    [{ verdict: "review", unavailable: false }, "hold"],
    [{ verdict: "review", unavailable: true }, "hold"],
    [{ verdict: "block", unavailable: false }, "block"],
  ] as const)("maps %o to %s", async (outcome, expected) => {
    moderateAiText.mockResolvedValueOnce({ ...outcome });
    expect(await screenPostText({}, input({ body: "x" }))).toBe(expected);
  });
});

describe("settlePostModeration", () => {
  function admin(error: unknown = null) {
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error })) }));
    return { client: { from: vi.fn(() => ({ update })) }, update };
  }

  it("approves allowed text", async () => {
    const a = admin();
    expect(await settlePostModeration(a.client, "post_comments", "c1", "allow")).toBe("approved");
    expect(a.update).toHaveBeenCalledWith({ moderation_status: "approved" });
  });

  it("holds text the screen could not clear", async () => {
    const a = admin();
    expect(await settlePostModeration(a.client, "team_posts", "p1", "hold")).toBe("held");
    expect(a.update).toHaveBeenCalledWith({ moderation_status: "held" });
  });

  it("reports held when the status write fails (row stays pending, author-only)", async () => {
    const a = admin({ message: "boom" });
    expect(await settlePostModeration(a.client, "team_posts", "p1", "allow")).toBe("held");
  });
});

describe("client copy helpers", () => {
  it("shows the held notice only for held results", () => {
    expect(heldNotice({ held: true })).toMatch(/only you can see it/);
    expect(heldNotice({ held: false })).toBeNull();
    expect(heldNotice(undefined)).toBeNull();
  });

  it("recognises the moderation block error", () => {
    expect(blockedMessage(new Error(POST_BLOCKED_MESSAGE))).toBe(POST_BLOCKED_MESSAGE);
    expect(blockedMessage(new Error("network"))).toBeNull();
  });
});

describe("entry points screen before writing", () => {
  const sources: Array<[string, string, string]> = [
    ["src/lib/team-posts.functions.ts", "export const createTeamPost", ".insert("],
    ["src/lib/team-posts.functions.ts", "export const updateTeamPost", ".update("],
    ["src/lib/post-engagement.functions.ts", "export const createComment", ".insert("],
    ["src/lib/post-engagement.functions.ts", "export const updateComment", ".update("],
  ];

  it.each(sources)("%s %s", (file, marker, write) => {
    const src = readFileSync(file, "utf8");
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("export const", start + marker.length);
    const body = src.slice(start, next === -1 ? undefined : next);
    const screen = body.indexOf("screenPostText(");
    expect(screen).toBeGreaterThan(-1);
    expect(screen).toBeLessThan(body.indexOf(write));
    expect(body).toContain('if (screen === "block") throw');
    expect(body.indexOf("settlePostModeration(")).toBeGreaterThan(body.indexOf(write));
  });
});

describe("migration", () => {
  const sql = readFileSync("supabase/migrations/20261016120000_post_text_moderation.sql", "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("backfills existing rows as approved before new rows default to pending", () => {
    for (const t of ["team_posts", "post_comments"]) {
      const add = sql.indexOf(
        `ALTER TABLE public.${t}\n  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'approved'`,
      );
      const pending = sql.indexOf(
        `ALTER TABLE public.${t} ALTER COLUMN moderation_status SET DEFAULT 'pending'`,
      );
      expect(add).toBeGreaterThan(-1);
      expect(pending).toBeGreaterThan(add);
    }
  });

  it("gates reads with a restrictive approved-or-author policy on both tables", () => {
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain(
      "ON public.post_comments AS RESTRICTIVE FOR SELECT USING (moderation_status = 'approved' OR author_id = auth.uid());",
    );
    expect(flat).toContain(
      "ON public.team_posts AS RESTRICTIVE FOR SELECT USING ( moderation_status = 'approved' OR author_id = auth.uid() OR private_sec.viewer_manages_team(team_id) );",
    );
  });

  it("forces user inserts to pending and only lets the service role set the status", () => {
    expect(sql).toContain("IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN");
    expect(sql).toContain("NEW.moderation_status := 'pending';");
    expect(sql).toContain(
      "NEW.moderation_status := CASE WHEN _text_changed THEN 'pending' ELSE OLD.moderation_status END;",
    );
    expect(sql).toContain("BEFORE INSERT OR UPDATE ON public.team_posts");
    expect(sql).toContain("BEFORE INSERT OR UPDATE ON public.post_comments");
  });
});
