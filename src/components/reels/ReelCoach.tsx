import { useRef, useState } from "react";
import { Bot, Check, Copy, Hash, Loader2, Send, Sparkles, Type, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { askReelCoach, applyReelCopy, buildReelPackage } from "@/lib/reels.functions";

type Msg = { role: "user" | "assistant"; content: string };

type Overlay = { at: string; text: string };
type Package = {
  sport: string | null;
  caption: string;
  captions: string[];
  overlays: Overlay[];
  hashtags: string[];
};

const QUICK_PROMPTS = [
  "Write a punchier caption",
  "Tighten the cut and apply it",
  "Coach my technique",
  "Which moment should be the thumbnail?",
  "How should I film this better?",
];

const TONES = ["Hype", "Recruiting", "Funny", "Humble"] as const;

/**
 * Conversational sports agent for a single reel. Grounded server-side in the
 * AI analysis of that clip, so answers reference what the footage shows.
 */
export function ReelCoach({ reelId }: { reelId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pkg, setPkg] = useState<Package | null>(null);
  const [packing, setPacking] = useState(false);
  const [tone, setTone] = useState<string | undefined>(undefined);
  const [applied, setApplied] = useState(false);
  const [captionIdx, setCaptionIdx] = useState(0);
  const inFlight = useRef(false);

  const captionOptions = pkg
    ? (pkg.captions?.length ? pkg.captions : [pkg.caption]).filter(Boolean)
    : [];
  const selectedCaption =
    captionOptions[Math.min(captionIdx, Math.max(captionOptions.length - 1, 0))] ?? "";

  async function send(question: string) {
    const q = question.trim();
    if (!q || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setInput("");
    const history = messages.slice(-8);
    setMessages((m) => [...m, { role: "user", content: q }]);
    try {
      const res = await askReelCoach({ data: { reelId, question: q, history } });
      setMessages((m) => [...m, { role: "assistant", content: res.answer }]);
      // The agent can apply copy, overlays, or a new cut list itself.
      if (res.actions?.length) toast.success(res.actions.join(" · "));
    } catch (e: any) {
      toast.error(e?.message ?? "Reel Coach is unavailable right now");
      setMessages((m) => m.slice(0, -1));
      setInput(q);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function applyAsCaption(text: string) {
    try {
      await applyReelCopy({ data: { reelId, caption: text } });
      toast.success("Caption updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the caption");
    }
  }

  /** One call that returns caption + on-screen text moments + hashtags. */
  async function makePackage(tone?: string) {
    if (packing) return;
    setPacking(true);
    setTone(tone);
    try {
      const res = await buildReelPackage({ data: { reelId, tone } });
      setPkg(res as Package);
      setApplied(false);
      setCaptionIdx(0);
    } catch (e: any) {
      toast.error(e?.message ?? "Reel Coach could not build the package");
    } finally {
      setPacking(false);
    }
  }

  async function applyPackage() {
    if (!pkg) return;
    try {
      await applyReelCopy({
        data: {
          reelId,
          caption: selectedCaption || undefined,
          hashtags: pkg.hashtags,
          overlays: pkg.overlays,
        },
      });
      setApplied(true);
      toast.success("Caption, hashtags and text moments saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the package");
    }
  }

  async function copyPackage() {
    if (!pkg) return;
    const text = [
      selectedCaption,
      "",
      ...pkg.overlays.map((o) => `${o.at} — ${o.text}`),
      "",
      pkg.hashtags.map((h) => `#${h}`).join(" "),
    ]
      .join("\n")
      .trim();
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied — paste it straight into your post");
    } catch {
      toast.error("Could not copy — select the text instead");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-lime">
        <Bot className="h-3.5 w-3.5" /> Reel Coach
      </p>
      {messages.length === 0 && !pkg && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Ask for a better caption, hashtags, or filming tips — or let the coach build the whole
          post for you.
        </p>
      )}

      {/* Post builder: caption + on-screen text moments + sport hashtags. */}
      <div className="mt-2 rounded-lg border border-border/70 p-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => makePackage()}
            disabled={packing}
            className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 py-1 text-[10px] font-semibold text-black disabled:opacity-50"
          >
            {packing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {pkg ? "Regenerate post" : "Build my post"}
          </button>
          {TONES.map((t) => (
            <button
              key={t}
              onClick={() => makePackage(t)}
              disabled={packing}
              className={`rounded-full border px-2 py-1 text-[10px] disabled:opacity-50 ${
                tone === t ? "border-lime text-lime" : "border-border text-muted-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {packing && !pkg && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Watching the clip and writing your caption…
          </p>
        )}

        {pkg && (
          <div className="mt-2.5 space-y-2.5">
            {pkg.sport && (
              <p className="micro-label text-muted-foreground">
                Tailored for {pkg.sport}
              </p>
            )}

            {captionOptions.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground">
                  Captions — pick one
                </p>
                <div className="mt-1 space-y-1.5">
                  {captionOptions.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setCaptionIdx(i);
                        setApplied(false);
                      }}
                      className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                        i === captionIdx
                          ? "border-lime bg-lime/10"
                          : "border-border hover:border-lime/50"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                          i === captionIdx ? "border-lime bg-lime text-black" : "border-border"
                        }`}
                      >
                        {i === captionIdx && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap break-words">{c}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {pkg.overlays.length > 0 && (
              <div>
                <p className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                  <Type className="h-3 w-3" /> On-screen text moments
                </p>
                <ul className="mt-1 space-y-1">
                  {pkg.overlays.map((o, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="shrink-0 rounded bg-lime/15 px-1.5 py-0.5 text-[10px] font-semibold text-lime">
                        {o.at || `#${i + 1}`}
                      </span>
                      <span className="min-w-0 break-words">{o.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {pkg.hashtags.length > 0 && (
              <div>
                <p className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                  <Hash className="h-3 w-3" /> Hashtags
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pkg.hashtags.map((h) => (
                    <span
                      key={h}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      #{h}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={applyPackage}
                className="inline-flex items-center gap-1 rounded-full border border-lime px-2.5 py-1 text-[10px] font-semibold text-lime"
              >
                {applied ? <Check className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                {applied ? "Saved to this reel" : "Use this post"}
              </button>
              <button
                onClick={copyPackage}
                className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground"
              >
                <Copy className="h-3 w-3" /> Copy all
              </button>
            </div>
          </div>
        )}
      </div>

      {messages.length > 0 && (
        <ul className="mt-2 space-y-2">
          {messages.map((m, i) => (
            <li
              key={i}
              className={
                m.role === "user"
                  ? "ml-auto max-w-[85%] rounded-lg bg-lime/15 px-2.5 py-1.5 text-xs"
                  : "max-w-[92%] rounded-lg border border-border px-2.5 py-1.5 text-xs"
              }
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.role === "assistant" && (
                <button
                  onClick={() => applyAsCaption(m.content)}
                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-lime underline"
                >
                  <Sparkles className="h-3 w-3" /> Use as caption
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => send(p)}
            disabled={busy}
            className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-2 flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Reel Coach…"
          className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label="Send to Reel Coach"
          className="rounded-lg bg-lime p-1.5 text-black disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
        </button>
      </form>
    </div>
  );
}
