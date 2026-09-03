import { COHORT_META } from "@/lib/child-policy";
import type { GuardianChild } from "@/lib/child-safety.functions";

function consentLabel(child: GuardianChild): { text: string; tone: string } {
  const status = child.consent?.status;
  if (status === "approved") return { text: "Approved", tone: "text-primary" };
  if (status === "revoked") return { text: "Consent withdrawn", tone: "text-destructive" };
  if (status === "pending") return { text: "Waiting on approval", tone: "text-muted-foreground" };
  return { text: "No consent on file", tone: "text-muted-foreground" };
}

/**
 * Card-based, keyboard-accessible switcher for guardians with more than one
 * linked minor. It always makes clear which child the panel below is acting
 * for, which the previous pill row did not.
 */
export function FamilyChildSwitcher({
  children,
  selected,
  onSelect,
}: {
  children: GuardianChild[];
  selected: string | null;
  onSelect: (childUserId: string) => void;
}) {
  if (children.length < 2) return null;

  return (
    <div className="mt-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Choose a child
      </h2>
      <div role="tablist" aria-label="Your linked children" className="mt-2 grid gap-2 sm:grid-cols-2">
        {children.map((c) => {
          const isSelected = c.childUserId === selected;
          const consent = consentLabel(c);
          return (
            <button
              key={c.childUserId}
              type="button"
              role="tab"
              id={`child-tab-${c.childUserId}`}
              aria-selected={isSelected}
              aria-controls={`child-panel-${c.childUserId}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelect(c.childUserId)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const i = children.findIndex((x) => x.childUserId === c.childUserId);
                const next =
                  e.key === "ArrowRight"
                    ? children[(i + 1) % children.length]
                    : children[(i - 1 + children.length) % children.length];
                if (next) {
                  onSelect(next.childUserId);
                  document.getElementById(`child-tab-${next.childUserId}`)?.focus();
                }
              }}
              className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-xs font-bold">
                {c.avatarUrl ? (
                  <img src={c.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  c.displayName.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{c.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {COHORT_META[c.cohort].label}
                  {c.username ? ` · @${c.username}` : ""}
                </span>
                <span className={`block truncate text-xs font-semibold ${consent.tone}`}>
                  {consent.text}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
