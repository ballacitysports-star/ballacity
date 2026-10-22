import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LISTING_COPY,
  hideErrorMessage,
  visibilityAction,
  type ListingKind,
  type ListingVisibility,
} from "@/lib/listing-visibility";
import { useListingVisibility, useSetListingHidden } from "@/lib/use-listing-visibility";

/**
 * Hide a listing from the public, or show it again. Shown only to the people
 * allowed to (the database re-checks), and honest about three states: visible,
 * hidden by you, and hidden by BallaCity moderators, which you cannot lift.
 *
 * `state` lets a list that already has the columns skip the extra query.
 * `variant="icon"` is a small button for a row in a list.
 */
export function ListingVisibilityToggle({
  kind,
  id,
  state,
  variant = "card",
}: {
  kind: ListingKind;
  id: string;
  state?: ListingVisibility;
  variant?: "card" | "icon";
}) {
  const query = useListingVisibility(kind, id, !state);
  const mutation = useSetListingHidden(kind, id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const current = state ?? query.data;
  if (!current) return null;

  const copy = LISTING_COPY[kind];
  const action = visibilityAction(current);

  const apply = async (hidden: boolean) => {
    try {
      const res = await mutation.mutateAsync(hidden);
      if (!hidden && res.stillHidden) {
        toast.message("BallaCity moderators still have this hidden.");
      } else {
        toast.success(
          hidden ? `Your ${copy.noun} is hidden.` : `Your ${copy.noun} is public again.`,
        );
      }
    } catch (e) {
      toast.error(hideErrorMessage(e instanceof Error ? e.message : ""));
    }
  };

  if (action === "held") {
    if (variant === "icon") return null;
    return (
      <section
        aria-label="Visibility"
        className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      >
        <p className="font-semibold">Hidden by BallaCity moderators</p>
        <p className="mt-1 text-muted-foreground">
          This {copy.noun} is not public, and only moderators can change that.{" "}
          <Link to="/contact" className="font-semibold text-lime underline">
            Contact support
          </Link>{" "}
          to appeal.
        </p>
      </section>
    );
  }

  const hiding = action === "hide";
  const label = hiding ? "Hide from public" : "Show to everyone";
  const Icon = hiding ? EyeOff : Eye;

  const dialog = (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hide this {copy.noun} from the public?</AlertDialogTitle>
          <AlertDialogDescription>
            It leaves the feed, search, city pages and link previews. {copy.whoStillSees} can still
            see it. {copy.extra ? `${copy.extra} ` : ""}You can show it again at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it public</AlertDialogCancel>
          <AlertDialogAction onClick={() => void apply(true)}>Hide</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const onClick = () => (hiding ? setConfirmOpen(true) : void apply(false));

  if (variant === "icon") {
    return (
      <>
        <button
          type="button"
          onClick={onClick}
          disabled={mutation.isPending}
          aria-label={`${label}: ${copy.noun}`}
          title={label}
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/80 text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
        {dialog}
      </>
    );
  }

  return (
    <section
      aria-label="Visibility"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-sm ${
        hiding ? "border-border bg-surface" : "border-amber-500/40 bg-amber-500/10"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{hiding ? `Visible to everyone` : `Hidden from the public`}</p>
        <p className="text-muted-foreground">
          {hiding
            ? `Hide this ${copy.noun} to take it out of the feed, search and city pages.`
            : `${copy.whoStillSees} can still see it.`}
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={mutation.isPending}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm font-bold hover:border-lime/40 disabled:opacity-50"
      >
        <Icon className="h-4 w-4" aria-hidden /> {mutation.isPending ? "Saving…" : label}
      </button>
      {dialog}
    </section>
  );
}
