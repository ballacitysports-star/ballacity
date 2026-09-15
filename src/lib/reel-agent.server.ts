/**
 * Reel Coach agent (server-only).
 *
 * A tool-using sports agent: it can read the athlete's reel analysis, profile
 * and recent games, and — when the athlete asks — apply copy, overlays and the
 * cut list straight to the reel. Every tool is scoped to the caller's own rows
 * (all reads/writes go through the request-scoped, RLS-enforcing client).
 */

import type { AiSession } from "@/lib/ai/gate.server";
import { buildReelGrounding, REEL_COACH_COLUMNS } from "@/lib/reel-coach.server";

const MODEL = "google/gemini-3-flash-preview";
const MAX_TURNS = 6;

export type CoachMessage = { role: "user" | "assistant"; content: string };

export type CoachResult = {
  answer: string;
  /** Human-readable log of what the agent actually changed. */
  actions: string[];
  /** True when the agent wrote to the reel, so the UI can refresh. */
  changed: boolean;
};

type Ctx = {
  supabase: any;
  userId: string;
  reelId: string;
  reel: Record<string, any>;
  actions: string[];
  changed: boolean;
  session?: AiSession | null;
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_reel_details",
      description:
        "Full AI analysis of this reel: play-by-play timeline, planned cut list, coaching report, spoken transcript, current copy.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_profile",
      description: "The athlete's profile: display name, city, sports and skill levels, bio.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_games",
      description: "The athlete's most recent games (title, sport, venue, start time).",
      parameters: {
        type: "object",
        properties: { limit: { type: "number", description: "How many games, 1-10." } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_copy",
      description:
        "Save new copy on the reel. Only call this when the athlete asked you to apply/save changes.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          overlays: {
            type: "array",
            items: {
              type: "object",
              properties: { at: { type: "string" }, text: { type: "string" } },
              required: ["at", "text"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_edit_plan",
      description:
        "Save a new cut list (segments the player renders live). Only call this when the athlete asked for it.",
      parameters: {
        type: "object",
        properties: {
          segments: {
            type: "array",
            items: {
              type: "object",
              properties: {
                start: { type: "number" },
                end: { type: "number" },
                pace: { type: "string", enum: ["normal", "slowmo", "hold", "quick"] },
                why: { type: "string" },
              },
              required: ["start", "end"],
              additionalProperties: false,
            },
          },
          why: { type: "string" },
        },
        required: ["segments"],
        additionalProperties: false,
      },
    },
  },
] as const;

async function runTool(name: string, args: any, ctx: Ctx): Promise<any> {
  switch (name) {
    case "get_reel_details": {
      const r = ctx.reel;
      return {
        title: r.ai_title || r.title,
        caption: r.ai_caption ?? null,
        hashtags: r.ai_hashtags ?? [],
        sport: r.ai_sport ?? null,
        analysis: r.ai_analysis ?? null,
        timeline: r.ai_timeline ?? [],
        edit_plan: r.ai_edit_plan ?? null,
        coaching: r.ai_coaching ?? null,
        transcript: r.ai_transcript?.text ?? null,
        overlays: r.ai_overlays ?? [],
      };
    }
    case "get_my_profile": {
      const { data } = await ctx.supabase
        .from("profiles")
        .select("display_name,city,bio,sports,sport_levels")
        .eq("id", ctx.userId)
        .maybeSingle();
      return data ?? { note: "No profile yet" };
    }
    case "get_my_games": {
      const limit = Math.max(1, Math.min(10, Number(args?.limit) || 5));
      const { data } = await ctx.supabase
        .from("games")
        .select("title,sport,venue_name,starts_at")
        .order("starts_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    }
    case "apply_copy": {
      const patch: Record<string, any> = {};
      if (args?.title) patch.ai_title = String(args.title).slice(0, 120);
      if (args?.caption) patch.ai_caption = String(args.caption).slice(0, 500);
      if (Array.isArray(args?.hashtags) && args.hashtags.length) {
        patch.ai_hashtags = args.hashtags
          .map((h: unknown) => String(h).replace(/^#/, "").trim())
          .filter(Boolean)
          .slice(0, 8);
      }
      if (Array.isArray(args?.overlays) && args.overlays.length) {
        patch.ai_overlays = args.overlays
          .map((o: any) => ({
            at: String(o?.at ?? "").slice(0, 24),
            text: String(o?.text ?? "").slice(0, 60),
          }))
          .filter((o: { text: string }) => o.text.length > 0)
          .slice(0, 6);
      }
      if (Object.keys(patch).length === 0) return { updated: false, reason: "nothing to apply" };
      // Agent-written copy is publicly visible once saved: check it first.
      if (ctx.session) {
        const { moderateAiText } = await import("@/lib/ai/moderation.server");
        const verdict = await moderateAiText(ctx.session.admin, {
          userId: ctx.userId,
          jobId: ctx.session.jobId,
          text: [
            patch.ai_title ?? "",
            patch.ai_caption ?? "",
            ...(patch.ai_hashtags ?? []),
            ...((patch.ai_overlays ?? []) as { text: string }[]).map((o) => o.text),
          ].join("\n"),
          context: "Reel Coach copy applied to a reel",
          target: { table: "highlight_reels", id: ctx.reelId, field: "apply_copy" },
        });
        if (verdict.verdict === "block") {
          return { updated: false, reason: "that copy did not pass the safety check" };
        }
      }
      const { error } = await ctx.supabase
        .from("highlight_reels")
        .update(patch)
        .eq("id", ctx.reelId)
        .eq("user_id", ctx.userId);
      if (error) return { updated: false, error: error.message };
      Object.assign(ctx.reel, patch);
      ctx.changed = true;
      ctx.actions.push(
        `Updated ${Object.keys(patch)
          .map((k) => k.replace(/^ai_/, ""))
          .join(", ")}`,
      );
      return { updated: true, fields: Object.keys(patch) };
    }
    case "apply_edit_plan": {
      const PACES = ["normal", "slowmo", "hold", "quick"];
      const segments = Array.isArray(args?.segments)
        ? args.segments
            .map((s: any) => {
              const start = Math.max(0, Number(s?.start) || 0);
              const end = Math.max(start + 0.5, Number(s?.end) || start + 2);
              return {
                start: Math.round(start * 100) / 100,
                end: Math.round(end * 100) / 100,
                pace: PACES.includes(String(s?.pace)) ? String(s.pace) : "normal",
                why: String(s?.why ?? "").slice(0, 160),
              };
            })
            .sort((a: { start: number }, b: { start: number }) => a.start - b.start)
            .slice(0, 6)
        : [];
      if (segments.length === 0) return { updated: false, reason: "no valid segments" };
      const edit_plan = {
        segments,
        why: String(args?.why ?? "").slice(0, 240),
        total:
          Math.round(segments.reduce((n: number, s: any) => n + (s.end - s.start), 0) * 10) / 10,
        source: "coach",
      };
      const { error } = await ctx.supabase
        .from("highlight_reels")
        .update({ ai_edit_plan: edit_plan })
        .eq("id", ctx.reelId)
        .eq("user_id", ctx.userId);
      if (error) return { updated: false, error: error.message };
      ctx.reel.ai_edit_plan = edit_plan;
      ctx.changed = true;
      ctx.actions.push(`Saved a ${segments.length}-cut edit plan (${edit_plan.total}s)`);
      return { updated: true, edit_plan };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

/** Tool-calling turn, routed through the shared AI transport (same model + tools). */
async function gateway(_apiKey: string, messages: any[], session?: AiSession | null) {
  const { rawChat } = await import("@/lib/ai/gateway.server");
  const out = await rawChat({
    model: session?.config.provider.textModel ?? MODEL,
    messages,
    tools: TOOLS,
  });
  if (session) {
    const { recordUsage } = await import("@/lib/ai/usage.server");
    await recordUsage(
      session.admin,
      { jobId: session.jobId, userId: session.userId, feature: session.feature },
      {
        provider: session.provider.name,
        model: out.model,
        usage: out.usage,
        outcome: "ok",
        config: session.config,
      },
    );
  }
  return out.message;
}

/** Runs the agent loop and returns the final answer plus anything it changed. */
export async function runReelCoachAgent(
  apiKey: string,
  input: {
    supabase: any;
    userId: string;
    reelId: string;
    question: string;
    history: CoachMessage[];
    session?: AiSession | null;
  },
): Promise<CoachResult> {
  const { data: reel, error } = await input.supabase
    .from("highlight_reels")
    .select(REEL_COACH_COLUMNS)
    .eq("id", input.reelId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!reel) throw new Error("Reel not found");

  const ctx: Ctx = {
    supabase: input.supabase,
    userId: input.userId,
    reelId: input.reelId,
    reel: reel as Record<string, any>,
    actions: [],
    changed: false,
    session: input.session ?? null,
  };

  const messages: any[] = [
    {
      role: "system",
      content: [
        "You are Reel Coach, a sports highlight agent inside a pickup-sports app.",
        "You help the athlete improve this reel: captions, titles, hashtags, on-screen text, which moments to feature, the cut list, technique, and how to film better next time.",
        "Use your tools to look things up instead of guessing. Call apply_copy or apply_edit_plan ONLY when the athlete clearly asks you to apply, save, or use something — otherwise just propose it in chat.",
        "After applying a change, say plainly what you changed.",
        "Be concrete and brief (max 140 words). Never invent scores, stats, opponents, or player names.",
        "Here is what is already known about the reel:",
        buildReelGrounding(ctx.reel) || "No AI analysis is available for this reel yet.",
      ].join("\n"),
    },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.question },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const msg = await gateway(apiKey, messages, input.session ?? null);
    if (!msg) break;
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (calls.length === 0) {
      const answer = String(msg.content ?? "").trim();
      if (!answer && ctx.actions.length === 0) break;
      return {
        answer: answer || `Done — ${ctx.actions.join("; ")}.`,
        actions: ctx.actions,
        changed: ctx.changed,
      };
    }
    messages.push(msg);
    for (const call of calls) {
      let args: any = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }
      let result: any;
      try {
        result = await runTool(String(call.function?.name), args, ctx);
      } catch (e: any) {
        result = { error: e?.message ?? "tool failed" };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  if (ctx.actions.length > 0) {
    return { answer: `Done — ${ctx.actions.join("; ")}.`, actions: ctx.actions, changed: true };
  }
  throw new Error("Reel Coach had nothing to say — try rephrasing");
}
