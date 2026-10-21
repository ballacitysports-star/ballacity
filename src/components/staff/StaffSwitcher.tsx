import { Link } from "@tanstack/react-router";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { signOut } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useStaffAccess } from "@/hooks/use-staff-access";
import { STAFF_TIER_LABEL, showsStaffChrome, staffDashboards, staffTierOf } from "@/lib/staff";

/** Staff badge with a dropdown to jump between dashboards and sign out. */
async function handleSignOut() {
  try {
    await signOut();
    toast.success("Signed out");
    window.location.href = "/auth";
  } catch {
    toast.error("Couldn't sign out");
  }
}

export function StaffSwitcher() {
  const { access } = useStaffAccess();
  const tier = staffTierOf(access);
  if (!tier || !showsStaffChrome(access)) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${STAFF_TIER_LABEL[tier]} tools`}
          className="inline-flex items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={tier === "superadmin" ? "destructive" : "default"} className="gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden />
            {STAFF_TIER_LABEL[tier]}
          </Badge>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Staff dashboards</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {staffDashboards(access).map((d) => (
          <DropdownMenuItem key={d.tier} asChild>
            <Link to={d.to} className="flex flex-col items-start gap-0.5">
              <span className="text-sm font-medium">{d.label}</span>
              <span className="text-xs text-muted-foreground">{d.description}</span>
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void handleSignOut()} className="text-destructive">
          <LogOut className="mr-2 h-4 w-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
