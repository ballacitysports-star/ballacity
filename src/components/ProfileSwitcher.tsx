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
  const { profiles, active, loading } = useMyProfiles();
  const switcher = useSwitchProfile();

  if (loading || !active) return null;

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
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Your profiles</DropdownMenuLabel>
        {profiles.map((p) => {
          const meta = ACCOUNT_TYPE_META[p.kind];
          const isActive = p.id === active.id;
          return (
            <DropdownMenuItem
              key={p.id}
              className="gap-2"
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
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {meta.label}
                  {p.handle ? ` · ${p.handle}` : ""}
                </span>
              </span>
              {isActive && <Check className="h-4 w-4 text-primary" aria-hidden />}
            </DropdownMenuItem>
          );
        })}
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
