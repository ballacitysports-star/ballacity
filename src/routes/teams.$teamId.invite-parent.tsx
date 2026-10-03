import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getTeamRosterOverview, inviteParentToTryout } from "@/lib/tryouts.functions";

export const Route = createFileRoute("/teams/$teamId/invite-parent")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Invite a parent to a tryout | BallaCity" },
      { name: "description", content: "Email a tryout invite to a parent who isn't on BallaCity yet." },
      { property: "og:title", content: "Invite a parent to a tryout | BallaCity" },
      { property: "og:description", content: "Send parents a link to your team's tryout sign-up page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InviteParentPage,
});

function InviteParentPage() {
  const { teamId } = Route.useParams();
  const rosterFn = useServerFn(getTeamRosterOverview);
  const send = useServerFn(inviteParentToTryout);
  const roster = useQuery({ queryKey: ["team-roster-overview", teamId], queryFn: () => rosterFn({ data: { teamId } }) });
  const events = (roster.data?.events ?? [])
    .filter((e) => e.eventDate && new Date(e.eventDate).getTime() >= Date.now() - 864e5)
    .sort((a, b) => new Date(a.eventDate!).getTime() - new Date(b.eventDate!).getTime());
  const [postId, setPostId] = useState("");
  const [email, setEmail] = useState("");
  const [parentName, setParentName] = useState("");
  const [childName, setChildName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);
  useEffect(() => { if (!postId && events.length) setPostId(events[0].id); }, [events.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!postId) return toast.error("Pick a tryout.");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error("Enter a valid email.");
    setBusy(true);
    const r = await send({ data: { teamId, postId, email: email.trim(), parentName: parentName || undefined, childName: childName || undefined } })
      .catch(() => ({ ok: false as const, error: "Couldn't send the email." }));
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    if (r.sent) toast.success(`Invite sent to ${email.trim()}`);
    else toast.info("This parent was already invited to this tryout.");
    setSentTo((s) => [email.trim(), ...s]);
    setEmail(""); setParentName(""); setChildName("");
  };

  return (
    <main className="page-shell max-w-xl py-6">
      <Link to="/teams/$teamId/tryouts" params={{ teamId }} className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Tryouts
      </Link>
      <h1 className="mt-2 font-display text-2xl font-bold">Invite a parent</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Email a parent who isn't on BallaCity yet. They get the tryout details and a link to sign up and apply for their child.
      </p>

      {roster.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : roster.error ? (
        <p className="mt-6 text-sm text-coral">Only owners, managers and coaches can send invites.</p>
      ) : events.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No upcoming tryouts. <Link to="/teams/$teamId/events" params={{ teamId }} className="underline">Post one</Link> first.
        </p>
      ) : (
        <form onSubmit={onSend} className="mt-6 space-y-3 rounded-2xl border border-border bg-surface p-4">
          <label className="block text-sm font-semibold">
            Tryout
            <select value={postId} onChange={(e) => setPostId(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm">
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} — {new Date(ev.eventDate!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Parent's email
            <Input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" className="mt-1" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Parent's name <span className="font-normal text-muted-foreground">(optional)</span>
              <Input maxLength={80} value={parentName} onChange={(e) => setParentName(e.target.value)} className="mt-1" />
            </label>
            <label className="block text-sm font-semibold">
              Child's first name <span className="font-normal text-muted-foreground">(optional)</span>
              <Input maxLength={80} value={childName} onChange={(e) => setChildName(e.target.value)} className="mt-1" />
            </label>
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            <Mail className="mr-2 h-4 w-4" /> {busy ? "Sending…" : "Send invite"}
          </Button>
          <p className="text-xs text-muted-foreground">Each parent gets one email per tryout, even if you send again.</p>
        </form>
      )}

      {sentTo.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold">Sent this visit</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{sentTo.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </section>
      )}
    </main>
  );
}
