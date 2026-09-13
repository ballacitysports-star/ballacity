import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { ACCOUNT_TYPE_META, type AccountType } from "@/lib/account-type";

/**
 * Wraps a linked-profile creation flow (team, trainer, gym). Accounts can now
 * hold several profiles at once — a personal player profile plus any number of
 * team, trainer, and gym profiles — so this no longer gates on account type.
 * It only makes sure the visitor is signed in.
 */
export function AccountTypeGate({
  requires,
  children,
}: {
  requires: AccountType;
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <>{children}</>;

  const requiredLabel = ACCOUNT_TYPE_META[requires].label;
  return (
    <div className="page-shell-narrow py-6">
      <div className="rounded-2xl border border-border bg-surface p-5 text-sm">
        <div className="font-display text-lg font-bold">Sign in to add a {requiredLabel}</div>
        <p className="mt-2 text-muted-foreground">
          {requiredLabel} profiles are added to your account. Sign in and you can switch between
          all of your profiles anytime.
        </p>
        <div className="mt-4 flex gap-2">
          <Link
            to="/auth"
            className="rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
