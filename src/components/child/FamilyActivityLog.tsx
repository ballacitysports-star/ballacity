import { History } from "lucide-react";
import { useFamilyActivity } from "@/lib/child-safety";
import { describeFamilyActivity } from "@/lib/family-activity";
import { formatRelativeTime } from "@/lib/datetime";

/**
 * Append-only trail of family changes for one linked minor. Rows are written by
 * database triggers, so it also covers changes made outside this screen.
 */
export function FamilyActivityLog({ childUserId }: { childUserId: string }) {
  const { entries, isLoading } = useFamilyActivity(childUserId);

  return (
    <section className="mt-4 rounded-xl border border-border bg-background p-3">
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <History className="h-4 w-4" aria-hidden /> Family activity
      </h3>
      {isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading activity…</p>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing recorded yet. Consent decisions and safety-setting changes appear here and cannot
          be edited or deleted.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.map((e) => {
            const d = describeFamilyActivity(e);
            return (
              <li key={e.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{d.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatRelativeTime(e.createdAt)}
                  </span>
                </div>
                {d.detail ? <div className="text-muted-foreground">{d.detail}</div> : null}
                <div className="text-[11px] text-muted-foreground">
                  {e.actorIsMe ? "By you" : "By your child or our team"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
