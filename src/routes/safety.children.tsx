import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/seo";
import {
  CHILD_POLICY_DISCLAIMER,
  COHORT_META,
  FEATURE_KEYS,
  FEATURE_META,
  PERMISSION_MATRIX,
  type PermissionLevel,
} from "@/lib/child-policy";

export const Route = createFileRoute("/safety/children")({
  head: () =>
    pageHead({
      path: "/safety/children",
      title: "Child & teen safety — OpenRun",
      description:
        "How OpenRun protects members under 13 and teens: parental consent, generalized location, messaging limits, private videos, reporting and data deletion.",
    }),
  component: ChildSafetyCenter,
});

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  allowed: "Standard",
  protected: "Protected",
  parent_controlled: "Parent-controlled",
  restricted: "Restricted",
  blocked: "Off",
  never: "Never",
};

const SECTIONS = [
  {
    title: "Parent or guardian approval",
    body: "Members under 13 can use OpenRun, but only after a parent or guardian approves the account. Before approval we collect only a name or nickname, a private date of birth, and the guardian's email — nothing else. Games, messaging, videos and profiles stay switched off, enforced on our servers rather than only in the app.",
  },
  {
    title: "Location safety",
    body: "A child's precise location is never shared or shown publicly. Profiles show a general city at most. Game venue details are shared with the host and the people playing, and never reveal where a child lives.",
  },
  {
    title: "Messaging safety",
    body: "Unknown adults cannot message an under-13 member. Adults can only message a 13–15 member when they already share a game or conversation. A guardian can narrow messaging to teammates, to guardians only, or turn it off completely.",
  },
  {
    title: "Video and AI",
    body: "A child's highlight videos are private by default and are never automatically public or searchable. AI video analysis is off for child accounts until a guardian turns it on, and children's information is not used to train AI models.",
  },
  {
    title: "No advertising to children",
    body: "OpenRun does not use children's or teens' information for targeted or behavioural advertising, and does not run session-replay tracking on minor accounts.",
  },
  {
    title: "Reporting and blocking",
    body: "Any member — child, teen or guardian — can report a person, game, message, comment or video, and block someone, from the screen where it happened. Reports about unsafe adult behaviour toward a minor go to moderation with priority handling.",
  },
  {
    title: "Deleting information",
    body: "A guardian can request a copy of their child's information, ask for corrections, withdraw consent, or ask us to delete the account. Withdrawing consent immediately turns messaging off, hides videos and availability, and makes the profile private.",
  },
  {
    title: "Not an emergency service",
    body: "OpenRun is not an emergency service and does not supervise games. In an emergency contact local emergency services. Hosts are responsible for venue safety and participants are responsible for their own readiness to play.",
  },
];

function ChildSafetyCenter() {
  const cohorts = ["child_under_13", "teen_13_15", "teen_16_17", "adult"] as const;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 pb-24">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-wide">Safety Center</span>
      </div>
      <h1 className="mt-2 font-display text-3xl font-bold">Child &amp; teen safety</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        OpenRun supports players under 13, teens and adults — with a different, age-appropriate
        experience for each. Here is exactly how that works and what parents and guardians control.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 text-xs">
        <Link
          to="/parent"
          className="rounded-full bg-primary px-4 py-2 font-bold text-primary-foreground"
        >
          Parent Center
        </Link>
        <Link to="/safety" className="rounded-full border border-border px-4 py-2 font-semibold">
          Safety Center
        </Link>
        <Link to="/privacy" className="rounded-full border border-border px-4 py-2 font-semibold">
          Privacy Policy
        </Link>
        <Link to="/contact" className="rounded-full border border-border px-4 py-2 font-semibold">
          Contact support
        </Link>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s.title} className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-bold">{s.title}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
          </section>
        ))}
      </div>

      <h2 className="mt-8 font-display text-xl font-bold">What each age group can do</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="bg-surface">
            <tr>
              <th scope="col" className="px-3 py-2 font-bold">
                Feature
              </th>
              {cohorts.map((c) => (
                <th key={c} scope="col" className="px-3 py-2 font-bold">
                  {COHORT_META[c].short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURE_KEYS.map((f) => (
              <tr key={f} className="border-t border-border">
                <th scope="row" className="px-3 py-2 font-medium">
                  {FEATURE_META[f].label}
                </th>
                {cohorts.map((c) => (
                  <td key={c} className="px-3 py-2 text-muted-foreground">
                    {LEVEL_LABEL[PERMISSION_MATRIX[f][c]]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        {CHILD_POLICY_DISCLAIMER}
      </p>
    </main>
  );
}
