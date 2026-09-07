import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Download, Loader2, Search, ShieldAlert } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { moderationCheck } from "@/lib/moderation.functions";
import {
  listAuditLogs,
  auditLogFacets,
  exportAuditLogs,
  type AuditLogEntry,
} from "@/lib/audit-log.functions";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  auditActionCategory,
  auditActionLabel,
  auditActionsInCategory,
  auditTargetLabel,
  type AuditCategory,
} from "@/lib/audit-actions";

export const Route = createFileRoute("/admin/audit")({
  head: () =>
    pageHead({
      path: "/admin/audit",
      title: "Audit logs — ballaCity Admin",
      description: "Append-only history of administrative and security actions on ballaCity.",
      noindex: true,
    }),
  ssr: false,
  component: AuditLogPage,
});

const PAGE_SIZE = 50;

const CATEGORY_TONE: Record<AuditCategory, string> = {
  users: "bg-amber-500/15 text-amber-600",
  content: "bg-sky-500/15 text-sky-600",
  reports: "bg-destructive/15 text-destructive",
  legal: "bg-purple-500/15 text-purple-500",
  settings: "bg-muted text-muted-foreground",
  permissions: "bg-emerald-500/15 text-emerald-600",
  payments: "bg-blue-500/15 text-blue-600",
  security: "bg-rose-500/15 text-rose-600",
};

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return null;
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const category = auditActionCategory(entry.action);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{auditActionLabel(entry.action)}</span>
              {category ? (
                <Badge className={CATEGORY_TONE[category]} variant="secondary">
                  {AUDIT_CATEGORY_LABELS[category]}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {entry.actorName} · {fmtWhen(entry.createdAt)}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {auditTargetLabel(entry.targetType)}
              {entry.targetId ? ` · ${entry.targetId}` : ""}
            </p>
            {entry.reason ? <p className="text-xs">{entry.reason}</p> : null}
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              {open ? "Hide" : "Details"}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="mt-3 grid gap-3 sm:grid-cols-3">
          <DetailBlock label="Before" value={entry.before} />
          <DetailBlock label="After" value={entry.after} />
          <DetailBlock label="Metadata" value={entry.metadata} />
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AuditLogPage() {
  const navigate = useNavigate();
  const check = useServerFn(moderationCheck);
  const list = useServerFn(listAuditLogs);
  const facetsFn = useServerFn(auditLogFacets);
  const exportFn = useServerFn(exportAuditLogs);

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

  const { data: access, isLoading: accessLoading } = useQuery({
    queryKey: ["moderation-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!accessLoading && access && !access.isModerator) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [access, accessLoading, authReady, hasSession, navigate]);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [targetType, setTargetType] = useState<string>("all");
  const [actorId, setActorId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const canRead = !!access?.isModerator;

  const { data: facets } = useQuery({
    queryKey: ["audit-facets"],
    queryFn: () => facetsFn({}),
    enabled: canRead,
  });

  const filters = useMemo(() => {
    const actions =
      action !== "all"
        ? [action]
        : category !== "all"
          ? auditActionsInCategory(category as AuditCategory)
          : undefined;
    return {
      ...(search ? { search } : {}),
      ...(actions?.length ? { actions } : {}),
      ...(targetType !== "all" ? { targetType } : {}),
      ...(actorId !== "all" ? { actorId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    };
  }, [search, action, category, targetType, actorId, from, to]);

  const { data, isFetching } = useQuery({
    queryKey: ["audit-logs", filters, page],
    queryFn: () => list({ data: { ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    enabled: canRead,
    placeholderData: keepPreviousData,
  });

  const actionOptions = useMemo(() => {
    const all = facets?.actions ?? [];
    if (category === "all") return all;
    const allowed = new Set(auditActionsInCategory(category as AuditCategory));
    return all.filter((a) => allowed.has(a.value));
  }, [facets, category]);

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setCategory("all");
    setAction("all");
    setTargetType("all");
    setActorId("all");
    setFrom("");
    setTo("");
    setPage(0);
  };

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await exportFn({ data: filters });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openrun-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${res.rows} entries`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!authReady || accessLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!canRead) return null;

  const total = data?.total ?? 0;
  const entries = data?.entries ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-shell min-h-dvh space-y-4 py-4 pb-24 sm:py-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldAlert className="h-5 w-5 text-primary" /> Audit logs
          </h1>
          <p className="text-sm text-muted-foreground">
            Append-only record of administrative and security actions. Entries can never be
            edited or deleted.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={doExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search action, target or reason"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v);
                  setAction("all");
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {AUDIT_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {AUDIT_CATEGORY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Action</Label>
              <Select
                value={action}
                onValueChange={(v) => {
                  setAction(v);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {auditActionLabel(a.value)} ({a.uses})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Admin</Label>
              <Select
                value={actorId}
                onValueChange={(v) => {
                  setActorId(v);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All admins</SelectItem>
                  {(facets?.actors ?? []).map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label} ({a.uses})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Target</Label>
              <Select
                value={targetType}
                onValueChange={(v) => {
                  setTargetType(v);
                  setPage(0);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All targets</SelectItem>
                  {(facets?.targetTypes ?? []).map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {auditTargetLabel(t.value)} ({t.uses})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(0);
                }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {isFetching ? "Loading…" : `${total} ${total === 1 ? "entry" : "entries"}`}
            </p>
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset filters
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {entries.length === 0 && !isFetching ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No audit entries match these filters.
            </CardContent>
          </Card>
        ) : (
          entries.map((e: AuditLogEntry) => <EntryRow key={e.id} entry={e} />)
        )}
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
