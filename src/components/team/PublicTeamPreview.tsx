import { Link } from "@tanstack/react-router";
import { MapPin } from "lucide-react";
import { Logo } from "@/components/Logo";
import type { PublicTeamPreview as Preview } from "@/lib/city-pages.functions";
import { authSearchHere } from "@/lib/pending-next";

/**
 * What a signed-out visitor sees at a shared team link: name, sports, city,
 * tagline and bio of an adult-only team. Roster, owner, contacts and posts stay
 * behind sign-in. Any team the server does not mark `eligible` gets a generic
 * prompt that says nothing about the team.
 */
export function PublicTeamPreview({ preview }: { preview: Preview | null }) {
  const search = authSearchHere() as never;
  const shown = preview?.eligible ? preview : null;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-md items-center justify-between px-5 py-3">
          <Logo />
        </div>
      </header>
      <main className="mx-auto max-w-md px-5 py-8">
        {shown ? (
          <>
            {shown.sports.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {shown.sports.join(" • ")} team
              </p>
            )}
            <h1 className="page-title mt-1">{shown.name}</h1>
            {shown.tagline && <p className="mt-1 text-sm">{shown.tagline}</p>}
            {shown.city && (
              <p className="mt-4 flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />
                {shown.city}
              </p>
            )}
            {shown.bio && <p className="mt-4 text-sm text-muted-foreground">{shown.bio}</p>}
            <p className="mt-6 text-xs text-muted-foreground">
              Create a free account to see the roster, upcoming games and tryouts, and to follow
              this team.
            </p>
          </>
        ) : (
          <>
            <h1 className="page-title">Sign in to see this team</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This team isn&rsquo;t open to the public. Sign in to check whether you can view it.
            </p>
          </>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Link
            to="/auth"
            search={search}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-lime px-5 text-sm font-bold text-primary-foreground"
          >
            {shown ? "Sign up to follow" : "Sign in"}
          </Link>
          {shown && (
            <Link
              to="/auth"
              search={search}
              className="inline-flex min-h-11 items-center justify-center text-sm text-muted-foreground"
            >
              Already have an account? Sign in
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
