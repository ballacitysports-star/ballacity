import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Upload, ShieldCheck, Clock, X } from "lucide-react";
import { toast } from "sonner";
import { GAMES } from "@/lib/sample-data";
import { useHostedGames } from "@/lib/hosted-games-store";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  type GamePaymentSettings, type PaymentMethod, type PaymentSubmission, type JoinRequest, paymentTypeMeta,
  getGamePaymentSettings, listPaymentMethodsForHost,
  uploadProofScreenshot, createPaymentSubmission, listMySubmissionsForGame,
  getMyJoinRequest,
} from "@/lib/payments";
import { LegalNotice } from "@/components/LegalNotice";
import { joinGame } from "@/lib/games-store";

export const Route = createFileRoute("/games/$gameId_/pay")({
  validateSearch: (search: Record<string, unknown>) => {
    const out: { invite?: true; from?: string } = {};
    if (search.invite === "1" || search.invite === 1 || search.invite === true) out.invite = true;
    if (typeof search.from === "string" && search.from.length > 0) out.from = search.from;
    return out;
  },
  loader: ({ params }) => {
    return { gameId: params.gameId };
  },
  head: () => ({ meta: [{ title: "Pay game fee — OpenRun" }] }),
  notFoundComponent: () => <div className="p-6 text-center text-sm">Game not found.</div>,
  errorComponent: ({ reset }) => (
    <div className="p-6 text-center"><button onClick={reset} className="text-lime font-bold">Try again</button></div>
  ),
  component: PayPage,
});

function PayPage() {
  const { gameId } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const hosted = useHostedGames();
  const game = useMemo(
    () => hosted.find((g) => g.id === gameId) ?? GAMES.find((g) => g.id === gameId),
    [hosted, gameId],
  );
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
    if (!user || !game) return;
    try {
      const req = await getMyJoinRequest(game.id);
      setMyReq((prev) => {
        // Toast on approval transition (pending/rejected/none → approved).
        if (req?.status === "approved" && prev?.status !== "approved") {
          toast.success("You're approved! You can pay now.");
        }
        return req;
      });
    } catch { /* ignore polling errors */ }
  }, [game, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!game) return;
        const s = await getGamePaymentSettings(game.id);
        if (cancelled) return;
        setSettings(s);
        if (s) {
          const all = await listPaymentMethodsForHost(s.host_id);
          if (cancelled) return;
          const filtered = s.accepted_method_ids.length > 0
            ? all.filter((m) => s.accepted_method_ids.includes(m.id))
            : all;
          setMethods(filtered);
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
      } catch (e: any) { toast.error(e.message); } finally { if (!cancelled) setFetching(false); }
    })();
    return () => { cancelled = true; };
  }, [game, user]);

  // Live-update the join-request status so the approval gate flips to the
  // payment picker the moment the host approves. Realtime is primary;
  // a slow poll and refetch-on-focus cover any dropped websocket frames.
  const refreshRef = useRef(refreshJoinRequest);
  useEffect(() => { refreshRef.current = refreshJoinRequest; }, [refreshJoinRequest]);
  useEffect(() => {
    if (!user || !game) return;
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
    const onVisibility = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(poll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [game, user]);

  if (loading || fetching) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;
  if (!game) {
    return (
      <div className="min-h-dvh grid place-items-center px-6 text-center">
        <div>
          <h1 className="font-display text-2xl font-bold">Game not found</h1>
          <p className="text-sm text-muted-foreground mt-2">It may have wrapped up or been cancelled.</p>
          <Link to="/feed" className="inline-block mt-5 rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground">
            Back to feed
          </Link>
        </div>
      </div>
    );
  }

  const fee = settings?.entry_fee ?? game.price;
  const requiresApproval = !!settings?.requires_approval;
  const isApproved = myReq?.status === "approved";
  const approvalGateActive = requiresApproval && !isApproved;
  const hostId = settings?.host_id ?? game.hostUserId ?? null;

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-4">
        <Link to="/games/$gameId" params={{ gameId: game.id }} className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="font-display text-xl font-bold leading-tight">{game.title}</h1>
          <div className="text-xs text-muted-foreground">{game.location}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-lime/30 bg-lime/5 p-5 mb-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Game fee</div>
        <div className="font-display text-4xl font-bold text-lime mt-1">${Number(fee).toFixed(2)}</div>
        {settings?.payment_deadline && (
          <div className="mt-2 inline-flex items-center gap-1 text-xs text-coral">
            <Clock className="h-3 w-3" /> Pay by {new Date(settings.payment_deadline).toLocaleString()}
          </div>
        )}
      </div>

      {mySubs.length > 0 && <MySubsList subs={mySubs} />}

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
      ) : !hostId ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center">
          <div className="font-semibold text-sm">Payment is not ready yet</div>
          <p className="text-xs text-muted-foreground mt-1">Reach out to the host directly to arrange this game fee.</p>
        </div>
      ) : methods.length === 0 ? (
        <PaymentInstructionsAndProof
          game_id={game.id}
          host_id={hostId}
          method={null}
          extraInstructions={settings?.payment_instructions ?? null}
          onCancel={() => nav({ to: "/games/$gameId", params: { gameId: game.id } })}
          onSubmitted={async () => {
            joinGame(game.id);
            const subs = await listMySubmissionsForGame(game.id);
            setMySubs(subs);
          }}
        />
      ) : !picked ? (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Pay host using</h2>
          <div className="space-y-2">
            {methods.map((m) => {
              const meta = paymentTypeMeta(m.payment_type);
              return (
                <button key={m.id} onClick={() => setPicked(m)} className="w-full flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 text-left hover:border-lime/40">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-lg">{meta.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{m.label || meta.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{m.username || m.contact_info}</div>
                  </div>
                  <span className="text-lime text-sm">→</span>
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <PaymentInstructionsAndProof
          game_id={game.id}
          host_id={hostId}
          method={picked}
          extraInstructions={settings?.payment_instructions ?? null}
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

      <div className="mt-5"><LegalNotice /></div>
    </div>
  );
}

function MySubsList({ subs }: { subs: PaymentSubmission[] }) {
  return (
    <div className="mb-4 space-y-2">
      {subs.map((s) => (
        <div key={s.id} className={`rounded-2xl border p-3 text-xs ${
          s.status === "verified" ? "border-lime/40 bg-lime/5" :
          s.status === "rejected" ? "border-coral/40 bg-coral/5" : "border-border bg-surface"
        }`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold uppercase">{
              s.status === "verified" ? "✓ Confirmed" :
              s.status === "rejected" ? "✗ Rejected — submit again" : "⏳ Pending verification"
            }</span>
            <span className="text-muted-foreground">{new Date(s.submitted_at).toLocaleString()}</span>
          </div>
          {s.reviewer_notes && <p className="mt-1 text-muted-foreground">Host: {s.reviewer_notes}</p>}
        </div>
      ))}
    </div>
  );
}

function PaymentInstructionsAndProof({
  game_id, host_id, method, extraInstructions, onCancel, onSubmitted,
}: {
  game_id: string; host_id: string; method: PaymentMethod | null;
  extraInstructions: string | null; onCancel: () => void; onSubmitted: () => void;
}) {
  const meta = method ? paymentTypeMeta(method.payment_type) : paymentTypeMeta("cash");
  const [file, setFile] = useState<File | null>(null);
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      let path: string | null = null;
      if (file) path = await uploadProofScreenshot(file);
      await createPaymentSubmission({
        game_id, host_id,
        payment_method_id: method?.id ?? null,
        payment_type: method?.payment_type ?? "cash",
        screenshot_path: path,
        transaction_reference: ref || null,
        notes: notes || null,
      });
      toast.success("Submitted — host will verify shortly.");
      onSubmitted();
    } catch (e: any) { toast.error(e.message); } finally { setSubmitting(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-lime/30 bg-surface p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-lg">{meta.emoji}</div>
          <div>
            <div className="font-bold text-sm">{method ? meta.name : "Pay host directly"}</div>
            <div className="text-xs text-muted-foreground">
              {method ? "Send directly to host" : "Use the arrangement the host shared, then submit proof"}
            </div>
          </div>
          <button onClick={onCancel} className="ml-auto text-muted-foreground"><X className="h-4 w-4" /></button>
        </div>
        {method?.username && <Field label="Send to" value={method.username} />}
        {method?.contact_info && <Field label="Contact" value={method.contact_info} />}
        {method?.payment_url && (
          <a href={method.payment_url} target="_blank" rel="noreferrer"
            className="mt-2 flex items-center justify-center gap-2 w-full rounded-xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground">
            <ExternalLink className="h-4 w-4" /> Open {meta.name}
          </a>
        )}
        {(method?.instructions || extraInstructions || !method) && (
          <div className="mt-3 rounded-xl bg-background p-3 text-xs text-muted-foreground space-y-1">
            {method?.instructions && <p>{method.instructions}</p>}
            {extraInstructions && <p>{extraInstructions}</p>}
            {!method && !extraInstructions && <p>Confirm payment details with the host, then submit a screenshot, transaction ID, or note for verification.</p>}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">I have paid — submit proof</h3>
        <label className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-background p-3 cursor-pointer">
          <Upload className="h-4 w-4 text-lime" />
          <span className="text-xs flex-1 truncate">{file ? file.name : "Upload screenshot of payment"}</span>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="hidden" />
        </label>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transaction ID (optional)"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime" />
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes for host (optional)"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime resize-none" />
        <button type="submit" disabled={submitting}
          className="w-full rounded-xl bg-lime-gradient py-3 text-sm font-bold text-primary-foreground inline-flex items-center justify-center gap-2 disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> {submitting ? "Submitting…" : "I have paid"}
        </button>
      </form>
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
