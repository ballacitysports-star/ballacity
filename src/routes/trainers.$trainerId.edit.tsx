import { createFileRoute, redirect, notFound, Link } from "@tanstack/react-router";
import { ensureOrgById, isMyOrg } from "@/lib/org-store";
import { ShieldAlert } from "lucide-react";

class ForbiddenError extends Error {
  constructor(message = "You don't have permission to edit this trainer.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const Route = createFileRoute("/trainers/$trainerId/edit")({
  head: () => ({
    meta: [
      { title: "Edit trainer — OpenRun" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.trainerId);
    if (!org) throw notFound();
    if (org.kind !== "coach") {
      // Non-trainer org — send to the generic org editor if allowed, else block.
      if (!isMyOrg(org.id)) throw new ForbiddenError();
      throw redirect({ to: "/teams/$teamId/edit", params: { teamId: org.id } });
    }
    if (!isMyOrg(org.id)) {
      throw new ForbiddenError(
        "Only the trainer who created this profile can edit it.",
      );
    }
    throw redirect({ to: "/teams/$teamId/edit", params: { teamId: org.id } });
  },
  errorComponent: ({ error }) => {
    const forbidden = error instanceof ForbiddenError;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 pt-24 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold">
          {forbidden ? "Editing not allowed" : "Couldn't open editor"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : "Something went wrong."}
        </p>
        <Link
          to="/trainers"
          className="mt-2 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Back to trainers
        </Link>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <p className="text-muted-foreground">Trainer not found.</p>
      <Link
        to="/trainers"
        className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        Back to trainers
      </Link>
    </div>
  ),
  component: () => null,
});
