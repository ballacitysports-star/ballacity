/**
 * The guardian's calls (managed-handover.functions.ts). A server function is its handler here: the middleware is replaced
 * by a context, the input is validated, then the handler runs. The database decides who may start and for whom; what is
 * checked here is that the app asks it first, sends nothing unless it agrees, cancels when the email cannot be sent, and
 * never lets raw text through.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type SendOpts = { templateData: Record<string, unknown>; idempotencyKey: string };

const h = vi.hoisted(() => ({
  rpc: [] as { name: string; args: Record<string, unknown> }[],
  rpcResult: {} as Record<string, { data?: unknown; error?: unknown }>,
  claims: {} as Record<string, unknown>,
  sent: [] as { template: string; to: string; opts: SendOpts }[],
  sendResult: { sent: true } as { sent: boolean },
  sendThrows: null as unknown,
}));

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
      handler(fn: (ctx: { context: unknown; data: unknown }) => unknown) {
        return (arg: { data: unknown }) =>
          fn({
            context: {
              userId: "guardian",
              claims: h.claims,
              supabase: {
                rpc: async (name: string, args: Record<string, unknown>) => {
                  h.rpc.push({ name, args });
                  return h.rpcResult[name] ?? { data: null, error: null };
                },
                from: () => ({
                  select: () => ({
                    in: async () => ({
                      data: [
                        { id: "guardian", display_name: "Alex Smith" },
                        { id: "11111111-1111-4111-8111-111111111111", display_name: "Jake S." },
                      ],
                    }),
                  }),
                }),
              },
            },
            data: validate(arg.data),
          });
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
// The server starts a handover with the service role, for the signed-in guardian's id.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpc.push({ name, args });
      return h.rpcResult[name] ?? { data: null, error: null };
    },
  },
}));
vi.mock("@/lib/email-templates/send-email", () => ({
  sendTemplateEmail: async (template: string, to: string, opts: SendOpts) => {
    if (h.sendThrows) throw h.sendThrows;
    h.sent.push({ template, to, opts });
    return h.sendResult;
  },
}));

const { cancelManagedHandover, startManagedHandover } =
  await import("./managed-handover.functions");

const CHILD = "11111111-1111-4111-8111-111111111111";
type Call<T> = (arg: { data: unknown }) => Promise<T>;
const start = async (data: Record<string, unknown> = {}) =>
  (startManagedHandover as unknown as Call<{ expiresAt: string; emailMasked: string }>)({
    data: { childUserId: CHILD, email: "Adult@Example.test ", attested: true, ...data },
  });
const cancel = () =>
  (cancelManagedHandover as unknown as Call<{ cancelled: boolean }>)({
    data: { childUserId: CHILD },
  });

beforeEach(() => {
  h.rpc.length = 0;
  h.sent.length = 0;
  h.sendResult = { sent: true };
  h.sendThrows = null;
  h.claims = {};
  h.rpcResult = {
    start_managed_handover: {
      data: {
        ok: true,
        handover_id: "ho1",
        expires_at: "2026-11-28T10:00:00Z",
        email_masked: "a***@example.test",
      },
      error: null,
    },
    cancel_managed_handover: { data: true, error: null },
  };
});

describe("startManagedHandover", () => {
  it("asks the database first with a token hash (never the token), then emails the one-time link", async () => {
    const res = await start();
    expect(res).toEqual({ expiresAt: "2026-11-28T10:00:00Z", emailMasked: "a***@example.test" });
    const call = h.rpc.find((c) => c.name === "start_managed_handover")!;
    // The guardian is the signed-in user the middleware verified, not anything the browser sent.
    expect(call.args).toMatchObject({
      _guardian: "guardian",
      _child: CHILD,
      _email: "Adult@Example.test",
    });
    expect(String(call.args._token_hash)).toMatch(/^[0-9a-f]{64}$/);

    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0]!;
    expect(mail.template).toBe("managed-handover");
    expect(mail.to).toBe("adult@example.test");
    const url = String(mail.opts.templateData.handoverUrl);
    const token = url.split("/handover/")[1]!;
    expect(url.startsWith("https://ballacity.com/handover/")).toBe(true);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    // The database got the hash of exactly this token, not the token.
    expect(call.args._token_hash).not.toBe(token);
    expect(mail.opts.templateData).toMatchObject({
      guardianName: "Alex",
      accountName: "Jake S.",
      expiresDays: 7,
    });
    expect(mail.opts.idempotencyKey).toMatch(/^managed-handover-[0-9a-f]{64}$/);
  });

  it("sends nothing when the database refuses, and says why in words", async () => {
    for (const [code, words] of [
      ["HANDOVER_EMAIL_IS_OWN", /own email address, not yours/],
      ["HANDOVER_EMAIL_UNUSABLE", /can't be used/],
      ["HANDOVER_EMAIL_INVALID", /full email address/],
    ] as const) {
      h.rpcResult.start_managed_handover = { data: { ok: false, code }, error: null };
      await expect(start()).rejects.toThrow(words);
    }
    for (const raised of [
      "HANDOVER_NOT_ADULT: an account can be handed over once its person is 18 or over.",
      "HANDOVER_NOT_ALLOWED: only the adult who manages this account can hand it over.",
      "HANDOVER_ALREADY_PENDING: a handover is already waiting for this account.",
      "HANDOVER_LIMIT: too many handover attempts for now.",
    ]) {
      h.rpcResult.start_managed_handover = {
        data: null,
        error: { message: raised, code: "P0001" },
      };
      const err = (await start().catch((e: Error) => e)) as Error;
      expect(err.message).not.toMatch(/HANDOVER_|P0001/);
      expect(err.message.length).toBeGreaterThan(20);
    }
    expect(h.sent).toEqual([]);
    expect(h.rpc.every((c) => c.name === "start_managed_handover")).toBe(true);
  });

  it("is 'not available' while the migration is missing, and sends nothing", async () => {
    h.rpcResult.start_managed_handover = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    };
    await expect(start()).rejects.toThrow(/isn't available yet/);
    expect(h.sent).toEqual([]);
  });

  it("never shows raw database text for a failure it does not know", async () => {
    h.rpcResult.start_managed_handover = {
      data: null,
      error: { code: "57014", message: "canceling statement due to statement timeout" },
    };
    const err = (await start().catch((e: Error) => e)) as Error;
    expect(err.message).toBe("Something went wrong and nothing was changed. Please try again.");
  });

  it("cancels the handover and says so when the email cannot be sent, so nothing is left pending", async () => {
    h.sendThrows = new Error("upstream 503");
    await expect(start()).rejects.toThrow(/couldn't send the email, so nothing was changed/);
    expect(h.rpc.map((c) => c.name)).toEqual(["start_managed_handover", "cancel_managed_handover"]);
    expect(h.rpc[1]!.args).toEqual({ _child: CHILD });
  });

  it("does the same when the address is suppressed (the email service answers 'not sent')", async () => {
    h.sendResult = { sent: false };
    await expect(start()).rejects.toThrow(/couldn't send the email/);
    expect(h.rpc.map((c) => c.name)).toEqual(["start_managed_handover", "cancel_managed_handover"]);
  });

  it("refuses a managed account's own session (a guardian switched in) before asking anything", async () => {
    h.claims = { app_metadata: { managed: true, managed_by: "guardian" } };
    await expect(start()).rejects.toThrow(/Switch back to your own account/);
    expect(h.rpc).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("refuses input that is not a handover request", async () => {
    await expect(start({ childUserId: "not-a-uuid" })).rejects.toThrow();
    await expect(start({ attested: false })).rejects.toThrow();
    await expect(start({ email: "" })).rejects.toThrow();
    await expect(start({ email: "a".repeat(300) })).rejects.toThrow();
    expect(h.rpc).toEqual([]);
  });
});

describe("cancelManagedHandover", () => {
  it("cancels through the database as the guardian", async () => {
    expect(await cancel()).toEqual({ cancelled: true });
    expect(h.rpc).toEqual([{ name: "cancel_managed_handover", args: { _child: CHILD } }]);
  });

  it("reads 'nothing pending' as not cancelled, and refusals as words", async () => {
    h.rpcResult.cancel_managed_handover = { data: false, error: null };
    expect(await cancel()).toEqual({ cancelled: false });
    h.rpcResult.cancel_managed_handover = {
      data: null,
      error: { message: "HANDOVER_BUSY: the handover is being finished right now.", code: "P0001" },
    };
    await expect(cancel()).rejects.toThrow(/being finished right now/);
    h.rpcResult.cancel_managed_handover = {
      data: null,
      error: { code: "PGRST202", message: "missing" },
    };
    await expect(cancel()).rejects.toThrow(/isn't available yet/);
  });
});
