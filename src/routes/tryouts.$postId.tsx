import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { CalendarClock, MapPin, Users, ShieldCheck, Mail } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { RsvpDialog, useMyTryoutRegistrations } from "@/components/tryouts/TryoutsSection";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTryout, getMyTryoutResult } from "@/lib/tryouts.functions";
import { cancelPolicyNote } from "@/lib/cancel-window";

const tryoutQuery = (postId: string) =>
  queryOptions({ queryKey: ["tryouts", "one", postId], queryFn: () => getTryout({ data: { postId } }) });

export const Route = createFileRoute("/tryouts/$postId")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(tryoutQuery(params.postId)),
  head: ({ loaderData }) => {
    const title = loaderData ? `${loaderData.title} — ${loaderData.teamName} ${loaderData.kind === "clinic" ? "camp" : "tryout"} sign-up | BallaCity` : "Tryout sign-up | BallaCity";
    const desc = loaderData
      ? `Apply for a spot at ${loaderData.teamName}'s ${loaderData.kind === "tryout" ? "tryout" : "camp"}. Parents can sign up their child and sign the team waiver in one step.`
      : "Sign up for a team tryout or camp on BallaCity.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  errorComponent: () => <div className="page-shell py-16 text-center">Couldn't load this tryout. Try again soon.</div>,
  notFoundComponent: () => <div className="page-shell py-16 text-center">Tryout not found.</div>,
  component: TryoutPage,
});

function TryoutPage() {
  const { postId } = Route.useParams();
  const { data: t } = useSuspenseQuery(tryoutQuery(postId));
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const myRegistrations = useMyTryoutRegistrations();
  useEffect(() => {
    if (!user || !t) return setIsManager(false);
    supabase.rpc("is_team_manager", { _team: t.teamId, _user: user.id }).then(({ data }) => setIsManager(!!data));
  }, [user?.id, t?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!t)
    return (
      <div className="page-shell py-16 text-center">
        <p className="font-semibold">This event is no longer available.</p>
        <Link to="/" className="mt-3 inline-block text-sm underline">Browse other tryouts &amp; camps</Link>
      </div>
    );

  const left = t.spotsMax != null ? Math.max(t.spotsMax - t.spotsTaken, 0) : null;
  const passed = t.eventDate ? new Date(t.eventDate).getTime() < Date.now() : false;
  const apply = () =>
    user ? setOpen(true) : navigate({ to: "/auth", search: { next: `/tryouts/${t.id}` } as any });

  return (
    <main className="page-shell max-w-2xl py-10">
      <span className="rounded-full bg-lime/15 px-2 py-0.5 text-xs font-semibold text-lime">
        {t.kind === "tryout" ? "Tryout" : "Camp / Clinic"}
      </span>
      <h1 className="mt-3 font-display text-3xl font-bold">{t.title}</h1>
      <Link to="/teams/$teamId" params={{ teamId: t.teamId }} className="text-muted-foreground hover:underline">
        {t.teamName}
      </Link>
      <div className="mt-4 space-y-1 text-sm text-muted-foreground">
        <p className="flex items-center gap-2"><CalendarClock className="h-4 w-4" />
          {t.eventDate ? new Date(t.eventDate).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date TBA"}
        </p>
        {t.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{t.location}</p>}
        {left != null && <p className="flex items-center gap-2"><Users className="h-4 w-4" />{left === 0 ? "Full" : `${left} of ${t.spotsMax} spots left`}</p>}
        <p>{t.price ? `Fee: $${t.price}` : "Free"}</p>
        <p>{cancelPolicyNote(t.cancelCutoffMin)}</p>
      </div>
      {isManager && !passed && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="rounded-full">
            <Link to="/teams/$teamId/invite-parent" params={{ teamId: t.teamId }} search={{ postId: t.id }}>
              <Mail className="mr-1 h-4 w-4" /> Invite parent
            </Link>
          </Button>
        </div>
      )}
      {t.body && <p className="mt-6 whitespace-pre-wrap">{t.body}</p>}

      <div className="mt-8 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg font-semibold">
          {t.kind === "tryout" ? "Apply for Tryout" : "Register for Camp"}
        </h2>
        <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Parents can sign up a linked child and sign the team waiver on their behalf. The team sees your application on their dashboard.
        </p>
        {t && myRegistrations.has(t.id) && !passed ? (
          <Button className="mt-4 w-full rounded-full" variant="outline" onClick={apply}>
            Registered ✓ · Manage or cancel
          </Button>
        ) : (
          <Button className="mt-4 w-full rounded-full" disabled={left === 0 || passed} onClick={apply}>
            {passed ? "This event has passed" : left === 0 ? "Full" : user
                ? t.kind === "tryout"
                  ? "Apply now"
                  : "Register now"
                : "Sign in to apply"}
          </Button>
        )}
      </div>
      {user && <MyResult postId={t.id} />}
      {open && <RsvpDialog tryout={t} onClose={() => setOpen(false)} />}
    </main>
  );
}

function MyResult({ postId }: { postId: string }) {
  const fn = useServerFn(getMyTryoutResult);
  const q = useQuery({ queryKey: ["my-tryout-result", postId], queryFn: () => fn({ data: { postId } }) });
  const r = q.data;
  if (!r || (r.score == null && !r.notes && r.attended == null)) return null;
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-5">
      <h2 className="font-display text-lg font-semibold">Your result</h2>
      {r.attended != null && <p className="mt-1 text-sm text-muted-foreground">{r.attended ? "Attended" : "Did not attend"}</p>}
      {r.score != null && <p className="mt-2 text-2xl font-bold">{r.score}/10</p>}
      {r.notes && <p className="mt-2 text-sm italic">Coach: {r.notes}</p>}
      {!r.scoresShared && <p className="mt-2 text-xs text-muted-foreground">The team hasn't shared scores for this tryout.</p>}
    </div>
  );
}
