import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldAlert } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  moderationCheck,
  listReports,
  setReportStatus,
  applyModerationAction,
  listModerationAudit,
  type ModerationReport,
} from "@/lib/moderation.functions";
import { reportReasonLabel, reportStatusLabel } from "@/lib/moderation";

export const Route = createFileRoute("/admin/moderation")({
  head: () =>
    pageHead({
      path: "/admin/moderation",
      title: "Moderation — ballaCity Admin",
      description: "Review ballaCity safety reports, take action, and audit moderation history.",
      noindex: true,
    }),
  ssr: false,
  component: ModerationPage,
});

const STATUS_FILTERS = [
  "all",
  "new",
  "investigating",
  "escalated",
  "resolved",
  "dismissed",
] as const;
const SUBJECT_FILTERS = ["all", "user", "game", "message", "reel"] as const;

function statusTone(status: string) {
  const s = reportStatusLabel(status);
  if (s === "New") return "bg-destructive/15 text-destructive";
  if (s === "Investigating") return "bg-amber-500/15 text-amber-600";
  if (s === "Escalated") return "bg-purple-500/15 text-purple-500";
  if (s === "Resolved") return "bg-emerald-500/15 text-emerald-600";
  return "bg-muted text-muted-foreground";
}

function ModerationPage() {
  const navigate = useNavigate();
  const check = useServerFn(moderationCheck);
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

  const { data: access, isLoading } = useQuery({
    queryKey: ["moderation-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!isLoading && access && !access.isModerator) {
      toast.error("Moderator access required");
      navigate({ to: "/" });
    }
  }, [access, isLoading, authReady, hasSession, navigate]);

  if (!authReady || isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!access?.isModerator) return null;

  return (
    <div className="min-h-dvh">
      <BackHeader title="Moderation" fallbackTo="/admin" />
      <div className="page-shell space-y-4 py-4 sm:py-6">
        <p className="text-sm text-muted-foreground">
          Reports, actions, and the moderation audit log
        </p>

        <Tabs defaultValue="reports">
          <TabsList>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <TabsContent value="reports" className="pt-3">
            <ReportsTab />
          </TabsContent>
          <TabsContent value="audit" className="pt-3">
            <AuditTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ReportsTab() {
  const qc = useQueryClient();
  const fetchReports = useServerFn(listReports);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("new");
  const [subject, setSubject] = useState<(typeof SUBJECT_FILTERS)[number]>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["moderation-reports", status, subject],
    queryFn: () => fetchReports({ data: { status, subjectType: subject } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["moderation-reports"] });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {s === "all" ? "All" : reportStatusLabel(s)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SUBJECT_FILTERS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={subject === s ? "secondary" : "ghost"}
            onClick={() => setSubject(s)}
          >
            {s === "all" ? "All types" : s}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reports…
        </div>
      ) : (data?.reports.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <ShieldAlert className="mx-auto mb-2 h-6 w-6" />
            No reports in this view.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data!.reports.map((r) => (
            <ReportCard key={r.id} report={r} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report, onDone }: { report: ModerationReport; onDone: () => void }) {
  const statusFn = useServerFn(setReportStatus);
  const actionFn = useServerFn(applyModerationAction);
  const [notes, setNotes] = useState("");

  const statusMutation = useMutation({
    mutationFn: (next: "investigating" | "resolved" | "dismissed" | "escalated") =>
      statusFn({ data: { reportId: report.id, status: next, notes } }),
    onSuccess: () => {
      toast.success("Report updated");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't update report"),
  });

  const actionMutation = useMutation({
    mutationFn: (action: "warn" | "remove_content" | "suspend" | "ban" | "restore") =>
      actionFn({ data: { reportId: report.id, action, reason: notes } }),
    onSuccess: (res: any) => {
      toast.success(res?.summary ?? "Action applied");
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't apply action"),
  });

  const busy = statusMutation.isPending || actionMutation.isPending;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="capitalize">
            {report.subjectType}
          </Badge>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(report.status)}`}
          >
            {reportStatusLabel(report.status)}
          </span>
          <span className="text-sm font-medium">{reportReasonLabel(report.reason)}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date(report.createdAt).toLocaleString()}
          </span>
        </div>

        <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Reporter</dt>
            <dd>{report.reporter?.name ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reported user</dt>
            <dd>
              {report.reported ? (
                <Link
                  to="/players/$userId"
                  params={{ userId: report.reported.id }}
                  className="underline"
                >
                  {report.reported.name}
                </Link>
              ) : (
                "Unknown"
              )}
              {report.reported && report.reported.moderationState !== "active" ? (
                <Badge variant="outline" className="ml-2 capitalize">
                  {report.reported.moderationState}
                </Badge>
              ) : null}
            </dd>
          </div>
          {report.gameId ? (
            <div>
              <dt className="text-muted-foreground">Game</dt>
              <dd>
                <Link to="/games/$gameId" params={{ gameId: report.gameId }} className="underline">
                  {report.gameTitle ?? report.gameId}
                </Link>
              </dd>
            </div>
          ) : null}
          {report.messageId ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Message evidence</dt>
              <dd className="rounded-lg border border-border bg-surface p-2 whitespace-pre-wrap">
                {report.messageDeleted
                  ? "(message removed)"
                  : (report.messageBody ?? "(attachment only)")}
              </dd>
            </div>
          ) : null}
          {report.reelId ? (
            <div>
              <dt className="text-muted-foreground">Highlight reel</dt>
              <dd>
                {report.reelTitle ?? report.reelId}
                {report.reelHidden ? " (hidden)" : ""}
              </dd>
            </div>
          ) : null}
          {report.details ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Reporter description</dt>
              <dd className="whitespace-pre-wrap">{report.details}</dd>
            </div>
          ) : null}
          {report.resolutionNotes ? (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Resolution</dt>
              <dd className="whitespace-pre-wrap">{report.resolutionNotes}</dd>
            </div>
          ) : null}
        </dl>

        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
          placeholder="Moderator note / reason (recorded in the audit log)"
        />

        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => statusMutation.mutate("investigating")}
          >
            Investigating
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => actionMutation.mutate("warn")}
          >
            Warn
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || report.subjectType === "user"}
            onClick={() => actionMutation.mutate("remove_content")}
          >
            Remove content
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => actionMutation.mutate("suspend")}
          >
            Suspend
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => actionMutation.mutate("ban")}
          >
            Ban
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => actionMutation.mutate("restore")}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => statusMutation.mutate("escalated")}
          >
            Escalate
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => statusMutation.mutate("resolved")}
          >
            Resolve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => statusMutation.mutate("dismissed")}
          >
            Dismiss
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const fetchAudit = useServerFn(listModerationAudit);
  const { data, isLoading } = useQuery({
    queryKey: ["moderation-audit"],
    queryFn: () => fetchAudit({}),
  });

  if (isLoading)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading audit log…
      </div>
    );

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface text-muted-foreground">
          <tr>
            <th className="p-2">When</th>
            <th className="p-2">Admin</th>
            <th className="p-2">Action</th>
            <th className="p-2">Target</th>
            <th className="p-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {(data?.entries ?? []).map((e) => (
            <tr key={e.id} className="border-t border-border">
              <td className="p-2 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
              <td className="p-2">{e.actorName}</td>
              <td className="p-2">{e.action}</td>
              <td className="p-2">
                {e.targetType}
                {e.targetId ? ` · ${e.targetId.slice(0, 8)}…` : ""}
              </td>
              <td className="p-2">{e.summary ?? e.reason ?? "—"}</td>
            </tr>
          ))}
          {(data?.entries.length ?? 0) === 0 ? (
            <tr>
              <td className="p-4 text-center text-muted-foreground" colSpan={5}>
                No moderation actions recorded yet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
