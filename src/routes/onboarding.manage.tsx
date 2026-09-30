import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Baby, Building2, Trophy } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { PrimaryCTA } from "@/components/PrimaryCTA";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { canStartAsManager, clearManagerHint } from "@/lib/account-type";
import { useMyAgeStatus } from "@/lib/age-verification";

export const Route = createFileRoute("/onboarding/manage")({
  head: () =>
    pageHead({
      path: "/onboarding/manage",
      title: "What will you manage? — ballaCity",
      description: "Set up your child, a team or a gym. One login covers everything you manage.",
      noindex: true,
    }),
  ssr: false,
  component: ManagePage,
});

/**
 * Where a Parent / Guardian / Owner lands once their account exists.
 *
 * Nothing here creates anything; it only routes, so backing out costs nothing.
 * Each destination is an ordinary signed-in flow (accounts hold several profile
 * kinds, so none of them asks for a particular account type), which is why this
 * screen exists at all: the account is stored as a player, and without it the
 * first thing such a person would see is a player's feed.
 */
const CHOICES = [
  {
    id: "child",
    icon: Baby,
    label: "My child",
    body: "Add a profile you manage from your account. Your child doesn't need an email or password.",
  },
  {
    id: "team",
    icon: Trophy,
    label: "A team",
    body: "Host games and manage the roster.",
  },
  {
    id: "gym",
    icon: Building2,
    label: "A gym",
    body: "Run a gym with trainers and members.",
  },
] as const;

export type ManageChoice = (typeof CHOICES)[number]["id"];

/** Where each answer goes. */
export function destinationForManageChoice(choice: ManageChoice): string {
  switch (choice) {
    case "child":
      return "/players/add";
    case "team":
      return "/teams/create";
    case "gym":
      return "/orgs/create";
  }
}

function ManagePage() {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<ManageChoice | null>(null);
  const { data: ageStatus } = useMyAgeStatus();

  // A child, a team and a gym all need an adult. The server refuses anyone else;
  // this keeps a minor who opens the URL from landing on a dead end. The sign-up
  // hint goes too, or every later landing on "/" would detour through here.
  useEffect(() => {
    if (ageStatus && !canStartAsManager(ageStatus.cohort)) {
      void clearManagerHint();
      navigate({ to: "/feed", replace: true });
    }
  }, [ageStatus, navigate]);

  const leave = (to: string, search?: Record<string, unknown>) => {
    // The sign-up hint has done its job once they have answered (or skipped).
    void clearManagerHint();
    navigate({ to, search, replace: false } as never);
  };

  return (
    <OnboardingShell
      title="What will you manage?"
      description="One login covers everything you manage. You can add more any time, and set up a profile of your own later."
      footer={
        <button
          type="button"
          onClick={() => leave("/feed")}
          className="underline-offset-2 hover:underline"
        >
          Skip for now
        </button>
      }
    >
      <div className="space-y-3">
        {CHOICES.map((c) => {
          const Icon = c.icon;
          const active = choice === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setChoice(c.id)}
              aria-pressed={active}
              className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
                active ? "border-lime bg-lime/5" : "border-border bg-surface hover:border-lime/40"
              }`}
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-lime" />
              <span className="min-w-0">
                <span className="block font-semibold text-foreground">{c.label}</span>
                <span className="block text-sm text-muted-foreground">{c.body}</span>
              </span>
            </button>
          );
        })}
      </div>

      <PrimaryCTA
        className="mt-6"
        disabled={!choice}
        onClick={() => {
          if (!choice) return;
          leave(
            destinationForManageChoice(choice),
            choice === "child" ? { from: "onboarding" } : undefined,
          );
        }}
      >
        Continue
      </PrimaryCTA>
    </OnboardingShell>
  );
}
