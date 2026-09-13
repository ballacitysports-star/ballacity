import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_TYPE_META, type AccountType } from "@/lib/account-type";
import {
  addProfileRoute,
  useMyProfiles,
  useSetDefaultProfile,
  useSwitchProfile,
  type AccountProfile,
} from "@/lib/account-profiles";

const ADDABLE: Exclude<AccountType, "player">[] = ["team", "trainer", "gym"];

function Avatar({ profile, size = 8 }: { profile: AccountProfile; size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-xs font-bold"
      style={{ height: `${size * 0.25}rem`, width: `${size * 0.25}rem` }}
    >
      {profile.avatarUrl ? (
        <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        profile.avatarFallback
      )}
    </span>
  );
}

/**
 * Lets the user switch which of their profiles the app acts as, and add new
 * team, trainer, or gym profiles. The player profile is always present.
 */
export function ProfileSwitcher({ className }: { className?: string }) {
  const { profiles, active, defaultId, pendingKind, loading } = useMyProfiles();
  const switcher = useSwitchProfile();
  const setDefault = useSetDefaultProfile();

  if (loading || !active) return null;

  // Registered as a team/trainer/gym without finishing setup: label the
  // registered type instead of the player profile we fall back to.
  if (pendingKind) {
    const pendingMeta = ACCOUNT_TYPE_META[pendingKind];
    return (
      <Link
        to={addProfileRoute(pendingKind)}
        search={{ finish: 1 } as never}
        className={`inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold transition-colors hover:bg-surface-2 ${className ?? ""}`}
      >
        <span aria-hidden>{pendingMeta.emoji}</span>
        <span className="truncate">{pendingMeta.label}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
          Setup incomplete
        </span>
      </Link>
    );
  }

  const activeMeta = ACCOUNT_TYPE_META[active.kind];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold transition-colors hover:bg-surface-2 ${className ?? ""}`}
        aria-label="Switch profile"
      >
        <Avatar profile={active} size={5} />
        <span className="truncate">{active.name}</span>
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
          {activeMeta.label}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Your profiles</DropdownMenuLabel>
        {profiles.map((p) => {
          const meta = ACCOUNT_TYPE_META[p.kind];
          const isActive = p.id === active.id;
          const isDefault = p.id === defaultId;
          return (
            <div key={p.id} className="flex items-center gap-1 pr-1">
              <DropdownMenuItem
                className="min-w-0 flex-1 gap-2"
                onSelect={() => {
                  if (isActive) return;
                  switcher.mutate(p, {
                    onSuccess: () => toast.success(`Switched to ${p.name}`),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not switch profile"),
                  });
                }}
              >
                <Avatar profile={p} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    {isDefault && (
                      <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                        Default
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {meta.label}
                    {p.handle ? ` · ${p.handle}` : ""}
                  </span>
                </span>
                {isActive && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
              </DropdownMenuItem>
              <button
                type="button"
                aria-label={isDefault ? `Clear default profile` : `Set ${p.name} as default`}
                aria-pressed={isDefault}
                disabled={setDefault.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDefault.mutate(isDefault ? null : p, {
                    onSuccess: () =>
                      toast.success(
                        isDefault ? "Default profile cleared" : `${p.name} is now your default`,
                      ),
                    onError: (err) =>
                      toast.error(
                        err instanceof Error ? err.message : "Could not save default profile",
                      ),
                  });
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <Star
                  className={`h-4 w-4 ${isDefault ? "fill-primary text-primary" : "text-muted-foreground"}`}
                  aria-hidden
                />
              </button>
            </div>
          );
        })}
        <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
          The starred profile is the one you start in on every device.
        </p>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Add a profile</DropdownMenuLabel>
        {ADDABLE.map((kind) => (
          <DropdownMenuItem key={kind} asChild className="gap-2">
            <Link to={addProfileRoute(kind)}>
              <Plus className="h-4 w-4" aria-hidden />
              <span className="text-sm">New {ACCOUNT_TYPE_META[kind].label.toLowerCase()}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
