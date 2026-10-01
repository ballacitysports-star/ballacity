import { useState } from "react";
import { FileText, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateWaiverDraft,
  usePublishTeamWaiver,
  useTeamWaiverHistory,
  teamWaiverErrorMessage,
} from "@/lib/team-waivers";

/**
 * A team's liability waiver: once published, it blocks team_respond_invite's
 * accept path for anyone who hasn't signed it (src/lib/team-waivers.ts). A
 * team with no waiver here simply has none — opt-in, not a default blank one.
 */
export function WaiverTab({ teamId }: { teamId: string; teamName: string }) {
  const history = useTeamWaiverHistory(teamId);
  const createDraft = useCreateWaiverDraft(teamId);
  const publish = usePublishTeamWaiver(teamId);

  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("Team Waiver");
  const [content, setContent] = useState("");

  const rows = history.data ?? [];
  const published = rows.find((w) => w.published) ?? null;
  const drafts = rows.filter((w) => !w.published);

  const onCreate = () => {
    if (!version.trim() || !content.trim()) {
      toast.error("Add a version and some content first");
      return;
    }
    createDraft.mutate(
      { version: version.trim(), title: title.trim() || "Team Waiver", content: content.trim() },
      {
        onSuccess: () => {
          toast.success("Draft saved");
          setVersion("");
          setContent("");
        },
        onError: (e) => toast.error(teamWaiverErrorMessage(e)),
      },
    );
  };

  return (
    <div className="space-y-4">
      <h2 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
        <ShieldCheck className="h-4 w-4" /> Liability waiver
      </h2>

      {history.isLoading ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : published ? (
        <div className="rounded-2xl border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Published · v{published.version}</div>
            <span className="rounded-full bg-lime/15 px-2 py-0.5 text-[10px] font-bold text-lime">
              Live — blocks unsigned joins
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
            {published.content}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-5 text-center text-sm text-muted-foreground">
          No waiver published. Members can join freely until you publish one.
        </div>
      )}

      {drafts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">Drafts</div>
          {drafts.map((w) => (
            <div
              key={w.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-surface p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">v{w.version}</div>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{w.content}</p>
              </div>
              <Button
                size="sm"
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate(w.id, {
                    onSuccess: () => toast.success("Waiver published"),
                    onError: (e) => toast.error(teamWaiverErrorMessage(e)),
                  })
                }
              >
                Publish
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 rounded-2xl border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <FileText className="h-3.5 w-3.5" /> Draft a new version
        </div>
        <Input
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="Version (e.g. 2026-10-01)"
          maxLength={64}
        />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Waiver content…"
          rows={6}
        />
        <Button onClick={onCreate} disabled={createDraft.isPending} size="sm">
          Save draft
        </Button>
      </div>
    </div>
  );
}
