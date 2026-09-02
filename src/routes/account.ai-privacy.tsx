import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Film, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsStaticRow } from "@/components/settings/SettingsRow";
import { AiDisclosureBody } from "@/components/reels/AiVideoDisclosure";
import { AI_RESULTS_CAVEAT, AI_TRAINING_NOTE } from "@/lib/ai-video-privacy";
import { useMyPrivacy, type PrivacyPreferences } from "@/lib/privacy";
import { deleteMyAiAnalysis, listMyAiAnalyses } from "@/lib/ai-video-privacy.functions";
import { deleteReel } from "@/lib/reels.functions";

export const Route = createFileRoute("/account/ai-privacy")({
  head: () =>
    pageHead({
      path: "/account/ai-privacy",
      title: "AI & Video Privacy — ballaCity",
      description:
        "See how ballaCity's AI analyzes your clips, what is kept, and delete AI results or uploaded videos at any time.",
      noindex: true,
    }),
  component: AiVideoPrivacyPage,
});

function AnalysisCard({
  item,
  onDeleteAnalysis,
  onDeleteVideo,
}: {
  item: Awaited<ReturnType<typeof listMyAiAnalyses>>[number];
  onDeleteAnalysis: (reelId: string) => Promise<void>;
  onDeleteVideo: (reelId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"analysis" | "video" | null>(null);
  const [confirmVideo, setConfirmVideo] = useState(false);

  const run = async (kind: "analysis" | "video", fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{item.aiTitle || item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              item.sport,
              new Date(item.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              }),
              item.status === "processing"
                ? "Analyzing…"
                : item.status === "analysis_deleted"
                  ? "AI results deleted"
                  : item.hasAnalysis
                    ? "AI results saved"
                    : "No AI results",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Film className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>

      {item.aiCaption && (
        <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{item.aiCaption}</p>
      )}
      {item.hashtags.length > 0 && (
        <p className="mt-1 text-xs text-lime">{item.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
      )}
      {item.coachingNotes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.coachingNotes.map((n) => (
            <li key={n} className="text-xs text-muted-foreground">
              • {n}
            </li>
          ))}
        </ul>
      )}
      {item.hasAnalysis && (
        <p className="mt-2 text-[11px] italic text-muted-foreground">{AI_RESULTS_CAVEAT}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {item.hasAnalysis && (
          <button
            type="button"
            disabled={!item.deletable || busy !== null}
            onClick={() => void run("analysis", () => onDeleteAnalysis(item.reelId))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {busy === "analysis" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            Delete AI results
          </button>
        )}
        {confirmVideo ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("video", () => onDeleteVideo(item.reelId))}
              className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
            >
              {busy === "video" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Confirm delete video
            </button>
            <button
              type="button"
              onClick={() => setConfirmVideo(false)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
            >
              Keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => setConfirmVideo(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-destructive/50 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete video
          </button>
        )}
      </div>
      {!item.deletable && item.hasAnalysis && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          AI results can be deleted once this clip finishes processing.
        </p>
      )}
    </li>
  );
}

function AiVideoPrivacyPage() {
  const { prefs, isLoading, saving, update } = useMyPrivacy();
  const qc = useQueryClient();

  const analyses = useQuery({
    queryKey: ["my-ai-analyses"],
    queryFn: () => listMyAiAnalyses(),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["my-ai-analyses"] });

  const deleteAnalysis = useMutation({
    mutationFn: (reelId: string) => deleteMyAiAnalysis({ data: { reelId } }),
    onSuccess: () => {
      toast.success("AI results deleted");
      void refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't delete these AI results"),
  });

  const deleteVideo = useMutation({
    mutationFn: (reelId: string) => deleteReel({ data: { reelId } }),
    onSuccess: () => {
      toast.success("Video and AI results deleted");
      void refresh();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't delete this video"),
  });

  const save = async (patch: Partial<PrivacyPreferences>) => {
    try {
      await update(patch);
      toast.success("AI preferences saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save AI preferences");
    }
  };

  const items = analyses.data ?? [];

  return (
    <div className="min-h-dvh bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/settings" className="rounded-full p-2 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-medium">AI &amp; Video Privacy</h1>
      </header>

      <main className="mx-auto max-w-xl pb-4">
        <section className="px-4 pt-4">
          <AiDisclosureBody />
        </section>

        <SettingsGroup title="AI preferences">
          <SettingsStaticRow
            icon={Sparkles}
            label="AI analysis of my clips"
            description="Generate titles, captions, hashtags and coaching notes from clips you upload. Turning this off stops all AI analysis."
            trailing={
              <Switch
                checked={prefs.ai_processing}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ ai_processing: v })}
                aria-label="AI analysis of my clips"
              />
            }
          />
          <SettingsStaticRow
            label={AI_TRAINING_NOTE.settingLabel}
            description={AI_TRAINING_NOTE.settingDescription}
            trailing={
              <Switch
                checked={prefs.ai_training_opt_in}
                disabled={isLoading || saving}
                onCheckedChange={(v) => save({ ai_training_opt_in: v })}
                aria-label={AI_TRAINING_NOTE.settingLabel}
              />
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Your AI analyses">
          <SettingsStaticRow>
            {analyses.isLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your analyses…
              </p>
            ) : analyses.isError ? (
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t load your analyses. Pull down to retry.
              </p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No clips analyzed yet.{" "}
                <Link to="/reels" search={{ game: "", title: "", upload: "" }} className="font-semibold text-lime underline">
                  Upload a highlight
                </Link>
                .
              </p>
            ) : (
              <ul className="w-full space-y-3">
                {items.map((item) => (
                  <AnalysisCard
                    key={item.reelId}
                    item={item}
                    onDeleteAnalysis={(id) => deleteAnalysis.mutateAsync(id).then(() => {})}
                    onDeleteVideo={(id) => deleteVideo.mutateAsync(id).then(() => {})}
                  />
                ))}
              </ul>
            )}
          </SettingsStaticRow>
        </SettingsGroup>

        <SettingsGroup title="More">
          <SettingsStaticRow>
            <p className="text-xs text-muted-foreground">
              Deleting your account removes every clip, AI result, and derived file with it. See{" "}
              <Link to="/account/privacy" className="font-semibold text-lime underline">
                Privacy
              </Link>{" "}
              for profile and location controls, or the{" "}
              <Link to="/trust-center" className="font-semibold text-lime underline">
                Trust Center
              </Link>{" "}
              for how AI is used across ballaCity.
            </p>
          </SettingsStaticRow>
        </SettingsGroup>
      </main>
    </div>
  );
}
