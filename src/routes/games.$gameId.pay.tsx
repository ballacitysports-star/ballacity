import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Upload, ShieldCheck, Clock, X, Check, CircleDashed, AlertCircle, RotateCw, Film, Image as ImageIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { GAMES } from "@/lib/sample-data";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  type GamePaymentSettings,
  type PaymentMethod,
  type PaymentSubmission,
  type JoinRequest,
  paymentTypeMeta,
  getGamePaymentSettings,
  listPaymentMethodsForHost,
  uploadProofScreenshot,
  createPaymentSubmission,
  listMySubmissionsForGame,
  getMyJoinRequest,
} from "@/lib/payments";
import { LegalNotice } from "@/components/LegalNotice";
import { joinGame } from "@/lib/games-store";
import { z } from "zod";

// Local YYYY-MM-DD for a Date, avoiding UTC shift from toISOString().
function toLocalDateInputValue(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const proofSchema = z.object({
  paidAmount: z
    .string()
    .trim()
    .nonempty({ message: "Enter the amount you paid." })
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
      message: "Use a number like 15 or 15.00.",
    })
    .refine((v) => Number(v) > 0, { message: "Amount must be greater than 0." })
    .refine((v) => Number(v) <= 100000, { message: "Amount looks too large." }),
  paidAt: z
    .string()
    .nonempty({ message: "Pick the date you paid." })
    .refine((v) => !Number.isNaN(new Date(v).getTime()), {
      message: "Invalid date.",
    })
    .refine((v) => new Date(v) <= new Date(new Date().setHours(23, 59, 59, 999)), {
      message: "Payment date can't be in the future.",
    }),
  transactionRef: z
    .string()
    .trim()
    .max(120, { message: "Transaction ID must be under 120 characters." })
    .optional(),
  notes: z.string().trim().max(500, { message: "Notes must be under 500 characters." }).optional(),
});

export const Route = createFileRoute("/games/$gameId/pay")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: { invite?: true; from?: string } = {};
    if (search.invite === "1" || search.invite === 1 || search.invite === true) out.invite = true;
    if (typeof search.from === "string" && search.from.length > 0) out.from = search.from;
    return out;
  },
  loader: ({ params }) => {
    const game = GAMES.find((g) => g.id === params.gameId);
    if (!game) throw notFound();
    return { game };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Pay for ${loaderData?.game.title ?? "game"} — OpenRun` }],
  }),
  notFoundComponent: () => <div className="p-6 text-center text-sm">Game not found.</div>,
  errorComponent: ({ reset }) => (
    <div className="p-6 text-center">
      <button onClick={reset} className="text-lime font-bold">
        Try again
      </button>
    </div>
  ),
  component: PayPage,
});

function PayPage() {
  const { game } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [settings, setSettings] = useState<GamePaymentSettings | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [picked, setPicked] = useState<PaymentMethod | null>(null);
  const [mySubs, setMySubs] = useState<PaymentSubmission[]>([]);
  const [myReq, setMyReq] = useState<JoinRequest | null>(null);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [loading, user, nav]);

  const refreshJoinRequest = useCallback(async () => {
    if (!user) return;
    try {
      const req = await getMyJoinRequest(game.id);
      setMyReq((prev) => {
        // Toast on approval transition (pending/rejected/none → approved).
        if (req?.status === "approved" && prev?.status !== "approved") {
          toast.success("You're approved! You can pay now.");
        }
        return req;
      });
    } catch {
      /* ignore polling errors */
    }
  }, [game.id, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getGamePaymentSettings(game.id);
        if (cancelled) return;
        setSettings(s);
        if (s) {
          const all = await listPaymentMethodsForHost(s.host_id);
          if (cancelled) return;
          // Show every enabled method the host offers so players can pick any,
          // including ones with direct payment URLs.
          setMethods(all);
        }
        if (user) {
          const [subs, req] = await Promise.all([
            listMySubmissionsForGame(game.id),
            getMyJoinRequest(game.id),
          ]);
          if (cancelled) return;
          setMySubs(subs);
          setMyReq(req);
        }
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [game.id, user]);

  // Live-update the join-request status so the approval gate flips to the
  // payment picker the moment the host approves. Realtime is primary;
  // a slow poll and refetch-on-focus cover any dropped websocket frames.
  const refreshRef = useRef(refreshJoinRequest);
  useEffect(() => {
    refreshRef.current = refreshJoinRequest;
  }, [refreshJoinRequest]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`pay-join-req:${game.id}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "join_requests",
          filter: `player_id=eq.${user.id}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as JoinRequest | undefined;
          if (row?.game_id === game.id) refreshRef.current();
        },
      )
      .subscribe();

    const poll = window.setInterval(() => refreshRef.current(), 15_000);
    const onFocus = () => refreshRef.current();
    window.addEventListener("focus", onFocus);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [game.id, user]);

  // Live-update payment submissions so the status timeline reflects host
  // review (verified/rejected) in real time. Realtime primary, poll fallback.
  const refreshSubs = useCallback(async () => {
    if (!user) return;
    try {
      const subs = await listMySubmissionsForGame(game.id);
      setMySubs((prev) => {
        const prevLatest = prev[0];
        const nextLatest = subs[0];
        if (
          nextLatest &&
          prevLatest &&
          nextLatest.id === prevLatest.id &&
          nextLatest.status !== prevLatest.status
        ) {
          if (nextLatest.status === "verified") toast.success("Payment verified by host!");
          if (nextLatest.status === "rejected") toast.error("Host rejected your payment — try again.");
        }
        return subs;
      });
    } catch {
      /* ignore polling errors */
    }
  }, [game.id, user]);

  const refreshSubsRef = useRef(refreshSubs);
  useEffect(() => {
    refreshSubsRef.current = refreshSubs;
  }, [refreshSubs]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`pay-subs:${game.id}:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_submissions",
          filter: `player_id=eq.${user.id}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as PaymentSubmission | undefined;
          if (row?.game_id === game.id) refreshSubsRef.current();
        },
      )
      .subscribe();

    const poll = window.setInterval(() => refreshSubsRef.current(), 15_000);
    const onFocus = () => refreshSubsRef.current();
    window.addEventListener("focus", onFocus);
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshSubsRef.current();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [game.id, user]);

  if (loading || fetching) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;

  const fee = settings?.entry_fee ?? game.price;
  const requiresApproval = !!settings?.requires_approval;
  const isApproved = myReq?.status === "approved";
  const approvalGateActive = requiresApproval && !isApproved;

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="font-display text-xl font-bold leading-tight">{game.title}</h1>
          <div className="text-xs text-muted-foreground">{game.location}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-lime/30 bg-lime/5 p-5 mb-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Game fee</div>
        <div className="font-display text-4xl font-bold text-lime mt-1">
          ${Number(fee).toFixed(2)}
        </div>
        {settings?.payment_deadline && (
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-coral">
            <Clock className="h-3 w-3" /> Pay by{" "}
            {new Date(settings.payment_deadline).toLocaleString()}
          </div>
        )}
      </div>

      {mySubs.length > 0 && <PaymentStatusTimeline latest={mySubs[0]} history={mySubs.slice(1)} />}

      {requiresApproval && (myReq?.status === "pending" || myReq?.status === "approved") && (
        <div
          data-testid="approval-status-indicator"
          data-status={myReq.status}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={`mb-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${
            myReq.status === "approved"
              ? "border-lime/40 bg-lime/10 text-lime"
              : "border-coral/40 bg-coral/10 text-coral"
          }`}
        >
          {myReq.status === "approved" ? (
            <>
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Approved — you can pay now</span>
            </>
          ) : (
            <>
              <Clock className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
              <span>Approval pending — waiting on host</span>
            </>
          )}
        </div>
      )}

      {approvalGateActive ? (
        <div
          className="rounded-2xl border border-coral/40 bg-coral/10 p-5"
          role="status"
          aria-live="polite"
          data-testid="approval-required-gate"
        >
          <div className="flex items-center gap-2 font-display text-sm font-bold">
            <Clock className="h-4 w-4 text-coral" /> Waiting on host approval
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {myReq?.status === "pending"
              ? "Your request to join is pending. Payment unlocks after the host approves you."
              : myReq?.status === "rejected"
                ? "The host declined your request. You can't submit payment for this game."
                : "This host reviews every player before payment. Send a request to join first."}
          </p>
          <Link
            to="/games/$gameId"
            params={{ gameId: game.id }}
            className="mt-3 inline-flex items-center rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground"
          >
            {myReq ? "Back to game" : "Request to join"}
          </Link>
        </div>
      ) : !settings || methods.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center">
          <div className="font-semibold text-sm">Host hasn't configured payment yet</div>
          <p className="text-xs text-muted-foreground mt-1">
            Reach out to the host directly to arrange payment.
          </p>
        </div>
      ) : !picked ? (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
            Pay host using
          </h2>
          <div className="space-y-2">
            {methods.map((m) => {
              const meta = paymentTypeMeta(m.payment_type);
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40"
                >
                  <button
                    onClick={() => setPicked(m)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-lg">
                      {meta.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{m.label || meta.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {m.username || m.contact_info}
                      </div>
                    </div>
                  </button>
                  {m.payment_url ? (
                    <a
                      href={m.payment_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => setPicked(m)}
                      className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-3 py-1.5 text-xs font-bold text-primary-foreground"
                      title={`Open ${meta.name} in a new tab`}
                      aria-label={`Open ${meta.name} in a new tab to pay`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> Open {meta.name}
                    </a>
                  ) : (
                    <button
                      onClick={() => setPicked(m)}
                      className="text-lime text-sm"
                      aria-label="Select payment method"
                    >
                      →
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <PaymentInstructionsAndProof
          game_id={game.id}
          host_id={settings.host_id}
          method={picked}
          extraInstructions={settings.payment_instructions}
          onCancel={() => setPicked(null)}
          onSubmitted={async () => {
            joinGame(game.id);
            const subs = await listMySubmissionsForGame(game.id);
            setMySubs(subs);
            setPicked(null);
          }}
        />
      )}

      {settings?.refund_policy && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-3 text-xs">
          <div className="font-semibold mb-1">Refund policy</div>
          <p className="text-muted-foreground">{settings.refund_policy}</p>
        </div>
      )}

      <div className="mt-5">
        <LegalNotice />
      </div>
    </div>
  );
}

function PaymentStatusTimeline({
  latest,
  history,
}: {
  latest: PaymentSubmission;
  history: PaymentSubmission[];
}) {
  const isRejected = latest.status === "rejected";
  const isVerified = latest.status === "verified";
  const isPending = latest.status === "pending";

  // Three canonical steps; the third splits into verified vs rejected.
  type StepState = "done" | "current" | "upcoming" | "failed";
  const steps: { key: string; label: string; hint: string; state: StepState; at?: string | null }[] =
    [
      {
        key: "submitted",
        label: "Proof submitted",
        hint: "You sent payment details to the host.",
        state: "done",
        at: latest.submitted_at,
      },
      {
        key: "review",
        label: "Host reviewing",
        hint: isPending
          ? "Waiting on the host to confirm your payment."
          : "Host reviewed your submission.",
        state: isPending ? "current" : "done",
        at: isPending ? null : latest.reviewed_at,
      },
      isRejected
        ? {
            key: "rejected",
            label: "Rejected — try again",
            hint: latest.reviewer_notes || "Host couldn't verify this payment.",
            state: "failed",
            at: latest.reviewed_at,
          }
        : {
            key: "verified",
            label: "Payment verified",
            hint: isVerified
              ? latest.reviewer_notes || "You're all set — see you at the game."
              : "You'll be confirmed once the host verifies.",
            state: isVerified ? "done" : "upcoming",
            at: isVerified ? latest.reviewed_at : null,
          },
    ];

  return (
    <div
      className="mb-4 rounded-2xl border border-border bg-surface p-4"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="payment-status-timeline"
      data-status={latest.status}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Payment status
        </h3>
        <span
          className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 border ${
            isVerified
              ? "border-lime/40 bg-lime/10 text-lime"
              : isRejected
                ? "border-coral/40 bg-coral/10 text-coral"
                : "border-border bg-background text-muted-foreground"
          }`}
        >
          {isVerified ? "Verified" : isRejected ? "Rejected" : "Pending"}
        </span>
      </div>

      <ol className="space-y-3">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={s.key} className="relative flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`grid h-6 w-6 place-items-center rounded-full border ${
                    s.state === "done"
                      ? "border-lime/50 bg-lime/15 text-lime"
                      : s.state === "current"
                        ? "border-coral/50 bg-coral/10 text-coral"
                        : s.state === "failed"
                          ? "border-coral/60 bg-coral/15 text-coral"
                          : "border-border bg-background text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  {s.state === "done" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : s.state === "current" ? (
                    <Clock className="h-3.5 w-3.5 animate-pulse" />
                  ) : s.state === "failed" ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5" />
                  )}
                </span>
                {!isLast && (
                  <span
                    className={`w-px flex-1 mt-1 ${
                      s.state === "done" ? "bg-lime/40" : "bg-border"
                    }`}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="flex-1 pb-1 -mt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <div
                    className={`text-sm font-semibold ${
                      s.state === "failed"
                        ? "text-coral"
                        : s.state === "upcoming"
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }`}
                  >
                    {s.label}
                  </div>
                  {s.at && (
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {new Date(s.at).toLocaleString()}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{s.hint}</p>
              </div>
            </li>
          );
        })}
      </ol>

      {history.length > 0 && (
        <details className="mt-3 rounded-xl border border-border/70 bg-background/60 p-2 text-xs">
          <summary className="cursor-pointer font-semibold text-muted-foreground">
            Previous attempts ({history.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-2">
                <span
                  className={`font-semibold ${
                    h.status === "verified"
                      ? "text-lime"
                      : h.status === "rejected"
                        ? "text-coral"
                        : "text-muted-foreground"
                  }`}
                >
                  {h.status === "verified"
                    ? "✓ Verified"
                    : h.status === "rejected"
                      ? "✗ Rejected"
                      : "⏳ Pending"}
                </span>
                <span className="text-muted-foreground">
                  {new Date(h.submitted_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PaymentInstructionsAndProof({
  game_id,
  host_id,
  method,
  extraInstructions,
  onCancel,
  onSubmitted,
}: {
  game_id: string;
  host_id: string;
  method: PaymentMethod;
  extraInstructions: string | null;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const meta = paymentTypeMeta(method.payment_type);
  const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB
  const [file, setFile] = useState<File | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "success" | "error">(
    "idle",
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const uploadTickRef = useRef<number | null>(null);
  const [ref, setRef] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [paidAt, setPaidAt] = useState(() => toLocalDateInputValue(new Date()));
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Persist "opened" across the round-trip so a hard refresh, a webview
  // relaunch, or a mobile OS backgrounding still resumes at the proof step.
  const resumeKey = `pay-opened:${game_id}:${method.id}`;
  const [opened, setOpened] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(resumeKey) === "1";
    } catch {
      return false;
    }
  });
  const [returned, setReturned] = useState(false);
  const proofRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Scroll the proof form into view and focus the screenshot picker so the
  // user lands on the next action without hunting for it.
  const resumeAtProof = useCallback(() => {
    proofRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Delay focus until after the smooth scroll settles.
    window.setTimeout(() => {
      fileInputRef.current?.focus({ preventScroll: true });
    }, 400);
  }, []);

  const handleOpenExternal = () => {
    setOpened(true);
    try {
      window.sessionStorage.setItem(resumeKey, "1");
    } catch {
      /* storage unavailable — resume still works within this tab */
    }
    // Give the new tab a beat to open, then scroll the proof form into view
    // so the user sees the return steps as soon as they come back.
    window.setTimeout(resumeAtProof, 300);
  };

  // Auto-resume when the user comes back to this tab after paying externally.
  // Fires on tab focus, page-visibility change, and pageshow (mobile
  // back/forward cache). Guarded on `opened` so it only triggers post-tap.
  useEffect(() => {
    if (!opened) return;
    let didResume = false;
    const trigger = () => {
      if (didResume) return;
      didResume = true;
      setReturned(true);
      resumeAtProof();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") trigger();
    };
    const onPageShow = () => trigger();
    window.addEventListener("focus", trigger);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("focus", trigger);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [opened, resumeAtProof]);

  // Revoke object URL previews on unmount / replacement to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (uploadTickRef.current !== null) window.clearInterval(uploadTickRef.current);
    };
  }, [previewUrl]);

  const stopProgressTick = () => {
    if (uploadTickRef.current !== null) {
      window.clearInterval(uploadTickRef.current);
      uploadTickRef.current = null;
    }
  };

  // The Storage JS client doesn't surface XHR progress events, so we
  // animate a determinate-looking bar toward 90% while the request is in
  // flight, then snap to 100% on success. This gives clear feedback that
  // something is happening for large image/video proofs.
  const startProgressTick = () => {
    stopProgressTick();
    setUploadProgress(5);
    uploadTickRef.current = window.setInterval(() => {
      setUploadProgress((p) => (p >= 90 ? p : p + Math.max(1, (90 - p) * 0.08)));
    }, 250);
  };

  const uploadFile = useCallback(
    async (f: File) => {
      setUploadState("uploading");
      setUploadError(null);
      startProgressTick();
      try {
        const path = await uploadProofScreenshot(f);
        stopProgressTick();
        setUploadProgress(100);
        setUploadedPath(path);
        setUploadState("success");
        toast.success("Proof uploaded — ready to submit.");
      } catch (err: unknown) {
        stopProgressTick();
        setUploadProgress(0);
        setUploadedPath(null);
        setUploadState("error");
        const msg =
          err instanceof Error ? err.message : "Upload failed. Check your connection and retry.";
        setUploadError(msg);
        toast.error(`Upload failed: ${msg}`);
      }
    },
    [],
  );

  const pickFile = (f: File | null) => {
    if (!f) return;
    // Validate type + size client-side before we hit the network.
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast.error("Choose an image or video file.");
      return;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      toast.error(
        `File is too large (${(f.size / (1024 * 1024)).toFixed(1)} MB). Max is 20 MB.`,
      );
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(isImage ? URL.createObjectURL(f) : null);
    void uploadFile(f);
  };

  const retryUpload = () => {
    if (file) void uploadFile(file);
  };

  const clearProof = () => {
    stopProgressTick();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setUploadedPath(null);
    setUploadState("idle");
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };




  const submitProof = async () => {
    if (submitting) return;

    const parsed = proofSchema.safeParse({
      paidAmount,
      paidAt,
      transactionRef: ref,
      notes,
    });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      toast.error("Please fix the highlighted fields.");
      return;
    }
    setErrors({});

    // Block submit while the upload is in flight or has failed. Users can
    // retry or clear the file — but we don't quietly re-upload here.
    if (uploadState === "uploading") {
      toast.error("Wait for the upload to finish before submitting.");
      return;
    }
    if (file && uploadState === "error") {
      toast.error("Retry the upload or remove the file, then submit again.");
      return;
    }

    setSubmitting(true);
    try {
      let path: string | null = uploadedPath;
      // Fallback: user attached a file but it hasn't been uploaded (unlikely
      // in the normal flow — pickFile auto-uploads). Upload now inline.
      if (file && !path) path = await uploadProofScreenshot(file);
      // Store paid_at at local noon so a date-only value doesn't shift a day in UTC.
      const paidAtIso = new Date(`${parsed.data.paidAt}T12:00:00`).toISOString();
      await createPaymentSubmission({
        game_id,
        host_id,
        payment_method_id: method.id,
        payment_type: method.payment_type,
        screenshot_path: path,
        transaction_reference: parsed.data.transactionRef || null,
        paid_amount: Number(parsed.data.paidAmount),
        paid_at: paidAtIso,
        notes: parsed.data.notes || null,
      });
      toast.success("Submitted — host will verify shortly.");
      try {
        window.sessionStorage.removeItem(resumeKey);
      } catch {
        /* ignore */
      }
      onSubmitted();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void submitProof();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-lime/30 bg-surface p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-lg">
            {meta.emoji}
          </div>
          <div>
            <div className="font-bold text-sm">{meta.name}</div>
            <div className="text-xs text-muted-foreground">Send directly to host</div>
          </div>
          <button onClick={onCancel} className="ml-auto text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {method.username && <Field label="Send to" value={method.username} />}
        {method.contact_info && <Field label="Contact" value={method.contact_info} />}
        {method.payment_url && (
          <a
            href={method.payment_url}
            target="_blank"
            rel="noreferrer"
            onClick={handleOpenExternal}
            aria-label={`Open ${meta.name} in a new tab to pay the host`}
            className="mt-2 flex items-center justify-center gap-2 w-full rounded-xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground"
          >
            <ExternalLink className="h-4 w-4" /> Open {meta.name} to pay
          </a>
        )}
        {(method.instructions || extraInstructions) && (
          <div className="mt-3 rounded-xl bg-background p-3 text-xs text-muted-foreground space-y-1">
            {method.instructions && <p>{method.instructions}</p>}
            {extraInstructions && <p>{extraInstructions}</p>}
          </div>
        )}

        <div className="mt-3 rounded-xl border border-border bg-background p-3 text-xs">
          <div className="font-bold uppercase tracking-wider text-muted-foreground mb-2">
            How to pay
          </div>
          <ol className="list-decimal pl-4 space-y-1 text-foreground/90">
            {method.payment_url ? (
              <li>
                Tap <span className="font-semibold">Open {meta.name} to pay</span> above — it opens
                in a new tab.
              </li>
            ) : (
              <li>
                Open {meta.name} and send the fee to{" "}
                <span className="font-semibold">{method.username || method.contact_info}</span>.
              </li>
            )}
            <li>Complete the payment inside {meta.name}.</li>
            <li>Screenshot the confirmation screen.</li>
            <li>
              Come back to this tab and upload the screenshot below, then tap{" "}
              <span className="font-semibold">I have paid</span>.
            </li>
          </ol>
        </div>
      </div>

      {opened && (
        <div
          role="status"
          aria-live="assertive"
          data-testid="return-from-payment-callout"
          data-returned={returned ? "1" : "0"}
          className={`rounded-2xl border p-3 text-xs transition-colors ${
            returned
              ? "border-lime/60 bg-lime/15 shadow-[0_0_0_2px_rgba(163,230,53,0.2)]"
              : "border-lime/40 bg-lime/10"
          }`}
        >
          <div className="font-bold text-lime mb-0.5">
            {returned ? "Welcome back — upload your screenshot" : "Paying in a new tab…"}
          </div>
          <p className="text-muted-foreground">
            {returned
              ? "You're on the proof step. Add your screenshot below and tap I have paid."
              : "Finish the payment, screenshot the confirmation, then come back here."}
          </p>
        </div>
      )}

      <form
        ref={proofRef}
        onSubmit={submit}
        className="rounded-2xl border border-border bg-surface p-4 space-y-3"
      >

        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          I have paid — submit proof
        </h3>
        <ProofUploader
          file={file}
          previewUrl={previewUrl}
          uploadState={uploadState}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
          fileInputRef={fileInputRef}
          onPick={pickFile}
          onRetry={retryUpload}
          onClear={clearProof}
          maxBytes={MAX_UPLOAD_BYTES}
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="paid-amount"
              className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1"
            >
              Amount paid *
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <input
                id="paid-amount"
                type="text"
                inputMode="decimal"
                value={paidAmount}
                onChange={(e) => setPaidAmount(e.target.value)}
                placeholder="0.00"
                aria-invalid={!!errors.paidAmount}
                aria-describedby={errors.paidAmount ? "paid-amount-err" : undefined}
                className={`w-full rounded-xl border bg-background pl-6 pr-3 py-2 text-sm outline-none focus:border-lime ${
                  errors.paidAmount ? "border-coral" : "border-border"
                }`}
              />
            </div>
            {errors.paidAmount && (
              <p id="paid-amount-err" className="mt-1 text-[11px] text-coral">
                {errors.paidAmount}
              </p>
            )}
          </div>
          <div>
            <label
              htmlFor="paid-at"
              className="block text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1"
            >
              Payment date *
            </label>
            <input
              id="paid-at"
              type="date"
              value={paidAt}
              max={toLocalDateInputValue(new Date())}
              onChange={(e) => setPaidAt(e.target.value)}
              aria-invalid={!!errors.paidAt}
              aria-describedby={errors.paidAt ? "paid-at-err" : undefined}
              className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-lime ${
                errors.paidAt ? "border-coral" : "border-border"
              }`}
            />
            {errors.paidAt && (
              <p id="paid-at-err" className="mt-1 text-[11px] text-coral">
                {errors.paidAt}
              </p>
            )}
          </div>
        </div>
        <div>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Transaction ID (optional)"
            maxLength={120}
            aria-invalid={!!errors.transactionRef}
            aria-describedby={errors.transactionRef ? "tx-ref-err" : undefined}
            className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-lime ${
              errors.transactionRef ? "border-coral" : "border-border"
            }`}
          />
          {errors.transactionRef && (
            <p id="tx-ref-err" className="mt-1 text-[11px] text-coral">
              {errors.transactionRef}
            </p>
          )}
        </div>
        <div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Notes for host (optional)"
            aria-invalid={!!errors.notes}
            aria-describedby={errors.notes ? "notes-err" : undefined}
            className={`w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-lime resize-none ${
              errors.notes ? "border-coral" : "border-border"
            }`}
          />
          {errors.notes && (
            <p id="notes-err" className="mt-1 text-[11px] text-coral">
              {errors.notes}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void submitProof()}
          disabled={uploadState === "uploading"}
          className="w-full rounded-xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <ShieldCheck className="h-4 w-4" />{" "}
          {submitting
            ? "Submitting…"
            : uploadState === "uploading"
              ? "Uploading proof…"
              : "I have paid"}
        </button>
      </form>
    </div>
  );
}

function ProofUploader({
  file,
  previewUrl,
  uploadState,
  uploadProgress,
  uploadError,
  fileInputRef,
  onPick,
  onRetry,
  onClear,
  maxBytes,
}: {
  file: File | null;
  previewUrl: string | null;
  uploadState: "idle" | "uploading" | "success" | "error";
  uploadProgress: number;
  uploadError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (f: File | null) => void;
  onRetry: () => void;
  onClear: () => void;
  maxBytes: number;
}) {
  const openPicker = () => fileInputRef.current?.click();
  const isVideo = !!file?.type.startsWith("video/");
  const sizeMb = file ? (file.size / (1024 * 1024)).toFixed(1) : null;

  return (
    <div
      className={`rounded-xl border p-3 text-xs ${
        uploadState === "error"
          ? "border-coral/50 bg-coral/5"
          : uploadState === "success"
            ? "border-lime/50 bg-lime/5"
            : "border-dashed border-border bg-background"
      }`}
      data-testid="proof-uploader"
      data-upload-state={uploadState}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        capture="environment"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          // Allow re-picking the same file after clear/retry.
          if (e.target) e.target.value = "";
        }}
        className="hidden"
      />

      {!file ? (
        <button
          type="button"
          onClick={openPicker}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-secondary text-lime">
            <Upload className="h-4 w-4" />
          </span>
          <span className="flex-1">
            <span className="block font-semibold text-foreground">
              Upload proof (image or video)
            </span>
            <span className="block text-[11px] text-muted-foreground">
              Screenshot or short clip · max {Math.round(maxBytes / (1024 * 1024))} MB
            </span>
          </span>
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Payment proof preview"
                className="h-12 w-12 rounded-lg object-cover border border-border"
              />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-secondary text-lime">
                {isVideo ? <Film className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate font-semibold text-foreground">{file.name}</div>
              <div className="text-[11px] text-muted-foreground">
                {isVideo ? "Video" : "Image"} · {sizeMb} MB
                {uploadState === "success" && (
                  <span className="ml-1 text-lime">· Uploaded</span>
                )}
                {uploadState === "uploading" && (
                  <span className="ml-1 text-muted-foreground">· Uploading…</span>
                )}
                {uploadState === "error" && (
                  <span className="ml-1 text-coral">· Upload failed</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {uploadState === "error" && (
                <button
                  type="button"
                  onClick={onRetry}
                  aria-label="Retry upload"
                  className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-2.5 py-1 text-[11px] font-bold text-primary-foreground"
                >
                  <RotateCw className="h-3 w-3" /> Retry
                </button>
              )}
              <button
                type="button"
                onClick={openPicker}
                aria-label="Choose a different file"
                disabled={uploadState === "uploading"}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground disabled:opacity-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={onClear}
                aria-label="Remove file"
                disabled={uploadState === "uploading"}
                className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:text-coral disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {(uploadState === "uploading" || uploadState === "success") && (
            <div className="space-y-1">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-border/60"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(uploadProgress)}
                aria-label="Upload progress"
              >
                <div
                  className={`h-full transition-[width] duration-200 ${
                    uploadState === "success" ? "bg-lime" : "bg-lime/80"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{Math.round(uploadProgress)}%</span>
                <span>
                  {uploadState === "success" ? "Ready to submit" : "Keep this tab open"}
                </span>
              </div>
            </div>
          )}

          {uploadState === "error" && (
            <div
              role="alert"
              className="rounded-lg border border-coral/40 bg-coral/10 p-2 text-[11px] text-coral"
            >
              <div className="font-bold mb-0.5 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Upload didn't finish
              </div>
              <p className="text-coral/90">
                {uploadError || "Something went wrong."} Tap{" "}
                <span className="font-semibold">Retry</span> to try again, or{" "}
                <span className="font-semibold">Replace</span> to pick a different file.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-background px-3 py-2 mb-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold truncate">{value}</span>
    </div>
  );
}
