import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { CheckCircle2 } from "lucide-react";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

export const Route = createFileRoute("/checkout/return")({
  head: () =>
    pageHead({
      path: "/checkout/return",
      title: "All set — ballaCity",
      description: "Confirmation and next steps.",
      noindex: true,
    }),
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  const { freeMode, notice } = useFeatureAccess();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md w-full rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
        <CheckCircle2 className="mx-auto h-12 w-12 text-lime" />
        <h1 className="mt-4 page-title">{session_id ? "Payment complete" : "Checkout complete"}</h1>
        {/* Nothing is being sold while ballaCity is free, so subscription and
            refund copy would only confuse someone who landed here. */}
        {freeMode ? (
          <p className="mt-2 page-subtitle">{notice}</p>
        ) : (
          <>
            <p className="mt-2 page-subtitle">
              Thanks for supporting ballaCity! Subscriptions activate immediately. For merch orders,
              you'll receive a confirmation email with shipping details.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              All sales are final. No refunds. Manage subscriptions anytime from the billing portal
              on the Plans page.
            </p>
          </>
        )}
        <div className="mt-6 flex gap-2 justify-center">
          <Link
            to="/plans"
            className="rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-lime/40"
          >
            {freeMode ? "Your plan" : "Plans"}
          </Link>
          <Link
            to="/reels"
            search={{ game: "", title: "", upload: "" }}
            className="rounded-xl bg-lime px-4 py-2 text-sm font-bold text-black"
          >
            Back to Reels
          </Link>
        </div>
      </div>
    </div>
  );
}
