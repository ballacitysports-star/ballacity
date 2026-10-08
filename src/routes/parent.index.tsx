import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFamilyPostsEnabled } from "@/lib/reels.functions";
import { getChildPublicXp, setChildPublicXp } from "@/lib/public-xp.functions";
import { GuardianVideoUploadDialog } from "@/components/child/GuardianVideoUploadDialog";
import {
  getChildFamilySharing,
  getChildFamilyView,
  setChildFamilySharing,
  setChildFamilyView,
} from "@/lib/family-clips.functions";
import type { GuardianChild } from "@/lib/child-safety.functions";
import { toast } from "sonner";
import { ShieldCheck, UserPlus, Users } from "lucide-react";
import { pageHead } from "@/lib/seo";
import { useAuth } from "@/hooks/use-auth";
import { useFamilyRoster } from "@/lib/family-roster";
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
import { GuardianApprovalsDashboard } from "@/components/child/GuardianApprovalsDashboard";
import { GuardianProfileCard } from "@/components/child/GuardianProfileCard";
import { FamilyRoster } from "@/components/child/FamilyRoster";
import { UnfinishedChildProfilesPrompt } from "@/components/child/UnfinishedChildProfilesPrompt";
import { useDeleteManagedChild, useSwitchToManagedChild } from "@/lib/use-managed-children";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";

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

const MESSAGING_OPTIONS: Array<{ value: ChildControls["messaging"]; label: string; hint: string }> =
  [
    { value: "off", label: "Off", hint: "No direct messages at all." },
    { value: "guardian_only", label: "Guardians only", hint: "Only you can message them." },
    { value: "teammates", label: "Teammates", hint: "People in the same game or team." },
    { value: "peers", label: "Peers", hint: "Other members their own age." },
  ];

const MEDIA_OPTIONS: Array<{
  value: ChildControls["mediaVisibility"];
  label: string;
  hint: string;
}> = [
  { value: "private", label: "Private", hint: "Only your child and you." },
  { value: "guardian", label: "Guardian review", hint: "You see everything they upload." },
  { value: "teammates", label: "Teammates", hint: "Visible to their game or team only." },
];

/**
 * Offered for ages 13-15 only (the database enforces this too). Reels still stay
 * private until the teen posts them, and are never shown to anonymous visitors.
 */
const MEMBERS_OPTION: (typeof MEDIA_OPTIONS)[number] = {
  value: "members",
  label: "Signed-in members",
  hint: "Reels they choose to post can be seen by signed-in ballaCity members. Never public on the web.",
};

/**
 * Family post: add a private clip of an under-13 child to the parent's own reels.
 * Only shown while the family_posts switch is on. The clip is never public or
 * visible to other members; the database enforces that and the guardian link.
 */
function FamilyPostLink({ child }: { child: GuardianChild }) {
  const fetchEnabled = useServerFn(getFamilyPostsEnabled);
  const { data } = useQuery({
    queryKey: ["family-posts-enabled"],
    queryFn: () => fetchEnabled(),
    staleTime: 60_000,
  });
  const qc = useQueryClient();
  const getViewFn = useServerFn(getChildFamilyView);
  const setViewFn = useServerFn(setChildFamilyView);
  const getShareFn = useServerFn(getChildFamilySharing);
  const setShareFn = useServerFn(setChildFamilySharing);
  const enabled = data?.enabled === true && child.cohort === "child_under_13";
  const { data: sharing } = useQuery({
    queryKey: ["child-family-sharing", child.childUserId],
    queryFn: () => getShareFn({ data: { childUserId: child.childUserId } }),
    enabled,
  });
  const shareRows = [
    {
      kind: "link" as const,
      checked: sharing?.links === true,
      label: "Allow private links",
      hint: "You can send one clip at a time to someone, such as a coach or relative. Links expire and you can turn them off.",
    },
    {
      kind: "team" as const,
      checked: sharing?.team === true,
      label: "Allow sharing with a team",
      hint: "You can let one team that includes them watch a clip. Never anyone under 13.",
    },
  ];
  const { data: view } = useQuery({
    queryKey: ["child-family-view", child.childUserId],
    queryFn: () => getViewFn({ data: { childUserId: child.childUserId } }),
    enabled,
  });
  if (!enabled) return null;
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="text-sm font-semibold">Add a clip of {child.displayName}</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Upload to your own reels and tag it to {child.displayName}. Only you can see it: it never
        appears on the highlights feed, on a profile, or to other members.
      </p>
      {child.controls.aiAnalysis ? (
        <GuardianVideoUploadDialog childUserId={child.childUserId} className="mt-2" />
      ) : (
        <p className="mt-2 text-xs font-semibold text-amber-300">
          Turn on &ldquo;AI video analysis&rdquo; below first. Every clip is analysed by AI.
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold">{child.displayName} can watch these clips</div>
          <p className="text-[11px] text-muted-foreground">
            Read-only, on their own account. They can&apos;t edit, delete or share them.
          </p>
        </div>
        <Switch
          checked={view?.enabled ?? true}
          onCheckedChange={async (v) => {
            try {
              await setViewFn({ data: { childUserId: child.childUserId, enabled: v } });
              await qc.invalidateQueries({ queryKey: ["child-family-view", child.childUserId] });
              toast.success("Setting saved");
            } catch (e: any) {
              toast.error(e?.message ?? "Could not save this setting");
            }
          }}
          aria-label={`${child.displayName} can watch family clips`}
        />
      </div>
      {shareRows.map((row) => (
        <div
          key={row.kind}
          className="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3"
        >
          <div className="min-w-0">
            <div className="text-xs font-semibold">{row.label}</div>
            <p className="text-[11px] text-muted-foreground">{row.hint} Off until you turn it on.</p>
          </div>
          <Switch
            checked={row.checked}
            onCheckedChange={async (v) => {
              try {
                await setShareFn({ data: { childUserId: child.childUserId, kind: row.kind, enabled: v } });
                await qc.invalidateQueries({ queryKey: ["child-family-sharing", child.childUserId] });
                await qc.invalidateQueries({ queryKey: ["family-share-enabled"] });
                await qc.invalidateQueries({ queryKey: ["family-team-share-enabled"] });
                toast.success(v ? "Turned on" : "Turned off, and anything already shared this way has been stopped");
              } catch (e: any) {
                toast.error(e?.message ?? "Could not save this setting");
              }
            }}
            aria-label={`${row.label} for ${child.displayName}`}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Safe public XP: show this child's level, XP bar and milestone badges on their public
 * Player Card. Off until the guardian turns it on. Never shows game dates, venues,
 * streaks, reliability or attendance.
 */
function PublicXpToggle({ child }: { child: GuardianChild }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getChildPublicXp);
  const setFn = useServerFn(setChildPublicXp);
  const { data } = useQuery({
    queryKey: ["child-public-xp", child.childUserId],
    queryFn: () => getFn({ data: { childUserId: child.childUserId } }),
  });
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold">Show {child.displayName}&apos;s level and XP publicly</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Their level, XP bar and milestone badges appear on their Player Card. Never game dates,
          locations, streaks or attendance. Off until you turn it on.
        </p>
      </div>
      <Switch
        checked={data?.enabled === true}
        onCheckedChange={async (v) => {
          try {
            await setFn({ data: { childUserId: child.childUserId, enabled: v } });
            await qc.invalidateQueries({ queryKey: ["child-public-xp", child.childUserId] });
            toast.success(v ? "Level and XP are now public" : "Level and XP are no longer public");
          } catch (e: any) {
            toast.error(e?.message ?? "Could not save this setting");
          }
        }}
        aria-label={`Show ${child.displayName}'s level and XP publicly`}
      />
    </div>
  );
}

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
  const remove = useDeleteManagedChild();
  const switchTo = useSwitchToManagedChild();
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
                : child.managed
                  ? "No approval needed"
                  : "Consent pending"}
            {child.ageReviewRequired ? " · Age under review" : ""}
          </p>
          {child.managed ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Managed by you — no email or password of their own.
            </p>
          ) : null}
        </div>
        {child.managed ? (
          // Everything done after switching is done as the child, under the
          // child's rules — that is what makes acting on their behalf safe.
          <Button
            size="sm"
            className="shrink-0"
            disabled={switchTo.isPending}
            onClick={() =>
              switchTo.mutate(
                { childUserId, childName: child.displayName },
                {
                  onError: (e) =>
                    toast.error(
                      e instanceof Error ? e.message : "Could not switch to that profile",
                    ),
                },
              )
            }
          >
            {switchTo.isPending
              ? "Switching…"
              : `Switch to ${child.displayName.split(" ")[0]}'s profile`}
          </Button>
        ) : null}
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
        <FamilyPostLink child={child} />
        <PublicXpToggle child={child} />
        <OptionRow
          label="Messaging"
          value={c.messaging}
          options={MESSAGING_OPTIONS}
          onChange={(v) => set({ messaging: v })}
        />
        <OptionRow
          label="Video visibility"
          value={c.mediaVisibility}
          options={
            // Keep the option listed if it is already selected (e.g. the teen turned 16).
            child.cohort === "teen_13_15" || c.mediaVisibility === "members"
              ? [...MEDIA_OPTIONS, MEMBERS_OPTION]
              : MEDIA_OPTIONS
          }
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
        <div className="rounded-xl border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Public recruitment profile</span>
            <Switch
              checked={c.publicProfile}
              onCheckedChange={(next) => {
                if (
                  next &&
                  !window.confirm(
                    "As this child's parent/guardian, you consent to showing their player card, stats and highlight videos publicly on the web. Exact location, birthdate and upcoming game venues stay private, and all inquiries come to you. You can turn this off anytime.",
                  )
                )
                  return;
                set({ public_profile: next });
              }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Let coaches, recruiters and scouts view this athlete's player card, stats and
            highlights. Exact location and birthdate stay private, and inquiries go to you — never
            to your child.
          </p>
          <p className="mt-2 text-xs font-semibold">
            Status:{" "}
            <span className={c.publicProfile ? "text-lime" : "text-muted-foreground"}>
              {c.publicProfile ? "Public on the web" : "Private"}
            </span>
          </p>
          {c.publicProfile ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link to="/player-card/$userId" params={{ userId: childUserId }}>
                  View public card
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const url = `${window.location.origin}/player-card/${childUserId}`;
                  navigator.clipboard
                    .writeText(url)
                    .then(() => toast.success("Link copied"))
                    .catch(() => toast.error("Could not copy link"));
                }}
              >
                Copy link
              </Button>
            </div>
          ) : null}
        </div>
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
        {child.managed ? null : (
          <Button size="sm" variant="outline" onClick={() => request("deletion")}>
            Request deletion
          </Button>
        )}
        {child.managed ? (
          // A managed child exists only under this guardian: there is no
          // login to hand back to, and no second adult to re-approve consent,
          // so the way out is deleting the profile — not unlinking it or
          // withdrawing consent, which would leave an account nobody can reach.
          <Button
            size="sm"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              const first = child.displayName.split(" ")[0] ?? child.displayName;
              const typed = window.prompt(
                `This permanently deletes ${child.displayName}'s profile, games, videos and messages. It can't be undone.\n\nType ${first} to confirm.`,
              );
              if (typed === null) return;
              if (typed.trim().toLowerCase() !== first.toLowerCase()) {
                toast.error(`Type ${first} exactly to delete the profile.`);
                return;
              }
              remove.mutate(
                { childUserId },
                {
                  onSuccess: () => toast.success(`${child.displayName}'s profile was deleted.`),
                  onError: (e) =>
                    toast.error(e instanceof Error ? e.message : "Could not delete that profile"),
                },
              );
            }}
          >
            Delete {child.displayName.split(" ")[0]}&apos;s profile
          </Button>
        ) : null}
        {child.managed ? null : (
          <>
            <Button
              size="sm"
              variant="destructive"
              disabled={revoke.isPending || child.consent?.status === "revoked"}
              onClick={() =>
                revoke.mutate(
                  { childUserId, reason: "Withdrawn from the Parent Center" },
                  {
                    onSuccess: () => toast.success("Consent withdrawn and restrictions applied."),
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Could not withdraw"),
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
          </>
        )}
      </div>
    </section>
  );
}

function ParentCenterPage() {
  const { user, loading } = useAuth();
  const { children, isLoading } = useMyChildren();
  const roster = useFamilyRoster();
  const { requests } = useParentRequests();
  const [openChild, setOpenChild] = useState<string | null>(null);
  const selected = openChild ?? children[0]?.childUserId ?? null;

  if (!loading && !user) {
    return (
      <main className="page-shell-content py-10">
        <h1 className="page-title">Parent Center</h1>
        <p className="mt-2 page-subtitle">
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
    <main className="page-shell-content pt-6 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="h-5 w-5" aria-hidden />
          <span className="section-eyebrow">Parent Center</span>
        </div>
        <ProfileSwitcher />
      </div>
      <h1 className="mt-2 page-title">Your family</h1>
      <p className="mt-2 page-subtitle">
        Everyone you manage, who is waiting on you, and their settings — consent, messaging, videos,
        discoverability and data requests. You only ever see information about your own children.
      </p>
      <Link to="/guardian" className="mt-2 inline-block text-xs font-semibold text-primary underline">
        See your kids' teams and games → Guardian Dashboard
      </Link>

      <GuardianProfileCard />
      <GuardianApprovalsDashboard />
      <FamilyApprovalsPanel />

      <section className="mt-5 rounded-2xl border border-primary/40 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="font-display text-sm font-bold">Add a child — no login needed</h2>
        </div>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          Create your child&rsquo;s player profile under your account. They don&rsquo;t need an
          email or password, and every child-safety setting applies from the start.
        </p>
        <Link
          to="/players/add"
          search={{ from: "parent" }}
          className="mt-3 inline-block rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"
        >
          Add your child
        </Link>
      </section>

      <UnfinishedChildProfilesPrompt />

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
      ) : children.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <Users className="h-4 w-4" aria-hidden /> No children yet
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add your child above — they don&rsquo;t need their own login. If your child already has
            an account, invite them with the form below, or open the approval link they send you
            while signed in here.
          </p>
        </div>
      ) : (
        <>
          <FamilyRoster
            needsAction={roster.needsAction}
            approved={roster.approved}
            selected={selected}
            onSelect={setOpenChild}
          />
          {selected ? <ChildPanel key={selected} childUserId={selected} /> : null}
        </>
      )}

      <h2 className="mt-8 section-eyebrow text-muted-foreground">
        Child already has their own login?
      </h2>
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
