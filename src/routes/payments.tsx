import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Inbox,
  Settings as SettingsIcon,
  ShieldCheck,
  ExternalLink,
  UserCheck,
  BellRing,
} from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { UnpaidPlayersPanel } from "@/components/payments/UnpaidPlayersPanel";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  PAYMENT_TYPES,
  paymentTypeMeta,
  type PaymentMethod,
  type PaymentSubmission,
  type PaymentType,
  type JoinRequest,
  listMyPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  listHostSubmissions,
  reviewSubmission,
  getSignedProofUrl,
  listHostJoinRequests,
  reviewJoinRequest,
} from "@/lib/payments";
import { LegalNotice } from "@/components/LegalNotice";
import { GAMES } from "@/lib/sample-data";
import { PlayerReliabilityBadge } from "@/components/games/PlayerReliabilityBadge";
import { formatGameWhen } from "@/lib/format";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";

export const Route = createFileRoute("/payments")({
  head: () =>
    pageHead({
      path: "/payments",
      title: "Payments — ballaCity",
      description: "Manage payment methods, verify player payments, and review requests.",
      noindex: true,
    }),
  // URL-persisted state: top tab (methods/verify/requests) plus verify-panel
  // and requests-panel filters. Refresh or share preserves the exact view.
  validateSearch: zodValidator(
    z.object({
      tab: fallback(z.string(), "").default(""),
      verify: fallback(z.string(), "").default(""),
      requests: fallback(z.string(), "").default(""),
    }),
  ),
  component: PaymentsHub,
});

function PaymentsHub() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const search = Route.useSearch();
  const tab: "methods" | "verify" | "requests" | "unpaid" =
    search.tab === "verify" || search.tab === "requests" || search.tab === "unpaid" ? search.tab : "methods";
  const setTab = (v: "methods" | "verify" | "requests" | "unpaid") =>
    nav({
      to: "/payments",
      search: (p: any) => ({ ...p, tab: v === "methods" ? "" : v }),
      replace: true,
    });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [loading, user, nav]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;

  return (
    <div className="page-shell-narrow pt-6 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <Link
          to="/profile"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="text-xs text-muted-foreground">
            Direct, peer-to-peer. No fees through ballaCity.
          </p>
        </div>
      </div>

      <div className="flex gap-1 mb-4 rounded-2xl bg-surface p-1 border border-border">
        <TabBtn
          active={tab === "methods"}
          onClick={() => setTab("methods")}
          icon={<SettingsIcon className="h-4 w-4" />}
        >
          Methods
        </TabBtn>
        <TabBtn
          active={tab === "verify"}
          onClick={() => setTab("verify")}
          icon={<Inbox className="h-4 w-4" />}
        >
          Verify
        </TabBtn>
        <TabBtn
          active={tab === "requests"}
          onClick={() => setTab("requests")}
          icon={<UserCheck className="h-4 w-4" />}
        >
          Requests
        </TabBtn>
        <TabBtn
          active={tab === "unpaid"}
          onClick={() => setTab("unpaid")}
          icon={<BellRing className="h-4 w-4" />}
        >
          Unpaid
        </TabBtn>
      </div>

      {tab === "methods" ? (
        <MethodsPanel />
      ) : tab === "verify" ? (
        <VerifyPanel />
      ) : tab === "unpaid" ? (
        <UnpaidPlayersPanel />
      ) : (
        <RequestsPanel />
      )}

      <div className="mt-6">
        <LegalNotice />
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold transition-colors ${
        active ? "bg-lime text-primary-foreground" : "text-muted-foreground"
      }`}
    >
      {icon} {children}
    </button>
  );
}

// =============================================================
function MethodsPanel() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [adding, setAdding] = useState(false);

  const refresh = () =>
    listMyPaymentMethods()
      .then(setMethods)
      .catch((e) => toast.error(e.message));
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-3">
      {methods.length === 0 && !adding && (
        <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-6 text-center">
          <div className="font-display text-base font-bold">No payment methods yet</div>
          <p className="text-xs text-muted-foreground mt-1">
            Add Venmo, Cash App, Zelle, or others so players can pay you directly.
          </p>
        </div>
      )}
      {methods.map((m) => (
        <MethodCard
          key={m.id}
          method={m}
          onUpdate={async (patch) => {
            await updatePaymentMethod(m.id, patch);
            refresh();
          }}
          onDelete={async () => {
            if (confirm("Delete this payment method?")) {
              await deletePaymentMethod(m.id);
              refresh();
            }
          }}
        />
      ))}

      {adding ? (
        <AddMethodForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            refresh();
            toast.success("Payment method added");
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-2xl border border-dashed border-lime/40 bg-lime/5 px-4 py-3 text-sm font-bold text-lime inline-flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" /> Add payment method
        </button>
      )}
    </div>
  );
}

function MethodCard({
  method,
  onUpdate,
  onDelete,
}: {
  method: PaymentMethod;
  onUpdate: (p: Partial<PaymentMethod>) => void;
  onDelete: () => void;
}) {
  const meta = paymentTypeMeta(method.payment_type);
  return (
    <div
      className={`rounded-2xl border bg-surface p-4 ${method.is_enabled ? "border-border" : "border-border/40 opacity-60"}`}
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-lg">
          {meta.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">{method.label || meta.name}</div>
          {method.username && (
            <div className="text-xs text-muted-foreground truncate">{method.username}</div>
          )}
          {method.contact_info && (
            <div className="text-xs text-muted-foreground truncate">{method.contact_info}</div>
          )}
          {method.payment_url && (
            <a
              href={method.payment_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-lime"
            >
              <ExternalLink className="h-3 w-3" /> Payment link
            </a>
          )}
          {method.instructions && (
            <p className="mt-1 text-xs text-muted-foreground">{method.instructions}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <button onClick={() => onUpdate({ is_enabled: !method.is_enabled })} className="text-xs">
            {method.is_enabled ? (
              <ToggleRight className="h-6 w-6 text-lime" />
            ) : (
              <ToggleLeft className="h-6 w-6 text-muted-foreground" />
            )}
          </button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-coral">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddMethodForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [type, setType] = useState<PaymentType>("venmo");
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [contact, setContact] = useState("");
  const [instructions, setInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const meta = paymentTypeMeta(type);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createPaymentMethod({
        payment_type: type,
        label: label || null,
        username: username || null,
        payment_url: url || null,
        contact_info: contact || null,
        instructions: instructions || null,
      });
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-lime/30 bg-surface p-4 space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {PAYMENT_TYPES.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setType(t.id)}
            className={`flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 text-[10px] font-semibold ${
              type === t.id
                ? "border-lime bg-lime/10 text-lime"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            <span className="text-lg">{t.emoji}</span>
            <span className="leading-tight text-center">{t.name}</span>
          </button>
        ))}
      </div>
      <Input
        value={label}
        onChange={setLabel}
        placeholder={`Label (optional, e.g. "Personal ${meta.name}")`}
      />
      {meta.fields.username !== undefined && (
        <Input
          value={username}
          onChange={setUsername}
          placeholder={meta.fields.username}
          required
        />
      )}
      {meta.fields.url !== undefined && (
        <Input value={url} onChange={setUrl} placeholder={meta.fields.url} type="url" />
      )}
      {meta.fields.contact !== undefined && (
        <Input value={contact} onChange={setContact} placeholder={meta.fields.contact} required />
      )}
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        rows={2}
        placeholder="Optional instructions (e.g. include your player name in note)"
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime resize-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-border bg-background py-2 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-xl bg-lime-gradient py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save method"}
        </button>
      </div>
    </form>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-lime"
    />
  );
}

// =============================================================
function VerifyPanel() {
  const search = Route.useSearch();
  const nav = useNavigate();
  const filter: "pending" | "verified" | "rejected" =
    search.verify === "verified" || search.verify === "rejected" ? search.verify : "pending";
  const setFilter = (v: "pending" | "verified" | "rejected") =>
    nav({
      to: "/payments",
      search: (p: any) => ({ ...p, verify: v === "pending" ? "" : v }),
      replace: true,
    });
  const [subs, setSubs] = useState<PaymentSubmission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const refresh = () => {
    listHostSubmissions(filter)
      .then(setSubs)
      .catch((e) => toast.error(e.message));
    listHostSubmissions("pending")
      .then((p) => setPendingCount(p.length))
      .catch(() => {});
  };
  useEffect(() => {
    refresh();
  }, [filter]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["pending", "verified", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold capitalize inline-flex items-center justify-center gap-1.5 ${
              filter === s
                ? "bg-lime text-primary-foreground"
                : "border border-border bg-surface text-muted-foreground"
            }`}
          >
            {s}
            {s === "pending" && pendingCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-[1px] text-[10px] font-extrabold ${
                  filter === s
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-coral/15 text-coral"
                }`}
              >
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>
      {subs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
          No {filter} submissions.
        </div>
      )}
      {subs.map((s) => (
        <SubmissionCard key={s.id} sub={s} onReviewed={refresh} />
      ))}
    </div>
  );
}

function SubmissionCard({ sub, onReviewed }: { sub: PaymentSubmission; onReviewed: () => void }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [player, setPlayer] = useState<{
    display_name: string | null;
    username: string | null;
    avatar_initials: string | null;
    avatar_url: string | null;
  } | null>(null);
  const game = GAMES.find((g) => g.id === sub.game_id);
  const meta = sub.payment_type ? paymentTypeMeta(sub.payment_type) : null;

  useEffect(() => {
    if (sub.screenshot_path) getSignedProofUrl(sub.screenshot_path).then(setProofUrl);
  }, [sub.screenshot_path]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_initials, avatar_url")
        .eq("id", sub.player_id)
        .maybeSingle();
      if (!cancelled) setPlayer(data as any);
    })();
    return () => {
      cancelled = true;
    };
  }, [sub.player_id]);

  const review = async (status: "verified" | "rejected") => {
    setBusy(true);
    try {
      const trimmed = note.trim();
      await reviewSubmission(sub.id, status, trimmed || undefined);
      toast.success(status === "verified" ? "Payment approved" : "Payment rejected");
      if (status === "verified") {
        const { createNotification } = await import("@/lib/notifications");
        void createNotification({
          user_id: sub.player_id,
          type: "payment_verified",
          title: `Payment verified for ${game?.title ?? "your game"}`,
          body: trimmed || "You're on the roster. See you there!",
          link: `/games/${sub.game_id}`,
        }).catch(() => {});
      } else {
        const { createNotification } = await import("@/lib/notifications");
        void createNotification({
          user_id: sub.player_id,
          type: "payment_rejected",
          title: `Payment rejected for ${game?.title ?? "your game"}`,
          body: trimmed || "The host was not able to verify your payment.",
          link: `/games/${sub.game_id}/pay`,
        }).catch(() => {});
      }
      setNote("");
      onReviewed();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const playerLabel =
    player?.display_name ||
    (player?.username ? `@${player.username}` : `Player ${sub.player_id.slice(0, 8)}…`);
  const initials =
    player?.avatar_initials ||
    (player?.display_name ? player.display_name.slice(0, 2).toUpperCase() : "P");

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <UserAvatar
              name={player?.display_name ?? playerLabel}
              initials={initials}
              avatarUrl={player?.avatar_url}
              className="h-7 w-7 text-[10px] shrink-0"
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{playerLabel}</div>
              <div className="text-[10px] text-muted-foreground">
                {new Date(sub.submitted_at).toLocaleString()}
              </div>
            </div>
          </div>
          <div className="text-xs font-semibold truncate">{game?.title ?? sub.game_id}</div>
          {game && (
            <div className="text-[11px] text-muted-foreground">
              {formatGameWhen(game)} · {game.location}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {meta && (
              <div>
                <span className="text-muted-foreground">Method</span>
                <div className="font-medium">
                  {meta.emoji} {meta.name}
                </div>
              </div>
            )}
            {sub.paid_amount != null && (
              <div>
                <span className="text-muted-foreground">Amount</span>
                <div className="font-medium">${Number(sub.paid_amount).toFixed(2)}</div>
              </div>
            )}
            {sub.paid_at && (
              <div>
                <span className="text-muted-foreground">Paid at</span>
                <div className="font-medium">{new Date(sub.paid_at).toLocaleString()}</div>
              </div>
            )}
            {sub.transaction_reference && (
              <div className="col-span-2 min-w-0">
                <span className="text-muted-foreground">Reference</span>
                <div className="font-medium truncate">{sub.transaction_reference}</div>
              </div>
            )}
          </div>
          {sub.notes && (
            <div className="mt-2 rounded-lg bg-background p-2 text-xs">
              <div className="text-[10px] uppercase font-bold text-muted-foreground mb-0.5">
                Player note
              </div>
              {sub.notes}
            </div>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
            sub.status === "verified"
              ? "bg-lime/15 text-lime"
              : sub.status === "rejected"
                ? "bg-coral/15 text-coral"
                : "bg-secondary text-muted-foreground"
          }`}
        >
          {sub.status}
        </span>
      </div>
      {proofUrl && (
        <a href={proofUrl} target="_blank" rel="noreferrer">
          <img
            src={proofUrl}
            alt="Payment proof"
            className="w-full max-h-72 object-contain rounded-xl border border-border bg-background"
          />
        </a>
      )}
      {sub.status !== "pending" && sub.reviewer_notes && (
        <div className="rounded-lg border border-border bg-background p-2 text-xs">
          <div className="text-[10px] uppercase font-bold text-muted-foreground mb-0.5">
            Your note
          </div>
          {sub.reviewer_notes}
        </div>
      )}
      {sub.status === "pending" && (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note to the player (e.g. why rejected, or a thanks)"
            rows={2}
            maxLength={1000}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none focus:border-lime resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => review("rejected")}
              disabled={busy}
              className="flex-1 rounded-xl border border-coral/40 bg-coral/10 py-2 text-sm font-bold text-coral disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => review("verified")}
              disabled={busy}
              className="flex-1 rounded-xl bg-lime-gradient py-2 text-sm font-bold text-primary-foreground inline-flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" /> Approve
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
function RequestsPanel() {
  const search = Route.useSearch();
  const nav = useNavigate();
  const filter: "pending" | "approved" | "rejected" =
    search.requests === "approved" || search.requests === "rejected" ? search.requests : "pending";
  const setFilter = (v: "pending" | "approved" | "rejected") =>
    nav({
      to: "/payments",
      search: (p: any) => ({ ...p, requests: v === "pending" ? "" : v }),
      replace: true,
    });
  const [reqs, setReqs] = useState<JoinRequest[]>([]);
  const refresh = () =>
    listHostJoinRequests(filter)
      .then(setReqs)
      .catch((e) => toast.error(e.message));
  useEffect(() => {
    refresh();
  }, [filter]);

  const review = async (id: string, status: "approved" | "rejected") => {
    try {
      await reviewJoinRequest(id, status);
      toast.success(status === "approved" ? "Player approved" : "Request rejected");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-bold capitalize ${
              filter === s
                ? "bg-lime text-primary-foreground"
                : "border border-border bg-surface text-muted-foreground"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {reqs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center text-sm text-muted-foreground">
          No {filter} requests.
        </div>
      )}
      {reqs.map((r) => {
        const game = GAMES.find((g) => g.id === r.game_id);
        return (
          <div key={r.id} className="rounded-2xl border border-border bg-surface p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{game?.title ?? r.game_id}</div>
                {game && (
                  <div className="text-[11px] text-muted-foreground">
                    {formatGameWhen(game)} · {game.location}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground mt-1">
                  Player ID: {r.player_id.slice(0, 8)}… · {new Date(r.created_at).toLocaleString()}
                </div>
                <PlayerReliabilityBadge userId={r.player_id} className="mt-1.5" />
                {r.message && <p className="text-xs mt-2 italic">"{r.message}"</p>}
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  r.status === "approved"
                    ? "bg-lime/15 text-lime"
                    : r.status === "rejected"
                      ? "bg-coral/15 text-coral"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {r.status}
              </span>
            </div>
            {r.status === "pending" && (
              <div className="flex gap-2">
                <button
                  onClick={() => review(r.id, "rejected")}
                  className="flex-1 rounded-xl border border-coral/40 bg-coral/10 py-2 text-sm font-bold text-coral"
                >
                  Reject
                </button>
                <button
                  onClick={() => review(r.id, "approved")}
                  className="flex-1 rounded-xl bg-lime-gradient py-2 text-sm font-bold text-primary-foreground inline-flex items-center justify-center gap-1"
                >
                  <ShieldCheck className="h-4 w-4" /> Approve
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
