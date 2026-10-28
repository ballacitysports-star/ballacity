import { useRouter } from "@tanstack/react-router";
import { isChatThreadPath } from "@/lib/chat-layout";
import { StaffSwitcher } from "@/components/staff/StaffSwitcher";
import { useStaffAccess } from "@/hooks/use-staff-access";
import { showsStaffChrome } from "@/lib/staff";

/** Slim top bar shown above every page to staff. */
export function StaffBar() {
  const router = useRouter();
  const pathname = router.state.location.pathname;
  const { access } = useStaffAccess();
  if (!showsStaffChrome(access) || pathname === "/auth" || pathname === "/staff") return null;
  // A conversation owns the whole screen (its header, its message box); the bar
  // would sit on top of the header there.
  if (isChatThreadPath(pathname)) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="flex h-9 items-center justify-end px-4">
        <StaffSwitcher />
      </div>
    </div>
  );
}
