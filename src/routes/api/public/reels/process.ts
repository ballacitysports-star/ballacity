import { createFileRoute } from "@tanstack/react-router";

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 10 * 60 * 1000;
const BATCH_SIZE = 5;

type Reel = {
  id: string;
  user_id: string;
  title: string;
  video_path: string;
  attempts: number;
};

async function callLovableAI(prompt: string, apiKey: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            'You are a social media expert generating catchy sports highlight reel metadata. Respond ONLY with JSON: {"title":"...","caption":"...","hashtags":["..."]}. Title max 60 chars, caption max 200 chars, 3-5 hashtags.',
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    throw new Error(`AI gateway ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI gateway returned no content");
  const parsed = JSON.parse(content);
  return {
    title: String(parsed.title ?? "").slice(0, 120),
    caption: String(parsed.caption ?? "").slice(0, 500),
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags.map((h: unknown) => String(h)).slice(0, 8)
      : [],
  };
}

async function processReel(
  reel: Reel,
  supabaseAdmin: any,
  apiKey: string,
): Promise<{ id: string; status: "completed" | "failed"; error?: string }> {
  try {
    await supabaseAdmin
      .from("highlight_reels")
      .update({
        attempts: reel.attempts + 1,
        processing_started_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", reel.id);

    const ai = await callLovableAI(
      `Original filename/title: "${reel.title}". Generate engaging title, caption, and hashtags for this sports highlight clip.`,
      apiKey,
    );

    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: "completed",
        ai_title: ai.title,
        ai_caption: ai.caption,
        ai_hashtags: ai.hashtags,
        completed_at: new Date().toISOString(),
        error_message: null,
        failed_at: null,
      })
      .eq("id", reel.id);

    return { id: reel.id, status: "completed" };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const finalFail = reel.attempts + 1 >= MAX_ATTEMPTS;
    await supabaseAdmin
      .from("highlight_reels")
      .update({
        status: finalFail ? "failed" : "processing",
        error_message: msg,
        failed_at: finalFail ? new Date().toISOString() : null,
      })
      .eq("id", reel.id);
    return { id: reel.id, status: finalFail ? "failed" : "failed", error: msg };
  }
}

export const Route = createFileRoute("/api/public/reels/process")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Pick fresh processing reels OR reels stuck > STUCK_AFTER_MS
        const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
        const { data: reels, error } = await supabaseAdmin
          .from("highlight_reels")
          .select("id,user_id,title,video_path,attempts")
          .eq("status", "processing")
          .lt("attempts", MAX_ATTEMPTS)
          .or(`processing_started_at.is.null,processing_started_at.lt.${stuckBefore}`)
          .order("created_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results = [];
        for (const r of (reels ?? []) as Reel[]) {
          results.push(await processReel(r, supabaseAdmin, apiKey));
        }

        return new Response(
          JSON.stringify({ processed: results.length, results }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
