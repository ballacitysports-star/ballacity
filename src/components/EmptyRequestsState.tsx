import { Inbox } from "lucide-react";

export function EmptyRequestsState({ filter = "all" }: { filter?: "all" | "host" | "player" }) {
  const title =
    filter === "host"
      ? "No host actions"
      : filter === "player"
        ? "No sent requests"
        : "No pending requests";
  const description =
    filter === "host"
      ? "Games where players are waiting for your approval will appear here."
      : filter === "player"
        ? "Games you've requested to join will appear here."
        : "Player requests and games awaiting your approval will appear here.";
  return (
    <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-6 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted">
        <Inbox className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="mt-3 font-display text-sm font-bold">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
