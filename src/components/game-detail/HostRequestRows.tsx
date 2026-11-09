import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Clock, Check, X as XIcon } from "lucide-react";
import { fetchProfileAges } from "@/lib/use-my-age";
import { requesterAgeLabel } from "@/lib/game-age";
import { UserAvatar } from "@/components/UserAvatar";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { reviewJoinRequest, type JoinRequest } from "@/lib/payments";
import { HOST_APPROVE_NOTE, hostBadge } from "@/lib/join-guardian-status";
import { supabase } from "@/integrations/supabase/client";
import {
  blockConfirmText,
  blockPlayer,
  notifyJoinReview,
} from "@/components/game-detail/game-player-actions";

type ProfileBits = {
  display_name?: string | null;
  avatar_initials?: string | null;
  avatar_url?: string | null;
};

export function HostRequestRow({
  req,
  gameTitle,
  ageReq,
  onOptimistic,
  guardian,
}: {
  req: JoinRequest;
  gameTitle: string;
  ageReq?: { minAge: number | null; maxAge: number | null };
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
  guardian?: { needsGuardian: boolean; guardianApproved: boolean };
}) {
  const badge = guardian ? hostBadge(guardian) : null;
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [age, setAge] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_initials, avatar_url")
        .eq("id", req.player_id)
        .maybeSingle();
      if (data) setName((data as ProfileBits).display_name ?? "Player");
      const ages = await fetchProfileAges([req.player_id]);
      setAge(ages[req.player_id] ?? null);
    })();
  }, [req.player_id]);
  const ageLabel = requesterAgeLabel(age, ageReq);

  /** Resolves true only when the review itself was saved. */
  const act = async (status: "approved" | "rejected", reason?: string | null): Promise<boolean> => {
    setBusy(true);
    const rollback = onOptimistic(req.id, status);
    try {
      await reviewJoinRequest(req.id, status, reason ?? undefined);
    } catch (e: unknown) {
      rollback();
      toast.error((e as { message?: string } | null)?.message);
      setBusy(false);
      return false;
    }
    // The decision is saved; a failed heads-up to the player must not undo it on screen.
    const heardBack = await notifyJoinReview(
      req.player_id,
      req.game_id,
      gameTitle,
      status,
      reason,
    ).then(
      () => true,
      () => false,
    );
    toast.success(status === "approved" ? "Approved" : "Declined", {
      description: heardBack
        ? undefined
        : "We couldn't notify the player. They'll see it in the game.",
    });
    setBusy(false);
    return true;
  };

  const promptRejection = (defaultReason?: string): string | null => {
    const raw = window.prompt(
      "Add a short reason for the player (optional). Leave blank to decline without a note.",
      defaultReason ?? "",
    );
    // `null` = user cancelled the prompt → abort. Empty string = decline with no reason.
    if (raw === null) return null;
    return raw.trim().slice(0, 500);
  };

  return (
    <div
      className={`rounded-2xl border p-3 ${req.status === "pending" ? "border-border bg-surface" : "border-border/50 bg-surface/40 opacity-70"}`}
    >
      <div className="flex items-center gap-2">
        <Link
          to="/players/$userId"
          params={{ userId: req.player_id }}
          className="grid h-9 w-9 place-items-center rounded-full bg-lime-gradient text-xs font-bold text-primary-foreground hover:ring-2 hover:ring-lime"
          aria-label={`View ${name}'s profile`}
        >
          {name.slice(0, 2).toUpperCase()}
        </Link>
        <div className="flex-1 min-w-0">
          <Link
            to="/players/$userId"
            params={{ userId: req.player_id }}
            className="text-sm font-semibold truncate hover:text-lime hover:underline block"
          >
            {name}
          </Link>
          {ageLabel && (
            <div className="text-[11px] font-semibold text-muted-foreground">🎂 {ageLabel}</div>
          )}
          {badge && (
            <span
              data-testid="host-guardian-badge"
              className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                badge.tone === "ok"
                  ? "border-lime/40 bg-lime/10 text-lime"
                  : "border-coral/40 bg-coral/10 text-coral"
              }`}
            >
              {badge.label}
            </span>
          )}
          {req.message && (
            <div className="text-xs text-muted-foreground truncate">"{req.message}"</div>
          )}
        </div>
        {req.status === "pending" ? (
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm(blockConfirmText(name))) return;
                // Only block once the decline actually went through.
                if (!(await act("rejected", "Blocked by host"))) return;
                await blockPlayer(req.player_id, name);
              }}
              className="grid h-10 px-2 place-items-center rounded-xl border border-coral/60 bg-coral/10 text-coral text-[11px] font-bold disabled:opacity-50"
              title="Decline and block this player"
              aria-label={`Block ${name} from your games`}
            >
              Block
            </button>
            <button
              disabled={busy}
              onClick={() => {
                const reason = promptRejection();
                if (reason === null) return;
                void act("rejected", reason || null);
              }}
              aria-label={`Decline ${name}`}
              title="Decline"
              className="grid h-10 w-10 place-items-center rounded-xl border border-coral/40 text-coral disabled:opacity-50"
            >
              <XIcon className="h-4 w-4" aria-hidden />
            </button>

            <button
              disabled={busy}
              onClick={() => void act("approved")}
              aria-label={`Approve ${name}`}
              title="Approve"
              className="grid h-10 w-10 place-items-center rounded-xl bg-lime-gradient text-primary-foreground disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ) : (
          <span className="text-xs font-semibold uppercase">{req.status}</span>
        )}
      </div>
      {req.status === "pending" && guardian?.needsGuardian && !guardian.guardianApproved && (
        <p className="mt-2 text-[11px] text-muted-foreground">{HOST_APPROVE_NOTE}</p>
      )}
    </div>
  );
}

export function HostPendingChip({
  req,
  gameTitle,
  onOptimistic,
  index,
}: {
  req: JoinRequest;
  gameTitle: string;
  onOptimistic: (reqId: string, status: "approved" | "rejected") => () => void;
  index: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string>("Player");
  const [initials, setInitials] = useState<string>("?");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_initials, avatar_url")
        .eq("id", req.player_id)
        .maybeSingle();
      if (data) {
        const dn = (data as ProfileBits).display_name ?? "Player";
        setName(dn);
        setInitials(((data as ProfileBits).avatar_initials ?? dn.slice(0, 2)).toUpperCase());
        setAvatarUrl((data as ProfileBits).avatar_url ?? null);
      }
    })();
  }, [req.player_id]);

  /** Resolves true only when the review itself was saved. */
  const act = async (status: "approved" | "rejected", reason?: string | null): Promise<boolean> => {
    setBusy(true);
    const rollback = onOptimistic(req.id, status);
    setOpen(false);
    try {
      await reviewJoinRequest(req.id, status, reason ?? undefined);
    } catch (e: unknown) {
      rollback();
      toast.error((e as { message?: string } | null)?.message);
      setBusy(false);
      return false;
    }
    // The decision is saved; a failed heads-up to the player must not undo it on screen.
    const heardBack = await notifyJoinReview(
      req.player_id,
      req.game_id,
      gameTitle,
      status,
      reason,
    ).then(
      () => true,
      () => false,
    );
    toast.success(status === "approved" ? `Approved ${name}` : `Declined ${name}`, {
      description: heardBack
        ? undefined
        : "We couldn't notify the player. They'll see it in the game.",
    });
    setBusy(false);
    return true;
  };

  const promptRejection = (): string | null => {
    const raw = window.prompt(
      "Add a short reason for the player (optional). Leave blank to decline without a note.",
      "",
    );
    if (raw === null) return null;
    return raw.trim().slice(0, 500);
  };

  return (
    <div className="relative">
      <motion.button
        type="button"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: index * 0.04 }}
        onClick={() => setOpen((v) => !v)}
        title={`${name} — tap to approve or decline`}
        aria-label={`Review ${name}'s pickup request`}
        className={`relative grid h-11 w-11 place-items-center rounded-full border border-dashed text-xs font-bold transition ${
          open
            ? "border-coral bg-coral/20 text-coral ring-2 ring-coral/40"
            : "border-coral/60 bg-coral/10 text-coral hover:bg-coral/20"
        }`}
      >
        {avatarUrl ? (
          <UserAvatar
            name={name}
            initials={initials}
            avatarUrl={avatarUrl}
            className="h-full w-full border-0 text-xs"
          />
        ) : (
          initials
        )}
        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-coral text-[8px] text-white">
          <Clock className="h-2.5 w-2.5" />
        </span>
      </motion.button>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute z-20 left-1/2 top-[calc(100%+6px)] -translate-x-1/2 w-56 rounded-2xl border border-border bg-background shadow-lg p-2"
        >
          <Link
            to="/players/$userId"
            params={{ userId: req.player_id }}
            className="block px-2 py-1 text-sm font-semibold truncate hover:text-lime"
          >
            {name}
          </Link>
          {req.message && (
            <div className="px-2 pb-2 text-[11px] text-muted-foreground line-clamp-3">
              "{req.message}"
            </div>
          )}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex gap-1.5">
              <button
                disabled={busy}
                onClick={() => {
                  const reason = promptRejection();
                  if (reason === null) return;
                  void act("rejected", reason || null);
                }}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-coral/40 text-coral py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                <XIcon className="h-3.5 w-3.5" /> Decline
              </button>

              <button
                disabled={busy}
                onClick={() => void act("approved")}
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-lime-gradient text-primary-foreground py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" /> Approve
              </button>
            </div>
            <button
              disabled={busy}
              onClick={async () => {
                if (!confirm(blockConfirmText(name))) return;
                // Only block once the decline actually went through.
                if (!(await act("rejected", "Blocked by host"))) return;
                await blockPlayer(req.player_id, name);
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-coral/60 bg-coral/10 text-coral py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              Decline &amp; block
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
