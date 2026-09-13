import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, FileText, Eye, Plus } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import { adminCheck } from "@/lib/admin.functions";
import {
  adminCreateLegalDraft,
  adminDeleteLegalDraft,
  adminListLegalDocuments,
  adminLegalReacceptancePending,
  adminPublishLegalDocument,
  adminUnpublishLegalDocument,
  type AdminLegalDocument,
} from "@/lib/legal-documents.functions";
import { MANAGED_LEGAL_LIST, type ManagedLegalType } from "@/lib/legal-catalog";
import { parseLegalContent } from "@/lib/legal-documents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LegalReviewBanner } from "@/components/legal/LegalDocumentBody";

export const Route = createFileRoute("/admin/legal")({
  head: () =>
    pageHead({
      path: "/admin/legal",
      title: "Legal & Compliance — ballaCity Admin",
      description: "Manage versions of ballaCity's legal and policy documents.",
      noindex: true,
    }),
  ssr: false,
  component: AdminLegalPage,
});

type DraftForm = {
  document_type: ManagedLegalType;
  title: string;
  version: string;
  content: string;
  summary: string;
  requires_reacceptance: boolean;
  effective_date: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function AdminLegalPage() {
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

  const { data: adminData, isLoading: checking } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!checking && adminData && !adminData.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [adminData, checking, authReady, hasSession, navigate]);

  if (!authReady || checking)
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!adminData?.isAdmin) return null;

  return <LegalManager />;
}

function LegalManager() {
  const qc = useQueryClient();
  const list = useServerFn(adminListLegalDocuments);
  const create = useServerFn(adminCreateLegalDraft);
  const publish = useServerFn(adminPublishLegalDocument);
  const unpublish = useServerFn(adminUnpublishLegalDocument);
  const remove = useServerFn(adminDeleteLegalDraft);
  const pendingCount = useServerFn(adminLegalReacceptancePending);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["admin-legal-documents"],
    queryFn: () => list({}) as Promise<AdminLegalDocument[]>,
  });

  const [activeType, setActiveType] = useState<ManagedLegalType>("terms");
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [preview, setPreview] = useState<AdminLegalDocument | null>(null);
  const [confirmDoc, setConfirmDoc] = useState<AdminLegalDocument | null>(null);
  const [affected, setAffected] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-legal-documents"] });
    qc.invalidateQueries({ queryKey: ["legal-documents", "published"] });
    qc.invalidateQueries({ queryKey: ["legal-consents"] });
  };

  const byType = useMemo(() => {
    const map = new Map<string, AdminLegalDocument[]>();
    for (const d of docs ?? []) {
      const arr = map.get(d.document_type) ?? [];
      arr.push(d);
      map.set(d.document_type, arr);
    }
    return map;
  }, [docs]);

  const meta = MANAGED_LEGAL_LIST.find((m) => m.type === activeType)!;
  const versions = byType.get(activeType) ?? [];
  const live = versions.find((v) => v.published) ?? null;
  const drafts = versions.filter((v) => !v.published && !v.published_at);
  const history = versions.filter((v) => v.published_at && !v.published);

  const saveDraft = useMutation({
    mutationFn: (form: DraftForm) => create({ data: form }),
    onSuccess: () => {
      toast.success("Draft saved");
      setDraft(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => publish({ data: { id } }),
    onSuccess: () => {
      toast.success("Published");
      setConfirmDoc(null);
      setAffected(null);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unpublishMutation = useMutation({
    mutationFn: (id: string) => unpublish({ data: { id, reason: "Unpublished from admin" } }),
    onSuccess: () => {
      toast.success("Unpublished — users now see no live version of this document");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Draft deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openConfirm = async (doc: AdminLegalDocument) => {
    setConfirmDoc(doc);
    setAffected(null);
    if (doc.requires_reacceptance) {
      try {
        const res = await pendingCount({
          data: { document_type: doc.document_type as ManagedLegalType, version: doc.version },
        });
        setAffected(res.pending);
      } catch {
        setAffected(null);
      }
    }
  };

  const newDraft = (fromLive?: AdminLegalDocument | null) => {
    setDraft({
      document_type: activeType,
      title: fromLive?.title ?? meta.label,
      version: "",
      content: fromLive?.content ?? "",
      summary: "",
      requires_reacceptance: meta.requiresConsent,
      effective_date: today(),
    });
  };

  return (
    <div className="page-shell min-h-dvh space-y-4 py-4 sm:py-6">
      <header className="flex items-center gap-3">
        <Link to="/admin" className="rounded-full p-2 hover:bg-surface" aria-label="Back to admin">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="page-title">Legal &amp; Compliance</h1>
          <p className="page-subtitle">
            Draft, review, and publish versions of ballaCity's policy documents. Published versions
            are what users see and are never edited afterwards.
          </p>
        </div>
      </header>

      <LegalReviewBanner />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {MANAGED_LEGAL_LIST.map((m) => {
          const rows = byType.get(m.type) ?? [];
          const hasLive = rows.some((r) => r.published);
          return (
            <button
              key={m.type}
              type="button"
              onClick={() => {
                setActiveType(m.type);
                setDraft(null);
              }}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeType === m.type
                  ? "border-lime bg-lime/15 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:bg-surface-2"
              }`}
            >
              {m.label}
              <span
                className={`h-2 w-2 rounded-full ${hasLive ? "bg-lime" : "bg-muted-foreground/40"}`}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading documents…</p>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" aria-hidden /> {meta.label}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {live ? (
                <div className="rounded-2xl border border-lime/40 bg-lime/5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-lime text-primary-foreground">Current version</Badge>
                    <span className="text-sm font-semibold">v{live.version}</span>
                    <span className="text-xs text-muted-foreground">
                      Effective {live.effective_date}
                      {live.effective_date > today() ? " (scheduled)" : ""}
                    </span>
                    {live.requires_reacceptance ? (
                      <Badge variant="outline">Requires re-acceptance</Badge>
                    ) : null}
                  </div>
                  {live.summary ? (
                    <p className="mt-2 text-xs text-muted-foreground">{live.summary}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setPreview(live)}>
                      <Eye className="mr-1 h-4 w-4" aria-hidden /> Preview
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => newDraft(live)}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden /> New version from this
                    </Button>
                    {meta.requiresConsent ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={unpublishMutation.isPending}
                        onClick={() => unpublishMutation.mutate(live.id)}
                      >
                        Unpublish
                      </Button>
                    )}
                  </div>
                  {meta.requiresConsent ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Consent documents can't be unpublished — publish a replacement version
                      instead.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-border bg-surface p-3 text-sm text-muted-foreground">
                  No published version. Users see the built-in fallback copy until you publish one.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => newDraft(null)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden /> Create draft
                </Button>
              </div>

              {drafts.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Drafts
                  </h3>
                  {drafts.map((d) => (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-surface p-3"
                    >
                      <Badge variant="outline">Draft</Badge>
                      <span className="text-sm font-semibold">v{d.version}</span>
                      <span className="text-xs text-muted-foreground">
                        Effective {d.effective_date}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPreview(d)}>
                          Preview
                        </Button>
                        <Button size="sm" onClick={() => void openConfirm(d)}>
                          Publish
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(d.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {history.length > 0 ? (
                <div className="space-y-2 border-t border-border pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Previous versions
                  </h3>
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {history.map((h) => (
                      <li key={h.id} className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">v{h.version}</span>
                        <span>effective {h.effective_date}</span>
                        {h.requires_reacceptance ? <span>· material change</span> : null}
                        <button
                          type="button"
                          className="text-lime underline"
                          onClick={() => setPreview(h)}
                        >
                          Preview
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {draft ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">New draft — {meta.label}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Content uses simple formatting: a line starting with <code>##</code> is a heading;
                  blank lines separate paragraphs.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="legal-title">Title</Label>
                    <Input
                      id="legal-title"
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="legal-version">Version label</Label>
                    <Input
                      id="legal-version"
                      placeholder="2026-10-01"
                      value={draft.version}
                      onChange={(e) => setDraft({ ...draft, version: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="legal-effective">Effective date</Label>
                    <Input
                      id="legal-effective"
                      type="date"
                      value={draft.effective_date}
                      onChange={(e) => setDraft({ ...draft, effective_date: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="legal-material"
                        checked={draft.requires_reacceptance}
                        onCheckedChange={(v) => setDraft({ ...draft, requires_reacceptance: v })}
                      />
                      <Label htmlFor="legal-material" className="text-sm">
                        Material change (users must accept again)
                      </Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="legal-summary">Summary of change</Label>
                  <Textarea
                    id="legal-summary"
                    rows={2}
                    value={draft.summary}
                    onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="legal-content">Content</Label>
                  <Textarea
                    id="legal-content"
                    rows={16}
                    className="font-mono text-xs"
                    value={draft.content}
                    onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      saveDraft.isPending ||
                      !draft.version.trim() ||
                      !draft.title.trim() ||
                      !draft.content.trim()
                    }
                    onClick={() => saveDraft.mutate(draft)}
                  >
                    {saveDraft.isPending ? "Saving…" : "Save draft"}
                  </Button>
                  <Button variant="ghost" onClick={() => setDraft(null)}>
                    Cancel
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Saving creates a draft only. Nothing is shown to users until you publish it, and
                  publishing asks for confirmation first.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* Preview */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{preview?.title}</DialogTitle>
            <DialogDescription>
              v{preview?.version} · effective {preview?.effective_date}
              {preview?.published ? " · published" : " · not published"}
            </DialogDescription>
          </DialogHeader>
          <article className="space-y-4">
            {parseLegalContent(preview?.content ?? "").map((s, i) => (
              <section key={`${s.heading}-${i}`} className="space-y-1.5">
                {s.heading ? <h3 className="text-sm font-semibold">{s.heading}</h3> : null}
                {s.body.map((p, j) => (
                  <p key={j} className="text-sm leading-relaxed text-muted-foreground">
                    {p}
                  </p>
                ))}
              </section>
            ))}
          </article>
        </DialogContent>
      </Dialog>

      {/* Publish confirmation */}
      <Dialog
        open={!!confirmDoc}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDoc(null);
            setAffected(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Publish this version?</DialogTitle>
            <DialogDescription>
              This becomes the version shown to users. It can't be edited afterwards.
            </DialogDescription>
          </DialogHeader>
          {confirmDoc ? (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Document</dt>
                <dd className="font-medium">{confirmDoc.title}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Version</dt>
                <dd className="font-medium">v{confirmDoc.version}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Effective date</dt>
                <dd className="font-medium">
                  {confirmDoc.effective_date}
                  {confirmDoc.effective_date > today() ? " (scheduled)" : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Summary of change</dt>
                <dd className="mt-1">{confirmDoc.summary || "No summary provided."}</dd>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                {confirmDoc.requires_reacceptance ? (
                  <>
                    Marked as a material change:{" "}
                    {affected === null
                      ? "affected accounts are being counted…"
                      : `${affected} account${affected === 1 ? "" : "s"} will be asked to accept this version`}
                    . Existing acceptances are kept as history and nothing is accepted on a user's
                    behalf.
                  </>
                ) : (
                  "Not marked as a material change, so users are not asked to accept again."
                )}
              </div>
            </dl>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDoc(null)}>
              Cancel
            </Button>
            <Button
              disabled={publishMutation.isPending || !confirmDoc}
              onClick={() => confirmDoc && publishMutation.mutate(confirmDoc.id)}
            >
              {publishMutation.isPending ? "Publishing…" : "Publish version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
