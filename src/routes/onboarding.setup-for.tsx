import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { User, Users, UserPlus } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/onboarding/setup-for")({
  head: () =>
    pageHead({
      path: "/onboarding/setup-for",
      title: "Who are you setting up ballaCity for? — ballaCity",
      description:
        "Set up ballaCity for yourself, for your child, or for both. One login covers your whole family.",
      noindex: true,
    }),
  ssr: false,
  component: SetupForPage,
});

/**
 * Step 2 of onboarding: who is this account for?
 *
 * This is the fork that decides whether the account owner gets their own
 * player profile, a child's, or both — and it is the reason a child never
 * needs a login. Nothing here creates anything; it only routes, so backing
 * out costs nothing.
 */
const CHOICES = [
  {
    id: "me",
    icon: User,
    label: "I'm playing",
    body: "Set up your own player profile.",
  },
  {
    id: "child",
    icon: Users,
    label: "I'm setting this up for my child",
    body: "Create a profile you manage. Your child doesn't need their own login.",
  },
  {
    id: "both",
    icon: UserPlus,
    label: "I'm playing and setting it up for my child",
    body: "Start with your profile, then add your child.",
  },
] as const;

type Choice = (typeof CHOICES)[number]["id"];

/** Where each answer goes. `both` starts with the owner and adds a child after. */
export function destinationForSetupChoice(choice: Choice): string {
  return choice === "child" ? "/players/add" : "/onboarding/welcome";
}

function SetupForPage() {
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice | null>(null);

  return (
    <OnboardingShell
      title="Who are you setting up ballaCity for?"
      description="One login covers your whole family. You can add more players any time."
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

      <Button
        className="mt-6 w-full"
        disabled={!choice}
        onClick={() => {
          if (!choice) return;
          // `both` is the owner first; the Add Player prompt follows from the
          // welcome wizard rather than being stacked on top of it here.
          navigate({
            to: destinationForSetupChoice(choice),
            search: choice === "both" ? { addChildNext: true } : undefined,
          } as never);
        }}
      >
        Continue
      </Button>
    </div>
  );
}
