/**
 * Superadmin Discovery: finds teams, gyms and trainers on the public web and
 * lists them for approval.
 *
 * "Start" creates a run, then this tab keeps asking the server for the next
 * small step until the run is done (so it keeps going while the tab stays
 * open, and can be stopped or resumed). Nothing becomes a listing until a
 * person approves it; approving creates an ordinary unclaimed listing that its
 * real owner can later claim.
 */

import { useEffect, useRef, useState } from "react";
import { MAX_DROPPED_STEPS, isNetworkDrop } from "@/lib/discovery/network-drop";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Pencil } from "lucide-react";
import {
  superadminDiscoveryBulk,
  superadminDiscoveryCancel,
  superadminDiscoveryIds,
  superadminDiscoveryList,
  superadminDiscoveryOverview,
  superadminDiscoveryReview,
  superadminDiscoveryStart,
  superadminDiscoveryStep,
} from "@/lib/discovery.functions";
import { DISCOVERY_TYPES, DISCOVERY_TYPE_LABELS, type DiscoveryType } from "@/lib/discovery/areas";
import { ORG_CATEGORIES } from "@/lib/org-listing";
import { SPORTS } from "@/lib/sample-data";
import { SportHubsPanel } from "@/components/superadmin/SportHubsPanel";
import { ConfirmAction } from "./ConfirmAction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Run = Awaited<ReturnType<typeof superadminDiscoveryStart>>;
type Candidate = Awaited<ReturnType<typeof superadminDiscoveryList>>["rows"][number];
type Status = "pending" | "approved" | "rejected";

const PAGE = 25;
/** Matches the server: finds this sure and with no possible repeat can be bulk-approved. */
const BULK_MIN = 0.75;
/** The server takes at most this many finds per bulk call; more are sent in turns. */
const BULK_CHUNK = 50;

type BulkAction = "approve" | "reject" | "remove";
type BulkTotals = { done: number; skipped: number; failed: { name: string; error: string }[] };

/** Where a listing created from a find lives, so it can be looked at before it is removed. */
const listingHref = (c: Candidate) =>
  c.created_listing_id
    ? c.subject_type === "gym"
      ? `/orgs/${c.created_listing_id}`
      : `/teams/${c.created_listing_id}`
    : null;

/** A find can be picked while it awaits a decision, or while its listing exists. */
const isSelectable = (c: Candidate) =>
  c.status === "pending" || (c.status === "approved" && !!c.created_listing_id);

const STATUS_LABEL: Record<Status, string> = {
  pending: "To review",
  approved: "Approved",
  rejected: "Rejected",
};

function confidenceLabel(c: number): {
  text: string;
  variant: "default" | "secondary" | "outline";
} {
  if (c >= BULK_MIN) return { text: "High confidence", variant: "default" };
  if (c >= 0.5) return { text: "Medium confidence", variant: "secondary" };
  return { text: "Low confidence", variant: "outline" };
}

const asMessage = (e: unknown, fallback = "Something went wrong") =>
  e instanceof Error ? e.message : fallback;

export function DiscoveryTab() {
  const qc = useQueryClient();
  const getOverview = useServerFn(superadminDiscoveryOverview);
  const startFn = useServerFn(superadminDiscoveryStart);
  const stepFn = useServerFn(superadminDiscoveryStep);
  const cancelFn = useServerFn(superadminDiscoveryCancel);
  const listFn = useServerFn(superadminDiscoveryList);
  const reviewFn = useServerFn(superadminDiscoveryReview);
  const bulkFn = useServerFn(superadminDiscoveryBulk);
  const idsFn = useServerFn(superadminDiscoveryIds);

  const overview = useQuery({
    queryKey: ["superadmin-discovery-overview"],
    queryFn: () => getOverview(),
  });

  const [pickedArea, setAreaId] = useState("");
  const [types, setTypes] = useState<DiscoveryType[]>([...DISCOVERY_TYPES]);
  const [maxPages, setMaxPages] = useState("80");
  const [run, setRun] = useState<Run | null>(null);
  const [driving, setDriving] = useState(false);
  const seeded = useRef(false);
  // Steps in a row whose connection dropped; reset by any step that gets an answer.
  const dropped = useRef(0);

  // The area defaults to the first one; no need to wait for an effect to fill it in.
  const areaId = pickedArea || overview.data?.areas[0]?.id || "";

  // Pick up the latest run once the overview loads.
  useEffect(() => {
    if (!overview.data || seeded.current) return;
    seeded.current = true;
    setRun(overview.data.run);
  }, [overview.data]);

  const refreshCandidates = () => qc.invalidateQueries({ queryKey: ["superadmin-discovery-list"] });

  const start = useMutation({
    mutationFn: () =>
      startFn({
        data: { areaId, types, maxPages: Math.max(1, Math.round(Number(maxPages) || 80)) },
      }),
    onSuccess: (r) => {
      setRun(r);
      setDriving(true);
      toast.success("Discovery started. Keep this tab open while it runs.");
    },
    onError: (e: unknown) => toast.error(asMessage(e, "Could not start")),
  });

  const step = useMutation({
    mutationFn: (runId: string) => stepFn({ data: { runId } }),
    onSuccess: (r) => {
      dropped.current = 0;
      setRun(r);
      refreshCandidates();
      if (r.status !== "running") {
        setDriving(false);
        if (r.status === "done")
          toast.success(`Discovery finished: ${r.stats.candidates} new finds`);
        if (r.status === "failed") toast.error(r.error ?? "Discovery stopped");
      }
    },
    onError: (e: unknown) => {
      const message = asMessage(e, "A step failed. Resume to try again.");
      // A step that outlived the server drops the connection; the run is saved
      // after every step, so carry on a few times before giving up.
      if (isNetworkDrop(message) && dropped.current < MAX_DROPPED_STEPS) {
        dropped.current += 1;
        toast.message("A step took too long and the connection dropped. Retrying…");
        return;
      }
      dropped.current = 0;
      setDriving(false);
      toast.error(
        isNetworkDrop(message)
          ? "Steps keep taking too long and dropping the connection. Press Resume to try again."
          : message,
      );
    },
  });

  const cancel = useMutation({
    mutationFn: (runId: string) => cancelFn({ data: { runId } }),
    onSuccess: (r) => {
      setDriving(false);
      setRun(r);
      toast.message("Discovery stopped");
    },
    onError: (e: unknown) => toast.error(asMessage(e)),
  });

  // Keep stepping while driving. A busy answer means another tab holds the step.
  useEffect(() => {
    if (!driving || !run || run.status !== "running" || step.isPending) return;
    const t = setTimeout(() => step.mutate(run.id), run.busy ? 3000 : 250);
    return () => clearTimeout(t);
  }, [driving, run, step]);

  const running = run?.status === "running";
  const toggleType = (t: DiscoveryType) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const total = run ? run.tasksLeft + run.pagesLeft : 0;

  return (
    <div className="space-y-4">
      <SportHubsPanel />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Find teams, gyms and trainers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Searches the web and map listings, reads each organization&apos;s own website, and
            queues what it finds below. Nothing is listed until you approve it, and approved finds
            become unclaimed listings their owners can claim.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">Area</span>
              <select
                value={areaId}
                onChange={(e) => setAreaId(e.target.value)}
                disabled={running}
                className="rounded-md border bg-background px-3 py-2 text-sm"
                aria-label="Area"
              >
                {(overview.data?.areas ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="space-y-1" disabled={running}>
              <legend className="text-xs font-medium">Look for</legend>
              <div className="flex flex-wrap gap-3">
                {DISCOVERY_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={types.includes(t)}
                      onChange={() => toggleType(t)}
                    />
                    {DISCOVERY_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block space-y-1">
              <span className="text-xs font-medium">Pages to read (most)</span>
              <Input
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={(e) => setMaxPages(e.target.value)}
                disabled={running}
                className="w-28"
              />
            </label>
            <Button
              disabled={!areaId || !types.length || running || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? "Starting…" : "Start discovery"}
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Web search:{" "}
            {!overview.data
              ? "checking…"
              : overview.data.searchEnabled
                ? "on"
                : "off (add FIRECRAWL_API_KEY to turn it on)"}
            {" · "}Map listings: on
          </p>

          {run && (
            <div className="space-y-2 rounded-lg border p-3" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    run.status === "failed"
                      ? "destructive"
                      : run.status === "running"
                        ? "default"
                        : "secondary"
                  }
                >
                  {run.status === "running" ? (driving ? "Running" : "Paused") : run.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {run.areaLabel} · {run.types.map((t) => DISCOVERY_TYPE_LABELS[t]).join(", ")}
                </span>
                <div className="ml-auto flex gap-2">
                  {running && !driving && (
                    <Button size="sm" onClick={() => setDriving(true)}>
                      Resume
                    </Button>
                  )}
                  {running && driving && (
                    <Button size="sm" variant="outline" onClick={() => setDriving(false)}>
                      Pause
                    </Button>
                  )}
                  {running && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(run.id)}
                    >
                      Stop
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs">
                {run.pagesDone} of up to {run.maxPages} pages read · {run.stats.candidates} new
                finds · {run.stats.duplicates} already listed or repeated
                {run.stats.errors ? ` · ${run.stats.errors} problems` : ""}
                {running && total > 0
                  ? ` · ${run.tasksLeft} lookups and ${run.pagesLeft} pages to go`
                  : ""}
              </p>
              {run.error && <p className="text-xs text-destructive">{run.error}</p>}
              {run.log.length > 0 && (
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-muted-foreground">
                  {run.log.map((l, i) => (
                    <li key={`${i}-${l}`}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ReviewQueue
        listFn={listFn}
        reviewFn={reviewFn}
        bulkFn={bulkFn}
        idsFn={idsFn}
        onChanged={refreshCandidates}
      />
    </div>
  );
}

function ReviewQueue({
  listFn,
  reviewFn,
  bulkFn,
  idsFn,
  onChanged,
}: {
  listFn: ReturnType<typeof useServerFn<typeof superadminDiscoveryList>>;
  reviewFn: ReturnType<typeof useServerFn<typeof superadminDiscoveryReview>>;
  bulkFn: ReturnType<typeof useServerFn<typeof superadminDiscoveryBulk>>;
  idsFn: ReturnType<typeof useServerFn<typeof superadminDiscoveryIds>>;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<Status>("pending");
  const [type, setType] = useState<DiscoveryType | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [removing, setRemoving] = useState<string[] | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
      setPicked([]);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ["superadmin-discovery-list", status, type, query, page],
    queryFn: () =>
      listFn({
        data: { status, type: type || undefined, search: query, limit: PAGE, offset: page * PAGE },
      }),
    placeholderData: keepPreviousData,
  });

  const rows = (list.data?.rows ?? []) as Candidate[];
  const counts = list.data?.counts;
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE));

  const review = useMutation({
    mutationFn: (v: {
      id: string;
      action: "approve" | "reject" | "remove";
      edits?: Record<string, unknown>;
      confirmDuplicate?: boolean;
    }) => reviewFn({ data: v as never }),
    onSuccess: (_r, v) => {
      toast.success(
        v.action === "approve"
          ? "Listed as an unclaimed listing"
          : v.action === "remove"
            ? "Listing removed"
            : "Rejected",
      );
      setPicked((p) => p.filter((x) => x !== v.id));
      onChanged();
    },
    onError: (e: unknown) => toast.error(asMessage(e)),
  });

  const bulk = useMutation({
    mutationFn: async (v: { action: BulkAction; ids: string[] }) => {
      const total: BulkTotals = { done: 0, skipped: 0, failed: [] };
      for (let i = 0; i < v.ids.length; i += BULK_CHUNK) {
        const r = await bulkFn({
          data: { ids: v.ids.slice(i, i + BULK_CHUNK), action: v.action },
        });
        total.done += r.done;
        total.skipped += r.skipped;
        total.failed.push(...r.failed);
      }
      return total;
    },
    onSuccess: (r, v) => {
      const verb = { approve: "approved", reject: "rejected", remove: "removed" }[v.action];
      toast.success(
        `${r.done} ${verb}` +
          (r.skipped
            ? v.action === "approve"
              ? `, ${r.skipped} need a closer look`
              : `, ${r.skipped} skipped`
            : "") +
          (r.failed.length ? `, ${r.failed.length} failed` : ""),
      );
      if (r.failed[0]) toast.error(`${r.failed[0].name}: ${r.failed[0].error}`);
      setPicked([]);
      onChanged();
    },
    onError: (e: unknown) => toast.error(asMessage(e)),
  });

  // Every find matching the current filters, across pages (up to a server limit).
  const selectAll = useMutation({
    mutationFn: () => idsFn({ data: { status, type: type || undefined, search: query } }),
    onSuccess: (r) => {
      setPicked(r.ids);
      if (r.total > r.ids.length) {
        toast.message(`Selected the first ${r.ids.length} of ${r.total}.`);
      }
    },
    onError: (e: unknown) => toast.error(asMessage(e)),
  });

  const approve = (c: Candidate, edits?: Record<string, unknown>) => {
    if (
      c.duplicate_of &&
      !window.confirm(`This may repeat "${c.duplicate_of.name}". Add it anyway?`)
    ) {
      return;
    }
    review.mutate({ id: c.id, action: "approve", edits, confirmDuplicate: !!c.duplicate_of });
  };

  const total = list.data?.total ?? 0;
  const selectableRows = rows.filter(isSelectable);
  const allOnPage = selectableRows.length > 0 && selectableRows.every((r) => picked.includes(r.id));
  const toggleAllOnPage = () =>
    setPicked((p) =>
      allOnPage
        ? p.filter((id) => !selectableRows.some((r) => r.id === id))
        : [...new Set([...p, ...selectableRows.map((r) => r.id)])],
    );
  const busy = bulk.isPending || review.isPending;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Finds</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Status">
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "default" : "outline"}
                onClick={() => {
                  setStatus(s);
                  setPage(0);
                  setPicked([]);
                }}
              >
                {STATUS_LABEL[s]}
                {counts ? ` (${counts[s]})` : ""}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Type">
            <Button
              size="sm"
              variant={type === "" ? "secondary" : "ghost"}
              onClick={() => {
                setType("");
                setPage(0);
                setPicked([]);
              }}
            >
              All
            </Button>
            {DISCOVERY_TYPES.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={type === t ? "secondary" : "ghost"}
                onClick={() => {
                  setType(t);
                  setPage(0);
                  setPicked([]);
                }}
              >
                {DISCOVERY_TYPE_LABELS[t]}
              </Button>
            ))}
          </div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or city"
            className="max-w-xs"
            aria-label="Search finds"
          />
        </div>

        {selectableRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={toggleAllOnPage}
                aria-label="Select all on this page"
              />
              Select all on this page ({selectableRows.length})
            </label>
            {allOnPage && total > selectableRows.length && picked.length < total && (
              <Button
                size="sm"
                variant="link"
                className="h-auto p-0 text-xs"
                disabled={selectAll.isPending}
                onClick={() => selectAll.mutate()}
              >
                {selectAll.isPending ? "Selecting…" : `Select all ${total} matching`}
              </Button>
            )}
          </div>
        )}

        {picked.length > 0 && status !== "rejected" && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2 text-xs">
            <span>{picked.length} selected</span>
            {status === "pending" ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => bulk.mutate({ action: "approve", ids: picked })}
                >
                  Approve high-confidence
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => bulk.mutate({ action: "reject", ids: picked })}
                >
                  Reject selected
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => setRemoving(picked)}
              >
                Remove selected listings
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              Clear
            </Button>
            <span className="text-muted-foreground">
              {status === "pending"
                ? "Bulk approval skips low-confidence finds and possible repeats; review those one by one."
                : "Listings an owner has claimed, or that people have started using, are skipped."}
            </span>
          </div>
        )}

        {list.isError && (
          <p className="text-sm text-destructive">
            {asMessage(list.error, "Could not load finds")}
          </p>
        )}

        <ul className="space-y-2">
          {rows.map((c) => (
            <CandidateCard
              key={c.id}
              c={c}
              picked={picked.includes(c.id)}
              selectable={isSelectable(c)}
              busy={review.isPending && review.variables?.id === c.id}
              onPick={() =>
                setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))
              }
              onApprove={() => approve(c)}
              onReject={() => review.mutate({ id: c.id, action: "reject" })}
              onRemove={() => setRemoving([c.id])}
              onEdit={() => setEditing(c)}
            />
          ))}
          {!list.isLoading && rows.length === 0 && (
            <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {status === "pending"
                ? "Nothing waiting. Start a discovery above to find more."
                : "Nothing here."}
            </li>
          )}
        </ul>

        {pages > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page + 1} of {pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </CardContent>

      <ConfirmAction
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={
          removing && removing.length > 1
            ? `Remove ${removing.length} listings`
            : "Remove this listing"
        }
        description={
          "This deletes the unclaimed listing from BallaCity. The find is filed as rejected, so discovery won't suggest it again. " +
          "A listing an owner has claimed, or that people have started using, is left alone."
        }
        confirmWord={removing && removing.length > 1 ? "REMOVE" : undefined}
        requireReason={false}
        confirmLabel="Remove"
        pending={busy}
        onConfirm={() => {
          const ids = removing ?? [];
          setRemoving(null);
          if (ids.length === 1) review.mutate({ id: ids[0], action: "remove" });
          else if (ids.length > 1) bulk.mutate({ action: "remove", ids });
        }}
      />

      {editing && (
        <EditDialog
          key={editing.id}
          c={editing}
          onClose={() => setEditing(null)}
          onApprove={(edits) => {
            approve(editing, edits);
            setEditing(null);
          }}
        />
      )}
    </Card>
  );
}

function CandidateCard({
  c,
  picked,
  selectable,
  busy,
  onPick,
  onApprove,
  onReject,
  onRemove,
  onEdit,
}: {
  c: Candidate;
  picked: boolean;
  selectable: boolean;
  busy: boolean;
  onPick: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const href = c.status === "approved" ? listingHref(c) : null;
  const conf = confidenceLabel(c.confidence);
  const where = [c.address, c.city].filter(Boolean).join(", ");
  return (
    <li className="rounded-lg border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 gap-2">
          {selectable && (
            <input
              type="checkbox"
              checked={picked}
              onChange={onPick}
              aria-label={`Select ${c.name}`}
              className="mt-1"
            />
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold">{c.name}</span>
              <Badge variant="outline">{DISCOVERY_TYPE_LABELS[c.subject_type]}</Badge>
              <Badge variant={conf.variant}>{conf.text}</Badge>
              {c.category && <Badge variant="secondary">{c.category}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {[where, c.sports.join(", ")].filter(Boolean).join(" · ")}
            </p>
            {c.description && <p className="text-xs">{c.description}</p>}
            {c.duplicate_of && (
              <p className="text-xs font-medium text-amber-500">
                May repeat &ldquo;{c.duplicate_of.name}&rdquo; (
                {c.duplicate_of.kind === "candidate" ? "another find" : "already listed"},{" "}
                {Math.round(c.duplicate_of.score * 100)}% match)
              </p>
            )}
            {c.reject_reason && <p className="text-xs text-muted-foreground">{c.reject_reason}</p>}
            <a
              href={c.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              {new URL(c.source_url).hostname.replace(/^www\./, "")}
            </a>
          </div>
        </div>
        {c.status === "pending" && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button size="sm" disabled={busy} onClick={onApprove}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
              Reject
            </Button>
          </div>
        )}
        {c.status === "approved" && href && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="ghost" asChild>
              <a href={href} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                View listing
              </a>
            </Button>
            <Button size="sm" variant="destructive" disabled={busy} onClick={onRemove}>
              Remove listing
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function EditDialog({
  c,
  onClose,
  onApprove,
}: {
  c: Candidate;
  onClose: () => void;
  onApprove: (edits: Record<string, unknown>) => void;
}) {
  const isGym = c.subject_type === "gym";
  const [form, setForm] = useState({
    name: c.name,
    city: c.city ?? "",
    address: c.address ?? "",
    website: c.website ?? "",
    category: c.category ?? "Other",
    sports: c.sports,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim().length >= 2;

  const submit = () =>
    onApprove({
      name: form.name.trim(),
      city: form.city.trim() || null,
      ...(isGym
        ? {
            address: form.address.trim() || null,
            website: form.website.trim() || null,
            category: form.category,
          }
        : { sports: form.sports }),
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check and approve</DialogTitle>
          <DialogDescription>
            Fix anything the reader got wrong, then approve. It is listed as an unclaimed{" "}
            {DISCOVERY_TYPE_LABELS[c.subject_type].toLowerCase()} listing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">Name</span>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              maxLength={120}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">City</span>
            <Input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              maxLength={120}
            />
          </label>
          {isGym ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Address</span>
                <Input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  maxLength={240}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Website</span>
                <Input
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                  maxLength={240}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium">Category</span>
                <select
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {ORG_CATEGORIES.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <div className="space-y-1">
              <span className="text-xs font-medium">Sports</span>
              <div className="flex flex-wrap gap-1">
                {SPORTS.map((s) => {
                  const on = form.sports.includes(s.name);
                  return (
                    <Button
                      key={s.name}
                      type="button"
                      size="sm"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() =>
                        set(
                          "sports",
                          on ? form.sports.filter((x) => x !== s.name) : [...form.sports, s.name],
                        )
                      }
                    >
                      {s.emoji} {s.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={submit}>
            Approve with these details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
