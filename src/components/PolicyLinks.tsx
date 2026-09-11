import { Link } from "@tanstack/react-router";

/**
 * Shared cross-links between the Safety Center, Trust Center, and the policy
 * pages. Kept in one place so every surface offers the same set.
 */
export function PolicyLinks({ className = "" }: { className?: string }) {
  const cls =
    "rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav aria-label="Policies and support" className={`flex flex-wrap gap-2 ${className}`}>
      <Link to="/safety" className={cls}>
        Safety Center
      </Link>
      <Link to="/trust-center" className={cls}>
        Trust Center
      </Link>
      <Link to="/community-guidelines" className={cls}>
        Community Guidelines
      </Link>
      <Link to="/terms" className={cls}>
        Terms
      </Link>
      <Link to="/privacy" className={cls}>
        Privacy
      </Link>
      <Link to="/cookies" className={cls}>
        Cookies
      </Link>
      <Link to="/contact" className={cls}>
        Contact
      </Link>
      <Link to="/contact" hash="report" className={cls}>
        Report a problem
      </Link>
    </nav>
  );
}
