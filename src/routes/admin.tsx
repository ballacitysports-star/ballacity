import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  adminCheck,
  adminListUsers,
  adminSetRole,
  adminListPayments,
  adminListReviews,
  adminDeleteReview,
  adminListGames,
  adminListReels,
  adminRetryReel,
} from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin · Panel" }] }),
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const check = useServerFn(adminCheck);
  const { data, isLoading } = useQuery({ queryKey: ["admin-check"], queryFn: () => check({}) });

  useEffect(() => {
    if (!isLoading && data && !data.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [data, isLoading, navigate]);

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.isAdmin) return null;

  return (
    <div className="min-h-dvh max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, payments, content</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/">Back</Link>
        </Button>
      </div>

      <Tabs defaultValue="reels">
        <TabsList>
          <TabsTrigger value="reels">Reels</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="games">Games</TabsTrigger>
        </TabsList>
        <TabsContent value="reels"><ReelsPanel /></TabsContent>
        <TabsContent value="users"><UsersPanel /></TabsContent>
        <TabsContent value="payments"><PaymentsPanel /></TabsContent>
        <TabsContent value="reviews"><ReviewsPanel /></TabsContent>
        <TabsContent value="games"><GamesPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function ReelsPanel() {
  const list = useServerFn(adminListReels);
  const retry = useServerFn(adminRetryReel);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-reels"], queryFn: () => list({}) });
  const mut = useMutation({
    mutationFn: (id: string) => retry({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reels"] });
      toast.success("Reel re-queued");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  const stuck = (data?.reels ?? []).filter((r: any) =>
    r.status === "processing" && Date.now() - new Date(r.created_at).getTime() > 10 * 60 * 1000
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚠ Generation worker status</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>No background worker is currently processing reels — uploads sit in <code>processing</code> until one is built.</p>
          <p className="text-muted-foreground text-xs">
            Stuck &gt;10 min: <strong>{stuck.length}</strong> · Total: {data?.reels.length ?? 0}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Reels ({data?.reels.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data?.reels.map((r: any) => {
            const ageMin = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000);
            const isStuck = r.status === "processing" && ageMin > 10;
            const isFailed = r.status === "failed";
            return (
              <div key={r.id} className="border rounded-md p-3 text-sm flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {r.title}
                    <Badge variant={isFailed ? "destructive" : isStuck ? "outline" : "secondary"}>
                      {r.status}{isStuck ? " (stuck)" : ""}
                    </Badge>
                    {r.attempts > 0 && <Badge variant="outline">attempt {r.attempts}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    user {r.user_id?.slice(0, 8)}… · {ageMin}m ago · {r.environment}
                  </div>
                  {r.error_message && (
                    <pre className="mt-1 text-xs text-destructive bg-destructive/10 rounded p-2 whitespace-pre-wrap break-all">
                      {r.error_message}
                      {r.failed_at && <span className="block text-muted-foreground mt-1">at {new Date(r.failed_at).toLocaleString()}</span>}
                    </pre>
                  )}
                </div>
                {(isFailed || isStuck) && (
                  <Button size="sm" variant="outline" onClick={() => mut.mutate(r.id)}>Retry</Button>
                )}
              </div>
            );
          })}
          {!data?.reels.length && <p className="text-muted-foreground text-sm">No reels yet</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function UsersPanel() {
  const list = useServerFn(adminListUsers);
  const setRole = useServerFn(adminSetRole);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => list({}) });
  const mut = useMutation({
    mutationFn: (vars: { userId: string; role: "admin" | "moderator"; grant: boolean }) =>
      setRole({ data: vars }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  return (
    <Card>
      <CardHeader><CardTitle>Users ({data?.users.length ?? 0})</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {data?.users.map((u: any) => (
          <div key={u.id} className="flex items-center justify-between border rounded-md p-3 text-sm gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="font-medium">{u.display_name || u.username || "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{u.email}</div>
              <div className="flex gap-1 mt-1">
                {u.roles.map((r: string) => <Badge key={r} variant="secondary">{r}</Badge>)}
              </div>
            </div>
            <div className="flex gap-2">
              {(["admin", "moderator"] as const).map((role) => {
                const has = u.roles.includes(role);
                return (
                  <Button
                    key={role}
                    size="sm"
                    variant={has ? "destructive" : "outline"}
                    onClick={() => mut.mutate({ userId: u.id, role, grant: !has })}
                  >
                    {has ? `Revoke ${role}` : `Make ${role}`}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PaymentsPanel() {
  const list = useServerFn(adminListPayments);
  const { data, isLoading } = useQuery({ queryKey: ["admin-payments"], queryFn: () => list({}) });
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Subscriptions ({data?.subscriptions.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.subscriptions.map((s: any) => (
            <div key={s.id} className="border rounded-md p-2">
              <div className="font-medium">{s.product_id}</div>
              <div className="text-xs text-muted-foreground">{s.status} · {s.environment}</div>
              <div className="text-xs">user: {s.user_id?.slice(0, 8)}…</div>
            </div>
          ))}
          {!data?.subscriptions.length && <p className="text-muted-foreground">None</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Purchases ({data?.purchases.length ?? 0})</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.purchases.map((p: any) => (
            <div key={p.id} className="border rounded-md p-2">
              <div className="font-medium">{p.product_id} — ${(p.amount_total / 100).toFixed(2)} {p.currency?.toUpperCase()}</div>
              <div className="text-xs text-muted-foreground">{p.status} · {p.environment}</div>
              <div className="text-xs">{p.customer_email}</div>
            </div>
          ))}
          {!data?.purchases.length && <p className="text-muted-foreground">None</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewsPanel() {
  const list = useServerFn(adminListReviews);
  const del = useServerFn(adminDeleteReview);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-reviews"], queryFn: () => list({}) });
  const mut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-reviews"] });
      toast.success("Deleted");
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  return (
    <Card>
      <CardHeader><CardTitle>Reviews ({data?.reviews.length ?? 0})</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {data?.reviews.map((r: any) => (
          <div key={r.id} className="border rounded-md p-3 text-sm flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-2">
                {r.title || "(no title)"} <span className="text-xs">★{r.rating}</span>
                {r.flagged && <Badge variant="destructive">flagged</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">→ {r.reviewee_name}</div>
              <p className="text-xs mt-1 line-clamp-2">{r.body}</p>
            </div>
            <Button size="sm" variant="destructive" onClick={() => mut.mutate(r.id)}>Delete</Button>
          </div>
        ))}
        {!data?.reviews.length && <p className="text-muted-foreground text-sm">No reviews</p>}
      </CardContent>
    </Card>
  );
}

function GamesPanel() {
  const list = useServerFn(adminListGames);
  const { data, isLoading } = useQuery({ queryKey: ["admin-games"], queryFn: () => list({}) });
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  return (
    <Card>
      <CardHeader><CardTitle>Games with payment settings ({data?.games.length ?? 0})</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {data?.games.map((g: any) => (
          <div key={g.id} className="border rounded-md p-3">
            <div className="font-medium">Game {g.game_id}</div>
            <div className="text-xs text-muted-foreground">
              Host {g.host_id?.slice(0, 8)}… · fee ${Number(g.entry_fee).toFixed(2)} · approval: {g.requires_approval ? "yes" : "no"}
            </div>
          </div>
        ))}
        {!data?.games.length && <p className="text-muted-foreground">No paid games yet</p>}
      </CardContent>
    </Card>
  );
}
