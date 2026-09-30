import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { SPORTS } from "@/lib/sample-data";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { COHORT_META, cohortFromBirthday, isMinorCohort } from "@/lib/child-policy";
import {
  GUARDIAN_RELATIONSHIPS,
  childDisplayName,
  type GuardianRelationship,
} from "@/lib/managed-children";
import {
  fetchUnfinishedChildProfile,
  useCreateManagedChild,
  useSwitchToManagedChild,
} from "@/lib/use-managed-children";
import type { CreatedManagedChild } from "@/lib/managed-children.functions";

const searchSchema = z.object({
  /** Where the parent came from, so the success screen sends them onward. */
  from: z.enum(["onboarding", "parent"]).optional(),
  /** A child started on the old Add Player screen, to finish setting up. */
  prefill: z.string().uuid().optional(),
});

export const Route = createFileRoute("/players/add")({
  head: () =>
    pageHead({
      path: "/players/add",
      title: "Add your child — ballaCity",
      description:
        "Add your child's player profile to your account. They don't need an email or password.",
      noindex: true,
    }),
  validateSearch: searchSchema,
  ssr: false,
  component: AddChildPage,
});

const RELATIONSHIP_LABEL: Record<GuardianRelationship, string> = {
  parent: "Parent",
  guardian: "Legal guardian",
  grandparent: "Grandparent",
  "other adult": "Other responsible adult",
};

/**
 * Add your child (§20).
 *
 * A child added here is a real account with no email or password, managed
 * from the parent's login. Because it is a real account, every child-safety
 * rule applies to it exactly as it does to a child who signed up themselves:
 * the age group comes from the birthday (checked again on the server and
 * locked once saved), messaging starts guardian-only, and the profile is
 * private.
 *
 * Everything else about the athlete — positions, teams, highlights,
 * availability — is filled in later, so this never becomes a sports résumé.
 */
function AddChildPage() {
  const navigate = useNavigate();
  const { from, prefill } = Route.useSearch();
  const create = useCreateManagedChild();
  const switchTo = useSwitchToManagedChild();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [sport, setSport] = useState("");
  const [relationship, setRelationship] = useState<GuardianRelationship>("parent");
  const [attested, setAttested] = useState(false);
  const [created, setCreated] = useState<CreatedManagedChild | null>(null);

  // Finishing a child started on the old screen: prefill what they entered.
  useEffect(() => {
    if (!prefill) return;
    let cancelled = false;
    void fetchUnfinishedChildProfile(prefill).then((p) => {
      if (cancelled || !p) return;
      setFirstName(p.firstName);
      setLastName(p.lastName ?? "");
      setDob(p.dateOfBirth ?? "");
      setSport(p.sport ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [prefill]);

  const cohort = useMemo(() => (dob ? cohortFromBirthday(dob) : null), [dob]);
  const tooOld = cohort !== null && cohort !== "unknown" && !isMinorCohort(cohort);
  const name = childDisplayName(firstName, lastName);
  const saving = create.isPending;

  const canSubmit =
    firstName.trim() !== "" && dob !== "" && attested && !tooOld && name.ok && !saving;

  const submit = () => {
    if (!canSubmit) return;
    create.mutate(
      {
        firstName,
        lastName: lastName || undefined,
        dateOfBirth: dob,
        sport: sport || undefined,
        relationship,
        fromPlayerProfileId: prefill,
      },
      {
        onSuccess: (child) => setCreated(child),
        // §23: the server only ever throws a message written for a parent.
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't add your child. Try again."),
      },
    );
  };

  if (created) {
    const first = created.displayName.split(" ")[0] || "your child";
    return (
      <div className="page-shell-narrow py-10">
        <div className="flex items-center gap-2 text-lime">
          <CheckCircle2 className="h-6 w-6" aria-hidden />
          <h1 className="page-title">{first}&apos;s profile is ready</h1>
        </div>
        <p className="mt-2 page-subtitle">
          You manage {first}&apos;s profile from your account. It starts private, with messages from
          you only — change that any time in the Parent Center.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button className="w-full sm:w-auto" onClick={() => navigate({ to: "/parent" })}>
            Go to Parent Center
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            disabled={switchTo.isPending}
            onClick={() =>
              switchTo.mutate(
                { childUserId: created.childUserId, childName: created.displayName },
                {
                  onError: (e) =>
                    toast.error(
                      e instanceof Error ? e.message : "Couldn't switch to that profile.",
                    ),
                },
              )
            }
          >
            {switchTo.isPending ? "Switching…" : `Switch to ${first}'s profile`}
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => {
              setCreated(null);
              setFirstName("");
              setLastName("");
              setDob("");
              setSport("");
              setAttested(false);
            }}
          >
            Add another child
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-narrow py-10">
      <h1 className="page-title">Add your child</h1>
      <p className="mt-2 page-subtitle">
        {from === "onboarding"
          ? "Set up the player you're managing. They don't need an email or password — you'll manage their profile from your account."
          : "They don't need an email or password. You manage their profile from your account and can switch into it any time."}
      </p>

      <div className="mt-6 space-y-4">
        <div>
          <Label htmlFor="first-name">First name</Label>
          <Input
            id="first-name"
            value={firstName}
            maxLength={40}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="last-name">Last name (optional)</Label>
          <Input
            id="last-name"
            value={lastName}
            maxLength={60}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="off"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Only the first letter is kept, so their profile shows e.g. &ldquo;
            {name.ok ? name.displayName : "Jake S."}&rdquo;.
          </p>
        </div>
        {!name.ok && firstName.trim() !== "" ? (
          <p className="text-xs text-destructive" role="alert">
            {name.message}
          </p>
        ) : null}
        <div>
          <Label htmlFor="dob">Birthday</Label>
          <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            Sets the safety rules for their age. Never shown publicly, and it can&apos;t be changed
            later without a correction request.
          </p>
          {tooOld ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              That birthday makes them an adult — they can sign up with their own account.
            </p>
          ) : cohort && cohort !== "unknown" ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Age group: {COHORT_META[cohort].label}
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="sport">Sport (optional)</Label>
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
        <div>
          <Label htmlFor="relationship">You are their</Label>
          <select
            id="relationship"
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as GuardianRelationship)}
            className="mt-1 h-10 w-full rounded-xl border border-border bg-surface px-3 text-base text-foreground"
          >
            {GUARDIAN_RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="attest"
              checked={attested}
              onCheckedChange={(v) => setAttested(v === true)}
              className="mt-0.5"
            />
            <label htmlFor="attest" className="text-xs leading-relaxed text-foreground">
              I&apos;m this child&apos;s parent or legal guardian. I agree to the{" "}
              <Link to="/terms" className="font-semibold text-primary underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="font-semibold text-primary underline">
                Privacy Policy
              </Link>{" "}
              on their behalf and give consent for their account.
            </label>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              Their profile starts private, only you can message them, and precise location is never
              shared.{" "}
              <Link to="/safety/children" className="underline">
                How we protect children
              </Link>
            </span>
          </p>
        </div>
      </div>

      <Button className="mt-6 w-full" disabled={!canSubmit} onClick={submit}>
        {saving ? "Adding…" : "Add child"}
      </Button>
      {from === "onboarding" ? (
        // A parent who signed up may want to look around, or add the child later.
        <div className="mt-3 text-center">
          <Link
            to="/parent"
            className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            Skip for now — go to the Parent Center
          </Link>
        </div>
      ) : null}
    </div>
  );
}
