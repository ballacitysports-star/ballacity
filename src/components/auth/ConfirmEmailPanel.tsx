import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";

/** Seconds before the confirmation email can be sent again. */
export const RESEND_COOLDOWN_S = 30;

/**
 * Shown after sign-up when the account exists but still needs its email
 * confirmed. A toast alone vanishes and leaves nobody knowing where to go next;
 * this stays until they act, says which address was used, and lets them resend
 * or start over with a different one.
 */
export function ConfirmEmailPanel({
  email,
  onResend,
  onChangeEmail,
}: {
  email: string;
  /** Resolves to an error message when the email could not be sent. */
  onResend: () => Promise<string | null>;
  onChangeEmail: () => void;
}) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (sending || cooldown > 0) return;
    setSending(true);
    setStatus(null);
    const error = await onResend();
    setSending(false);
    if (error) {
      setStatus({ kind: "error", text: error });
      return;
    }
    setStatus({ kind: "ok", text: `Sent again to ${email}.` });
    setCooldown(RESEND_COOLDOWN_S);
  };

  return (
    <section
      aria-labelledby="confirm-email-title"
      className="space-y-4 rounded-2xl border border-border bg-surface p-5 text-center"
    >
      <MailCheck className="mx-auto h-8 w-8 text-primary" aria-hidden />
      <div>
        <h2 id="confirm-email-title" className="font-display text-lg font-bold">
          Check your inbox
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="font-semibold text-foreground">{email}</span>. Open it on this device or
          any other to finish creating your account.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing there? Check spam or promotions, or send it again.
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={sending || cooldown > 0}
          className="w-full rounded-full border border-border bg-background px-4 py-3 text-sm font-bold disabled:opacity-50"
        >
          {sending ? "Sending…" : cooldown > 0 ? `Send it again in ${cooldown}s` : "Send it again"}
        </button>
        <button
          type="button"
          onClick={onChangeEmail}
          className="w-full py-2 text-xs text-muted-foreground underline"
        >
          Wrong address? Use a different email
        </button>
      </div>

      <p
        role={status?.kind === "error" ? "alert" : "status"}
        aria-live="polite"
        className={`text-xs ${status?.kind === "error" ? "font-semibold text-destructive" : "text-muted-foreground"}`}
      >
        {status?.text ?? ""}
      </p>
    </section>
  );
}
