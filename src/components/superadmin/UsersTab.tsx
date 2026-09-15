import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  superadminListUsers,
  superadminUserDetail,
  superadminSetRole,
  superadminSuspendUser,
  superadminUpdateProfile,
  superadminForceSignOut,
} from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmAction } from "./ConfirmAction";

const ROLES = ["superadmin", "admin", "moderator"] as const;
const EDITABLE = [
  "display_name",
  "username",
  "bio",
  "city",
  "sport",
  "account_type",
  "graduating_class",
  "search_radius_mi",
] as const;

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(superadminListUsers);
  const detail = useServerFn(superadminUserDetail);
  const setRole = useServerFn(superadminSetRole);
  const suspend = useServerFn(superadminSuspendUser);
  const updateProfile = useServerFn(superadminUpdateProfile);
  const forceSignOut = useServerFn(superadminForceSignOut);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openUser, setOpenUser] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    description?: string;
    word?: string;
    run: (reason: string) => Promise<unknown>;
  }>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const limit = 25;
  const users = useQuery({
    queryKey: ["superadmin-users", query, page],
    queryFn: () => list({ data: { search: query || undefined, limit, offset: page * limit } }),
  });

  const userDetail = useQuery({
    queryKey: ["superadmin-user", openUser],
    queryFn: () => detail({ data: { userId: openUser! } }),
    enabled: !!openUser,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["superadmin-users"] });
    qc.invalidateQueries({ queryKey: ["superadmin-user"] });
    qc.invalidateQueries({ queryKey: ["superadmin-overview"] });
    qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
  };

  const action = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast.success("Done");
      setConfirm(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  const p = userDetail.data?.profile as any;

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(search.trim());
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, username, city, or paste a user id"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="rounded-lg border divide-y">
        {users.isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (users.data?.users.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No accounts found.</div>
        ) : (
          users.data!.users.map((u: any) => (
            <button
              key={u.id}
              onClick={() => {
                setEdits({});
                setOpenUser(u.id);
              }}
              className="w-full text-left p-3 hover:bg-muted/50 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {u.display_name}
                  {u.username ? (
                    <span className="text-muted-foreground"> @{u.username}</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {u.email ?? "no email"} · {u.account_type ?? "unset"}
                  {u.city ? ` · ${u.city}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {u.suspended_at ? <Badge variant="destructive">Suspended</Badge> : null}
                {u.roles.map((r: string) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))}
              </div>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{users.data?.total ?? 0} accounts</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage((x) => x - 1)}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={(page + 1) * limit >= (users.data?.total ?? 0)}
            onClick={() => setPage((x) => x + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Sheet open={!!openUser} onOpenChange={(v) => !v && setOpenUser(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{p?.display_name ?? "Account"}</SheetTitle>
          </SheetHeader>

          {userDetail.isLoading || !userDetail.data ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4 pb-10">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Identity</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-1">
                  <div>Email: {userDetail.data.email ?? "—"}</div>
                  <div>
                    User id: <span className="font-mono">{openUser}</span>
                  </div>
                  <div>
                    Last sign-in:{" "}
                    {userDetail.data.lastSignInAt
                      ? new Date(userDetail.data.lastSignInAt).toLocaleString()
                      : "—"}
                  </div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {userDetail.data.roles.length === 0 ? (
                      <span className="text-muted-foreground">No roles</span>
                    ) : (
                      userDetail.data.roles.map((r: string) => (
                        <Badge key={r} variant="secondary">
                          {r}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="pt-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/players/$userId" params={{ userId: openUser! }}>
                        View public profile
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Roles</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {ROLES.map((role) => {
                    const has = userDetail.data!.roles.includes(role);
                    return (
                      <Button
                        key={role}
                        size="sm"
                        variant={has ? "default" : "outline"}
                        onClick={() =>
                          setConfirm({
                            title: `${has ? "Revoke" : "Grant"} ${role}`,
                            description:
                              role === "superadmin"
                                ? "Superadmins have complete control over the app."
                                : undefined,
                            word: role === "superadmin" ? "SUPERADMIN" : undefined,
                            run: (reason) =>
                              setRole({
                                data: { userId: openUser!, role, grant: !has, reason },
                              }),
                          })
                        }
                      >
                        {has ? `Revoke ${role}` : `Grant ${role}`}
                      </Button>
                    );
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Profile fields</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {EDITABLE.map((f) => (
                    <div key={f} className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">{f}</label>
                      <Input
                        value={edits[f] ?? p?.[f] ?? ""}
                        onChange={(e) => setEdits((s) => ({ ...s, [f]: e.target.value }))}
                      />
                    </div>
                  ))}
                  <Button
                    size="sm"
                    disabled={Object.keys(edits).length === 0}
                    onClick={() =>
                      setConfirm({
                        title: "Save profile changes",
                        run: (reason) => {
                          const patch: Record<string, unknown> = {};
                          for (const [k, v] of Object.entries(edits)) {
                            patch[k] =
                              v === ""
                                ? null
                                : k === "graduating_class" || k === "search_radius_mi"
                                  ? Number(v)
                                  : v;
                          }
                          return updateProfile({
                            data: { userId: openUser!, patch, reason },
                          }).then(() => setEdits({}));
                        },
                      })
                    }
                  >
                    Save changes
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Account state</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {p?.suspended_at ? (
                    <div className="text-xs text-destructive">
                      Suspended {new Date(p.suspended_at).toLocaleString()}
                      {p.suspended_reason ? ` — ${p.suspended_reason}` : ""}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={p?.suspended_at ? "outline" : "destructive"}
                      disabled={openUser === currentUserId}
                      onClick={() =>
                        setConfirm({
                          title: p?.suspended_at ? "Restore account" : "Suspend account",
                          description: p?.suspended_at
                            ? "The account regains access immediately."
                            : "The account is signed out and hidden from the public app. Fully reversible.",
                          word: p?.suspended_at ? undefined : "SUSPEND",
                          run: (reason) =>
                            suspend({
                              data: { userId: openUser!, suspend: !p?.suspended_at, reason },
                            }),
                        })
                      }
                    >
                      {p?.suspended_at ? "Restore account" : "Suspend account"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setConfirm({
                          title: "Force sign-out",
                          description: "Ends every active session for this account.",
                          run: () => forceSignOut({ data: { userId: openUser! } }),
                        })
                      }
                    >
                      Force sign-out
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Owned profiles & activity</CardTitle>
                </CardHeader>
                <CardContent className="text-xs space-y-2">
                  <Section
                    title="Teams / trainers"
                    rows={userDetail.data.teams}
                    render={(t: any) => `${t.name} (${t.kind})`}
                  />
                  <Section
                    title="Gyms / orgs"
                    rows={userDetail.data.orgs}
                    render={(o: any) => o.name}
                  />
                  <Section
                    title="Hosted games"
                    rows={userDetail.data.games}
                    render={(g: any) => `${g.title} · ${new Date(g.date).toLocaleDateString()}`}
                  />
                  <Section
                    title="Availability"
                    rows={userDetail.data.availability}
                    render={(a: any) => `${(a.sports ?? []).join(", ")} · ${a.status}`}
                  />
                  <Section
                    title="Reports"
                    rows={userDetail.data.reports}
                    render={(r: any) => `${r.reason} · ${r.status}`}
                  />
                  <Section
                    title="Purchases"
                    rows={userDetail.data.purchases}
                    render={(x: any) =>
                      `${x.product_id} · ${(x.amount_total / 100).toFixed(2)} ${x.currency} · ${x.status}`
                    }
                  />
                  <Section
                    title="Subscriptions"
                    rows={userDetail.data.subscriptions}
                    render={(s: any) => `${s.product_id} · ${s.status}`}
                  />
                </CardContent>
              </Card>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <ConfirmAction
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmWord={confirm?.word}
        pending={action.isPending}
        onConfirm={(reason) => confirm && action.mutate(() => confirm.run(reason))}
      />
    </div>
  );
}

function Section({
  title,
  rows,
  render,
}: {
  title: string;
  rows: any[];
  render: (row: any) => string;
}) {
  return (
    <div>
      <div className="micro-label text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <div className="text-muted-foreground">None</div>
      ) : (
        rows.map((r: any) => (
          <div key={r.id} className="truncate">
            {render(r)}
          </div>
        ))
      )}
    </div>
  );
}
