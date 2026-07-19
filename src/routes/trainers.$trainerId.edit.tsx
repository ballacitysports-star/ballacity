import { createFileRoute, redirect, notFound, Link } from "@tanstack/react-router";
import { ensureOrgById } from "@/lib/org-store";

export const Route = createFileRoute("/trainers/$trainerId/edit")({
  head: () => ({ meta: [{ title: "Edit trainer — OpenRun" }, { name: "robots", content: "noindex" }] }),
  loader: async ({ params }) => {
    const org = await ensureOrgById(params.trainerId);
    if (!org) throw notFound();
    throw redirect({ to: "/teams/$teamId/edit", params: { teamId: org.id } });
  },
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <p className="text-muted-foreground">{error instanceof Error ? error.message : "Couldn't open editor."}</p>
      <Link to="/trainers" className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground">
        Back to trainers
      </Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-md px-6 pt-24 text-center">
      <p className="text-muted-foreground">Trainer not found.</p>
      <Link to="/trainers" className="mt-4 inline-block rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground">
        Back to trainers
      </Link>
    </div>
  ),
  component: () => null,
});
