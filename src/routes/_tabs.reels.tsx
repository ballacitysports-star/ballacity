import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Upload,
  Video,
  Lock,
  Loader2,
  AlertTriangle,
  ExternalLink,
  Check,
  RefreshCw,
  Eye,
} from "lucide-react";
import { captureVideoFrames } from "@/lib/reel-frames";
import { processMyReels } from "@/lib/reels.functions";
import { ReelCoach } from "@/components/reels/ReelCoach";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/useSubscription";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/utils/payments.functions";
import { FREE_TIER } from "@/lib/catalog";
import { recapProgress, recapStepLabel, shareRecap, type RecapSummary } from "@/lib/recaps";
import { Share2 } from "lucide-react";

export const Route = createFileRoute("/_tabs/reels")({
  validateSearch: (search: Record<string, unknown>) => ({
    game: typeof search.game === "string" ? search.game : "",
    title: typeof search.title === "string" ? search.title : "",
    upload: search.upload === "1" || search.upload === true ? "1" : "",
  }),
  head: () =>
    pageHead({
      path: "/reels",
      title: "Highlight reels — OpenRun",
      description: "Turn your game footage into AI-edited highlight reels you can share.",
      noindex: true,
    }),
  component: ReelsPage,
});

type Reel = {
  id: string;
  title: string;
  video_path: string;
  status: string;
  used_free: boolean;
  created_at: string;
  ai_title: string | null;
  ai_caption: string | null;
  ai_hashtags: string[] | null;
  thumbnail_path: string | null;
  error_message: string | null;
  game_id: string | null;
  game_title: string | null;
  processing_step: string | null;
  completed_at: string | null;
};

function ReelCard({ reel }: { reel: Reel }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (reel.thumbnail_path) {
      supabase.storage
        .from("highlight-videos")
        .createSignedUrl(reel.thumbnail_path, 3600)
        .then(({ data }) => {
          if (!cancelled) setThumb(data?.signedUrl ?? null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [reel.thumbnail_path]);

  async function handlePlay() {
    if (!videoUrl) {
      const { data } = await supabase.storage
        .from("highlight-videos")
        .createSignedUrl(reel.video_path, 3600);
      if (data?.signedUrl) setVideoUrl(data.signedUrl);
    }
    setOpen(true);
  }

  const isDone = reel.status === "completed";
  const displayTitle = reel.ai_title || reel.title;
  const isProcessing = reel.status === "processing";

  return (
    <li className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={isDone ? handlePlay : undefined}
          className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-lime/10"
        >
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-lime">
              <Video className="h-5 w-5" />
            </div>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{displayTitle}</p>
          <p className="text-xs text-muted-foreground">
            {reel.status} · {new Date(reel.created_at).toLocaleDateString()}
            {reel.used_free && " · free"}
          </p>
          {reel.ai_caption && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{reel.ai_caption}</p>
          )}
          {isProcessing && (
            <div className="mt-1.5">
              <div className="h-1 overflow-hidden rounded-full bg-lime/15">
                <div
                  className="h-full rounded-full bg-lime transition-all"
                  style={{ width: `${recapProgress(reel as unknown as RecapSummary)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] font-semibold text-lime">
                {recapStepLabel(reel as unknown as RecapSummary)} — we'll notify you when it's ready
              </p>
            </div>
          )}
          {reel.status === "failed" && reel.error_message && (
            <p className="mt-1 text-[10px] text-amber-300">{reel.error_message}</p>
          )}
        </div>
        {isDone && reel.game_id && (
          <button
            onClick={async () => {
              const r = await shareRecap(reel as unknown as RecapSummary, {
                id: reel.game_id!,
                title: reel.game_title || displayTitle,
              });
              if (r === "copied") toast.success("Highlight link copied");
              if (r === "failed") toast.error("Could not share this highlight");
            }}
            className="shrink-0 rounded-full border border-border p-2 text-muted-foreground"
            aria-label="Share highlight"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && videoUrl && (
        <div className="mt-3">
          <video src={videoUrl} controls className="w-full rounded-lg" />
        </div>
      )}
    </li>
  );
}

function ReelsPage() {
  const { user } = useAuth();
  const { game: gameId, title: gameTitle, upload: autoUpload } = Route.useSearch();
  const { isActive, isPastDue, freeUsed, freeRemaining, loading: subLoading } = useSubscription();
  const { openCheckout, isOpen, checkoutElement, closeCheckout } = useStripeCheckout();
  const fileRef = useRef<HTMLInputElement>(null);
  const [reels, setReels] = useState<Reel[]>([]);
  const [busy, setBusy] = useState(false);
  const autoOpened = useRef(false);
  const gameReels = gameId ? reels.filter((r) => r.game_id === gameId) : [];
  const visibleReels = gameId ? gameReels : reels;


  const canGenerate = isActive || freeRemaining > 0;
  const lockedReason = !user
    ? "Sign in to create reels"
    : !canGenerate
      ? "You've used all 3 free reels. Subscribe to keep going."
      : null;

  useEffect(() => {
    if (!user) return;
    let env: string;
    try {
      env = getStripeEnvironment();
    } catch {
      return;
    }
    const load = () =>
      supabase
        .from("highlight_reels")
        .select("*")
        .eq("user_id", user.id)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .then(({ data }) => setReels((data as Reel[]) ?? []));
    load();

    // Live pipeline progress for this user's reels.
    const channel = supabase
      .channel(`my-reels-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "highlight_reels",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Reel | null;
          if (row?.status === "completed" && (payload.old as any)?.status !== "completed") {
            toast.success("Your highlight reel is ready");
          }
          load();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, busy]);

  // Deep link from a finished game: open the picker straight away.
  useEffect(() => {
    if (autoUpload !== "1" || autoOpened.current || !user || !canGenerate) return;
    autoOpened.current = true;
    fileRef.current?.click();
  }, [autoUpload, user, canGenerate]);


  async function handleUpload(file: File) {
    if (!user) return;
    if (!canGenerate) {
      handleSubscribe();
      return;
    }
    setBusy(true);
    try {
      const env = getStripeEnvironment();
      const path = `${user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const { error: upErr } = await supabase.storage
        .from("highlight-videos")
        .upload(path, file, { upsert: false });
      if (upErr) throw upErr;

      const usedFree = !isActive;
      const { error: insErr } = await supabase.from("highlight_reels").insert({
        user_id: user.id,
        title: gameTitle
          ? `Recap · ${gameTitle}`
          : file.name.replace(/\.[^.]+$/, ""),
        video_path: path,
        status: "processing",
        used_free: usedFree,
        environment: env,
        game_id: gameId || null,
        game_title: gameTitle || null,
      });
      if (insErr) throw insErr;

      toast.success("Reel queued — AI processing started");
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSubscribe() {
    if (!user) {
      toast.error("Please sign in first");
      return;
    }
    openCheckout({
      priceId: "ai_highlight_reel_monthly",
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  }

  async function handleManageBilling() {
    try {
      const result = await createPortalSession({
        data: { environment: getStripeEnvironment(), returnUrl: window.location.href },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open billing portal");
    }
  }

  if (isOpen) {
    return (
      <div className="min-h-dvh">
        <PaymentTestModeBanner />
        <div className="px-4 py-4">
          <button onClick={closeCheckout} className="text-sm text-muted-foreground underline">
            ← Back
          </button>
        </div>
        <div className="px-4 pb-12">{checkoutElement}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <header className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-lime" />
          <h1 className="text-2xl font-bold">AI Highlight Reels</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a clip and let AI generate your highlight.
        </p>
      </header>

      {gameId && (
        <section className="mx-5 mb-5 rounded-2xl border border-lime/30 bg-lime/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-lime">
            Recap for finished game
          </p>
          <p className="mt-1 text-sm font-semibold">{gameTitle || "Your game"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {gameReels.length > 0
              ? `${gameReels.length} recap${gameReels.length === 1 ? "" : "s"} linked to this game.`
              : "Upload footage below and we'll link the recap to this game."}
          </p>
        </section>
      )}

      {isPastDue && (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-50/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Payment past due — we're retrying. Update your card to avoid losing access.
        </div>
      )}

      <section className="mx-5 mb-5 rounded-2xl border border-border bg-surface p-5">
        {subLoading ? (
          <p className="text-sm text-muted-foreground">Loading plan…</p>
        ) : isActive ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-lime">Pro · Unlimited reels</p>
              <p className="text-xs text-muted-foreground">$15 / month</p>
            </div>
            <button
              onClick={handleManageBilling}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs"
            >
              Manage <ExternalLink className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Free trial</p>
                <p className="text-xs text-muted-foreground">
                  {freeRemaining} of 3 free reels left
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{freeUsed}/3 used</span>
            </div>
            <button
              onClick={handleSubscribe}
              className="w-full rounded-xl bg-lime py-2.5 font-semibold text-black"
            >
              {freeRemaining > 0 ? "Upgrade to unlimited · $15/mo" : "Subscribe · $15/mo"}
            </button>
          </div>
        )}
      </section>

      {!isActive && (
        <section className="mx-5 mb-5 rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold">Free account includes</h2>
          <ul className="space-y-2">
            {FREE_TIER.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-5 mb-6">
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => (canGenerate ? fileRef.current?.click() : handleSubscribe())}
          disabled={busy || !user}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface/50 py-8 text-sm font-medium disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
            </>
          ) : canGenerate ? (
            <>
              <Upload className="h-5 w-5 text-lime" /> Upload a clip to generate a reel
            </>
          ) : (
            <>
              <Lock className="h-5 w-5" /> Subscribe to create more reels
            </>
          )}
        </button>
        {lockedReason && (
          <p className="mt-2 text-center text-xs text-muted-foreground">{lockedReason}</p>
        )}
      </section>

      <section className="mx-5 pb-24">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {gameId ? "Recaps for this game" : "Your reels"}
        </h2>
        {visibleReels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {gameId
              ? "No recap for this game yet — upload footage above."
              : "No reels yet — upload your first clip above."}
          </p>
        ) : (
          <ul className="space-y-2">
            {visibleReels.map((r) => (
              <ReelCard key={r.id} reel={r} />
            ))}
          </ul>
        )}
        {gameId && reels.length > gameReels.length && (
          <Link
            to="/reels"
            search={{ game: "", title: "", upload: "" }}
            className="mt-3 inline-block text-xs font-semibold text-lime underline"
          >
            View all your reels
          </Link>
        )}
      </section>
    </div>
  );
}
