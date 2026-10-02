import { useState } from "react";
import { fetchWaiverRequirement, type TeamWaiver } from "@/lib/team-waivers";
import { SignWaiverDialog } from "@/components/team/SignWaiverDialog";
import { toast } from "sonner";
import { CalendarDays, Check, Inbox, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  guardianApprovalError,
  useGuardianApprovals,
  useGuardianDecision,
} from "@/lib/guardian-approvals";

function ItemCard({
  icon,
  title,
  lines,
  busy,
  onApprove,
  onDecline,
}: {
  icon: React.ReactNode;
  title: string;
  lines: Array<string | null>;
  busy: boolean;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <li className="rounded-xl border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          {lines.filter(Boolean).map((l) => (
            <p key={l} className="mt-0.5 text-xs text-muted-foreground">
              {l}
            </p>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" disabled={busy} onClick={onApprove}>
          <Check className="h-4 w-4" aria-hidden /> Approve
        </Button>
        <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={onDecline}>
          <X className="h-4 w-4" aria-hidden /> Decline
        </Button>
      </div>
    </li>
  );
}

export function GuardianApprovalsDashboard() {
  const { invites, requests, isLoading, hasChildren } = useGuardianApprovals();
  const { invite, request } = useGuardianDecision();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [waiverFor, setWaiverFor] = useState<{
    invite: import("@/lib/guardian-approvals").GuardianTeamInvite;
    waiver: TeamWaiver;
  } | null>(null);

  if (!hasChildren) return null;
  const total = invites.length + requests.length;

  const decide = (
    kind: "invite" | "request",
    id: string,
    approve: boolean,
    childName: string,
    what: string,
  ) => {
    if (!approve && !window.confirm(`Decline ${what} for ${childName}?`)) return;
    setBusyId(id);
    const m = kind === "invite" ? invite : request;
    m.mutate(
      { id, approve },
      {
        onSuccess: () =>
          toast.success(
            approve
              ? `Approved — ${childName.split(" ")[0]} can now accept.`
              : `Declined ${what}.`,
          ),
        onError: (e) => toast.error(guardianApprovalError(e)),
        onSettled: () => setBusyId(null),
      },
    );
  };

  return (
    <section className="mt-4 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold">Needs your approval</h2>
        {total > 0 ? (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
            {total}
          </span>
        ) : null}
      </div>

      {isLoading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : total === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Inbox className="h-4 w-4" aria-hidden /> Nothing waiting — team invites and game requests
          for your children will show up here.
        </div>
      ) : (
        <>
          {invites.length > 0 ? (
            <>
              <h3 className="mt-4 section-eyebrow text-muted-foreground">Team invites</h3>
              <ul className="mt-2 space-y-2">
                {invites.map((i) => (
                  <ItemCard
                    key={i.id}
                    icon={<Users className="h-4 w-4" aria-hidden />}
                    title={`${i.childName} → ${i.teamName}`}
                    lines={[
                      `Invited as ${i.role}`,
                      i.message ? `“${i.message}”` : null,
                      `Expires ${new Date(i.expiresAt).toLocaleDateString()}`,
                    ]}
                    busy={busyId === i.id}
                    onApprove={async () => {
                      const req = await fetchWaiverRequirement(i.teamId, i.childUserId);
                      if (req && !req.signed) {
                        setWaiverFor({ invite: i, waiver: req.waiver });
                        return;
                      }
                      decide("invite", i.id, true, i.childName, "this invite");
                    }}
                    onDecline={() => decide("invite", i.id, false, i.childName, "this invite")}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {requests.length > 0 ? (
            <>
              <h3 className="mt-4 section-eyebrow text-muted-foreground">Game requests</h3>
              <ul className="mt-2 space-y-2">
                {requests.map((r) => (
                  <ItemCard
                    key={r.id}
                    icon={<CalendarDays className="h-4 w-4" aria-hidden />}
                    title={`${r.childName} wants to join ${r.gameTitle}`}
                    lines={[
                      r.gameDate ? new Date(r.gameDate).toLocaleDateString() : null,
                      r.message ? `“${r.message}”` : null,
                    ]}
                    busy={busyId === r.id}
                    onApprove={() => decide("request", r.id, true, r.childName, "this request")}
                    onDecline={() => decide("request", r.id, false, r.childName, "this request")}
                  />
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      <SignWaiverDialog
        open={!!waiverFor}
        onOpenChange={(o) => !o && setWaiverFor(null)}
        waiver={waiverFor?.waiver ?? null}
        teamName={waiverFor?.invite.teamName ?? ""}
        onBehalfOf={waiverFor?.invite.childUserId}
        childName={waiverFor?.invite.childName}
        onSigned={() => {
          const i = waiverFor?.invite;
          if (i) decide("invite", i.id, true, i.childName, "this invite");
        }}
      />
    </section>
  );
}
