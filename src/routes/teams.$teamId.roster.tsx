import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Mail, Trophy, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/UserAvatar";
import { emailRosterPrintout, getRosterBoard, saveRosterDetails } from "@/lib/tryouts.functions";
import { teamRosterErrorMessage, useTeamRosterActions } from "@/lib/team-roster";

export const Route = createFileRoute("/teams/$teamId/roster")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Team roster | BallaCity" },
      { name: "description", content: "Manage your roster: birth years, positions and tryout rankings." },
      { property: "og:title", content: "Team roster | BallaCity" },
      { property: "og:description", content: "Manage your roster with birth years, positions and tryout rankings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: RosterPage,
});

type Tryout = { score: number | null; attended: boolean; tryout: string } | null;

function TryoutTag({ t }: { t: Tryout }) {
  if (!t) return <span className="text-[11px] text-muted-foreground">No tryout</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-semibold text-lime" title={t.tryout}>
      <Trophy className="h-3 w-3" />
      {t.score != null ? `${t.score}/10` : t.attended ? "Attended" : "Applied"}
    </span>
  );
}

function MemberRow({ teamId, m, onSaved }: { teamId: string; m: any; onSaved: () => void }) {
  const save = useServerFn(saveRosterDetails);
  const [year, setYear] = useState(m.birthYear ? String(m.birthYear) : "");
  const [pos, setPos] = useState(m.position ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = year !== (m.birthYear ? String(m.birthYear) : "") || pos !== (m.position ?? "");
  const onSave = async () => {
    const y = year.trim() ? Number(year) : null;
    if (y != null && (!Number.isInteger(y) || y < 1940 || y > 2030)) return toast.error("Enter a 4-digit birth year.");
    setBusy(true);
    const r = await save({ data: { teamId, userId: m.userId, birthYear: y, position: pos } }).catch(() => ({ ok: false as const, error: "Couldn't save." }));
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Saved");
    onSaved();
  };
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <UserAvatar avatarUrl={m.avatar} name={m.name} size="sm" />
      <div className="min-w-[8rem] flex-1">
        <p className="text-sm font-semibold">{m.name}{m.jersey ? ` · #${m.jersey}` : ""}</p>
        <p className="text-[11px] capitalize text-muted-foreground">{m.role}</p>
      </div>
      <TryoutTag t={m.tryout} />
      <Input aria-label="Birth year" inputMode="numeric" maxLength={4} placeholder="Birth year" value={year}
        onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} className="h-8 w-24" />
      <Input aria-label="Position" maxLength={40} placeholder="Position" value={pos}
        onChange={(e) => setPos(e.target.value)} className="h-8 w-32" />
      <Button size="sm" disabled={!dirty || busy} onClick={onSave}>Save</Button>
    </li>
  );
}

function RosterPage() {
  const { teamId } = Route.useParams();
  const qc = useQueryClient();
  const boardFn = useServerFn(getRosterBoard);
  const emailFn = useServerFn(emailRosterPrintout);
  const board = useQuery({ queryKey: ["roster-board", teamId], queryFn: () => boardFn({ data: { teamId } }) });
  const { invite } = useTeamRosterActions(teamId);
  const [emailing, setEmailing] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["roster-board", teamId] });

  const onEmailRoster = async (postId: string, title: string) => {
    setEmailing(true);
    const r = await emailFn({ data: { teamId, postId } })
      .catch(() => null);
    setEmailing(false);
    if (!r) return toast.error("Couldn't send the roster emails. Try again.");
    toast.success(`Printable roster emailed for ${title}: ${r.sent} sent${r.skipped ? `, ${r.skipped} skipped` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`);
  };

  const onInvite = (userId: string, name: string) =>
    invite.mutate({ userId, role: "player" }, {
      onSuccess: () => toast.success(`Invite sent to ${name}. Parents approve it for minors.`),
      onError: (e) => toast.error(teamRosterErrorMessage(e)),
    });

  return (
    <main className="page-shell max-w-3xl py-6">
      <Link to="/teams/$teamId/manage" params={{ teamId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Manage team
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl font-bold">Roster</h1>
        <div className="flex items-center gap-2">
          {board.data?.upcomingTryout ? (
            <Button size="sm" variant="outline" disabled={emailing}
              onClick={() => onEmailRoster(board.data!.upcomingTryout!.id, board.data!.upcomingTryout!.title)}>
              <Mail className="mr-1 h-4 w-4" /> Email printable roster
            </Button>
          ) : null}
          <Link to="/teams/$teamId/tryouts" params={{ teamId }} className="rounded-full border border-border px-3 py-1 text-xs font-bold text-muted-foreground">
            Tryout rankings
          </Link>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Birth years are only visible to owners, managers and coaches.</p>

      {board.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : board.error ? (
        <p className="mt-6 text-sm text-coral">Only owners, managers and coaches can view this page.</p>
      ) : (
        <>
          <section className="mt-6">
            <h2 className="section-eyebrow mb-3 text-muted-foreground">On the team ({board.data!.members.length})</h2>
            <ul className="space-y-2">
              {board.data!.members.map((m) => <MemberRow key={m.userId} teamId={teamId} m={m} onSaved={refresh} />)}
            </ul>
          </section>
          <section className="mt-8">
            <h2 className="section-eyebrow mb-3 text-muted-foreground">Add from tryout rankings</h2>
            {board.data!.prospects.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Everyone who tried out is already on the roster.
              </p>
            ) : (
              <ul className="space-y-2">
                {board.data!.prospects.map((p, i) => (
                  <li key={p.userId} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
                    <span className="w-5 text-sm font-bold text-muted-foreground">{i + 1}</span>
                    <UserAvatar avatarUrl={p.avatar} name={p.name} size="sm" />
                    <p className="flex-1 text-sm font-semibold">{p.name}</p>
                    <TryoutTag t={p.tryout} />
                    <Button size="sm" variant="outline" disabled={invite.isPending} onClick={() => onInvite(p.userId, p.name)}>
                      <UserPlus className="mr-1 h-4 w-4" /> Invite
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
