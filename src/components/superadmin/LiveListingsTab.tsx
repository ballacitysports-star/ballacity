/**
 * Superadmin Live Listings: games, tryouts & camps, and player availability in
 * one place, with per-listing hide/unhide, a link to the live page, and edits.
 *
 * Hiding a listing sets only that row's `hidden_at` (via superadminModerate),
 * which takes it off the landing page, feeds and maps without touching any
 * global switch. Every hide, unhide and edit is written to the audit log.
 */

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Pencil } from "lucide-react";
import { superadminModerate } from "@/lib/superadmin.functions";
import {
  superadminListListings,
  superadminUpdateListing,
} from "@/lib/superadmin-listings.functions";
import {
  EDIT_SCHEMAS,
  LISTING_STATUS_LABELS,
  SECTION_MODERATION_KIND,
  TRYOUT_KIND_LABELS,
  liveLink,
  listingStatus,
  type ListingSection,
  type ListingStatus,
  type ListingRow,
  type ListingVisibility,
  type TryoutKind,
} from "@/lib/live-listings";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { scaleForSport } from "@/lib/sport-levels";
import {
  AVAILABILITY_INTENTS,
  INTENT_LABEL,
  initialLevelsForPost,
  parseIntents,
  postTiersForSport,
  type AvailabilityIntent,
} from "@/lib/availability-levels";
import { TierChips } from "@/components/sports/TierChips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const SECTIONS: { key: ListingSection; label: string }[] = [
  { key: "games", label: "🏀 Games & runs" },
  { key: "tryouts", label: "📋 Tryouts & camps" },
  { key: "availability", label: "🙋 Player availability" },
];

const VISIBILITY: { key: ListingVisibility; label: string }[] = [
  { key: "visible", label: "Visible" },
  { key: "hidden", label: "Hidden" },
  { key: "past", label: "Past / concluded" },
  { key: "all", label: "All" },
];

const PAGE = 25;

const STATUS_VARIANT: Record<ListingStatus, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  full: "secondary",
  joins_closed: "secondary",
  completed: "outline",
  closed: "outline",
  cancelled: "destructive",
  hidden: "destructive",
  held: "destructive",
  screening: "secondary",
};

type Listing = ListingRow;
/** Edit form fields; their shape depends on the section. */
type FormState = ListingRow;

export function LiveListingsTab() {
  const qc = useQueryClient();
  const list = useServerFn(superadminListListings);
  const moderate = useServerFn(superadminModerate);

  const [section, setSection] = useState<ListingSection>("games");
  const [visibility, setVisibility] = useState<ListingVisibility>("visible");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Listing | null>(null);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const listings = useQuery({
    queryKey: ["superadmin-listings", section, visibility, query, page],
    queryFn: () =>
      list({ data: { section, visibility, search: query, limit: PAGE, offset: page * PAGE } }),
    placeholderData: keepPreviousData,
  });

  const toggleHidden = useMutation({
    mutationFn: (row: Listing) =>
      moderate({
        data: {
          kind: SECTION_MODERATION_KIND[section],
          id: row.id,
          action: row.hidden_at ? "unhide" : "hide",
          reason: "Live listings tab",
        },
      }),
    onSuccess: (_r, row) => {
      toast.success(row.hidden_at ? "Listing is visible again" : "Listing hidden");
      qc.invalidateQueries({ queryKey: ["superadmin-listings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  // A tryout or camp whose text is held or unscreened is not public until a
  // superadmin approves it — the same action the Content tab uses.
  const approveText = useMutation({
    mutationFn: (row: Listing) =>
      moderate({
        data: {
          kind: SECTION_MODERATION_KIND.tryouts,
          id: row.id,
          action: "approve_text",
          reason: "Live listings tab",
        },
      }),
    onSuccess: () => {
      toast.success("Text approved");
      qc.invalidateQueries({ queryKey: ["superadmin-listings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const rows = (listings.data?.rows ?? []) as Listing[];
  const total = listings.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="space-y-3">
      <Tabs
        value={section}
        onValueChange={(v) => {
          setSection(v as ListingSection);
          setPage(0);
        }}
      >
        <TabsList className="h-auto flex-wrap">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.key} value={s.key}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={
            section === "availability"
              ? "Search sport, city, skill, note or player"
              : section === "tryouts"
                ? "Search title, details, location or team"
                : "Search title, sport, location or host"
          }
          className="max-w-sm"
          aria-label="Search listings"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label="Visibility">
          {VISIBILITY.map((v) => (
            <Button
              key={v.key}
              size="sm"
              variant={visibility === v.key ? "default" : "outline"}
              onClick={() => {
                setVisibility(v.key);
                setPage(0);
              }}
            >
              {v.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {listings.isLoading ? "Loading…" : `${total} listing${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {listings.isError && (
        <p className="text-sm text-destructive">
          {listings.error instanceof Error ? listings.error.message : "Could not load listings"}
        </p>
      )}

      <ul className="space-y-2">
        {rows.map((row) => (
          <ListingCard
            key={row.id}
            section={section}
            row={row}
            busy={
              (toggleHidden.isPending && toggleHidden.variables?.id === row.id) ||
              (approveText.isPending && approveText.variables?.id === row.id)
            }
            onToggleHidden={() => toggleHidden.mutate(row)}
            onApprove={
              section === "tryouts" && row.moderation_status !== "approved"
                ? () => approveText.mutate(row)
                : undefined
            }
            onEdit={() => setEditing(row)}
          />
        ))}
        {!listings.isLoading && rows.length === 0 && (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No listings match.
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

      {editing && (
        <EditListingDialog
          // Re-seeds the form when a different listing is opened.
          key={editing.id}
          section={section}
          row={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ListingCard({
  section,
  row,
  busy,
  onToggleHidden,
  onApprove,
  onEdit,
}: {
  section: ListingSection;
  row: Listing;
  busy: boolean;
  onToggleHidden: () => void;
  onApprove?: () => void;
  onEdit: () => void;
}) {
  const status = listingStatus(section, row);
  const title = section === "availability" ? availabilityTitle(row) : row.title;
  const details: string[] = [];
  if (section === "games") {
    details.push(row.sport, formatWhen(row.date), row.location);
    details.push(`${row.joined}/${row.max_players} players`);
    if (row.is_private) details.push("Private");
  } else if (section === "tryouts") {
    details.push(TRYOUT_KIND_LABELS[row.kind as TryoutKind] ?? row.kind);
    if (row.event_date) details.push(formatWhen(row.event_date));
    if (row.location) details.push(row.location);
    if (row.spots_max) details.push(`${row.spots_taken}/${row.spots_max} spots`);
  } else {
    const intents = parseIntents(row.looking_for);
    if (intents.length) details.push(intents.map((i) => INTENT_LABEL[i]).join(" & "));
    if (row.city) details.push(row.city);
    if (row.starts_on || row.ends_on) {
      details.push(`${row.starts_on ?? "…"} to ${row.ends_on ?? "open-ended"}`);
    }
  }

  return (
    <li className="rounded-lg border bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            <Badge variant={STATUS_VARIANT[status]}>{LISTING_STATUS_LABELS[status]}</Badge>
            {row.hidden_at && status !== "hidden" && <Badge variant="destructive">Hidden</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{details.filter(Boolean).join(" · ")}</p>
          <p className="text-[11px] text-muted-foreground">
            {section === "tryouts" ? "Team" : section === "games" ? "Host" : "Player"}:{" "}
            {row.owner_name ?? "Unknown"}
            {section === "availability" && row.note ? ` · “${String(row.note).slice(0, 80)}”` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" asChild>
            <a href={liveLink(section, row)} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1 h-3.5 w-3.5" />
              View live
            </a>
          </Button>
          {onApprove && (
            <Button size="sm" variant="default" disabled={busy} onClick={onApprove}>
              Approve
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant={row.hidden_at ? "default" : "destructive"}
            disabled={busy}
            onClick={onToggleHidden}
          >
            {row.hidden_at ? "Unhide" : "Hide"}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** The level fields of an availability row, in the shape the level helpers take. */
function levelSource(row: Listing) {
  return {
    sports: (row.sports ?? []) as string[],
    skill_level: (row.skill_level ?? null) as string | null,
    skill_levels: row.skill_levels as unknown,
  };
}

/** "Basketball (Varsity · JV), Soccer" — each sport with the levels the post lists. */
function availabilityTitle(row: Listing): string {
  const sports: string[] = row.sports ?? [];
  if (!sports.length) return "Any sport";
  return sports
    .map((sport) => {
      const tiers = postTiersForSport(levelSource(row), sport);
      return tiers.length ? `${sport} (${tiers.join(" · ")})` : sport;
    })
    .join(", ");
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** ISO instant → value for <input type="datetime-local"> in this browser's time zone. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function EditListingDialog({
  section,
  row,
  onClose,
}: {
  section: ListingSection;
  row: Listing;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const update = useServerFn(superadminUpdateListing);
  const [reason, setReason] = useState("");
  const [initial] = useState(() => initialForm(section, row));
  const [form, setForm] = useState<FormState>(initial);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  // Only what the admin touched: an untouched date must not round-trip through
  // the picker (it drops seconds) and look like a reschedule.
  const full = toPatch(section, form);
  const patch = Object.fromEntries(
    Object.entries(full).filter(([k]) => JSON.stringify(form[k]) !== JSON.stringify(initial[k])),
  );
  const check = EDIT_SCHEMAS[section].safeParse(patch);
  const problem = check.success ? null : (check.error.issues[0]?.message ?? "Check the form");

  const save = useMutation({
    mutationFn: () =>
      update({ data: { section, id: row.id, patch, reason: reason.trim() || undefined } }),
    onSuccess: (r) => {
      toast.success(r.changed.length ? "Listing updated" : "Nothing changed");
      qc.invalidateQueries({ queryKey: ["superadmin-listings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
      onClose();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit{" "}
            {section === "games"
              ? "game"
              : section === "tryouts"
                ? "tryout or camp"
                : "availability"}
          </DialogTitle>
          <DialogDescription>
            Changes go live immediately and are recorded in the audit log.
            {section !== "availability" && " People signed up are told if the time"}
            {section === "games" && " or venue"}
            {section !== "availability" && " changes."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {section === "games" && (
            <>
              <Field label="Title">
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Sport">
                <SportSelect value={form.sport} onChange={(v) => set("sport", v)} />
              </Field>
              <Field label="Date & time (your time zone)">
                <Input
                  type="datetime-local"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                />
              </Field>
              <Field
                label="Venue / address"
                hint={
                  form.location !== row.location
                    ? "Changing the address removes the map pin until the host re-picks the venue."
                    : undefined
                }
              >
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
              </Field>
              <Field label="Neighborhood">
                <Input
                  value={form.neighborhood}
                  onChange={(e) => set("neighborhood", e.target.value)}
                />
              </Field>
              <Field label={`Max players (${row.joined} joined)`}>
                <Input
                  type="number"
                  min={Math.max(1, row.joined)}
                  value={form.max_players}
                  onChange={(e) => set("max_players", e.target.value)}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!form.joins_closed}
                  onCheckedChange={(v) => set("joins_closed", !v)}
                />
                Joins open
              </label>
            </>
          )}

          {section === "tryouts" && (
            <>
              <Field label="Type">
                <div className="flex gap-2">
                  {(Object.keys(TRYOUT_KIND_LABELS) as TryoutKind[]).map((k) => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant={form.kind === k ? "default" : "outline"}
                      onClick={() => set("kind", k)}
                    >
                      {TRYOUT_KIND_LABELS[k]}
                    </Button>
                  ))}
                </div>
              </Field>
              <Field label="Title">
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Description">
                <Textarea
                  rows={5}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                />
              </Field>
              <Field label="Date & time (your time zone)">
                <Input
                  type="datetime-local"
                  value={form.event_date}
                  onChange={(e) => set("event_date", e.target.value)}
                />
              </Field>
            </>
          )}

          {section === "availability" && (
            <>
              <Field label="Sports">
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
                            on
                              ? form.sports.filter((x: string) => x !== s.name)
                              : [...form.sports, s.name],
                          )
                        }
                      >
                        {s.emoji} {s.name}
                      </Button>
                    );
                  })}
                </div>
              </Field>
              {form.sports.map((sport: string) => {
                const scale = scaleForSport(sport as Sport);
                const picked: string[] = form.levels[sport] ?? [];
                return (
                  <div key={sport} className="space-y-1">
                    <span className="block text-xs font-medium">
                      {sport} levels{" "}
                      <span className="text-[10px] uppercase text-muted-foreground">
                        {scale.system}
                      </span>
                    </span>
                    <TierChips
                      scale={scale}
                      selected={picked}
                      ariaPrefix={sport}
                      onToggle={(tier) =>
                        set("levels", {
                          ...form.levels,
                          [sport]: picked.includes(tier)
                            ? picked.filter((t) => t !== tier)
                            : [...picked, tier],
                        })
                      }
                    />
                  </div>
                );
              })}
              <Field label="Available as">
                <div className="flex gap-2" role="group" aria-label="Available as">
                  {AVAILABILITY_INTENTS.map((intent) => {
                    const on = form.looking_for.includes(intent);
                    return (
                      <Button
                        key={intent}
                        type="button"
                        size="sm"
                        variant={on ? "default" : "outline"}
                        aria-pressed={on}
                        onClick={() =>
                          set(
                            "looking_for",
                            AVAILABILITY_INTENTS.filter((i) =>
                              i === intent ? !on : form.looking_for.includes(i),
                            ),
                          )
                        }
                      >
                        {INTENT_LABEL[intent]}
                      </Button>
                    );
                  })}
                </div>
              </Field>
              <Field label="City / neighborhood">
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.status === "open"}
                  onCheckedChange={(v) => set("status", v ? "open" : "closed")}
                />
                {form.status === "open" ? "Open (looking for games)" : "Closed"}
              </label>
              <Field label="Player notes">
                <Textarea
                  rows={3}
                  value={form.note}
                  onChange={(e) => set("note", e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="Reason (optional, for the audit log)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!problem || save.isPending || Object.keys(patch).length === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initialForm(section: ListingSection, row: Listing): FormState {
  if (section === "games") {
    return {
      title: row.title ?? "",
      sport: row.sport ?? "",
      date: toLocalInput(row.date),
      location: row.location ?? "",
      neighborhood: row.neighborhood ?? "",
      max_players: String(row.max_players ?? ""),
      joins_closed: !!row.joins_closed,
    };
  }
  if (section === "tryouts") {
    return {
      kind: row.kind,
      title: row.title ?? "",
      body: row.body ?? "",
      event_date: toLocalInput(row.event_date),
    };
  }
  return {
    sports: [...(row.sports ?? [])],
    levels: initialLevelsForPost(levelSource(row)),
    looking_for: parseIntents(row.looking_for) as AvailabilityIntent[],
    city: row.city ?? "",
    status: row.status === "closed" ? "closed" : "open",
    note: row.note ?? "",
  };
}

/** Form state → the patch the server validates with the same schema. */
function toPatch(section: ListingSection, f: FormState): Record<string, unknown> {
  if (section === "games") {
    return {
      title: f.title,
      sport: f.sport,
      date: fromLocalInput(f.date) ?? "",
      location: f.location,
      neighborhood: f.neighborhood,
      max_players: Number(f.max_players),
      joins_closed: f.joins_closed,
    };
  }
  if (section === "tryouts") {
    return {
      kind: f.kind,
      title: f.title,
      body: f.body,
      event_date: fromLocalInput(f.event_date),
    };
  }
  return {
    sports: f.sports,
    levels: f.levels,
    looking_for: f.looking_for,
    city: f.city.trim() || null,
    status: f.status,
    note: f.note.trim() || null,
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-amber-500">{hint}</span>}
    </label>
  );
}

function SportSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = SPORTS.some((s) => s.name === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
    >
      {!known && value && <option value={value}>{value}</option>}
      {SPORTS.map((s) => (
        <option key={s.name} value={s.name}>
          {s.emoji} {s.name}
        </option>
      ))}
    </select>
  );
}
