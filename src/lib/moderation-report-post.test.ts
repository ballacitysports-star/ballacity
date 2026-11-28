import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reporting a network post (20261205100000) goes through report_post, which checks the post, the reporter and the
 * author itself. The client only passes the post, the reason and the details, and turns every refusal into a
 * sentence: never the database's text.
 */

type Result = { data: unknown; error: unknown };

const FILED = { report_id: "report-1", filed: true };

const h = vi.hoisted(() => ({
  result: { data: { report_id: "report-1", filed: true }, error: null } as Result,
  calls: [] as { fn: string; args: unknown }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const supabase = {
    rpc(fn: string, args: unknown) {
      expect(this).toBe(supabase);
      h.calls.push({ fn, args });
      return Promise.resolve(h.result);
    },
    from() {
      throw new Error("a post report is never written to a table directly");
    },
  };
  return { supabase };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

const {
  MESSAGE_REPORT_REASONS,
  POST_REPORT_FAILED_MESSAGE,
  POST_REPORT_UNAVAILABLE_MESSAGE,
  parsePostReportResult,
  reasonsFor,
  reportPost,
} = await import("@/lib/moderation");

const RAW = /POST_NOT_FOUND|CANNOT_REPORT_SELF|AUTH_REQUIRED|report_post|PGRST|relation|violates/;

beforeEach(() => {
  h.result = { data: FILED, error: null };
  h.calls = [];
});

async function refusal(error: unknown): Promise<string> {
  h.result = { data: null, error };
  try {
    await reportPost("post-1", "spam");
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("reportPost did not throw");
}

describe("reportPost", () => {
  it("calls report_post with the post, the reason and trimmed details, and answers what it did", async () => {
    await expect(reportPost("post-1", "harassment", "  said something awful  ")).resolves.toEqual({
      reportId: "report-1",
      filed: true,
    });
    expect(h.calls).toEqual([
      {
        fn: "report_post",
        args: { _post: "post-1", _reason: "harassment", _details: "said something awful" },
      },
    ]);
  });

  it("says when report_post filed nothing because the member's open report already says the same", async () => {
    h.result = { data: { report_id: "report-0", filed: false }, error: null };
    await expect(reportPost("post-1", "spam")).resolves.toEqual({
      reportId: "report-0",
      filed: false,
    });
  });

  it("never reads an answer it does not know as filed (or as already there)", () => {
    for (const data of [
      null,
      "report-1",
      { report_id: "report-1" },
      { filed: true },
      { report_id: 1, filed: true },
    ]) {
      expect(() => parsePostReportResult(data)).toThrow(POST_REPORT_FAILED_MESSAGE);
    }
    expect(parsePostReportResult({ report_id: "r", filed: false })).toEqual({
      reportId: "r",
      filed: false,
    });
  });

  it("sends no details for blank ones and cuts long ones to 1000 characters", async () => {
    await reportPost("post-1", "spam", "   ");
    await reportPost("post-1", "spam", "x".repeat(1500));
    expect((h.calls[0].args as { _details: unknown })._details).toBeNull();
    expect((h.calls[1].args as { _details: string })._details).toHaveLength(1000);
  });

  it("says a post is not available, the same for a missing post and one the member cannot read", async () => {
    const msg = await refusal({
      message: "POST_NOT_FOUND",
      code: "P0002",
      details: null,
      hint: null,
    });
    expect(msg).toBe("That post isn't available.");
  });

  it("says the member cannot report their own post", async () => {
    const msg = await refusal({
      message: "CANNOT_REPORT_SELF: you cannot report your own post.",
      code: "22023",
      details: null,
      hint: null,
    });
    expect(msg).toBe("You can't report your own post.");
  });

  it("says reporting is not available while the function is missing (before the migration or after its rollback)", async () => {
    const msg = await refusal({
      message:
        "Could not find the function public.report_post(_details, _post, _reason) in the schema cache",
      code: "PGRST202",
      details: null,
      hint: null,
    });
    expect(msg).toBe(POST_REPORT_UNAVAILABLE_MESSAGE);
  });

  it("never shows the database's own text", async () => {
    for (const error of [
      { message: "INVALID_REASON", code: "22023", details: null, hint: null },
      {
        message: 'relation "public.posts" does not exist',
        code: "42P01",
        details: null,
        hint: null,
      },
      { message: "new row violates check constraint", code: "23514", details: null, hint: null },
    ]) {
      const msg = await refusal(error);
      expect(msg).toBe(POST_REPORT_FAILED_MESSAGE);
      expect(msg).not.toMatch(RAW);
    }
    expect(await refusal({ message: "AUTH_REQUIRED", code: "42501" })).toBe("Sign in to continue.");
  });
});

describe("post report reasons", () => {
  it("are the message reasons, in the same words", () => {
    expect(reasonsFor("post")).toBe(MESSAGE_REPORT_REASONS);
  });
});
