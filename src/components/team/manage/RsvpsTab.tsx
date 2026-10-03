import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, FileSignature, Loader2, X } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { getTeamRosterOverview } from "@/lib/tryouts.functions";

type Waiver = { signedAt: string; byGuardian: boolean } | null;

function WaiverBadge({ waiver, required }: { waiver: Waiver; required: boolean }) {
  if (!required) return <span className="text-[11px] text-muted-foreground">No waiver</span>;
  return waiver ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-[11px] font-bold text-lime">
      <Check className="h-3 w-3" /> Signed{waiver.byGuardian ? " by guardian" : ""}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-[11px] font-bold text-coral">
      <X className="h-3 w-3" /> Not signed
    </span>
  );
}

export function RsvpsTab({ teamId }: { teamId: string }) {
  const fn = useServerFn(getTeamRosterOverview);
  const q = useQuery({ queryKey: ["team-roster-overview", teamId], queryFn: () => fn({ data: { teamId } }) });
  const [filter, setFilter] = useState<"all" | "unsigned">("all");

  if (q.isLoading)
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  if (q.error || !q.data) return <p className="text-sm text-coral">Couldn't load roster details.</p>;

  const { members, events, waiverVersion } = q.data;
  const required = !!waiverVersion;
  const shown = filter === "unsigned" ? members.filter((m) => !m.waiver) : members;
  const signedCount = members.filter((m) => m.waiver).length;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-eyebrow text-muted-foreground">
            <FileSignature className="mr-1 inline h-4 w-4" />
            Roster waivers {required ? `· v${waiverVersion} · ${signedCount}/${members.length} signed` : "· no waiver published"}
          </h2>
          {required && (
            <div className="flex gap-1 text-xs">
              {(["all", "unsigned"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 font-bold ${filter === f ? "border-lime text-lime" : "border-border text-muted-foreground"}`}>
                  {f === "all" ? "All" : "Not signed"}
                </button>
              ))}
            </div>
          )}
        </div>
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
              <UserAvatar avatarUrl={m.avatar} initials={null} name={m.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.name}</p>
                <p className="text-xs text-muted-foreground capitalize">
                  {m.role}{m.jersey ? ` · #${m.jersey}` : ""}{m.position ? ` · ${m.position}` : ""}
                </p>
              </div>
              <WaiverBadge waiver={m.waiver} required={required} />
            </li>
          ))}
          {shown.length === 0 && <p className="text-sm text-muted-foreground">Everyone has signed.</p>}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 section-eyebrow text-muted-foreground">Tryout &amp; camp RSVPs</h2>
        {events.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No tryouts or camps posted yet. Post one from the home page.
          </p>
        ) : (
          <div className="space-y-4">
            {events.map((e) => {
              const going = e.rsvps.filter((r) => r.status === "registered");
              const cancelled = e.rsvps.length - going.length;
              return (
                <div key={e.id} className="rounded-2xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold">{e.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.eventDate ? new Date(e.eventDate).toLocaleDateString() : "Date TBA"} · {going.length}
                      {e.spotsMax ? `/${e.spotsMax}` : ""} going{cancelled ? ` · ${cancelled} cancelled` : ""}
                    </p>
                  </div>
                  {going.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No RSVPs yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {going.map((r) => (
                        <li key={r.userId} className="flex items-center gap-3">
                          <UserAvatar avatarUrl={r.avatar} initials={null} name={r.name} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{r.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {r.isMember ? "On roster" : "New prospect"}{r.byGuardian ? " · registered by guardian" : ""}
                            </p>
                          </div>
                          <WaiverBadge waiver={r.waiver} required={required} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
