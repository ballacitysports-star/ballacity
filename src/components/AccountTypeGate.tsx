import { Link } from "@tanstack/react-router";
import { useAccountType, type AccountType, ACCOUNT_TYPE_META } from "@/lib/account-type";

/**
 * Wraps a linked-profile creation flow (team, trainer, gym) and only
 * renders it when the signed-in user's account_type matches. Account
 * type is permanent and chosen at signup, so a mismatch means the user
 * is on the wrong page — direct them to sign up with a different email
 * instead of offering an in-app switcher.
 */
export function AccountTypeGate({
  requires,
  children,
}: {
  requires: AccountType;
  children: React.ReactNode;
}) {
  const { accountType, loading } = useAccountType();
  if (loading) return null;
  if (accountType === requires) return <>{children}</>;

  const currentLabel = accountType ? ACCOUNT_TYPE_META[accountType].label : "another type";
  const requiredLabel = ACCOUNT_TYPE_META[requires].label;
  return (
    <div className="mx-auto w-full max-w-md p-6">
      <div className="rounded-2xl border border-border bg-surface p-5 text-sm">
        <div className="font-display text-lg font-bold">This is a {requiredLabel} page</div>
        <p className="mt-2 text-muted-foreground">
          Your account is a {currentLabel}. Each account can only be one type. To create a{" "}
          {requiredLabel} profile, sign up with a different email address.
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            to="/profile"
            className="rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            Back to profile
          </Link>
        </div>
      </div>
    </div>
  );
}
