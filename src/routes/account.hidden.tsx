import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, EyeOff } from "lucide-react";
import { withRequireAuth } from "@/components/RequireAuth";
import { ListingVisibilityToggle } from "@/components/listings/ListingVisibilityToggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { pageHead } from "@/lib/seo";
import type { ListingKind } from "@/lib/listing-visibility";

export const Route = createFileRoute("/account/hidden")({
  head: () =>
    pageHead({
      title: "Hidden listings — BallaCity",
      description:
        "Games, posts, teams, trainer profiles and gyms you have hidden from the public.",
      noindex: true,
    }),
  ssr: false,
  component: withRequireAuth(HiddenListingsPage),
});

type HiddenRow = {
  kind: ListingKind;
  id: string;
  title: string;
  to: string;
  params: Record<string, string>;
};

/** Everything the signed-in person has hidden themselves, one list, so nothing is lost once it is out of the feed. */
async function loadHidden(userId: string): Promise<HiddenRow[]> {
  // The generated types predate the hide columns.
  const q = (table: string, columns: string, ownerColumn: string) =>
    supabase
      .from(table as never)
      .select(columns)
      .eq(ownerColumn, userId)
      .not("owner_hidden_at", "is", null);
  const [games, posts, teams, gyms] = await Promise.all([
    q("hosted_games", "id, title", "host_id"),
    q("team_posts", "id, title, team_id", "author_id"),
    q("teams", "id, name, kind", "owner_id"),
    q("trainer_orgs", "id, name", "owner_id"),
  ]);
  const rows: HiddenRow[] = [];
  for (const g of (games.data ?? []) as unknown as { id: string; title: string }[]) {
    rows.push({
      kind: "game",
      id: g.id,
      title: g.title,
      to: "/games/$gameId",
      params: { gameId: g.id },
    });
  }
  for (const p of (posts.data ?? []) as unknown as {
    id: string;
    title: string;
    team_id: string;
  }[]) {
    rows.push({
      kind: "post",
      id: p.id,
      title: p.title,
      to: "/teams/$teamId",
      params: { teamId: p.team_id },
    });
  }
  for (const t of (teams.data ?? []) as unknown as { id: string; name: string; kind: string }[]) {
    rows.push(
      t.kind === "coach"
        ? {
            kind: "trainer",
            id: t.id,
            title: t.name,
            to: "/trainers/$trainerId",
            params: { trainerId: t.id },
          }
        : { kind: "team", id: t.id, title: t.name, to: "/teams/$teamId", params: { teamId: t.id } },
    );
  }
  for (const o of (gyms.data ?? []) as unknown as { id: string; name: string }[]) {
    rows.push({
      kind: "gym",
      id: o.id,
      title: o.name,
      to: "/orgs/$orgId",
      params: { orgId: o.id },
    });
  }
  return rows;
}

const KIND_LABEL: Record<ListingKind, string> = {
  game: "Game",
  post: "Team post",
  team: "Team",
  trainer: "Trainer profile",
  gym: "Gym",
};

function HiddenListingsPage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["hidden-listings", user?.id],
    enabled: !!user,
    queryFn: () => loadHidden(user!.id),
  });
  const rows = query.data ?? [];

  return (
    <div className="page-shell-content pt-6 pb-32">
      <div className="mb-5 flex items-center gap-3">
        <Link
          to="/settings"
          aria-label="Back to settings"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="page-title">Hidden listings</h1>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        These are out of the feed, search and city pages. You can still open them, and so can the
        people linked to them. Show one to make it public again.
      </p>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <EyeOff className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm font-semibold">Nothing hidden</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Hide a game, post, team, trainer profile or gym from its own page.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={`${r.kind}:${r.id}`} className="space-y-2">
              <Link
                to={r.to as never}
                params={r.params as never}
                className="block rounded-xl text-sm font-semibold hover:text-lime"
              >
                <span className="mr-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
                  {KIND_LABEL[r.kind]}
                </span>
                {r.title}
              </Link>
              <ListingVisibilityToggle
                kind={r.kind}
                id={r.id}
                state={{ ownerHidden: true, moderatorHidden: false }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
