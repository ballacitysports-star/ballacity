import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileSignature, Mail, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignWaiverDialog } from "@/components/team/SignWaiverDialog";
import type { ChildActivity, ChildWaiver } from "@/lib/guardian-activity.functions";
import type { TeamWaiver } from "@/lib/team-waivers";

const INVITE_LABEL: Record<string, string> = {
  pending: "Waiting",
  accepted: "Joined",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

/** Invites, waivers and team updates for a guardian's linked children (read-only, plus sign-on-behalf). */
export function ParentPortalSections({
  kids,
  multi,
  onSigned,
}: {
  kids: ChildActivity[];
  multi: boolean;
  onSigned: () => void;
}) {
  const [signing, setSigning] = useState<{ w: ChildWaiver; childId: string; childName: string } | null>(null);
  const invites = kids.flatMap((k) => k.invites.map((i) => ({ i, child: k.name })));
  const waivers = kids.flatMap((k) => k.waivers.map((w) => ({ w, child: k.name, childId: k.childUserId })));
  const updates = kids
    .flatMap((k) => k.updates.map((u) => ({ u, child: k.name })))
    .filter((x, idx, arr) => arr.findIndex((y) => y.u.id === x.u.id) === idx)
    .sort((a, b) => b.u.createdAt.localeCompare(a.u.createdAt));

  const dialogWaiver: TeamWaiver | null = signing
    ? {
        id: signing.w.waiverId,
        teamId: signing.w.teamId,
        version: signing.w.version,
        title: signing.w.title,
        content: signing.w.content,
        published: true,
        publishedAt: null,
      }
    : null;

  return (
    <>
      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold">
          <Mail className="h-4 w-4" aria-hidden /> Team invites
        </h2>
        <div className="mt-2 space-y-2">
          {invites.length === 0 ? (
            <p className="text-xs text-muted-foreground">No team invites.</p>
          ) : (
            invites.map(({ i, child }) => (
              <div key={i.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{i.teamName}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {multi ? `${child} · ` : ""}
                    {i.role} · {new Date(i.createdAt).toLocaleDateString()}
                    {i.guardianApproved ? " · You approved" : ""}
                  </p>
                </div>
                {i.status === "pending" && !i.guardianApproved ? (
                  <Link to="/parent" className="shrink-0 text-xs font-semibold text-primary underline">
                    Review
                  </Link>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {INVITE_LABEL[i.status] ?? i.status}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold">
          <FileSignature className="h-4 w-4" aria-hidden /> Waivers
        </h2>
        <div className="mt-2 space-y-2">
          {waivers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No team waivers to sign.</p>
          ) : (
            waivers.map(({ w, child, childId }) => (
              <div key={childId + w.waiverId} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{w.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {multi ? `${child} · ` : ""}
                    {w.teamName} · v{w.version}
                    {w.signedAt
                      ? ` · Signed ${new Date(w.signedAt).toLocaleDateString()}${w.signedByGuardian ? " by guardian" : ""}`
                      : ""}
                  </p>
                </div>
                {w.signedAt ? (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">Signed</span>
                ) : (
                  <Button size="sm" onClick={() => setSigning({ w, childId, childName: child })}>
                    Sign for {child.split(" ")[0]}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold">
          <Megaphone className="h-4 w-4" aria-hidden /> Team updates
        </h2>
        <div className="mt-2 space-y-2">
          {updates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No team updates yet.</p>
          ) : (
            updates.map(({ u }) => (
              <Link
                key={u.id}
                to="/teams/$teamId"
                params={{ teamId: u.teamId }}
                className="block rounded-xl border border-border bg-surface p-3"
              >
                <p className="text-xs text-muted-foreground">
                  {u.teamName} · <span className="capitalize">{u.kind}</span> ·{" "}
                  {new Date(u.createdAt).toLocaleDateString()}
                </p>
                {u.title && <p className="mt-0.5 text-sm font-semibold">{u.title}</p>}
                {u.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{u.body}</p>}
                {u.eventDate && (
                  <p className="mt-0.5 text-xs text-primary">{new Date(u.eventDate).toLocaleString()}</p>
                )}
              </Link>
            ))
          )}
        </div>
      </section>

      <SignWaiverDialog
        open={!!signing}
        onOpenChange={(o) => !o && setSigning(null)}
        waiver={dialogWaiver}
        teamName={signing?.w.teamName ?? ""}
        onBehalfOf={signing?.childId}
        childName={signing?.childName}
        onSigned={onSigned}
      />
    </>
  );
}
