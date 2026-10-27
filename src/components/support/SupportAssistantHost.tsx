import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CircleHelp } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { showSupportLauncher } from "@/lib/support/launcher";
import {
  closeSupport,
  openSupport,
  setSupportOwner,
  useSupportState,
} from "@/lib/support/support-store";
import { SupportPanel } from "./SupportPanel";

const TITLE = "BallaCity Help";
const DESCRIPTION = "Quick answers and an AI assistant for using BallaCity.";

/**
 * Mounted once, at the root. Owns the floating Help button and the drawer, and
 * keeps the conversation tied to whoever is signed in.
 */
export function SupportAssistantHost() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open } = useSupportState();
  const isMobile = useIsMobile();
  const userId = user?.id ?? null;

  // A different member (or signing out) starts from a clean, closed drawer.
  useEffect(() => {
    setSupportOwner(userId);
  }, [userId]);

  const panel = (
    <SupportPanel signedIn={!!user} email={user?.email ?? null} onNavigate={closeSupport} />
  );

  return (
    <>
      {showSupportLauncher(pathname, !!user) && !open ? (
        <button
          type="button"
          onClick={() => openSupport()}
          aria-label="Help and support"
          title="Help and support"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-3 z-40 grid h-11 w-11 place-items-center rounded-full border border-border bg-surface/90 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime md:left-4"
        >
          <CircleHelp className="h-5 w-5" aria-hidden />
        </button>
      ) : null}

      {isMobile ? (
        <Drawer open={open} onOpenChange={(o) => (o ? openSupport() : closeSupport())}>
          <DrawerContent className="flex h-[85dvh] max-h-[85dvh] flex-col">
            <DrawerHeader className="pb-2 text-left">
              <DrawerTitle className="font-display">{TITLE}</DrawerTitle>
              <DrawerDescription>{DESCRIPTION}</DrawerDescription>
            </DrawerHeader>
            {panel}
          </DrawerContent>
        </Drawer>
      ) : (
        <Sheet open={open} onOpenChange={(o) => (o ? openSupport() : closeSupport())}>
          <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
            <SheetHeader className="px-4 pb-2 pt-4 text-left">
              <SheetTitle className="font-display">{TITLE}</SheetTitle>
              <SheetDescription>{DESCRIPTION}</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
