import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Building2, MapPin, Users, ShieldCheck, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getTrainerOrg,
  listJoinRequestsForOrg,
  reviewJoinRequest,
} from "@/lib/trainer-orgs.functions";

export const Route = createFileRoute("/orgs/$orgId")({
  head: ({ loaderData }) => {
    const o = (loaderData as Awaited<ReturnType<typeof getTrainerOrg>> | undefined) ?? null;
    if (!o?.org) {
      return { meta: [{ title: "Organization — OpenRun" }, { name: "robots", content: "noindex" }] };
    }
    return {
      meta: [
        { title: `${o.org.name} — Trainer organization on OpenRun` },
        { name: "description", content: (o.org.bio || `${o.org.name} on OpenRun.`).slice(0, 155) },
      ],
    };
  },
  loader: async ({ params }) => {
    const res = await getTrainerOrg({ data: { id: params.orgId } });
    if (!res) throw notFound();
    return res;
  },
  component: OrgPage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-muted-foreground">Failed to load: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">Organization not found.</div>,
});

function OrgPage() {
  const initial = Route.useLoaderData();
  const { orgId } = Route.useParams();
  const auth = useAuth();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["trainer-org", orgId],
    queryFn: () => getTrainerOrg({ data: { id: orgId } }),
    initialData: initial,
  });

  const org = data?.org;
  const members = data?.members ?? [];
  const isAdmin =
    !!auth.user &&
    !!org &&
    (org.owner_id === auth.user.id ||
      members.some((m) => m.user_id === auth.user!.id && (m.role === "owner" || m.role === "admin")));

  const requests = useQuery({
    queryKey: ["trainer-org-requests", orgId],
    queryFn: () => listJoinRequestsForOrg({ data: { orgId } }),
    enabled: isAdmin,
  });

  if (!org) return null;

  async function review(id: string, action: "approve" | "reject") {
    try {
      await reviewJoinRequest({ data: { id, action } });
      toast.success(action === "approve" ? "Approved" : "Rejected");
      qc.invalidateQueries({ queryKey: ["trainer-org-requests", orgId] });
      qc.invalidateQueries({ queryKey: ["trainer-org", orgId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl p-4 pb-40 space-y-6">
      <header className="rounded-2xl border border-border/60 bg-surface p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime/15 text-2xl">
            {org.avatar || <Building2 className="h-6 w-6 text-lime" />}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">
              {org.name}
              {org.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
                  <ShieldCheck className="h-3 w-3" /> Verified
                </span>
              )}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground flex flex-wrap items-center gap-2">
              <span>@{org.handle}</span>
              {org.city && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {org.city}
                  </span>
                </>
              )}
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {members.length} trainer{members.length === 1 ? "" : "s"}
              </span>
            </div>
            {org.bio && <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap">{org.bio}</p>}
            {org.website && (
              <a
                href={org.website}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-lime hover:underline"
              >
                {org.website}
              </a>
            )}
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-border/60 bg-surface p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-lime" /> Trainers
        </h2>
        {members.length === 0 ? (
          <p className="text-xs text-muted-foreground">No trainers yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => {
              const t = m.teams;
              if (!t) return null;
              return (
                <li key={m.id}>
                  <Link
                    to="/trainers/$trainerId"
                    params={{ trainerId: t.id }}
                    className="flex items-center gap-3 rounded-xl border border-border/50 bg-background px-3 py-2 hover:border-lime/60"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-lime/15 text-sm">
                      {t.avatar || "T"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{t.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {m.role}
                        {t.city ? ` · ${t.city}` : ""}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isAdmin && (
        <section className="rounded-2xl border border-border/60 bg-surface p-4">
          <h2 className="text-sm font-semibold mb-3">Pending join requests</h2>
          {(requests.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No pending requests.</p>
          ) : (
            <ul className="space-y-2">
              {requests.data!.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border/50 bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{r.trainer?.name ?? r.trainer_id}</div>
                    {r.message && (
                      <div className="text-[11px] text-muted-foreground truncate">{r.message}</div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => review(r.id, "approve")}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => review(r.id, "reject")}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
