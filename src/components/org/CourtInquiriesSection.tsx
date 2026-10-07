import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Check, MessageCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMessageOrGuardian } from "@/components/messages/useMessageOrGuardian";
import { listOrgCourtInquiries, resolveCourtInquiry } from "@/lib/court-inquiries.functions";
import { courtTypeLabel, formatInquiryWhen } from "@/lib/court-inquiries";

/** Owner/admin inbox for in-app court inquiries sent from the directory. */
export function CourtInquiriesSection({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listOrgCourtInquiries);
  const resolve = useServerFn(resolveCourtInquiry);
  const { startMessage, dialog } = useMessageOrGuardian();
  const key = ["org-court-inquiries", orgId];
  const { data, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => list({ data: { orgId } }),
  });
  const rows = data ?? [];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending").slice(0, 5);

  async function setStatus(id: string, status: "handled" | "declined") {
    try {
      await resolve({ data: { id, status } });
      toast.success(status === "handled" ? "Marked handled" : "Declined");
      qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <section id="court-inquiries" className="rounded-2xl border border-border/60 bg-surface p-4">
      <h2 className="section-title mb-3 flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-lime" /> Court inquiries
        {pending.length > 0 && (
          <span className="rounded-full bg-lime/15 px-2 py-0.5 text-xs font-bold text-lime">
            {pending.length} new
          </span>
        )}
      </h2>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-xs text-muted-foreground">Couldn&apos;t load inquiries.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No inquiries yet. Players can request a court from the gyms directory.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...pending, ...done].map((r) => (
            <li
              key={r.id}
              className="space-y-2 rounded-xl border border-border/50 bg-background px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    to="/players/$userId"
                    params={{ userId: r.requester_id }}
                    className="truncate text-sm font-semibold hover:text-lime"
                  >
                    {r.requester?.display_name || "Player"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {r.sport} · {courtTypeLabel(r.court_type)} · {r.player_count} player
                    {r.player_count === 1 ? "" : "s"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatInquiryWhen(r.requested_date, r.start_time, r.duration_min, r.time_slot)}
                  </div>
                </div>
                {r.status !== "pending" && (
                  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                    {r.status}
                  </span>
                )}
              </div>
              {r.notes && (
                <p className="whitespace-pre-wrap text-xs text-foreground/80">{r.notes}</p>
              )}
              {r.status === "pending" && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      startMessage(r.requester_id, r.requester?.display_name || "this player")
                    }
                  >
                    <MessageCircle className="mr-1 h-3.5 w-3.5" /> Message
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "handled")}>
                    <Check className="mr-1 h-3.5 w-3.5" /> Handled
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "declined")}>
                    <X className="mr-1 h-3.5 w-3.5" /> Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </section>
  );
}
