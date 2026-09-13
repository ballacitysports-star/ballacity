import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { superadminAuditLog } from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function AuditTab() {
  const load = useServerFn(superadminAuditLog);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const limit = 50;
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-audit", query, page],
    queryFn: () => load({ data: { search: query || undefined, limit, offset: page * limit } }),
  });

  return (
    <div className="space-y-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setQuery(search.trim());
        }}
      >
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search action, target id, or reason"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="rounded-lg border divide-y">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : (data?.rows.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No entries.</div>
        ) : (
          data!.rows.map((r: any) => (
            <div key={r.id} className="p-3 space-y-1">
              <button
                className="w-full text-left flex items-start justify-between gap-3"
                onClick={() => setOpen(open === r.id ? null : r.id)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-mono truncate">{r.action}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {r.target_type ?? "—"} · {r.target_id ?? "—"}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <Badge variant="secondary">{new Date(r.created_at).toLocaleString()}</Badge>
                </div>
              </button>
              {open === r.id ? (
                <pre className="text-[11px] bg-muted rounded p-2 overflow-x-auto">
                  {JSON.stringify({ before: r.before, after: r.after, actor: r.actor_id }, null, 2)}
                </pre>
              ) : null}
            </div>
          ))
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{data?.total ?? 0} entries</span>
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
    </div>
  );
}
