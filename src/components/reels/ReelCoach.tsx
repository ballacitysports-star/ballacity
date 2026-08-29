import { useRef, useState } from "react";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { askReelCoach, applyReelCopy } from "@/lib/reels.functions";

type Msg = { role: "user" | "assistant"; content: string };

const QUICK_PROMPTS = [
  "Write a punchier caption",
  "Recruiting-style caption",
  "Which moment should be the thumbnail?",
  "How should I film this better?",
];

/**
 * Conversational sports agent for a single reel. Grounded server-side in the
 * AI analysis of that clip, so answers reference what the footage shows.
 */
export function ReelCoach({ reelId }: { reelId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

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
    } catch (e: any) {
      toast.error(e?.message ?? "Reel Coach is unavailable right now");
      setMessages((m) => m.slice(0, -1));
      setInput(q);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function useAsCaption(text: string) {
    try {
      await applyReelCopy({ data: { reelId, caption: text } });
      toast.success("Caption updated");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update the caption");
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-background/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-lime">
        <Bot className="h-3.5 w-3.5" /> Reel Coach
      </p>
      {messages.length === 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Ask for a better caption, hashtags, or filming tips for this clip.
        </p>
      )}

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
                  onClick={() => useAsCaption(m.content)}
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
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </form>
    </div>
  );
}
