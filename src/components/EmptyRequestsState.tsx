import { Inbox } from "lucide-react";

export function EmptyRequestsState() {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-3 font-display text-sm font-bold">No pending requests</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Player requests and games awaiting your approval will appear here.
      </p>
    </div>
  );
}
