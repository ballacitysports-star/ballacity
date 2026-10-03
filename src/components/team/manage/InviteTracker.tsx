import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Clock, FileSignature, Loader2, ShieldCheck, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { getTeamInviteTracker } from "@/lib/tryouts.functions";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Waiting" },
  { key: "accepted", label: "Joined" },
  { key: "declined", label: "Declined" },
  { key: "expired", label: "Expired" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-secondary text-foreground",
  accepted: "bg-lime/15 text-lime",
  declined: "bg-coral/15 text-coral",
  expired: "bg-secondary text-muted-foreground",
  cancelled: "bg-secondary text-muted-foreground",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting",
  accepted: "Joined",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function InviteTracker({ teamId }: { teamId: string }) {
  const fn = useServerFn(getTeamInviteTracker);
  const q = useQuery({
    queryKey: ["team-invite-tracker", teamId],
    queryFn: () => fn({ data: { teamId } }),
    refetchInterval: 20_000,
  });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  if (q.isLoading)
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading responses…
      </div>
    );
  if (!q.data) return <p className="text-sm text-coral">Couldn't load invite responses.</p>;

  const { invites, waiverVersion } = q.data;
  const count = (k: string) => (k === "all" ? invites.length : invites.filter((i) => i.status === k).length);
  const rows = filter === "all" ? invites : invites.filter((i) => i.status === filter);

  return (
    <section className="space-y-3">
      <h2 className="section-eyebrow text-muted-foreground">Responses</h2>
      <p className="flex items-start gap-2 rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
        <FileSignature className="mt-0.5 h-4 w-4 shrink-0" />
        {waiverVersion
          ? `Waiver v${waiverVersion} is collected automatically — athletes (or their guardian) must sign it before they can accept.`
          : "No waiver published. Publish one in the Waiver tab and every invited athlete will be asked to sign it before joining."}
      </p>

      <div className="flex flex-wrap gap-1 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-3 py-1 font-bold ${filter === f.key ? "border-lime text-lime" : "border-border text-muted-foreground"}`}
          >
            {f.label} · {count(f.key)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
              <UserAvatar avatarUrl={i.avatar} name={i.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{i.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLE[i.status] ?? STATUS_STYLE.pending}`}>
                    {STATUS_LABEL[i.status] ?? i.status}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <Clock className="h-3 w-3" /> sent {new Date(i.sentAt).toLocaleDateString()}
                  </span>
                  {i.needsGuardian && (
                    <span className="inline-flex items-center gap-0.5">
                      <ShieldCheck className="h-3 w-3" /> {i.guardianApproved ? "Guardian approved" : "Needs guardian OK"}
                    </span>
                  )}
                </div>
              </div>
              {waiverVersion &&
                (i.waiverSigned ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">
                    <Check className="h-3 w-3" /> Waiver{i.waiverByGuardian ? " (guardian)" : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    <X className="h-3 w-3" /> Waiver
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
