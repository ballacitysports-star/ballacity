import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Users } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import {
  useChildFootprint,
  useMyChildren,
  useParentRequests,
  useRevokeChildConsent,
  useRevokeGuardianLink,
  useUpdateChildControls,
} from "@/lib/child-safety";
import { CHILD_POLICY_DISCLAIMER, COHORT_META, type ChildControls } from "@/lib/child-policy";
import { formatRelativeDay } from "@/lib/datetime";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConsentTrail } from "@/components/child/ConsentTrail";
import { AddMinorPanel } from "@/components/child/AddMinorPanel";
import { FamilyActivityLog } from "@/components/child/FamilyActivityLog";
import { FamilyApprovalsPanel } from "@/components/child/FamilyApprovalsPanel";
import { FamilyChildSwitcher } from "@/components/child/FamilyChildSwitcher";


export const Route = createFileRoute("/parent/")({
  head: () =>
    pageHead({
      path: "/parent",
      title: "Parent Center — ballaCity",
      description:
        "Manage your child's ballaCity account: messaging, video visibility, discoverability, data requests and consent.",
      noindex: true,
    }),
  ssr: false,
  component: ParentCenterPage,
});

const MESSAGING_OPTIONS: Array<{ value: ChildControls["messaging"]; label: string; hint: string }> = [
  { value: "off", label: "Off", hint: "No direct messages at all." },
  { value: "guardian_only", label: "Guardians only", hint: "Only you can message them." },
  { value: "teammates", label: "Teammates", hint: "People in the same game or team." },
  { value: "peers", label: "Peers", hint: "Other members their own age." },
];

const MEDIA_OPTIONS: Array<{ value: ChildControls["mediaVisibility"]; label: string; hint: string }> =
  [
    { value: "private", label: "Private", hint: "Only your child and you." },
    { value: "guardian", label: "Guardian review", hint: "You see everything they upload." },
    { value: "teammates", label: "Teammates", hint: "Visible to their game or team only." },
  ];

function OptionRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; hint: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">{label}</div>
      <div className="grid gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-xl border px-3 py-2 text-left text-xs ${
              value === o.value ? "border-primary bg-primary/10" : "border-border bg-surface"
            }`}
          >
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="text-muted-foreground">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChildPanel({ childUserId }: { childUserId: string }) {
  const { children } = useMyChildren();
  const child = children.find((c) => c.childUserId === childUserId);
  const update = useUpdateChildControls();
  const revoke = useRevokeChildConsent();
  const unlink = useRevokeGuardianLink();
  const footprint = useChildFootprint(childUserId);
  const { submit } = useParentRequests();
  if (!child) return null;
  const c = child.controls;

  const set = (controls: Record<string, string | boolean>) => {
    update.mutate(
      { childUserId, controls },
      {
        onSuccess: () => toast.success("Setting saved"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  };

  const request = (kind: "access" | "correction" | "deletion") => {
    submit.mutate(
      { childUserId, kind },
      {
        onSuccess: () => toast.success("Request submitted — we'll confirm by email."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not submit"),
      },
    );
  };

  return (
    <section
      className="mt-4 rounded-2xl border border-border bg-surface p-4"
      id={`child-panel-${childUserId}`}
      role={children.length > 1 ? "tabpanel" : undefined}
      aria-labelledby={children.length > 1 ? `child-tab-${childUserId}` : undefined}
      tabIndex={-1}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-lg font-bold">{child.displayName}</h2>
          <p className="text-xs text-muted-foreground">
            {COHORT_META[child.cohort].label} ·{" "}
            {child.consent?.status === "approved"
              ? "Consent approved"
              : child.consent?.status === "revoked"
                ? "Consent withdrawn"
                : "Consent pending"}
            {child.ageReviewRequired ? " · Age under review" : ""}
          </p>
        </div>
      </header>

      <div className="mt-3 rounded-xl border border-border bg-background p-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span>
            Teams: <span className="font-semibold text-foreground">{child.teamCount}</span>
          </span>
          <span>
            Upcoming games:{" "}
            <span className="font-semibold text-foreground">{child.upcomingGames}</span>
          </span>
        </div>
        {child.nextGame ? (
          <p className="mt-1">
            Next up: <span className="font-semibold">{child.nextGame.title ?? "Game"}</span>{" "}
            {formatRelativeDay(child.nextGame.at)}
          </p>
        ) : (
          <p className="mt-1">No upcoming games scheduled.</p>
        )}
      </div>


      {footprint.data ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          {[
            ["Videos", footprint.data.reels],
            ["Games", footprint.data.games],
            ["Chats", footprint.data.conversations],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-background p-2">
              <div className="text-base font-bold tabular-nums">{String(value)}</div>
              <div className="text-muted-foreground">{String(label)}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 grid gap-4">
        <OptionRow
          label="Messaging"
          value={c.messaging}
          options={MESSAGING_OPTIONS}
          onChange={(v) => set({ messaging: v })}
        />
        <OptionRow
          label="Video visibility"
          value={c.mediaVisibility}
          options={MEDIA_OPTIONS}
          onChange={(v) => set({ media_visibility: v })}
        />
        {[
          ["Discoverable by other members", "social_discovery", c.socialDiscovery],
          ["AI video analysis", "ai_analysis", c.aiAnalysis],
          ["Can join games", "game_participation", c.gameParticipation],
          ["Notifications", "notifications", c.notifications],
          [
            "Allow overnight notifications",
            "notification_curfew_lifted",
            c.notificationCurfewLifted,
          ],
        ].map(([label, key, value]) => (
          <div key={String(key)} className="flex items-center justify-between gap-3">
            <span className="text-sm">{String(label)}</span>
            <Switch
              checked={value as boolean}
              onCheckedChange={(next) => set({ [String(key)]: next })}
            />
          </div>
        ))}
        <div className="rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
          Overnight notifications are off by default: between midnight and 6am in their local time
          we hold push alerts until morning. The alert still appears in the app straight away.
        </div>
        <div className="rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
          Precise location is never shared for a child account — only a general city, and venue
          details only with the host and participants of a game they join.
        </div>
      </div>
      <ConsentTrail childUserId={childUserId} />
      <FamilyActivityLog childUserId={childUserId} />

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => request("access")}>
          Request a copy of their data
        </Button>
        <Button size="sm" variant="outline" onClick={() => request("correction")}>
          Request a correction
        </Button>
        <Button size="sm" variant="outline" onClick={() => request("deletion")}>
          Request deletion
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={revoke.isPending || child.consent?.status === "revoked"}
          onClick={() =>
            revoke.mutate(
              { childUserId, reason: "Withdrawn from the Parent Center" },
              {
                onSuccess: () => toast.success("Consent withdrawn and restrictions applied."),
                onError: (e) => toast.error(e instanceof Error ? e.message : "Could not withdraw"),
              },
            )
          }
        >
          Withdraw consent
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={unlink.isPending}
          onClick={() => {
            const ok = window.confirm(
              `End your family link with ${child.displayName}? You will no longer manage their settings, and your consent for their account is withdrawn.`,
            );
            if (!ok) return;
            unlink.mutate(
              { childUserId, reason: "Guardian ended the link from the Parent Center" },
              {
                onSuccess: () => toast.success("Family link ended."),
                onError: (e) =>
                  toast.error(e instanceof Error ? e.message : "Could not end that link"),
              },
            );
          }}
        >
          End family link
        </Button>
      </div>

    </section>
  );
}

function ParentCenterPage() {
  const { user, loading } = useAuth();
  const { children, isLoading } = useMyChildren();
  const { requests } = useParentRequests();
  const [openChild, setOpenChild] = useState<string | null>(null);
  const selected = openChild ?? children[0]?.childUserId ?? null;

  if (!loading && !user) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-10">
        <h1 className="font-display text-2xl font-bold">Parent Center</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your adult account to manage a child&rsquo;s ballaCity account.
        </p>
        <Link
          to="/auth"
          className="mt-4 inline-block rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 pb-24">
      <div className="flex items-center gap-2 text-primary">
        <ShieldCheck className="h-5 w-5" aria-hidden />
        <span className="text-xs font-bold uppercase tracking-wide">Parent Center</span>
      </div>
      <h1 className="mt-2 font-display text-2xl font-bold">Your child&rsquo;s account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Manage consent, messaging, videos, discoverability and data requests. You only ever see
        information about your own child.
      </p>

      <FamilyApprovalsPanel />

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" aria-hidden /> No linked child accounts
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            When your child asks for approval, open the link they send you and approve it while
            signed in here. Their account then appears in this Parent Center. You can also invite a
            minor yourself with the form below.
          </p>
        </div>
      ) : (
        <>
          <FamilyChildSwitcher
            children={children}
            selected={selected}
            onSelect={setOpenChild}
          />
          {selected ? <ChildPanel key={selected} childUserId={selected} /> : null}
        </>

      )}

      <AddMinorPanel />

      {requests.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-bold">Your requests</h2>
          <ul className="mt-2 space-y-2 text-xs">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="capitalize">{r.kind.replace("_", " ")}</span>
                <span className="text-muted-foreground">{r.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3 text-xs">
        <Link to="/safety/children" className="font-semibold text-primary underline">
          Child &amp; teen safety
        </Link>
        <Link to="/privacy" className="font-semibold text-primary underline">
          Privacy Policy
        </Link>
        <Link to="/contact" className="font-semibold text-primary underline">
          Contact support
        </Link>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {CHILD_POLICY_DISCLAIMER}
      </p>
    </main>
  );
}
