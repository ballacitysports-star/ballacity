import { useEffect, useState } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { withRequireAuth } from "@/components/RequireAuth";
import { BackHeader } from "@/components/layout/BackHeader";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { useParentMode } from "@/hooks/use-parent-mode";
import { useAvailabilityGate } from "@/lib/availability-gate";
import type { PlayerAvailability } from "@/lib/availability";
import { MineView } from "@/components/players/MineView";
import { QuickAvailabilitySheet } from "@/components/availability/QuickAvailabilitySheet";
import { PostAvailabilityDialog } from "@/components/availability/PostAvailabilityDialog";
import { AvailabilityRequiredNotice } from "@/components/availability/AvailabilityRequiredNotice";
import { AVAILABILITY_POST_RETURN } from "@/lib/profile-return";

const availabilitySearchSchema = z.object({
  // Open posting once on arrival, if the posting check passes: "quick" is the quick sheet (AVAILABILITY_POST_RETURN,
  // after "Complete my profile"), "more" the full form (Home's "More options").
  compose: fallback(z.enum(["", "quick", "more"]), "").default(""),
});

export const Route = createFileRoute("/availability")({
  head: () =>
    pageHead({
      path: "/availability",
      title: "My availability & invitations — BallaCity",
      description:
        "Post when you're free to play, pause or renew your posts, and answer game invitations and requests.",
      noindex: true,
    }),
  validateSearch: zodValidator(availabilitySearchSchema),
  ssr: false,
  component: withRequireAuth(AvailabilityPage),
});

/**
 * WP 4.1: one screen for "My availability & invitations". Your posts (pause, resume, renew, remove), game invitations,
 * and the requests to and from you, with "I'm available" on top. It replaces the old "Mine" tab of Find Players
 * (`/players?tab=mine` now redirects here). Hidden in parent mode: a guardian acting for a child uses the family
 * screens, and a child's availability rules are enforced on the server either way.
 */
function AvailabilityPage() {
  const { user } = useAuth();
  const { isParentMode, loading: parentLoading } = useParentMode();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/availability" });
  const qc = useQueryClient();
  const gate = useAvailabilityGate();
  const [quickOpen, setQuickOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PlayerAvailability | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Set after "Switch to my player profile": ask the posting check again once it settles, so a player profile that
  // still needs a sport and level shows "Complete my profile" instead of a sheet that can't post.
  const [recheckGate, setRecheckGate] = useState(false);

  // Arriving to post (back from "Complete my profile", or Home's "More options"): open it once if the check passes.
  // The flag is cleared either way, so a member who still can't post sees the explanation below and never loops.
  // Never in parent mode, and not before we know whether it is parent mode: the page redirects to /feed then, and
  // clearing the flag here would race that redirect.
  useEffect(() => {
    if (!search.compose || gate.loading || parentLoading || isParentMode) return;
    const which = search.compose;
    void navigate({ search: { compose: "" }, replace: true });
    if (!gate.canPost) return;
    if (which === "more") setFormOpen(true);
    else setQuickOpen(true);
  }, [search.compose, gate.loading, gate.canPost, parentLoading, isParentMode, navigate]);

  useEffect(() => {
    if (!recheckGate || gate.loading) return;
    setRecheckGate(false);
    if (gate.canPost) setQuickOpen(true);
  }, [recheckGate, gate.loading, gate.canPost]);

  // Parent mode is decided by a separate guardian check; nothing here (posting included) shows until it settles.
  if (parentLoading) {
    return (
      <div className="min-h-dvh bg-background pb-24">
        <BackHeader title="My availability & invitations" fallbackTo="/feed" />
        <main className="page-shell-narrow py-4" aria-busy="true">
          <p className="sr-only">Loading…</p>
          <div className="h-12 animate-pulse rounded-2xl bg-surface" aria-hidden />
        </main>
      </div>
    );
  }
  if (isParentMode) return <Navigate to="/feed" replace />;

  const reload = () => {
    setReloadTick((t) => t + 1);
    // Home's availability card reads the same list.
    void qc.invalidateQueries({ queryKey: ["my-availabilities", user?.id] });
  };

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="My availability & invitations" fallbackTo="/feed" />

      <main className="page-shell-narrow space-y-4 py-4">
        <h1 className="sr-only">My availability &amp; invitations</h1>
        <p className="text-sm text-muted-foreground">
          Post when you're free to play. Hosts near you can invite you to their games.
        </p>

        {!gate.loading && !gate.canPost && (
          <AvailabilityRequiredNotice
            reason={gate.reason}
            returnTo={AVAILABILITY_POST_RETURN}
            onSwitched={() => setRecheckGate(true)}
          />
        )}
        {gate.canPost && (
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-lime-gradient text-base font-bold text-primary-foreground glow-lime"
          >
            <Plus className="h-5 w-5" strokeWidth={2.5} aria-hidden /> I'm available
          </button>
        )}

        <MineView
          user={user ? { id: user.id } : null}
          onEdit={(m) => setEditing(m)}
          refreshKey={reloadTick}
        />
      </main>

      <QuickAvailabilitySheet
        open={quickOpen}
        onOpenChange={setQuickOpen}
        onPosted={() => {
          setQuickOpen(false);
          reload();
          toast.success("You're listed. Players near you can see when you're free.");
        }}
        onMoreOptions={() => {
          setQuickOpen(false);
          setFormOpen(true);
        }}
      />

      {(formOpen || editing) && (
        <PostAvailabilityDialog
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onPosted={() => {
            const wasEdit = !!editing;
            setFormOpen(false);
            setEditing(null);
            reload();
            toast.success(wasEdit ? "Availability updated" : "Availability posted");
          }}
        />
      )}
    </div>
  );
}
