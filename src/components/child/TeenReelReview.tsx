/**
 * Parent Center: review a 13-15 player's reels and decide who can watch them.
 *
 * Every reel is Guardian only unless a verified guardian approves ONE of the player's
 * teams here. A guardian can take the approval back or delete the reel at any time;
 * the player cannot widen anything. The server and the database re-check the guardian
 * link, the player's age, the team and the reel's state on every change and every view.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { REEL_PRIVACY_PATH, TEEN_RESTRICTION } from "@/lib/teen-reel-privacy";
import {
  deleteTeenReel,
  getTeenReelPlayback,
  listTeenReels,
  setTeenReelTeam,
  type TeenReelRow,
  type TeenReelTeam,
} from "@/lib/teen-reels.functions";

function ReelItem({
  childUserId,
  reel,
  teams,
  onChanged,
}: {
  childUserId: string;
  reel: TeenReelRow;
  teams: TeenReelTeam[];
  onChanged: () => void;
}) {
  const playFn = useServerFn(getTeenReelPlayback);
  const setFn = useServerFn(setTeenReelTeam);
  const delFn = useServerFn(deleteTeenReel);
  const [open, setOpen] = useState(false);
  const [teamId, setTeamId] = useState(teams[0]?.teamId ?? "");
  const [busy, setBusy] = useState(false);
  const { data: play, isFetching } = useQuery({
    queryKey: ["teen-reel-playback", reel.id],
    queryFn: () => playFn({ data: { childUserId, reelId: reel.id } }),
    enabled: open,
    retry: false,
  });

  const canApprove = reel.status === "completed" && !reel.isDraft && !reel.onHold;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save this");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-border bg-background/60 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left" aria-expanded={open}>
        <p className="truncate text-sm font-semibold">{reel.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {new Date(reel.createdAt).toLocaleDateString()} ·{" "}
          {reel.onHold ? "On a safety hold" : reel.isDraft ? "Not posted yet" : reel.status === "completed" ? "Posted" : reel.status}
        </p>
        <p className={`text-[11px] font-semibold ${reel.state === "team" ? "text-lime" : "text-muted-foreground"}`}>
          {reel.state === "team" ? `Approved for ${reel.teamName}` : "Guardian only"}
        </p>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {isFetching && !play ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : play && play.found ? (
            <video
              src={play.videoUrl}
              poster={play.thumbnailUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-lg bg-black"
            />
          ) : (
            <p className="text-xs text-muted-foreground">This reel can&apos;t be played right now.</p>
          )}

          {reel.state === "team" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(() => setFn({ data: { childUserId, reelId: reel.id, teamId: null } }), "Back to guardian only")
              }
            >
              <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Take back to guardian only
            </Button>
          ) : teams.length === 0 ? (
            <p className="text-xs text-muted-foreground">Your child isn&apos;t on a team yet, so there is nothing to approve.</p>
          ) : (
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold text-muted-foreground">
                Approve for team
                <select
                  value={teamId}
                  onChange={(e) => setTeamId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal text-foreground"
                >
                  {teams.map((t) => (
                    <option key={t.teamId} value={t.teamId}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                disabled={busy || !teamId || !canApprove}
                onClick={() =>
                  run(() => setFn({ data: { childUserId, reelId: reel.id, teamId } }), "Approved for that team")
                }
              >
                Approve Verified team &amp; coaches
              </Button>
              {!canApprove && (
                <p className="text-[11px] text-muted-foreground">
                  It can be approved once it is finished, posted and not on hold. It stays Guardian only until then.
                </p>
              )}
            </div>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => {
              if (window.confirm("Delete this reel and its files? This can't be undone.")) {
                void run(() => delFn({ data: { childUserId, reelId: reel.id } }), "Reel deleted");
              }
            }}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Delete reel
          </Button>
        </div>
      )}
    </li>
  );
}

export function TeenReelReview({ childUserId, childName }: { childUserId: string; childName: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTeenReels);
  const key = ["teen-reels", childUserId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listFn({ data: { childUserId } }),
    retry: false,
  });

  return (
    <div className="rounded-xl border border-border p-3" aria-label={`${childName}'s reels`}>
      <div className="text-sm font-semibold">{childName}&apos;s reels</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Every reel is Guardian only. You can approve one team&apos;s members and coaches for a reel, take that back,
        or delete it, at any time. {TEEN_RESTRICTION}{" "}
        <Link to={REEL_PRIVACY_PATH} className="font-semibold text-primary underline">
          Reel privacy policy
        </Link>
      </p>
      {isLoading ? (
        <Loader2 className="mt-3 h-4 w-4 animate-spin text-muted-foreground" />
      ) : !data || data.reels.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No reels yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.reels.map((r) => (
            <ReelItem
              key={`${r.id}-${r.state}-${r.teamId ?? ""}`}
              childUserId={childUserId}
              reel={r}
              teams={data.teams}
              onChanged={() => void qc.invalidateQueries({ queryKey: key })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
