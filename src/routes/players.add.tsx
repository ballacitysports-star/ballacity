import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { SPORTS } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPlayer, PlayerProfileError, type PlayerProfile } from "@/lib/player-profiles";

export const Route = createFileRoute("/players/add")({
  head: () =>
    pageHead({
      path: "/players/add",
      title: "Add a player — ballaCity",
      description:
        "Add yourself or a player you manage. Guardian-managed players don't need their own login.",
      noindex: true,
    }),
  ssr: false,
  component: AddPlayerPage,
});

/**
 * Add Player (§20).
 *
 * Four fields and a button. Everything else about an athlete — positions,
 * skill level, teams, stats, highlights, availability — is filled in later
 * from the profile itself, so this never becomes a sports résumé form.
 *
 * A child created here has no auth account: `isSelf` is false, which leaves
 * player_profiles.user_id null. Their age cohort is derived from the birthday
 * by a database trigger, not chosen here, so the safety rules cannot be
 * side-stepped by picking a different answer on this screen.
 */
function AddPlayerPage() {
  const navigate = useNavigate();
  const [who, setWho] = useState<"child" | "me" | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [sport, setSport] = useState("");
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<PlayerProfile | null>(null);

  const canSubmit = !!who && firstName.trim() !== "" && dob !== "" && !saving;

  const submit = async () => {
    if (!canSubmit || !who) return;
    setSaving(true);
    try {
      const player = await createPlayer({
        firstName,
        lastName,
        dateOfBirth: dob,
        sport,
        isSelf: who === "me",
      });
      setCreated(player);
    } catch (e) {
      // §23: the thrown message is already user-facing; anything else is a bug
      // and must not reach the screen as a raw database error.
      toast.error(
        e instanceof PlayerProfileError ? e.message : "Couldn't create that player. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    const name = created.displayName.split(" ")[0] || "your player";
    return (
      <div className="page-shell-narrow py-10">
        <div className="flex items-center gap-2 text-lime">
          <CheckCircle2 className="h-6 w-6" />
          <h1 className="page-title">Player created!</h1>
        </div>
        <p className="mt-2 page-subtitle">
          Let&apos;s build {name}&apos;s profile when you&apos;re ready.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" onClick={() => navigate({ to: "/profile" })}>
            Complete profile
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => navigate({ to: "/feed" })}
          >
            Do this later
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-narrow py-10">
      <h1 className="page-title">Add a player</h1>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold text-foreground">Who is this player?</legend>
        <div className="mt-3 flex gap-2">
          {(
            [
              { id: "child", label: "A player I manage" },
              { id: "me", label: "Me" },
            ] as const
          ).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setWho(o.id)}
              aria-pressed={who === o.id}
              className={`flex-1 rounded-2xl border px-4 py-3 font-semibold transition-colors ${
                who === o.id
                  ? "border-lime bg-lime/5 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:border-lime/40"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {who === "child" && (
          <p className="mt-2 text-xs text-muted-foreground">
            This player doesn&apos;t need their own login — you manage this profile from your
            account.
          </p>
        )}
      </fieldset>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="first-name">First name</Label>
          <Input
            id="first-name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="last-name">Last name</Label>
          <Input
            id="last-name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="dob">Birthday</Label>
          <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            Used to keep younger players&apos; profiles private. Never shown publicly.
          </p>
        </div>
        <div>
          <Label htmlFor="sport">Sport</Label>
          <select
            id="sport"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-base text-foreground"
          >
            <option value="">Choose a sport</option>
            {SPORTS.map((s) => (
              <option key={s.name} value={s.name}>
                {s.emoji} {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Button className="mt-6 w-full" disabled={!canSubmit} onClick={submit}>
        {saving ? "Creating…" : "Create player"}
      </Button>
    </div>
  );
}
