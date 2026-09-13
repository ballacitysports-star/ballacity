import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superadminListContent, superadminModerate } from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmAction } from "./ConfirmAction";

const KINDS = [
  { key: "games", label: "Games" },
  { key: "teams", label: "Teams" },
  { key: "gyms", label: "Gyms" },
  { key: "posts", label: "Posts" },
  { key: "availability", label: "Availability" },
  { key: "comments", label: "Comments" },
  { key: "reviews", label: "Reviews" },
  { key: "reports", label: "Reports" },
  { key: "blocks", label: "Blocks" },
  { key: "messages", label: "Messages" },
] as const;

type Action = { action: string; label: string; destructive?: boolean };

function actionsFor(kind: string, row: any, hideCol: string | null): Action[] {
  const out: Action[] = [];
  const hidden = hideCol === "flagged" ? row.flagged === true : hideCol ? !!row[hideCol] : false;
  if (hideCol)
    out.push(
      hidden
        ? { action: "unhide", label: "Unhide" }
        : { action: "hide", label: "Hide", destructive: true },
    );
  if (kind === "games") {
    out.push(
      row.joins_closed
        ? { action: "open_joins", label: "Open joins" }
        : { action: "close_joins", label: "Close joins" },
    );
    out.push(
      row.status === "cancelled"
        ? { action: "restore_game", label: "Restore" }
        : { action: "cancel_game", label: "Cancel game", destructive: true },
    );
  }
  if (kind === "availability")
    out.push(
      row.status === "closed"
        ? { action: "open_availability", label: "Reopen" }
        : { action: "close_availability", label: "Close" },
    );
  if (kind === "reports") {
    out.push({ action: "resolve_report", label: "Resolve" });
    out.push({ action: "dismiss_report", label: "Dismiss" });
    out.push({ action: "reopen_report", label: "Reopen" });
  }
  if (kind === "teams" || kind === "gyms")
    out.push(
      row.verified
        ? { action: "unverify", label: "Unverify" }
        : { action: "verify", label: "Verify" },
    );
  if (kind === "reviews")
    out.push(
      row.verified
        ? { action: "unverify", label: "Unverify" }
        : { action: "verify", label: "Verify" },
    );
  return out;
}

function summarize(kind: string, row: any) {
  switch (kind) {
    case "games":
      return `${row.title} · ${row.sport} · ${new Date(row.date).toLocaleString()} · ${row.location}`;
    case "teams":
      return `${row.name} @${row.handle} · ${row.kind}${row.city ? ` · ${row.city}` : ""}${
        row.owner_id ? "" : " · Unclaimed"
      }`;
    case "gyms":
      return `${row.name} @${row.handle}${row.city ? ` · ${row.city}` : ""}${
        row.owner_id ? "" : " · Unclaimed"
      }`;
    case "posts":
      return `${row.title} · ${row.kind}`;
    case "availability":
      return `${(row.sports ?? []).join(", ")} · ${row.skill_level} · ${row.status}`;
    case "comments":
      return `${row.subject_type} · ${(row.body ?? "").slice(0, 100)}`;
    case "reviews":
      return `${row.rating}★ ${row.reviewee_name} · ${(row.title ?? row.body ?? "").slice(0, 80)}`;
    case "reports":
      return `${row.reason} · ${row.status}${row.details ? ` · ${row.details.slice(0, 60)}` : ""}`;
    case "blocks":
      return `${row.blocker_id} blocked ${row.blocked_id}`;
    case "messages":
      return row.deleted_at ? "(unsent message)" : (row.body ?? "(attachment)").slice(0, 120);
    default:
      return row.id;
  }
}

export function ModerationTab() {
  const qc = useQueryClient();
  const list = useServerFn(superadminListContent);
  const moderate = useServerFn(superadminModerate);

  const [kind, setKind] = useState<string>("games");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "hidden" | "visible">("all");
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    destructive?: boolean;
    run: (reason: string) => Promise<unknown>;
  }>(null);

  const limit = 25;
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-content", kind, query, filter, page],
    queryFn: () =>
      list({
        data: {
          kind,
          search: query || undefined,
          limit,
          offset: page * limit,
          onlyHidden: filter === "hidden" ? true : undefined,
          onlyVisible: filter === "visible" ? true : undefined,
        },
      }),
  });

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast.success("Done");
      setConfirm(null);
      qc.invalidateQueries({ queryKey: ["superadmin-content"] });
      qc.invalidateQueries({ queryKey: ["superadmin-overview"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Action failed"),
  });

  return (
    <div className="space-y-3">
      <Tabs
        value={kind}
        onValueChange={(v) => {
          setKind(v);
          setPage(0);
        }}
      >
        <TabsList className="flex-wrap h-auto">
          {KINDS.map((k) => (
            <TabsTrigger key={k.key} value={k.key}>
              {k.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <form
          className="flex gap-2 flex-1 min-w-[240px]"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(0);
            setQuery(search.trim());
          }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search content"
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {(["all", "visible", "hidden"] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => {
              setFilter(f);
              setPage(0);
            }}
          >
            {f}
          </Button>
        ))}
      </div>

      <div className="rounded-lg border divide-y">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (data?.rows.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">Nothing here.</div>
        ) : (
          data!.rows.map((row: any) => {
            const hidden =
              data!.hideCol === "flagged"
                ? row.flagged === true
                : data!.hideCol
                  ? !!row[data!.hideCol]
                  : false;
            return (
              <div key={row.id} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm truncate">{summarize(kind, row)}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate">
                      {row.id} · {new Date(row.created_at).toLocaleString()}
                    </div>
                  </div>
                  {hidden ? <Badge variant="destructive">Hidden</Badge> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {actionsFor(kind, row, data!.hideCol).map((a) => (
                    <Button
                      key={a.action}
                      size="sm"
                      variant={a.destructive ? "destructive" : "outline"}
                      onClick={() =>
                        setConfirm({
                          title: `${a.label} — ${data!.label}`,
                          destructive: a.destructive,
                          run: (reason) =>
                            moderate({
                              data: { kind, id: String(row.id), action: a.action, reason },
                            }),
                        })
                      }
                    >
                      {a.label}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data?.total ?? 0} items</span>
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
            disabled={(page + 1) * limit >= (data?.total ?? 0)}
            onClick={() => setPage((x) => x + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <ConfirmAction
        open={!!confirm}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm?.title ?? ""}
        description="Every moderation action is reversible and written to the audit log."
        pending={act.isPending}
        onConfirm={(reason) => confirm && act.mutate(() => confirm.run(reason))}
      />
    </div>
  );
}
