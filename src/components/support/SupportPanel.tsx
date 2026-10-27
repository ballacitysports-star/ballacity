import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, Mail, Send, ShieldAlert, Sparkles } from "lucide-react";
import { askSupportAssistant } from "@/lib/support/support.functions";
import {
  SUPPORT_TOPICS,
  getSupportTopic,
  resolveSupportLinks,
  type SupportLink,
} from "@/lib/support/knowledge";
import {
  appendSupportMessage,
  clearSupportConversation,
  newSupportMessageId,
  setSupportTopic,
  useSupportState,
  type SupportMessage,
} from "@/lib/support/support-store";
import {
  SUPPORT_MAX_HISTORY,
  SUPPORT_MAX_MESSAGE,
  draftTicket,
  type TicketCategory,
} from "@/lib/support/triage";
import { EMERGENCY_NOTICE } from "@/lib/safety";
import { SUPPORT_EMAIL } from "@/lib/trust";

const chip =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-background";

function LinkRow({ links, onNavigate }: { links: SupportLink[]; onNavigate?: () => void }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {links.map((l) => (
        <Link key={l.key} to={l.to as never} onClick={onNavigate} className={chip}>
          {l.label}
        </Link>
      ))}
    </div>
  );
}

function EscalationCard({
  category,
  description,
  email,
}: {
  category: TicketCategory;
  description: string;
  email: string | null;
}) {
  const ticket = draftTicket({ category, description, accountEmail: email });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `To: ${SUPPORT_EMAIL}\nSubject: ${ticket.subject}\n\n${ticket.body}`,
      );
      toast.success("Copied. Paste it into an email to support.");
    } catch {
      toast.error(`Couldn't copy. Email ${SUPPORT_EMAIL} instead.`);
    }
  };
  return (
    <div
      className="mt-2 rounded-2xl border border-lime/30 bg-lime/5 p-3"
      data-testid="support-escalation"
    >
      <p className="text-xs font-bold">A person should look at this</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        I've drafted an email to support. Check it, add anything missing, and send it from your own
        mail app.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <a href={ticket.mailto} className={`${chip} border-lime/40 text-lime`}>
          <Mail className="h-3.5 w-3.5" aria-hidden /> Email support
        </a>
        <button type="button" onClick={copy} className={chip}>
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copy details
        </button>
      </div>
    </div>
  );
}

function Bubble({
  message,
  previousUserText,
  email,
  onNavigate,
}: {
  message: SupportMessage;
  previousUserText: string;
  email: string | null;
  onNavigate?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-lime px-3.5 py-2.5 text-[13px] leading-relaxed text-primary-foreground">
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%]">
        <p className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-border bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed">
          {message.text}
        </p>
        <LinkRow links={message.links ?? []} onNavigate={onNavigate} />
        {message.escalation ? (
          <EscalationCard
            category={message.escalation}
            description={previousUserText}
            email={email}
          />
        ) : null}
      </div>
    </div>
  );
}

export function SupportPanel({
  signedIn,
  email = null,
  onNavigate,
}: {
  signedIn: boolean;
  email?: string | null;
  onNavigate?: () => void;
}) {
  const ask = useServerFn(askSupportAssistant);
  const { messages, topicId } = useSupportState();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const topic = topicId ? getSupportTopic(topicId) : undefined;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages.length, pending, topicId]);

  const send = async (raw: string) => {
    const text = raw.trim().slice(0, SUPPORT_MAX_MESSAGE);
    if (!text || pending || !signedIn) return;
    const history = messages
      .slice(-SUPPORT_MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.text }));
    setError(null);
    setDraft("");
    setSupportTopic(null);
    appendSupportMessage({ id: newSupportMessageId(), role: "user", text });
    setPending(true);
    try {
      const reply = await ask({ data: { message: text, history } });
      appendSupportMessage({
        id: newSupportMessageId(),
        role: "assistant",
        text: reply.answer,
        links: reply.links,
        escalation: reply.escalation,
        source: reply.source,
      });
    } catch (e) {
      setError(
        e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.",
      );
    } finally {
      setPending(false);
    }
  };

  const nearLimit = draft.length > SUPPORT_MAX_MESSAGE - 100;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2">
        {topic ? (
          <section
            className="rounded-2xl border border-border bg-surface p-4"
            aria-label={topic.title}
          >
            <button
              type="button"
              onClick={() => setSupportTopic(null)}
              className="mb-2 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All topics
            </button>
            <h3 className="font-display text-sm font-bold">{topic.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {topic.summary}
            </p>
            <ul className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {topic.points.map((p) => (
                <li key={p} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-lime" />
                  {p}
                </li>
              ))}
            </ul>
            <LinkRow links={resolveSupportLinks(topic.links)} onNavigate={onNavigate} />
          </section>
        ) : (
          <>
            {messages.length === 0 ? (
              <div className="rounded-2xl border border-border bg-surface p-4">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Sparkles className="h-4 w-4 text-lime" aria-hidden /> Hi, I'm BallaCity Help
                </p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {signedIn
                    ? "I'm an AI assistant. I answer from BallaCity's written help and can be wrong. I can't see your account, payments or anyone else's profile, and I can't take actions for you."
                    : "Pick a topic below for quick answers. Sign in to ask the assistant a question."}
                </p>
                {!signedIn ? (
                  <Link
                    to={"/auth" as never}
                    onClick={onNavigate}
                    className="mt-3 inline-flex min-h-10 items-center rounded-full bg-lime px-4 py-2 text-xs font-bold text-primary-foreground"
                  >
                    Sign in
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Conversation"
              className="mt-3 space-y-3"
            >
              {messages.map((m, i) => (
                <Bubble
                  key={m.id}
                  message={m}
                  previousUserText={
                    [...messages.slice(0, i)].reverse().find((x) => x.role === "user")?.text ?? ""
                  }
                  email={email}
                  onNavigate={onNavigate}
                />
              ))}
              {pending ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Thinking…
                </p>
              ) : null}
            </div>

            {error ? (
              <div
                role="alert"
                className="mt-3 rounded-2xl border border-coral/40 bg-coral/10 px-3 py-2.5 text-xs leading-relaxed"
              >
                {error} You can still browse the quick answers below, or email{" "}
                <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
                .
              </div>
            ) : null}

            <div className="mt-4">
              <h3 className="section-eyebrow text-muted-foreground">Quick answers</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SUPPORT_TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSupportTopic(t.id)}
                    className={chip}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border bg-background px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        {signedIn ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor="support-input" className="sr-only">
              Ask BallaCity Help a question
            </label>
            <textarea
              id="support-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              maxLength={SUPPORT_MAX_MESSAGE}
              placeholder="Ask about games, payments, teams or kids' accounts"
              className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none focus:border-lime"
            />
            <button
              type="submit"
              disabled={pending || draft.trim().length === 0}
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime text-primary-foreground disabled:opacity-40"
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>
        ) : null}
        {nearLimit ? (
          <p className="mt-1 text-right text-[10px] text-muted-foreground">
            {draft.length} / {SUPPORT_MAX_MESSAGE}
          </p>
        ) : null}
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-coral" aria-hidden />
          <span>
            {EMERGENCY_NOTICE} Need a person? Email{" "}
            <a className="font-semibold underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            .
            {messages.length > 0 ? (
              <>
                {" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    clearSupportConversation();
                    setError(null);
                  }}
                >
                  Clear chat
                </button>
              </>
            ) : null}
          </span>
        </p>
      </div>
    </div>
  );
}
