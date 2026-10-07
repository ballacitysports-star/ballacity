import { useState } from "react";
import { CheckCircle2, Clock, FileSignature, PenLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useTeamRoster } from "@/lib/team-roster";
import {
  useDeleteWaiverDraft,
  usePublishWaiverDraft,
  usePublishedWaiver,
  useSaveWaiverDraft,
  useSignWaiver,
  useTeamWaivers,
  useWaiverSignatures,
  waiverErrorMessage,
  type TeamWaiver,
} from "@/lib/team-waivers";

export function WaiverTab({ teamId, teamName }: { teamId: string; teamName: string }) {
  const { user } = useAuth();
  const current = usePublishedWaiver(teamId);
  const all = useTeamWaivers(teamId);
  const sigs = useWaiverSignatures(current.data?.id);
  const roster = useTeamRoster(teamId);
  const save = useSaveWaiverDraft(teamId);
  const publish = usePublishWaiverDraft();
  const remove = useDeleteWaiverDraft();
  const sign = useSignWaiver();

  const [editing, setEditing] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [title, setTitle] = useState(`${teamName} participation waiver`);
  const [version, setVersion] = useState(String(new Date().getFullYear()));
  const [content, setContent] = useState("");

  const drafts = (all.data ?? []).filter((w) => !w.published && !w.publishedAt);
  const archived = (all.data ?? []).filter((w) => !w.published && w.publishedAt);
  const signedBy = new Map((sigs.data ?? []).map((s) => [s.signerUserId, s]));
  const members = roster.data ?? [];
  const iSigned = !!user && signedBy.has(user.id);

  const openEditor = (w?: TeamWaiver) => {
    if (w) {
      setDraftId(w.id);
      setTitle(w.title);
      setVersion(w.version);
      setContent(w.content);
    } else {
      setDraftId(null);
      if (current.data) {
        setTitle(current.data.title);
        setContent(current.data.content);
        setVersion(`${current.data.version}-v2`);
      }
    }
    setEditing(true);
  };

  const valid = () => {
    if (!content.trim() || !version.trim() || !title.trim()) {
      toast.error("Fill in a title, version and the waiver text.");
      return false;
    }
    return true;
  };

  const saveDraft = async (thenPublish: boolean) => {
    if (!valid()) return;
    if (
      thenPublish &&
      !window.confirm("Publish this waiver? Everyone joining must sign it, and it can't be edited after.")
    )
      return;
    try {
      const id = await save.mutateAsync({ id: draftId, title, version, content });
      setDraftId(id);
      if (thenPublish) {
        await publish.mutateAsync(id);
        toast.success("Waiver published");
        setEditing(false);
        setDraftId(null);
      } else {
        toast.success("Draft saved");
      }
    } catch (e) {
      toast.error(waiverErrorMessage(e));
    }
  };

  const busy = save.isPending || publish.isPending;

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        <h2 className="inline-flex items-center gap-2 section-eyebrow text-muted-foreground">
          <FileSignature className="h-4 w-4" /> Team waiver
        </h2>
        {editing ? (
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
              Drafts are only visible to team leaders. Published waivers can't be edited — a new
              version replaces the old one and everyone joining signs again.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => saveDraft(true)}>
                {publish.isPending ? "Publishing…" : "Publish"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => saveDraft(false)}>
                {save.isPending && !publish.isPending ? "Saving…" : "Save draft"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : current.data ? (
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
            <div className="flex flex-wrap gap-2">
              {iSigned ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-3 py-1.5 text-xs font-bold text-lime">
                  <CheckCircle2 className="h-3.5 w-3.5" /> You signed this
                </span>
              ) : (
                <Button
                  disabled={sign.isPending}
                  onClick={() =>
                    sign.mutate(
                      { teamId, waiverId: current.data!.id },
                      {
                        onSuccess: () => toast.success("Signed"),
                        onError: (e) => toast.error(waiverErrorMessage(e)),
                      },
                    )
                  }
                >
                  <PenLine className="mr-1.5 h-3.5 w-3.5" />
                  {sign.isPending ? "Signing…" : "Sign it yourself"}
                </Button>
              )}
              <Button variant="outline" onClick={() => openEditor()}>
                Draft a new version
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              No waiver published. Once you publish one, nobody can join — by invite, guardian
              approval or tryout sign-up — without signing it.
            </p>
            <Button onClick={() => openEditor()}>Write a waiver</Button>
          </>
        )}
      </section>

      {drafts.length > 0 && !editing && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="section-eyebrow text-muted-foreground">Drafts · {drafts.length}</h2>
          {drafts.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {w.title} · v{w.version}
              </span>
              <Button size="sm" variant="outline" onClick={() => openEditor(w)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete draft"
                onClick={() => {
                  if (!window.confirm("Delete this draft?")) return;
                  remove.mutate(w.id, {
                    onSuccess: () => toast.success("Draft deleted"),
                    onError: (e) => toast.error(waiverErrorMessage(e)),
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </section>
      )}

      {current.data && (
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="section-eyebrow text-muted-foreground">
            Signatures · {members.filter((m) => signedBy.has(m.userId)).length}/{members.length}
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
            Players already on the roster aren't removed; everyone new must sign to join.
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
