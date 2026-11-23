import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  firstNameOf,
  handoverErrorMessage,
  looksLikeEmail,
  HANDOVER_DAYS,
  type ManagedHandoverInfo,
} from "@/lib/managed-handover";
import {
  useCancelManagedHandover,
  useManagedHandovers,
  useStartManagedHandover,
} from "@/lib/use-managed-handover";

type Step = "idle" | "form" | "confirm";

/**
 * Parent Center: hand a managed account over to the adult it belongs to. Shown only for a managed account whose person
 * is 18 or over (the database says so: guardian_managed_handovers), and not at all if the handover is not available yet.
 *
 * A guardian-started, adult-completed flow in three short steps: the adult's own address, a confirmation that says what
 * will and will not change, and the wait. Nothing about the account changes until the adult opens the emailed link and
 * confirms, so the card says so at every step.
 */
export function ManagedHandoverCard({ childUserId }: { childUserId: string }) {
  const handovers = useManagedHandovers();
  const info = (handovers.data ?? []).find((h) => h.childUserId === childUserId) ?? null;
  if (!info || (!info.isAdult && !info.pending)) return null;
  return <HandoverBody info={info} />;
}

function HandoverBody({ info }: { info: ManagedHandoverInfo }) {
  const first = firstNameOf(info.displayName);
  const start = useStartManagedHandover();
  const cancel = useCancelManagedHandover();
  const [step, setStep] = useState<Step>("idle");
  const [email, setEmail] = useState("");
  const [own, setOwn] = useState(false);
  const cleaned = email.trim();

  const send = () => {
    start.mutate(
      { childUserId: info.childUserId, email: cleaned },
      {
        onSuccess: (r) => {
          setStep("idle");
          setEmail("");
          setOwn(false);
          toast.success(
            `We emailed ${r.emailMasked || "them"}. Nothing changes until ${first} finishes.`,
          );
        },
        onError: (e) =>
          toast.error(handoverErrorMessage(e, "Couldn't start the handover. Please try again.")),
      },
    );
  };

  const undo = () => {
    cancel.mutate(
      { childUserId: info.childUserId },
      {
        onSuccess: () => toast.success("Handover cancelled. Nothing changed."),
        onError: (e) =>
          toast.error(handoverErrorMessage(e, "Couldn't cancel the handover. Please try again.")),
      },
    );
  };

  return (
    <section
      className="rounded-xl border border-border bg-background p-3 text-xs"
      aria-labelledby={`handover-title-${info.childUserId}`}
      data-testid="managed-handover"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h3 id={`handover-title-${info.childUserId}`} className="text-sm font-bold">
          {info.pending ? `Waiting for ${first}` : `Hand over ${first}'s account`}
        </h3>
      </div>

      {info.pending ? (
        <div className="mt-2 space-y-2" role="status">
          <p className="text-muted-foreground">
            We emailed {info.emailMasked ?? "their address"}. The link works once
            {info.expiresAt ? ` and expires ${new Date(info.expiresAt).toLocaleDateString()}` : ""}.
            Until {first} finishes it, nothing has changed: you still manage the account as usual.
          </p>
          <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={undo}>
            {cancel.isPending ? "Cancelling…" : "Cancel handover"}
          </Button>
        </div>
      ) : step === "idle" ? (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">
            {first} is 18 or over. This account has no sign-in of its own, so you are the only way
            in. When {first} is ready, you can hand it over: they get an email at their own address,
            choose a password, and the account becomes theirs.
          </p>
          <Button size="sm" onClick={() => setStep("form")}>
            Start handover
          </Button>
        </div>
      ) : step === "form" ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (looksLikeEmail(cleaned)) setStep("confirm");
          }}
        >
          <label
            className="block font-semibold text-muted-foreground"
            htmlFor={`handover-email-${info.childUserId}`}
          >
            {first}&apos;s own email address
          </label>
          <input
            id={`handover-email-${info.childUserId}`}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
          />
          <p className="text-muted-foreground">
            Use an address only {first} can open. It can&apos;t be yours or one that already has a
            BallaCity account.
          </p>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!looksLikeEmail(cleaned)}>
              Continue
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={() => setStep("idle")}>
              Back
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 space-y-2">
          <p>
            We&apos;ll email <span className="font-semibold">{cleaned}</span>. Nothing changes until{" "}
            {first} opens the link and confirms it&apos;s them. The link works once and expires in{" "}
            {HANDOVER_DAYS} days, and you can cancel any time before then.
          </p>
          <p className="text-muted-foreground">
            Once {first} finishes: the account is theirs and they sign in on their own. Your family
            link ends, so it leaves your Parent Center and you can no longer see or change its
            settings. Their games, teams and videos stay with them.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={own}
              onChange={(e) => setOwn(e.target.checked)}
              className="mt-0.5"
            />
            <span>This is {first}&apos;s own email address, not mine.</span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" disabled={!own || start.isPending} onClick={send}>
              {start.isPending ? "Sending…" : "Send the email"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={start.isPending}
              onClick={() => setStep("form")}
            >
              Back
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
