import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, ShieldCheck } from "lucide-react";
import { YouthOversightCard } from "@/components/admin/YouthOversightCard";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import {
  adminComplianceOverview,
  adminMarkComplianceReviewed,
  complianceAccessCheck,
  type ComplianceOverview,
} from "@/lib/compliance.functions";
import {
  COMPLIANCE_DISCLAIMER,
  COMPLIANCE_STATUS_META,
  type ComplianceStatus,
} from "@/lib/compliance";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/admin/compliance")({
  head: () =>
    pageHead({
      path: "/admin/compliance",
      title: "Compliance readiness — ballaCity Admin",
      description: "Track legal, consent, safety, security and data-rights readiness.",
      noindex: true,
    }),
  ssr: false,
  component: AdminCompliancePage,
});

function StatusBadge({ status }: { status: ComplianceStatus }) {
  const meta = COMPLIANCE_STATUS_META[status];
  const cls =
    meta.tone === "ok"
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : meta.tone === "warn"
        ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
        : meta.tone === "danger"
          ? "bg-destructive/15 text-destructive border-destructive/30"
          : "bg-primary/10 text-primary border-primary/30";
  return (
    <Badge variant="outline" className={cls} data-testid={`status-${status}`}>
      {meta.label}
    </Badge>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function AdminCompliancePage() {
  const navigate = useNavigate();
  const check = useServerFn(complianceAccessCheck);
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

  const { data: access, isLoading: checking } = useQuery({
    queryKey: ["compliance-access"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!checking && access && !access.allowed) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [access, checking, authReady, hasSession, navigate]);

  if (!authReady || checking)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!access?.allowed) return null;
  return <ComplianceDashboard />;
}

function ComplianceDashboard() {
  const qc = useQueryClient();
  const load = useServerFn(adminComplianceOverview);
  const markReviewed = useServerFn(adminMarkComplianceReviewed);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-compliance-overview"],
    queryFn: () => load({}) as Promise<ComplianceOverview>,
  });

  const review = useMutation({
    mutationFn: () => markReviewed({}),
    onSuccess: () => {
      toast.success("Security review recorded");
      qc.invalidateQueries({ queryKey: ["admin-compliance-overview"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="page-shell mx-auto max-w-5xl space-y-6 p-4 pb-24">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">
            <ArrowLeft className="mr-1 h-4 w-4" /> Admin
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => qc.invalidateQueries({ queryKey: ["admin-compliance-overview"] })}
          disabled={isFetching}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Compliance readiness</h1>
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          {COMPLIANCE_DISCLAIMER}
        </p>
        {data ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Overall readiness:</span>
            <StatusBadge status={data.overall} />
          </div>
        ) : null}
      </header>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading readiness…</p> : null}

      {data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Legal documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.legal.map((doc) => (
                <div key={doc.type} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{doc.label}</span>
                    <StatusBadge status={doc.status} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      Version {doc.version ?? "—"}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>Published: {fmtDate(doc.publishedAt)}</span>
                    <span>Effective: {fmtDate(doc.effectiveDate)}</span>
                    <span>
                      Re-acceptance pending:{" "}
                      {doc.requiresReacceptance ? (doc.pendingReacceptance ?? "—") : "n/a"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs">{doc.note}</p>
                </div>
              ))}
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/legal">Manage documents</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Consent <StatusBadge status={data.consent.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total users" value={String(data.consent.totalUsers)} />
              <Stat
                label="Current Terms accepted"
                value={String(data.consent.termsAccepted)}
                hint={`v${data.consent.termsVersion ?? "—"}`}
              />
              <Stat
                label="Current Privacy accepted"
                value={String(data.consent.privacyAccepted)}
                hint={`v${data.consent.privacyVersion ?? "—"}`}
              />
              <Stat label="Pending acceptance" value={String(data.consent.pendingAcceptance)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Safety <StatusBadge status={data.safety.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Open reports" value={String(data.safety.openReports)} />
                <Stat label="Investigating" value={String(data.safety.investigatingReports)} />
                <Stat label="Escalated" value={String(data.safety.escalatedReports)} />
                <Stat label="Suspended users" value={String(data.safety.suspendedUsers)} />
                <Stat label="Banned users" value={String(data.safety.bannedUsers)} />
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/moderation">Open moderation queue</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.security.map((area) => (
                <div key={area.area} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{area.label}</span>
                    <StatusBadge status={area.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{area.description}</p>
                  <p className="mt-1 text-xs">{area.evidence}</p>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => review.mutate()}
                  disabled={review.isPending}
                >
                  <ShieldCheck className="mr-1 h-4 w-4" /> Mark security controls reviewed
                </Button>
                <span className="text-xs text-muted-foreground">
                  Last human review: {fmtDate(data.lastReviewedAt)}
                </span>
              </div>
            </CardContent>
          </Card>

          <YouthOversightCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Data rights <StatusBadge status={data.data.status} />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Account deletion requests"
                  value={data.data.deletionRequests === null ? "n/a" : String(data.data.deletionRequests)}
                />
                <Stat
                  label="Data export requests"
                  value={String(data.data.exportRequestsPending)}
                  hint={`${data.data.exportRequestsTotal} all time · ${data.data.exportFailed} failed`}
                />
                <Stat
                  label="AI/video deletion requests"
                  value={String(data.data.aiDeletionRequests)}
                  hint="Accounts that withdrew AI video processing"
                />
                <Stat
                  label="AI training opt-outs"
                  value={String(data.data.aiOptOuts)}
                />
              </div>
              <p className="text-xs text-muted-foreground">{data.data.deletionNote}</p>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Snapshot generated {new Date(data.generatedAt).toLocaleString()}.
          </p>
        </>
      ) : null}
    </div>
  );
}
