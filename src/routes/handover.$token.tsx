import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { HandoverClaim } from "@/components/handover/HandoverClaim";

export const Route = createFileRoute("/handover/$token")({
  head: () => {
    const head = pageHead({
      title: "Take over your account — BallaCity",
      description: "Finish taking over your BallaCity account.",
      noindex: true,
    });
    // The token is in the address: no request from this page may carry it onward as a referrer.
    return { ...head, meta: [...head.meta, { name: "referrer", content: "no-referrer" }] };
  },
  ssr: false,
  component: HandoverPage,
});

function HandoverPage() {
  const { token } = Route.useParams();
  return <HandoverClaim token={token} />;
}
