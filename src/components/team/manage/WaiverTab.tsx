import { useState } from "react";
import { CheckCircle2, Clock, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTeamRoster } from "@/lib/team-roster";
import {
  useCreateAndPublishWaiver,
  usePublishedWaiver,
  useTeamWaivers,
  useWaiverSignatures,
  waiverErrorMessage,
} from "@/lib/team-waivers";

export function WaiverTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const current = usePublishedWaiver(teamId);
  const all = useTeamWaivers(teamId);
  const sigs = useWaiverSignatures(current.data?.id);
  const roster = useTeamRoster(teamId);
  const publish = useCreateAndPublishWaiver(teamId);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(`${teamName} participation waiver`);
  const [version, setVersion] = useState(String(new Date().getFullYear()));
  const [content, setContent] = useState("");

  const startEdit = () => {
    if (current.data) {
      setTitle(current.data.title);
      setContent(current.data.content);
      setVersion(`${current.data.version}-v2`);
    }
    setEditing(true);
  };

  const submit = () => {
    if (!content.trim() || !version.trim() || !title.trim()) {
      toast.error("Fill in a title, version and the waiver text.");
      return;
    }
    if (!window.confirm("Publish this waiver? Players must sign it before joining.")) return;
    publish.mutate(
      { title, version, content },
      {
        onSuccess: () => {
          toast.success("Waiver published");
          setEditing(false);
        },
        onError: (e) => toast.error(waiverErrorMessage(e)),
      },
    );
  };

  const signedBy = new Map((sigs.data ?? []).map((s) => [s.signerUserId, s]));
  const members = roster.data ?? [];
  const archived = (all.data ?? []).filter((w) => !w.published && w.publishedAt);

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
          <FileSignature className="h-4 w-4" /> Team waiver
        </h2>
        {current.data && !editing ? (
          <>
            <div>
              <div className="font-semibold">{current.data.title}</div>
              <div className="text-xs text-muted-foreground">
                Version {current.data.version}
                {current.data.publishedAt &&
                  ` · published ${new Date(current.data.publishedAt).toLocaleDateString()}`}
              </div>
            </div>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-sm text-muted-foreground">
              {current.data.content}
            </p>
            <Button variant="outline" onClick={startEdit}>
              Publish a new version
            </Button>
          </>
        ) : !editing ? (
          <>
            <p className="text-sm text-muted-foreground">
              No waiver yet. Once you publish one, invited players must sign it before they can
              join.
            </p>
            <Button onClick={startEdit}>Write a waiver</Button>
          </>
        ) : (
          <div className="space-y-3">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <Input
              value={version}
              maxLength={64}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="Version (e.g. 2026)"
            />
            <Textarea
              rows={10}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Waiver text players will agree to…"
            />
            <p className="text-xs text-muted-foreground">
              Published waivers can't be edited. A new version replaces the old one and everyone
              signs again.
            </p>
            <div className="flex gap-2">
              <Button disabled={publish.isPending} onClick={submit}>
                {publish.isPending ? "Publishing…" : "Publish"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {current.data && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="section-eyebrow text-muted-foreground">
            Signatures · {signedBy.size}/{members.length}
          </h2>
          {members.map((m) => {
            const s = signedBy.get(m.userId);
            return (
              <div key={m.userId} className="flex items-center justify-between text-sm">
                <span className="truncate">{m.displayName}</span>
                {s ? (
                  <span className="inline-flex items-center gap-1 text-xs text-lime">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {s.signedBy ? "Signed by guardian" : "Signed"} ·{" "}
                    {new Date(s.signedAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" /> Not signed
                  </span>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">
            Players already on the roster before this version aren't removed; new invitees must
            sign to join.
          </p>
        </section>
      )}

      {archived.length > 0 && (
        <section className="space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm">
          <h2 className="section-eyebrow text-muted-foreground">Past versions</h2>
          {archived.map((w) => (
            <div key={w.id} className="text-muted-foreground">
              {w.title} · v{w.version}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
