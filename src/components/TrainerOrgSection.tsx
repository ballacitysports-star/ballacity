import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Building2, Check, X, Loader2, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";

import { toast } from "sonner";
import {
  createTrainerOrg,
  leaveTrainerOrg,
  listInvitesForTrainer,
  listMyTrainerOrgMemberships,
  listTrainerOrgs,
  requestToJoinTrainerOrg,
  respondToTrainerOrgInvite,
} from "@/lib/trainer-orgs.functions";

type Props = { trainerId: string };

/**
 * Self-service organization panel for a trainer profile owner.
 * Renders on the trainer's own profile: shows current org, pending invites,
 * and lets them search+join or create a new org.
 */
export function TrainerOrgSection({ trainerId }: Props) {
  const qc = useQueryClient();
  const memberships = useQuery({
    queryKey: ["trainer-org-memberships", trainerId],
    queryFn: () => listMyTrainerOrgMemberships({ data: { trainerId } }),
  });
  const invites = useQuery({
    queryKey: ["trainer-org-invites", trainerId],
    queryFn: () => listInvitesForTrainer({ data: { trainerId } }),
  });

  const current = memberships.data?.[0];
  const [mode, setMode] = useState<"idle" | "join" | "create">("idle");

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["trainer-org-memberships", trainerId] });
    qc.invalidateQueries({ queryKey: ["trainer-org-invites", trainerId] });
    qc.invalidateQueries({ queryKey: ["trainer-org"] });
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4 text-lime" />
        <h3 className="text-sm font-semibold">Gym</h3>
      </div>

      {current ? (
        <div className="flex items-center justify-between rounded-xl border border-border/50 bg-background px-3 py-2">
          <div className="min-w-0">
            <Link
              to="/orgs/$orgId"
              params={{ orgId: current.org_id }}
              className="text-sm font-medium hover:underline truncate block"
            >
              {current.org?.name ?? "Gym"}
              {current.org?.verified ? " ✓" : ""}
            </Link>
            <div className="text-[11px] text-muted-foreground">
              Role: {current.role}
              {current.org?.city ? ` · ${current.org.city}` : ""}
            </div>
          </div>
          {current.role !== "owner" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await leaveTrainerOrg({ data: { orgId: current.org_id, trainerId } });
                  toast.success("Left organization");
                  invalidate();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to leave");
                }
              }}
            >
              Leave
            </Button>
          )}
        </div>
      ) : (
        <>
          {(invites.data ?? []).length > 0 && (
            <div className="space-y-2">
              <div className="micro-label text-muted-foreground">
                Pending invites
              </div>
              {invites.data!.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl border border-border/50 bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{inv.org?.name}</div>
                    <div className="text-[11px] text-muted-foreground">Role: {inv.role}</div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await respondToTrainerOrgInvite({
                            data: { inviteId: inv.id, action: "accept" },
                          });
                          toast.success("Joined organization");
                          invalidate();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await respondToTrainerOrgInvite({
                            data: { inviteId: inv.id, action: "decline" },
                          });
                          invalidate();
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Failed");
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {mode === "idle" && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setMode("join")}>
                <Search className="h-3.5 w-3.5 mr-1" /> Find & join
              </Button>
              <Button size="sm" onClick={() => setMode("create")}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create org
              </Button>
            </div>
          )}

          {mode === "join" && (
            <JoinForm
              trainerId={trainerId}
              onDone={() => {
                setMode("idle");
                invalidate();
              }}
            />
          )}
          {mode === "create" && (
            <CreateForm
              trainerId={trainerId}
              onDone={() => {
                setMode("idle");
                invalidate();
              }}
            />
          )}
          {mode !== "idle" && (
            <button
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={() => setMode("idle")}
            >
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
}

function JoinForm({ trainerId, onDone }: { trainerId: string; onDone: () => void }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["trainer-orgs-search", q],
    queryFn: () => listTrainerOrgs({ data: { search: q } }),
  });
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search organizations…"
        className="h-9"
      />
      <div className="max-h-56 overflow-auto space-y-1">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {(data ?? []).map((o) => (
          <div
            key={o.id}
            className="flex items-center justify-between rounded-lg border border-border/40 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {o.name}
                {o.verified ? " ✓" : ""}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                @{o.handle}
                {o.city ? ` · ${o.city}` : ""}
              </div>
            </div>
            <Button
              size="sm"
              disabled={pending === o.id}
              onClick={async () => {
                setPending(o.id);
                try {
                  await requestToJoinTrainerOrg({
                    data: { orgId: o.id, trainerId },
                  });
                  toast.success("Join request sent");
                  onDone();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setPending(null);
                }
              }}
            >
              Request
            </Button>
          </div>
        ))}
        {!isLoading && (data ?? []).length === 0 && (
          <div className="text-[11px] text-muted-foreground px-2 py-3">No orgs found.</div>
        )}
      </div>
    </div>
  );
}

function CreateForm({ trainerId, onDone }: { trainerId: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [city, setCity] = useState("");
  const [bio, setBio] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="space-y-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Gym name"
        className="h-9"
      />
      <Input
        value={handle}
        onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
        placeholder="handle (a-z, 0-9, _-)"
        className="h-9"
      />
      <LocationAutocomplete
        value={city}
        onChange={setCity}
        placeholder="City (optional)"
        mode="city"
        showCurrentButton={false}
      />

      <Textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder="Short bio (optional)"
        className="min-h-16"
      />
      <Button
        size="sm"
        disabled={submitting || name.length < 2 || handle.length < 3}
        onClick={async () => {
          setSubmitting(true);
          try {
            await createTrainerOrg({
              data: { name, handle, trainerId, city: city || undefined, bio: bio || undefined },
            });
            toast.success("Gym created");
            onDone();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Failed to create");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Creating…" : "Create organization"}
      </Button>
    </div>
  );
}
