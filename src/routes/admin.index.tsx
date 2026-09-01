import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
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
  adminRunReelWorker,
} from "@/lib/admin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanEntry, MigrationResult } from "@/lib/legacy-host-migration";
import { toast } from "sonner";
import { getLegalConsentStats } from "@/lib/legal-consent.functions";
import { LEGAL_DOCUMENT_LIST, effectiveVersion } from "@/lib/legal-documents";
import { usePublishedLegalDocuments } from "@/lib/legal-consent";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/")({
  head: () =>
    pageHead({
      path: "/admin",
      title: "Admin — OpenRun",
      description: "Internal OpenRun administration tools.",
      noindex: true,
    }),
  ssr: false,
  component: AdminPage,
});

function AdminPage() {
  const navigate = useNavigate();
  const check = useServerFn(adminCheck);
  const [authReady, setAuthReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isLoading && data && !data.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [data, isLoading, navigate, authReady, hasSession]);

  if (!authReady || isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!data?.isAdmin) return null;

  return (
    <div className="min-h-dvh max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin Panel</h1>
          <p className="text-sm text-muted-foreground">Manage users, payments, content</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/moderation">Moderation</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/legal">Legal &amp; Compliance</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/compliance">Compliance readiness</Link>
          </Button>

          <Button variant="outline" asChild>
            <Link to="/admin/audit">Audit logs</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/admin/location-analytics">Location analytics</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/">Back</Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="reels">
        <TabsList>
          <TabsTrigger value="reels">Reels</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="games">Games</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
        </TabsList>
        <TabsContent value="reels">
          <ReelsPanel />
        </TabsContent>
        <TabsContent value="users">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsPanel />
        </TabsContent>
        <TabsContent value="reviews">
          <ReviewsPanel />
        </TabsContent>
        <TabsContent value="games">
          <GamesPanel />
        </TabsContent>
        <TabsContent value="legal">
          <LegalConsentPanel />
        </TabsContent>

      </Tabs>
    </div>
  );
}

/** Acceptance counts per legal document version (admins/superadmins only). */
function LegalConsentPanel() {
  const load = useServerFn(getLegalConsentStats);
  const { data, isLoading, error } = useQuery({
    queryKey: ["legal-consent-stats"],
    queryFn: () => load(),
  });
  const { published } = usePublishedLegalDocuments();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Legal consent statistics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Current versions:{" "}
          {LEGAL_DOCUMENT_LIST.map(
            (d) => `${d.shortTitle} v${effectiveVersion(d.type, published).version}`,
          ).join(" · ")}
        </p>
        {isLoading ? <p className="text-muted-foreground">Loading…</p> : null}
        {error ? (
          <p className="text-destructive">
            {error instanceof Error ? error.message : "Failed to load"}
          </p>
        ) : null}
        {data && data.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.map((row) => (
              <li
                key={`${row.document_type}-${row.document_version}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span>
                  <span className="font-medium">
                    {row.document_type === "terms" ? "Terms of Service" : "Privacy Policy"}
                  </span>{" "}
                  <span className="text-muted-foreground">v{row.document_version}</span>
                </span>
                <span className="text-right text-xs text-muted-foreground">
                  {row.accepted_count} accepted
                  {row.latest_accepted_at
                    ? ` · latest ${new Date(row.latest_accepted_at).toLocaleString()}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : !isLoading && !error ? (
          <p className="text-muted-foreground">No consent records yet.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}


function ReelsPanel() {
  const list = useServerFn(adminListReels);
  const retry = useServerFn(adminRetryReel);
  const run = useServerFn(adminRunReelWorker);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-reels"], queryFn: () => list({}) });
  const mut = useMutation({
    mutationFn: (v: { id: string; restart?: boolean }) =>
      retry({ data: { id: v.id, restart: v.restart } }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["admin-reels"] });
      toast.success(res?.resumed ? "Resumed from last step" : "Reel restarted from scratch");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const runMut = useMutation({
    mutationFn: () => run({}),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["admin-reels"] });
      if (res?.ok) toast.success(`Worker ran — processed ${res.processed ?? 0}`);
      else toast.error(res?.error ?? `Worker failed (${res?.status ?? "?"})`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;

  const stuck = (data?.reels ?? []).filter(
    (r: any) =>
      r.status === "processing" && Date.now() - new Date(r.created_at).getTime() > 10 * 60 * 1000,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-3">
            <span>Generation worker</span>
            <Button size="sm" onClick={() => runMut.mutate()} disabled={runMut.isPending}>
              {runMut.isPending ? "Running…" : "Run worker now"}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>
            Worker runs automatically every minute via scheduled job. Use the button to trigger
            immediately.
          </p>
          <p className="text-muted-foreground text-xs">
            Stuck &gt;10 min: <strong>{stuck.length}</strong> · Total: {data?.reels.length ?? 0}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reels ({data?.reels.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data?.reels.map((r: any) => {
            const ageMin = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000);
            const isStuck = r.status === "processing" && ageMin > 10;
            const isFailed = r.status === "failed";
            return (
              <div
                key={r.id}
                className="border rounded-md p-3 text-sm flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium flex items-center gap-2 flex-wrap">
                    {r.title}
                    <Badge variant={isFailed ? "destructive" : isStuck ? "outline" : "secondary"}>
                      {r.status}
                      {isStuck ? " (stuck)" : ""}
                    </Badge>
                    {r.attempts > 0 && <Badge variant="outline">attempt {r.attempts}</Badge>}
                    {r.processing_step && r.processing_step !== "pending" && (
                      <Badge variant="outline">step: {r.processing_step}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    user {r.user_id?.slice(0, 8)}… · {ageMin}m ago · {r.environment}
                    {r.last_step_at &&
                      ` · last step ${new Date(r.last_step_at).toLocaleTimeString()}`}
                  </div>
                  {r.step_progress && Object.keys(r.step_progress).length > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      saved: {Object.keys(r.step_progress).join(", ")}
                    </div>
                  )}
                  {r.error_message && (
                    <pre className="mt-1 text-xs text-destructive bg-destructive/10 rounded p-2 whitespace-pre-wrap break-all">
                      {r.error_message}
                      {r.failed_at && (
                        <span className="block text-muted-foreground mt-1">
                          at {new Date(r.failed_at).toLocaleString()}
                        </span>
                      )}
                    </pre>
                  )}
                </div>
                {(isFailed || isStuck) && (
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="outline" onClick={() => mut.mutate({ id: r.id })}>
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => mut.mutate({ id: r.id, restart: true })}
                    >
                      Restart
                    </Button>
                  </div>
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
      <CardHeader>
        <CardTitle>Users ({data?.users.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.users.map((u: any) => (
          <div
            key={u.id}
            className="flex items-center justify-between border rounded-md p-3 text-sm gap-3 flex-wrap"
          >
            <div className="min-w-0">
              <div className="font-medium">{u.display_name || u.username || "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{u.email}</div>
              <div className="flex gap-1 mt-1">
                {u.roles.map((r: string) => (
                  <Badge key={r} variant="secondary">
                    {r}
                  </Badge>
                ))}
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
        <CardHeader>
          <CardTitle>Subscriptions ({data?.subscriptions.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.subscriptions.map((s: any) => (
            <div key={s.id} className="border rounded-md p-2">
              <div className="font-medium">{s.product_id}</div>
              <div className="text-xs text-muted-foreground">
                {s.status} · {s.environment}
              </div>
              <div className="text-xs">user: {s.user_id?.slice(0, 8)}…</div>
            </div>
          ))}
          {!data?.subscriptions.length && <p className="text-muted-foreground">None</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Purchases ({data?.purchases.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.purchases.map((p: any) => (
            <div key={p.id} className="border rounded-md p-2">
              <div className="font-medium">
                {p.product_id} — ${(p.amount_total / 100).toFixed(2)} {p.currency?.toUpperCase()}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.status} · {p.environment}
              </div>
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
      <CardHeader>
        <CardTitle>Reviews ({data?.reviews.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data?.reviews.map((r: any) => (
          <div
            key={r.id}
            className="border rounded-md p-3 text-sm flex items-start justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="font-medium flex items-center gap-2">
                {r.title || "(no title)"} <span className="text-xs">★{r.rating}</span>
                {r.flagged && <Badge variant="destructive">flagged</Badge>}
              </div>
              <div className="text-xs text-muted-foreground">→ {r.reviewee_name}</div>
              <p className="text-xs mt-1 line-clamp-2">{r.body}</p>
            </div>
            <Button size="sm" variant="destructive" onClick={() => mut.mutate(r.id)}>
              Delete
            </Button>
          </div>
        ))}
        {!data?.reviews.length && <p className="text-muted-foreground text-sm">No reviews</p>}
      </CardContent>
    </Card>
  );
}

function actionLabel(a: PlanEntry["action"]) {
  if (a === "claim-new-settings")
    return { text: "Will claim (new settings row)", variant: "default" as const };
  if (a === "claim-matching-settings")
    return { text: "Will claim (settings already yours)", variant: "secondary" as const };
  return { text: "Skip — owned by another host", variant: "outline" as const };
}

function GamesPanel() {
  const list = useServerFn(adminListGames);
  const { data, isLoading } = useQuery({ queryKey: ["admin-games"], queryFn: () => list({}) });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<MigrationResult | null>(null);

  const runMigration = async (dryRun: boolean) => {
    const { data: s } = await supabase.auth.getUser();
    if (!s.user) throw new Error("Sign in required");
    const { runLegacyHostMigration } = await import("@/lib/legacy-host-migration");
    return runLegacyHostMigration(s.user.id, { force: true, dryRun });
  };

  const dryRunMut = useMutation({
    mutationFn: () => runMigration(true),
    onSuccess: (res) => {
      setPreview(res);
      setPreviewOpen(true);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const backfill = useMutation({
    mutationFn: () => runMigration(false),
    onSuccess: (res) => {
      setConfirmOpen(false);
      setPreviewOpen(false);
      toast.success(`Backfill complete — claimed ${res.claimed}/${res.scanned} local games`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  const willClaim = preview?.plan.filter((p) => p.action !== "skip-other-host") ?? [];
  const willSkip = preview?.plan.filter((p) => p.action === "skip-other-host") ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-3 flex-wrap">
            <span>Host backfill (this device)</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => dryRunMut.mutate()}
                disabled={dryRunMut.isPending}
              >
                {dryRunMut.isPending ? "Scanning…" : "Preview (dry run)"}
              </Button>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={backfill.isPending}>
                    {backfill.isPending ? "Running…" : "Run host backfill now"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Run host backfill?</AlertDialogTitle>
                    <AlertDialogDescription className="space-y-2">
                      <p>
                        This will scan every locally-hosted game on this device and stamp unclaimed
                        games with your user ID as host. It also creates any missing
                        payment-settings rows.
                      </p>
                      <p className="text-destructive font-medium">
                        Warning: if any game already has a different host in the database, this will{" "}
                        <strong>overwrite</strong> that ownership and permanently transfer host
                        controls to you.
                      </p>
                      <p>
                        Tip: click "Preview (dry run)" first to see exactly which games will change.
                      </p>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setConfirmOpen(false)}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => backfill.mutate()}
                      disabled={backfill.isPending}
                    >
                      {backfill.isPending ? "Running…" : "Run backfill"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          Locally-hosted games live in each user's browser. "Preview" shows the exact plan without
          writing anything. "Run backfill" stamps unclaimed games on this device with your user id
          and creates any missing payment-settings rows.
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Backfill preview (dry run)</DialogTitle>
            <DialogDescription>
              Scanned {preview?.scanned ?? 0} local games. {willClaim.length} would be claimed,{" "}
              {willSkip.length} would be skipped. Nothing has been written.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto space-y-2">
            {preview?.plan.length ? (
              preview.plan.map((p) => {
                const label = actionLabel(p.action);
                return (
                  <div key={p.gameId} className="border rounded-md p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="font-medium truncate">{p.title}</div>
                      <Badge variant={label.variant}>{label.text}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono break-all">
                      id: {p.gameId}
                    </div>
                    <div className="text-xs">
                      <div>
                        local hostUserId:{" "}
                        <span className="font-mono">{p.currentHostUserId ?? "—"}</span>
                        {p.newHostUserId !== p.currentHostUserId && (
                          <>
                            {" "}
                            →{" "}
                            <span className="font-mono text-foreground font-medium">
                              {p.newHostUserId ?? "—"}
                            </span>
                          </>
                        )}
                      </div>
                      <div>
                        settings.host_id:{" "}
                        <span className="font-mono">{p.currentSettingsHostId ?? "—"}</span>
                        {p.newSettingsHostId !== p.currentSettingsHostId && (
                          <>
                            {" "}
                            →{" "}
                            <span className="font-mono text-foreground font-medium">
                              {p.newSettingsHostId ?? "—"}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">
                No unclaimed local games on this device.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                setPreviewOpen(false);
                setConfirmOpen(true);
              }}
              disabled={!willClaim.length}
            >
              Proceed to run…
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Games with payment settings ({data?.games.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data?.games.map((g: any) => (
            <div key={g.id} className="border rounded-md p-3">
              <div className="font-medium">Game {g.game_id}</div>
              <div className="text-xs text-muted-foreground">
                Host {g.host_id?.slice(0, 8)}… · fee ${Number(g.entry_fee).toFixed(2)} · approval:{" "}
                {g.requires_approval ? "yes" : "no"}
              </div>
            </div>
          ))}
          {!data?.games.length && <p className="text-muted-foreground">No paid games yet</p>}
        </CardContent>
      </Card>
    </div>
  );
}
