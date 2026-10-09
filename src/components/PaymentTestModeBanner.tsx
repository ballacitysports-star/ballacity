import { useFeatureAccess } from "@/hooks/useFeatureAccess";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;

export function PaymentTestModeBanner() {
  const { freeMode } = useFeatureAccess();

  // Nothing is chargeable while BallaCity is free, so a banner about payment
  // modes is noise at best and implies a cost at worst.
  if (freeMode) return null;

  if (!clientToken) {
    // Builder-facing, not athlete-facing: a missing key is a deploy task, and
    // on a live site it reads to a member as though the app is demanding
    // payment for something (the free tier) that costs nothing. The features
    // that don't involve a charge keep working, so say nothing in production.
    if (!import.meta.env.DEV) return null;
    return (
      <div className="w-full bg-red-100 border-b border-red-300 px-4 py-2 text-center text-sm text-red-800">
        Production checkout is not configured. Complete Stripe go-live in your Lovable project to
        accept real payments.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full bg-orange-100 border-b border-orange-300 px-4 py-2 text-center text-sm text-orange-800">
        All payments made in the preview are in test mode.{" "}
        <a
          href="https://docs.lovable.dev/features/payments#test-and-live-environments"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-medium"
        >
          Read more
        </a>
      </div>
    );
  }
  return null;
}
