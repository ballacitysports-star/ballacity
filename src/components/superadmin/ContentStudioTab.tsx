/**
 * Content Studio: sources -> drafts -> human approval -> publish to the official
 * BallaCity Facebook Page.
 *
 * Nothing here is a security boundary. Every action calls a server function that
 * re-checks the role, and the approval and publish states are set by database
 * routines that check again. What this screen does is make the rules visible:
 * which facts are unverified, what exactly will be posted, and what is not
 * available yet (scheduling, Meta analytics) and why.
 */

import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Facebook, Link2, Sparkles } from "lucide-react";
import {
  approveStudioDraft,
  createStudioDraft,
  disconnectMetaPage,
  generateStudioDraftWithAi,
  linkStudioSourceToListing,
  publishStudioDraft,
  rejectStudioDraft,
  setStudioDestinationPage,
  startMetaConnect,
  studioOverview,
  submitStudioSource,
  updateStudioDraft,
  updateStudioSettings,
  updateStudioSource,
} from "@/lib/content-studio.functions";
import { createUnclaimedListing } from "@/lib/listings.functions";
import {
  DRAFT_KINDS,
  LISTING_KINDS,
  SOURCE_DETAIL_FIELDS,
  composePostMessage,
  hasUnverifiedFacts,
  type ContentStudioSettings,
  type DraftFact,
  type DraftKind,
  type DraftStatus,
  type SourceDetailField,
} from "@/lib/content-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------- types

type Source = {
  id: string;
  url: string;
  normalized_url: string;
  url_host: string;
  platform: "facebook" | "instagram" | "web";
  source_kind: string;
  status: "new" | "needs_details" | "reviewed" | "dismissed";
  opportunity: "content_only" | "listing_candidate" | null;
  title: string | null;
  summary: string | null;
  sport: string | null;
  city: string | null;
  location: string | null;
  event_starts_at: string | null;
  age_group: string | null;
  listing_kind: string | null;
  org_name: string | null;
  details_verified: Record<string, string>;
  linked_subject_type: "team" | "gym" | null;
  linked_subject_id: string | null;
  notes: string | null;
  created_at: string;
};

type Draft = {
  id: string;
  source_id: string | null;
  kind: DraftKind;
  message: string;
  link_url: string | null;
  hashtags: string[];
  facts: DraftFact[];
  source_attribution: string | null;
  ai_generated: boolean;
  status: DraftStatus;
  version: number;
  approval_id: string | null;
  rejection_reason: string | null;
  updated_at: string;
};

type Attempt = {
  id: string;
  draft_id: string;
  status: "pending" | "succeeded" | "failed";
  external_post_id: string | null;
  error_code: string | null;
  error_message: string | null;
  destination_page_id: string;
  started_at: string;
  finished_at: string | null;
};

type Page = {
  id: string;
  page_id: string;
  page_name: string;
  is_destination: boolean;
  status: "active" | "expired" | "revoked" | "error";
  granted_scopes: string[];
  last_error: string | null;
  connected_at: string;
};

type Overview = {
  canApprove: boolean;
  settings: ContentStudioSettings;
  metaReady: boolean;
  sources: Source[];
  drafts: Draft[];
  attempts: Attempt[];
  pages: Page[];
};

const QUERY_KEY = ["content-studio"];

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  publishing: "Publishing…",
  published: "Published",
  failed: "Publish failed",
  rejected: "Rejected",
  canceled: "Canceled",
};

const SOURCE_STATUS_LABEL: Record<Source["status"], string> = {
  new: "New",
  needs_details: "Needs details",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

const FIELD_LABEL: Record<SourceDetailField, string> = {
  title: "Title",
  summary: "Summary (in your own words)",
  sport: "Sport",
  city: "City",
  location: "Location",
  event_starts_at: "Starts at",
  age_group: "Age group",
  listing_kind: "Opportunity type",
  org_name: "Team / coach / gym name",
};

const KIND_LABEL: Record<DraftKind, string> = {
  announcement: "Announcement",
  pickup_game: "Pickup game",
  team: "Team spotlight",
  tryout: "Tryout",
  coach: "Coach spotlight",
  gym: "Gym spotlight",
  event: "Event",
  recruitment: "Recruitment",
  reel_concept: "Reel concept",
};

function errMessage(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

function selectClass() {
  return "w-full rounded-md border bg-background px-3 py-2 text-sm";
}

// ---------------------------------------------------------------- root

export function ContentStudioTab() {
  const load = useServerFn(studioOverview);
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => load() as Promise<Overview> });

  // Coming back from Facebook's connect dialog.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const meta = params.get("meta");
    if (!meta) return;
    if (meta === "connected")
      toast.success("Facebook connected. Choose the destination Page below.");
    else toast.error(`Facebook connection failed (${meta.replace(/_/g, " ")}).`);
    params.delete("meta");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  if (q.isLoading) return <LoadingState label="Loading Content Studio…" />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const data = q.data;

  return (
    <div className="space-y-4">
      <StudioSummary data={data} />
      <Tabs defaultValue="sources">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="drafts">Drafts &amp; approval</TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
          <TabsTrigger value="page">Page &amp; settings</TabsTrigger>
        </TabsList>
        <TabsContent value="sources" className="pt-3">
          <SourcesSection data={data} />
        </TabsContent>
        <TabsContent value="drafts" className="pt-3">
          <DraftsSection data={data} />
        </TabsContent>
        <TabsContent value="published" className="pt-3">
          <PublishedSection data={data} />
        </TabsContent>
        <TabsContent value="page" className="pt-3">
          <PageSettingsSection data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Counts from rows this screen actually loaded. Meta reach/engagement is not shown: there is no insights integration. */
function StudioSummary({ data }: { data: Overview }) {
  const count = (pred: (d: Draft) => boolean) => data.drafts.filter(pred).length;
  const stats = [
    {
      label: "Sources needing details",
      value: data.sources.filter((s) => s.status === "needs_details" || s.status === "new").length,
    },
    {
      label: "Drafts awaiting approval",
      value: count((d) => d.status === "draft" || d.status === "in_review"),
    },
    { label: "Approved, not yet posted", value: count((d) => d.status === "approved") },
    { label: "Published", value: count((d) => d.status === "published") },
    { label: "Failed publishes", value: data.attempts.filter((a) => a.status === "failed").length },
    {
      label: "Listings from sources",
      value: data.sources.filter((s) => s.linked_subject_id).length,
    },
  ];
  const destination = data.pages.find((p) => p.is_destination && p.status === "active");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-surface p-3">
            <p className="text-xl font-semibold tabular-nums">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Counts cover the latest 200 sources and drafts. Reach, clicks and engagement are not shown:
        BallaCity has no Meta insights integration, so those numbers are unavailable rather than
        estimated.{" "}
        {destination
          ? `Posts go to ${destination.page_name}.`
          : "No destination Page is set, so nothing can be approved yet."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- sources

function SourcesSection({ data }: { data: Overview }) {
  const qc = useQueryClient();
  const submit = useServerFn(submitStudioSource);
  const [url, setUrl] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const [editing, setEditing] = useState<Source | null>(null);
  const [drafting, setDrafting] = useState<Source | null>(null);
  const [listing, setListing] = useState<Source | null>(null);

  const add = useMutation({
    mutationFn: () => submit({ data: { url } }),
    onSuccess: (res) => {
      setUrl("");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      if (res.duplicate) toast.info("Already submitted — opened the existing record.");
      else
        toast.success("Source saved. Add the details by hand: links are never read automatically.");
      setEditing(res.source as Source);
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const rows = data.sources.filter((s) => showDismissed || s.status !== "dismissed");

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-surface p-3">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) add.mutate();
          }}
        >
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a Facebook post, Page or event link, or any sports web page"
            aria-label="Source link"
            disabled={!data.settings.discovery}
          />
          <Button type="submit" disabled={!url.trim() || add.isPending || !data.settings.discovery}>
            <Link2 className="mr-1 h-4 w-4" /> Add source
          </Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          {data.settings.discovery
            ? "BallaCity stores the link as a reference only. It never reads, copies or republishes the post: a public link is not permission to reuse it. You enter the details yourself and mark which ones you confirmed."
            : "Source submission is turned off in settings."}
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={showDismissed} onCheckedChange={(v) => setShowDismissed(v === true)} />
        Show dismissed
      </label>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Link2 className="h-6 w-6" />}
          title="No sources yet"
          description="Add a link to a pickup game, tryout, team, coach or gym announcement to start a draft."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => (
            <li key={s.id} className="rounded-xl border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{s.title || s.org_name || s.url_host}</p>
                  <a
                    href={s.normalized_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex items-center gap-1 break-all text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" /> {s.normalized_url}
                  </a>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{s.platform}</Badge>
                    <Badge variant="outline">{s.source_kind}</Badge>
                    <Badge variant={s.status === "needs_details" ? "destructive" : "secondary"}>
                      {SOURCE_STATUS_LABEL[s.status]}
                    </Badge>
                    {s.linked_subject_id && (
                      <Badge variant="secondary">
                        Listing: {s.linked_subject_type} {s.linked_subject_id}
                      </Badge>
                    )}
                    <VerifiedCount source={s} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                    Details
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDrafting(s)}
                    disabled={s.status === "dismissed"}
                  >
                    <Sparkles className="mr-1 h-4 w-4" /> Draft
                  </Button>
                  {!s.linked_subject_id && data.settings.listingCreation && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setListing(s)}
                      disabled={s.status === "dismissed"}
                    >
                      Create listing
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <SourceDetailsDialog source={editing} onClose={() => setEditing(null)} />}
      {drafting && (
        <NewDraftDialog source={drafting} data={data} onClose={() => setDrafting(null)} />
      )}
      {listing && <CreateListingDialog source={listing} onClose={() => setListing(null)} />}
    </div>
  );
}

function VerifiedCount({ source }: { source: Source }) {
  const filled = SOURCE_DETAIL_FIELDS.filter((f) => source[f]);
  if (filled.length === 0) return null;
  const verified = filled.filter((f) => source.details_verified?.[f] === "verified").length;
  return (
    <Badge variant={verified === filled.length ? "secondary" : "outline"}>
      {verified}/{filled.length} details verified
    </Badge>
  );
}

function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

function SourceDetailsDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  const qc = useQueryClient();
  const update = useServerFn(updateStudioSource);
  const [details, setDetails] = useState<Record<SourceDetailField, string>>(() => {
    const out = {} as Record<SourceDetailField, string>;
    for (const f of SOURCE_DETAIL_FIELDS) {
      out[f] = f === "event_starts_at" ? toLocalInput(source.event_starts_at) : (source[f] ?? "");
    }
    return out;
  });
  const [verified, setVerified] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      SOURCE_DETAIL_FIELDS.map((f) => [f, source.details_verified?.[f] === "verified"]),
    ),
  );
  const [status, setStatus] = useState<Source["status"]>(source.status);
  const [opportunity, setOpportunity] = useState<string>(source.opportunity ?? "");
  const [notes, setNotes] = useState(source.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      update({
        data: {
          id: source.id,
          details: {
            ...details,
            event_starts_at: details.event_starts_at
              ? new Date(details.event_starts_at).toISOString()
              : null,
            listing_kind: details.listing_kind || null,
          },
          verified: Object.fromEntries(
            SOURCE_DETAIL_FIELDS.filter((f) => details[f]).map((f) => [
              f,
              verified[f] ? "verified" : "unverified",
            ]),
          ),
          status,
          opportunity: opportunity ? (opportunity as Source["opportunity"]) : null,
          notes,
        },
      }),
    onSuccess: () => {
      toast.success("Source updated");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Source details</DialogTitle>
          <DialogDescription className="break-all">{source.normalized_url}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">
            Tick "Verified" only for details you confirmed yourself (for example on the organizer's
            own page). Unverified details can still appear in a draft, but the approver will see
            them flagged.
          </p>
          {SOURCE_DETAIL_FIELDS.map((f) => (
            <div key={f} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-sm font-medium" htmlFor={`src-${f}`}>
                  {FIELD_LABEL[f]}
                </label>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Checkbox
                    checked={verified[f]}
                    disabled={!details[f]}
                    onCheckedChange={(v) => setVerified((m) => ({ ...m, [f]: v === true }))}
                  />
                  Verified
                </label>
              </div>
              {f === "summary" ? (
                <Textarea
                  id={`src-${f}`}
                  value={details[f]}
                  maxLength={2000}
                  onChange={(e) => setDetails((d) => ({ ...d, [f]: e.target.value }))}
                />
              ) : f === "listing_kind" ? (
                <select
                  id={`src-${f}`}
                  className={selectClass()}
                  value={details[f]}
                  onChange={(e) => setDetails((d) => ({ ...d, [f]: e.target.value }))}
                >
                  <option value="">—</option>
                  {LISTING_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`src-${f}`}
                  type={f === "event_starts_at" ? "datetime-local" : "text"}
                  value={details[f]}
                  onChange={(e) => setDetails((d) => ({ ...d, [f]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="src-status">
                Status
              </label>
              <select
                id="src-status"
                className={selectClass()}
                value={status}
                onChange={(e) => setStatus(e.target.value as Source["status"])}
              >
                {Object.entries(SOURCE_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="src-opp">
                Opportunity
              </label>
              <select
                id="src-opp"
                className={selectClass()}
                value={opportunity}
                onChange={(e) => setOpportunity(e.target.value)}
              >
                <option value="">Not decided</option>
                <option value="content_only">Content only</option>
                <option value="listing_candidate">Listing candidate</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="src-notes">
              Internal notes (staff only)
            </label>
            <Textarea
              id="src-notes"
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDraftDialog({
  source,
  data,
  onClose,
}: {
  source: Source;
  data: Overview;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const generate = useServerFn(generateStudioDraftWithAi);
  const create = useServerFn(createStudioDraft);
  const [kind, setKind] = useState<DraftKind>(defaultKindFor(source));
  const [notes, setNotes] = useState("");
  const [linkUrl, setLinkUrl] = useState(
    source.linked_subject_id
      ? `https://ballacity.com/${source.linked_subject_type === "gym" ? "orgs" : "teams"}/${source.linked_subject_id}`
      : "",
  );
  const [message, setMessage] = useState("");

  const done = () => {
    toast.success("Draft created. It needs a superadmin's approval before it can be posted.");
    qc.invalidateQueries({ queryKey: QUERY_KEY });
    onClose();
  };
  const ai = useMutation({
    mutationFn: () =>
      generate({
        data: { sourceId: source.id, kind, notes: notes || null, linkUrl: linkUrl || null },
      }),
    onSuccess: done,
    onError: (e) => toast.error(errMessage(e)),
  });
  const manual = useMutation({
    mutationFn: () =>
      create({ data: { sourceId: source.id, kind, message, linkUrl: linkUrl || null } }),
    onSuccess: done,
    onError: (e) => toast.error(errMessage(e)),
  });

  const filled = SOURCE_DETAIL_FIELDS.filter((f) => source[f]).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New draft</DialogTitle>
          <DialogDescription>{source.title || source.normalized_url}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {filled === 0 && (
            <p className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
              This source has no details yet. Add them first, or the AI has nothing to work from.
            </p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="draft-kind">
              Post type
            </label>
            <select
              id="draft-kind"
              className={selectClass()}
              value={kind}
              onChange={(e) => setKind(e.target.value as DraftKind)}
            >
              {DRAFT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="draft-link">
              BallaCity link (optional)
            </label>
            <Input
              id="draft-link"
              value={linkUrl}
              placeholder="https://ballacity.com/…"
              onChange={(e) => setLinkUrl(e.target.value)}
            />
          </div>

          <div className="space-y-2 rounded-xl border p-3">
            <p className="text-sm font-medium">Draft with AI</p>
            <Textarea
              value={notes}
              maxLength={800}
              placeholder="Optional notes for the AI (tone, what to emphasise). It only uses the source details."
              onChange={(e) => setNotes(e.target.value)}
            />
            <Button
              size="sm"
              onClick={() => ai.mutate()}
              disabled={ai.isPending || !data.settings.aiDrafts || filled === 0}
            >
              <Sparkles className="mr-1 h-4 w-4" /> {ai.isPending ? "Drafting…" : "Generate draft"}
            </Button>
            {!data.settings.aiDrafts && (
              <p className="text-xs text-muted-foreground">
                AI drafting is turned off in settings.
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-xl border p-3">
            <p className="text-sm font-medium">Or write it yourself</p>
            <Textarea
              value={message}
              maxLength={5000}
              onChange={(e) => setMessage(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => manual.mutate()}
              disabled={manual.isPending || !message.trim()}
            >
              Save draft
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function defaultKindFor(source: Source): DraftKind {
  const k = source.listing_kind;
  if (
    k === "pickup_game" ||
    k === "team" ||
    k === "tryout" ||
    k === "coach" ||
    k === "gym" ||
    k === "event"
  )
    return k;
  if (k === "league" || k === "tournament") return "event";
  return "announcement";
}

function CreateListingDialog({ source, onClose }: { source: Source; onClose: () => void }) {
  const qc = useQueryClient();
  const createListing = useServerFn(createUnclaimedListing);
  const link = useServerFn(linkStudioSourceToListing);
  const initialType: "team" | "gym" = source.listing_kind === "gym" ? "gym" : "team";
  const [subjectType, setSubjectType] = useState<"team" | "gym">(initialType);
  const [name, setName] = useState(source.org_name ?? source.title ?? "");
  const [handle, setHandle] = useState(
    (source.org_name ?? source.title ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 30),
  );
  const [city, setCity] = useState(source.city ?? "");

  const go = useMutation({
    mutationFn: async () => {
      const made = await createListing({
        data: {
          subjectType,
          name,
          handle,
          city: city || undefined,
          kind: source.listing_kind === "coach" ? "coach" : "team",
          sports: source.sport ? [source.sport] : [],
        },
      });
      await link({ data: { id: source.id, subjectType, subjectId: made.id } });
      return made;
    },
    onSuccess: () => {
      toast.success("Unclaimed listing created. Its owner can claim it from the listing page.");
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create an unclaimed listing</DialogTitle>
          <DialogDescription>
            The listing is labelled unclaimed and is not presented as run by or affiliated with the
            named team, coach or gym. Its real owner can claim it; a moderator reviews every claim.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="lst-type">
              Listing type
            </label>
            <select
              id="lst-type"
              className={selectClass()}
              value={subjectType}
              onChange={(e) => setSubjectType(e.target.value as "team" | "gym")}
            >
              <option value="team">Team or coach</option>
              <option value="gym">Gym or facility</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="lst-name">
              Name
            </label>
            <Input
              id="lst-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="lst-handle">
              Handle
            </label>
            <Input
              id="lst-handle"
              value={handle}
              maxLength={60}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="lst-city">
              City
            </label>
            <Input
              id="lst-city"
              value={city}
              maxLength={120}
              onChange={(e) => setCity(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => go.mutate()}
            disabled={go.isPending || name.trim().length < 2 || handle.trim().length < 2}
          >
            Create listing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- drafts

const DRAFT_FILTERS: { key: string; label: string; match: (d: Draft) => boolean }[] = [
  {
    key: "open",
    label: "Needs review",
    match: (d) => d.status === "draft" || d.status === "in_review",
  },
  {
    key: "ready",
    label: "Approved",
    match: (d) => d.status === "approved" || d.status === "failed" || d.status === "publishing",
  },
  { key: "done", label: "Published", match: (d) => d.status === "published" },
  {
    key: "closed",
    label: "Rejected / canceled",
    match: (d) => d.status === "rejected" || d.status === "canceled",
  },
];

function DraftsSection({ data }: { data: Overview }) {
  const [filter, setFilter] = useState("open");
  const [open, setOpen] = useState<Draft | null>(null);
  const current = DRAFT_FILTERS.find((f) => f.key === filter)!;
  const rows = data.drafts.filter(current.match);
  const sourceById = useMemo(() => new Map(data.sources.map((s) => [s.id, s])), [data.sources]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DRAFT_FILTERS.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={f.key === filter ? "default" : "outline"}
            onClick={() => setFilter(f.key)}
          >
            {f.label} ({data.drafts.filter(f.match).length})
          </Button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description="Drafts move through review, approval and publishing in these lists."
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((d) => (
            <li key={d.id} className="rounded-xl border bg-surface p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{KIND_LABEL[d.kind]}</Badge>
                    <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>
                      {DRAFT_STATUS_LABEL[d.status]}
                    </Badge>
                    {d.ai_generated && <Badge variant="outline">AI draft</Badge>}
                    {hasUnverifiedFacts(d.facts ?? []) && (
                      <Badge variant="destructive">Unverified facts</Badge>
                    )}
                    <Badge variant="outline">v{d.version}</Badge>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm">{d.message}</p>
                  {d.source_id && sourceById.get(d.source_id) && (
                    <p className="truncate text-xs text-muted-foreground">
                      From: {sourceById.get(d.source_id)!.url_host}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={() => setOpen(d)}>
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <DraftDialog
          draft={data.drafts.find((d) => d.id === open.id) ?? open}
          data={data}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function newKey(draftId: string) {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pub-${draftId.slice(0, 8)}-${rand}`;
}

function DraftDialog({
  draft,
  data,
  onClose,
}: {
  draft: Draft;
  data: Overview;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const update = useServerFn(updateStudioDraft);
  const approve = useServerFn(approveStudioDraft);
  const reject = useServerFn(rejectStudioDraft);
  const publish = useServerFn(publishStudioDraft);

  const editable = draft.status !== "publishing" && draft.status !== "published";
  const [message, setMessage] = useState(draft.message);
  const [linkUrl, setLinkUrl] = useState(draft.link_url ?? "");
  const [hashtags, setHashtags] = useState(draft.hashtags.join(" "));
  const [facts, setFacts] = useState<DraftFact[]>(draft.facts ?? []);
  const [ack, setAck] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // One key per publish intent: a double click or a retried request reaches the same attempt.
  const [publishKey, setPublishKey] = useState(() => newKey(draft.id));

  const dirty =
    message !== draft.message ||
    linkUrl !== (draft.link_url ?? "") ||
    hashtags !== draft.hashtags.join(" ") ||
    JSON.stringify(facts) !== JSON.stringify(draft.facts ?? []);
  const textDirty =
    message !== draft.message ||
    linkUrl !== (draft.link_url ?? "") ||
    hashtags !== draft.hashtags.join(" ");
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const save = useMutation({
    mutationFn: (status?: "draft" | "in_review" | "canceled") =>
      update({
        data: {
          id: draft.id,
          message,
          linkUrl: linkUrl || null,
          hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
          facts,
          ...(status ? { status } : {}),
        },
      }),
    onSuccess: (_r, status) => {
      toast.success(
        status === "in_review"
          ? "Sent for approval"
          : status === "canceled"
            ? "Draft canceled"
            : draft.status === "approved" && textDirty
              ? "Saved. The edit withdrew the approval; it needs approving again."
              : "Saved",
      );
      refresh();
      if (status === "canceled") onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const doApprove = useMutation({
    mutationFn: () =>
      approve({ data: { id: draft.id, version: draft.version, acknowledgeUnverified: ack } }),
    onSuccess: () => {
      toast.success("Approved. Exactly this version can now be published.");
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const doReject = useMutation({
    mutationFn: () => reject({ data: { id: draft.id, reason: rejectReason || null } }),
    onSuccess: () => {
      toast.success("Draft rejected");
      refresh();
      onClose();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const doPublish = useMutation({
    mutationFn: () => publish({ data: { id: draft.id, idempotencyKey: publishKey } }),
    onSuccess: (res) => {
      if (res.status === "published") toast.success("Posted to the Page.");
      else if (res.status === "pending")
        toast.info("Already publishing — the result will appear shortly.");
      else {
        toast.error(res.message);
        // A failed attempt is finished; a retry is a new intent with a new key.
        setPublishKey(newKey(draft.id));
      }
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const unverified = hasUnverifiedFacts(facts);
  const destination = data.pages.find((p) => p.is_destination && p.status === "active");
  const canPublish =
    data.canApprove &&
    data.settings.publishing &&
    data.metaReady &&
    !!destination &&
    (draft.status === "approved" || draft.status === "failed") &&
    !dirty;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {KIND_LABEL[draft.kind]} · {DRAFT_STATUS_LABEL[draft.status]} · v{draft.version}
          </DialogTitle>
          <DialogDescription>
            {draft.ai_generated ? "Drafted by AI from the source details. " : ""}
            Nothing is posted until a superadmin approves this exact version and presses Publish.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {draft.rejection_reason && (
            <p className="rounded-lg bg-muted p-2 text-sm">Rejected: {draft.rejection_reason}</p>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="d-msg">
              Message
            </label>
            <Textarea
              id="d-msg"
              rows={6}
              value={message}
              maxLength={5000}
              disabled={!editable}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="d-link">
                BallaCity link
              </label>
              <Input
                id="d-link"
                value={linkUrl}
                disabled={!editable}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium" htmlFor="d-tags">
                Hashtags
              </label>
              <Input
                id="d-tags"
                value={hashtags}
                disabled={!editable}
                onChange={(e) => setHashtags(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2 rounded-xl border p-3">
            <p className="text-sm font-medium">Facts this post relies on</p>
            {facts.length === 0 ? (
              <p className="text-xs text-muted-foreground">No facts listed.</p>
            ) : (
              <ul className="space-y-1">
                {facts.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-sm">
                    <span>{f.claim}</span>
                    <select
                      aria-label={`Status of: ${f.claim}`}
                      className="rounded-md border bg-background px-2 py-1 text-xs"
                      value={f.status}
                      disabled={!editable}
                      onChange={(e) =>
                        setFacts((all) =>
                          all.map((x, j) =>
                            j === i ? { ...x, status: e.target.value as DraftFact["status"] } : x,
                          ),
                        )
                      }
                    >
                      <option value="verified">Verified</option>
                      <option value="suggested">AI suggested</option>
                      <option value="unverified">Unverified</option>
                    </select>
                  </li>
                ))}
              </ul>
            )}
            {draft.source_attribution && (
              <p className="break-all text-xs text-muted-foreground">{draft.source_attribution}</p>
            )}
          </div>

          <div className="rounded-xl border bg-muted/40 p-3">
            <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Facebook className="h-3 w-3" /> Preview — what the Page will post
            </p>
            <p className="whitespace-pre-wrap text-sm">
              {composePostMessage({ message, hashtags: hashtags.split(/[\s,]+/).filter(Boolean) })}
            </p>
            {linkUrl && <p className="mt-1 break-all text-xs text-primary">{linkUrl}</p>}
          </div>

          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => save.mutate(undefined)}
              >
                Save changes
              </Button>
              {draft.status === "draft" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => save.mutate("in_review")}
                >
                  Send for approval
                </Button>
              )}
              {draft.status !== "canceled" && draft.status !== "rejected" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => save.mutate("canceled")}
                >
                  Cancel draft
                </Button>
              )}
            </div>
          )}

          {data.canApprove && (draft.status === "draft" || draft.status === "in_review") && (
            <div className="space-y-2 rounded-xl border border-primary/40 p-3">
              <p className="text-sm font-medium">Approve</p>
              {!destination && (
                <p className="text-xs text-destructive">
                  Set a destination Page under "Page &amp; settings" first.
                </p>
              )}
              {dirty && (
                <p className="text-xs text-muted-foreground">Save your changes before approving.</p>
              )}
              {unverified && (
                <label className="flex items-start gap-2 text-xs">
                  <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} />
                  This post relies on facts nobody has verified. I have checked them, or they are
                  worded as unconfirmed.
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={doApprove.isPending || dirty || !destination || (unverified && !ack)}
                  onClick={() => doApprove.mutate()}
                >
                  Approve v{draft.version}
                </Button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={rejectReason}
                  maxLength={500}
                  placeholder="Reason (optional)"
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={doReject.isPending}
                  onClick={() => doReject.mutate()}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}

          {(draft.status === "approved" || draft.status === "failed") && (
            <div className="space-y-2 rounded-xl border border-primary/40 p-3">
              <p className="text-sm font-medium">
                Publish to {destination?.page_name ?? "the Page"}
              </p>
              {!data.metaReady && (
                <p className="text-xs text-muted-foreground">
                  Publishing needs the Meta app credentials on the server.
                </p>
              )}
              {data.metaReady && !data.settings.publishing && (
                <p className="text-xs text-muted-foreground">
                  Publishing is turned off in settings.
                </p>
              )}
              {!data.canApprove && (
                <p className="text-xs text-muted-foreground">Only a superadmin can publish.</p>
              )}
              {draft.status === "failed" && (
                <p className="text-xs text-destructive">
                  The last attempt failed. If it failed with "no response", check the Page for the
                  post before retrying.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Scheduling is not available yet: posts go out when you press Publish.
              </p>
              <Button
                size="sm"
                disabled={!canPublish || doPublish.isPending}
                onClick={() => doPublish.mutate()}
              >
                {doPublish.isPending
                  ? "Publishing…"
                  : draft.status === "failed"
                    ? "Retry publish"
                    : "Publish now"}
              </Button>
              {data.canApprove && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={doReject.isPending}
                  onClick={() => doReject.mutate()}
                >
                  Withdraw approval (reject)
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- published

function PublishedSection({ data }: { data: Overview }) {
  const draftById = useMemo(() => new Map(data.drafts.map((d) => [d.id, d])), [data.drafts]);
  if (data.attempts.length === 0) {
    return (
      <EmptyState
        icon={<Facebook className="h-6 w-6" />}
        title="Nothing published yet"
        description="Publish attempts, successful or not, are listed here with Meta's post id."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {data.attempts.map((a) => {
        const d = draftById.get(a.draft_id);
        return (
          <li key={a.id} className="rounded-xl border bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                <Badge
                  variant={
                    a.status === "succeeded"
                      ? "secondary"
                      : a.status === "failed"
                        ? "destructive"
                        : "outline"
                  }
                >
                  {a.status === "succeeded"
                    ? "Posted"
                    : a.status === "failed"
                      ? "Failed"
                      : "Pending"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.started_at).toLocaleString()}
                </span>
              </div>
              {a.external_post_id && (
                <a
                  href={`https://www.facebook.com/${encodeURIComponent(a.external_post_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on Facebook <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {d && <p className="mt-1 line-clamp-2 text-muted-foreground">{d.message}</p>}
            {a.error_code && (
              <p className="mt-1 text-xs text-destructive">
                {a.error_code}: {a.error_message}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- page & settings

function PageSettingsSection({ data }: { data: Overview }) {
  const qc = useQueryClient();
  const connect = useServerFn(startMetaConnect);
  const setDest = useServerFn(setStudioDestinationPage);
  const disconnect = useServerFn(disconnectMetaPage);
  const saveSettings = useServerFn(updateStudioSettings);
  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });

  const startConnect = useMutation({
    mutationFn: () => connect(),
    onSuccess: (res) => {
      window.location.assign(res.url);
    },
    onError: (e) => toast.error(errMessage(e)),
  });
  const dest = useMutation({
    mutationFn: (connectionId: string) => setDest({ data: { connectionId } }),
    onSuccess: () => {
      toast.success("Destination set. Approvals for another Page must be approved again.");
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
  const drop = useMutation({
    mutationFn: (connectionId: string) => disconnect({ data: { connectionId } }),
    onSuccess: () => {
      toast.success("Page disconnected and its token deleted.");
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
  const flags = useMutation({
    mutationFn: (patch: Partial<ContentStudioSettings>) => saveSettings({ data: patch }),
    onSuccess: () => {
      toast.success("Settings saved");
      refresh();
    },
    onError: (e) => toast.error(errMessage(e)),
  });

  const SWITCHES: {
    key: keyof ContentStudioSettings;
    label: string;
    help: string;
    disabled?: boolean;
  }[] = [
    {
      key: "discovery",
      label: "Source submission",
      help: "Staff can add links and record sources.",
    },
    {
      key: "aiDrafts",
      label: "AI drafts",
      help: "Staff can ask the AI for a draft. The AI controls tab can also switch it off.",
    },
    {
      key: "listingCreation",
      label: "Listings from sources",
      help: "Staff can turn a source into an unclaimed team or gym listing.",
    },
    {
      key: "publishing",
      label: "Publishing",
      help: data.metaReady
        ? "A superadmin can publish approved drafts to the destination Page."
        : "Unavailable until META_APP_ID, META_APP_SECRET and CONTENT_STUDIO_TOKEN_KEY are set on the server.",
      disabled: !data.metaReady && !data.settings.publishing,
    },
  ];

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-xl border bg-surface p-3">
        <h3 className="flex items-center gap-1 font-medium">
          <Facebook className="h-4 w-4" /> Official Facebook Page
        </h3>
        {!data.metaReady ? (
          <p className="text-sm text-muted-foreground">
            Not configured. Connecting a Page needs a Meta app with the pages_show_list,
            pages_read_engagement and pages_manage_posts permissions approved through Meta App
            Review, and the app credentials set on the server.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect with an account that manages the official BallaCity Page. Every Page that
            account can post to is listed; nothing is posted until you pick the destination and
            approve a draft.
          </p>
        )}
        {data.canApprove && (
          <Button
            size="sm"
            disabled={!data.metaReady || startConnect.isPending}
            onClick={() => startConnect.mutate()}
          >
            {data.pages.length ? "Reconnect Facebook" : "Connect Facebook"}
          </Button>
        )}
        {data.pages.length > 0 && (
          <ul className="space-y-2 pt-1">
            {data.pages.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"
              >
                <div className="space-y-1">
                  <p className="font-medium">
                    {p.page_name}{" "}
                    <span className="text-xs text-muted-foreground">({p.page_id})</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {p.is_destination && <Badge>Destination</Badge>}
                    <Badge variant={p.status === "active" ? "secondary" : "destructive"}>
                      {p.status}
                    </Badge>
                  </div>
                  {p.last_error && <p className="text-xs text-destructive">{p.last_error}</p>}
                </div>
                {data.canApprove && (
                  <div className="flex flex-wrap gap-2">
                    {!p.is_destination && p.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dest.isPending}
                        onClick={() => dest.mutate(p.id)}
                      >
                        Make destination
                      </Button>
                    )}
                    {p.status !== "revoked" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={drop.isPending}
                        onClick={() => drop.mutate(p.id)}
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-surface p-3">
        <h3 className="font-medium">Switches</h3>
        {SWITCHES.map((s) => (
          <div key={s.key} className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.help}</p>
            </div>
            <Switch
              checked={data.settings[s.key]}
              disabled={!data.canApprove || flags.isPending || s.disabled}
              onCheckedChange={(v) => flags.mutate({ [s.key]: v })}
              aria-label={s.label}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          A switch never grants anything: roles are checked on the server for every action whether a
          switch is on or off.
        </p>
      </section>
    </div>
  );
}
