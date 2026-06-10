import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
        <CheckCircle2 className="mx-auto h-12 w-12 text-lime" />
        <h1 className="mt-4 text-2xl font-bold">
          {session_id ? "Subscription activated" : "Checkout complete"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You now have unlimited AI Highlight Reels. Thanks for supporting OpenRun!
        </p>
        <Link
          to="/reels"
          className="mt-6 inline-flex rounded-xl bg-lime px-5 py-2.5 font-semibold text-black"
        >
          Back to Reels
        </Link>
      </div>
    </div>
  );
}
