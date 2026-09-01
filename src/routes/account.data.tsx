import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Download, FileJson, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/seo";
import {
  EXPORT_CATEGORIES,
  EXPORT_DAILY_LIMIT,
  EXPORT_EXCLUSIONS,
  EXPORT_STATUS_META,
  EXPORT_TTL_HOURS,
  effectiveExportStatus,
  formatBytes,
} from "@/lib/data-export";
import { RETENTION_RULES } from "@/lib/retention";
import {
  getDataExportDownloadUrl,
  listMyDataExports,
  requestDataExport,
  type DataExportRequestRow,
} from "@/lib/data-export.functions";

export const Route = createFileRoute("/account/data")({
  head: () =>
    pageHead({
      path: "/account/data",
      title: "Your data & retention — OpenRun",
      description:
        "Download a copy of your OpenRun data, see how long each kind of information is kept, and what happens when you delete your account.",
      noindex: true,
    }),
  component: DataExportPage,
});

const TONE_CLASS: Record<string, string> = {
  neutral: "border-border text-muted-foreground",
  progress: "border-border text-foreground",
  ready: "border-lime/50 text-lime",
  error: "border-destructive/50 text-destructive",
};

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ExportRow({ row }: { row: DataExportRequestRow }) {
  const status = effectiveExportStatus(row);
  const meta = EXPORT_STATUS_META[status];
  const download = useMutation({
    mutationFn: () => getDataExportDownloadUrl({ data: { id: row.id } }),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Couldn't start the download"),
  });

  const totalRows = Object.values(row.row_counts ?? {}).reduce((a, b) => a + (b || 0), 0);

  return (
    <li className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Requested {formatWhen(row.requested_at)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              `${row.categories.length} categories`,
              totalRows > 0 ? `${totalRows} records` : null,
              row.file_bytes ? formatBytes(row.file_bytes) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${TONE_CLASS[meta.tone]}`}
        >
          {meta.label}
        </span>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">{meta.description}</p>
      {status === "failed" && row.error_message && (
        <p className="mt-1 text-xs text-destructive">{row.error_message}</p>
      )}
      {status === "ready" && row.expires_at && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Available until {formatWhen(row.expires_at)}
        </p>
      )}

      {status === "ready" && (
        <button
          type="button"
          disabled={download.isPending}
          onClick={() => download.mutate()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-lime px-3.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          {download.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Download JSON
        </button>
      )}
    </li>
  );
}

function DataExportPage() {
  const qc = useQueryClient();
  const exports = useQuery({ queryKey: ["my-data-exports"], queryFn: () => listMyDataExports() });

  const request = useMutation({
    mutationFn: () => requestDataExport({ data: {} }),
    onSuccess: (res) => {
      if (res.status === "ready") toast.success("Your data export is ready to download");
      else toast.error("We couldn't build your export. Please try again.");
      void qc.invalidateQueries({ queryKey: ["my-data-exports"] });
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error
          ? e.message.includes("rate")
            ? `You can request ${EXPORT_DAILY_LIMIT} exports per day. Try again later.`
            : e.message
          : "Couldn't request your export",
      ),
  });

  const rows = exports.data ?? [];

  return (
    <div className="min-h-dvh bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
        <Link to="/settings" className="rounded-full p-2 hover:bg-surface" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-lg font-medium">Your data</h1>
      </header>

      <main className="mx-auto max-w-xl space-y-6 px-4 py-4">
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-lime" aria-hidden />
            <h2 className="text-sm font-semibold">Download my data</h2>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            We build one machine-readable JSON file with your own data. The link works for{" "}
            {EXPORT_TTL_HOURS} hours and is private to you. You can request up to{" "}
            {EXPORT_DAILY_LIMIT} exports per day.
          </p>
          <button
            type="button"
            disabled={request.isPending}
            onClick={() => request.mutate()}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-lime px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {request.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {request.isPending ? "Building your file…" : "Request my data"}
          </button>
        </section>

        <section>
          <h2 className="text-sm font-semibold">What's included</h2>
          <ul className="mt-2 space-y-2">
            {EXPORT_CATEGORIES.map((c) => (
              <li key={c.id} className="rounded-xl border border-border bg-surface p-3">
                <p className="text-xs font-semibold">{c.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-lime" aria-hidden />
            <h2 className="text-sm font-semibold">Never included</h2>
          </div>
          <ul className="mt-2 space-y-1">
            {EXPORT_EXCLUSIONS.map((x) => (
              <li key={x} className="text-xs text-muted-foreground">
                • {x}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold">Your export history</h2>
          {exports.isLoading ? (
            <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              You haven't requested an export yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {rows.map((r) => (
                <ExportRow key={r.id} row={r} />
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">How long we keep things</h2>
          </div>
          <ul className="mt-2 space-y-2">
            {RETENTION_RULES.map((r) => (
              <li key={r.category} className="rounded-xl border border-border bg-surface p-3">
                <p className="text-xs font-semibold">{r.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.retention}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">If you delete your account: </span>
                  {r.onAccountDeletion}
                </p>
                {r.survivesDeletion && (
                  <p className="mt-1 text-[11px] italic text-muted-foreground">{r.reason}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Retention periods are being reviewed by legal. To delete your account, go to{" "}
            <Link to="/account/privacy" className="underline">
              Privacy
            </Link>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
