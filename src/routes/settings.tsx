import { createFileRoute, Link } from "@tanstack/react-router";
import { BackHeader } from "@/components/layout/BackHeader";
import { pageHead } from "@/lib/seo";
import { AgeReviewNotice } from "@/components/child/AgeReviewNotice";
import { BirthdayLockCard } from "@/components/child/BirthdayLockCard";
import { ParentCenterSection } from "@/components/child/ParentCenterSection";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  IdCard,
  LifeBuoy,
  LogOut,
  Lock,
  Scale,
  ShieldCheck,
  Monitor,
  Moon,
  Pencil,
  Shield,
  ShieldOff,
  Sparkles,
  Sun,
  Trash2,
  UserCog,
  BadgeCheck,
} from "lucide-react";
import { ACCOUNT_TYPE_META } from "@/lib/account-type";
import { useIsGuardianAccount } from "@/components/child/GuardianProfileCard";
import { useMyProfiles } from "@/lib/account-profiles";
import { ProfileSwitcher } from "@/components/ProfileSwitcher";
import { useMyProfile } from "@/lib/user-prefs-store";
import { MyAvatar } from "@/components/UserAvatar";
import {
  AVATAR_VISIBILITY_OPTIONS,
  DEFAULT_AVATAR_VISIBILITY,
  avatarVisibilityLabel,
  useAvatarVisibility,
  type AvatarVisibility,
} from "@/lib/avatar-privacy";
import {
  SettingsGroup,
  SettingsLinkRow,
  SettingsButtonRow,
  SettingsStaticRow,
} from "@/components/settings/SettingsRow";
import type { LucideIcon } from "lucide-react";

import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/lib/theme";
import { listMyOrgs, deleteTrainerOrg } from "@/lib/trainer-orgs.functions";
import { deleteMyAccount } from "@/lib/account.functions";
import { useServerFn } from "@tanstack/react-start";
import { signOut, useAuth } from "@/hooks/use-auth";
import { isManagedUser } from "@/lib/managed-children";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/settings")({
  head: () =>
    pageHead({
      path: "/settings",
      title: "Settings — ballaCity",
      description: "Manage your account, profiles, notifications, privacy, and security settings.",
      noindex: true,
    }),
  component: SettingsHubPage,
});

type Item = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
};

type Section = {
  title: string;
  items: Item[];
};

const SECTIONS: Section[] = [
  {
    title: "Account",
    items: [
      {
        to: "/profile/edit",
        label: "Edit profile",
        description: "Name, photo, bio, and links",
        icon: UserCog,
      },
      {
        to: "/profile",
        label: "My card",
        description: "View your public player card",
        icon: IdCard,
      },
    ],
  },
  {
    title: "Preferences",
    items: [
      {
        to: "/account/notifications",
        label: "Notifications",
        description: "Messages, approvals, join requests",
        icon: Bell,
      },
    ],
  },
  {
    title: "Security",
    items: [
      {
        to: "/account/security",
        label: "Password & sign-in",
        description: "Set or change your password",
        icon: Lock,
      },
      {
        to: "/reset-password",
        label: "Reset password",
        description: "Send a reset link to your email",
        icon: Shield,
      },
    ],
  },
  {
    title: "Plan",
    items: [
      {
        to: "/plans",
        label: "Your plan",
        description: "What your account includes",
        icon: CreditCard,
      },
    ],
  },
  {
    title: "Safety",
    items: [
      {
        to: "/account/blocked",
        label: "Blocked users",
        description: "See who you've blocked and unblock accounts",
        icon: ShieldOff,
      },
      {
        to: "/safety",
        label: "Safety Center",
        description: "Game, meeting, payment, and messaging safety",
        icon: ShieldCheck,
      },
      {
        to: "/trust-center",
        label: "Trust Center",
        description: "Privacy, security, payments, AI, and moderation",
        icon: BadgeCheck,
      },
      {
        to: "/community-guidelines",
        label: "Community Guidelines",
        description: "What's expected of every player and host",
        icon: Scale,
      },
      {
        to: "/contact",
        label: "Contact & report a problem",
        description: "Reach support or report something you saw",
        icon: LifeBuoy,
      },
    ],
  },
  {
    title: "Legal & Privacy",
    items: [
      {
        to: "/account/privacy",
        label: "Privacy",
        description: "Profile & location visibility, messages, delete account",
        icon: Shield,
      },
      {
        to: "/account/ai-privacy",
        label: "AI & Video Privacy",
        description: "How AI analyzes your clips, and delete AI results or videos",
        icon: Sparkles,
      },
      {
        to: "/account/data",
        label: "Your data & retention",
        description: "Download a copy of your data and see how long we keep it",
        icon: Download,
      },
      {
        to: "/account/legal",
        label: "Legal & Privacy",
        description: "Terms, Privacy Policy, and your consent status",
        icon: FileText,
      },
    ],
  },
];

function SettingsHubPage() {
  const [theme, setTheme, , resolved] = useTheme();
  const { user } = useAuth();
  // A managed child has no email or password, so the password screens don't
  // apply — and setting a password there would hand the child a login their
  // guardian never gave them.
  const sections = isManagedUser(user)
    ? SECTIONS.filter((section) => section.title !== "Security")
    : SECTIONS;

  const handleSignOut = async () => {
    try {
      // The shared device-level sign-out: `local` scope (see signOut() in
      // @/hooks/use-auth), unlinks push, clears per-account caches, and ends
      // a parked guardian session too when signing out of a child's profile.
      await signOut();
      toast.success("Signed out");
      window.location.href = "/auth";
    } catch {
      toast.error("Couldn't sign out");
    }
  };

  const themeOptions: Array<{
    value: "light" | "dark" | "system";
    label: string;
    Icon: typeof Sun;
  }> = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Monitor },
  ];

  return (
    <div className="min-h-dvh bg-background pb-24">
      <BackHeader title="Settings" fallbackTo="/profile" />

      <main className="page-shell-content pb-4">
        <AccountIdentityRow />

        <AgeReviewNotice />

        <div className="px-4 pt-2">
          <BirthdayLockCard />
        </div>

        <SettingsGroup title="Appearance">
          <SettingsStaticRow>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
              {themeOptions.map(({ value, label, Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(value)}
                    className={`flex flex-col items-center gap-1.5 rounded-lg px-2 py-3 text-xs font-medium transition ${
                      active
                        ? "bg-surface-2 text-foreground"
                        : "text-muted-foreground hover:bg-surface hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {theme === "system"
                ? `Following your device (currently ${resolved})`
                : `Using ${theme} theme`}
            </p>
          </SettingsStaticRow>
        </SettingsGroup>

        <ParentCenterSection />

        <ProfileIdentitySection />

        <AvatarPrivacySection />

        <MyOrgsSection />

        {sections.map((section) => (
          <SettingsGroup key={section.title} title={section.title}>
            {section.items.map((item) => (
              <SettingsLinkRow
                key={item.to}
                to={item.to}
                icon={item.icon}
                label={item.label}
                description={item.description}
              />
            ))}
          </SettingsGroup>
        ))}

        <SettingsGroup>
          <SettingsButtonRow
            icon={LogOut}
            label="Sign out"
            destructive
            onClick={handleSignOut}
            trailing={null}
          />
          <DeleteAccountButton />
        </SettingsGroup>
      </main>
    </div>
  );
}

/** YouTube's account row: avatar, name, handle, chevron to edit. */
function AccountIdentityRow() {
  const { user } = useAuth();
  const me = useMyProfile(user ?? null);
  if (!user || !me) return null;
  return (
    <div className="border-b border-border">
      <Link
        to="/profile/edit"
        className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface active:bg-surface-2"
      >
        <span className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-lg font-bold">
          {me.avatarUrl ? (
            <img src={me.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            me.avatar
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{me.name}</span>
          <span className="block truncate text-sm text-muted-foreground">{me.username}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </div>
  );
}

function ProfileIdentitySection() {
  // Derived from the active profile so the section follows a profile switch
  // immediately (the account_type read has its own state and would go stale).
  const { active, pendingKind, loading } = useMyProfiles();
  const { isGuardian } = useIsGuardianAccount();
  // An unfinished team/trainer/gym registration has no profile to act as yet;
  // show the type they registered as rather than silently saying "Player".
  const accountType = pendingKind ?? active?.kind ?? null;
  if (loading || !accountType) return null;
  const meta =
    isGuardian && !pendingKind && accountType === "player"
      ? {
          ...ACCOUNT_TYPE_META.player,
          label: "Parent / Guardian",
          emoji: "🛡️",
          blurb: "Manage your children's profiles, approvals and safety settings.",
        }
      : ACCOUNT_TYPE_META[accountType];
  return (
    <SettingsGroup title="Your profiles">
      <SettingsStaticRow>
        <div className="flex items-center gap-4">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-2 text-lg"
            aria-hidden
          >
            {meta.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">
                {pendingKind ? `Registered as ${meta.label}` : `Acting as ${meta.label}`}
              </span>
              {pendingKind ? (
                <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                  Setup incomplete
                </span>
              ) : (
                <BadgeCheck className="h-4 w-4 text-primary" aria-hidden />
              )}
            </div>
            <p className="text-xs text-muted-foreground">{meta.blurb}</p>
          </div>
        </div>
        <div className="mt-3">
          <ProfileSwitcher />
        </div>
        <p className="mt-2.5 text-xs text-muted-foreground">
          Your player profile is always yours. Add team, trainer, and gym profiles and switch
          between them anytime — the whole app follows the profile you pick.
        </p>
      </SettingsStaticRow>
    </SettingsGroup>
  );
}

/** Who can see my profile photo — enforced server-side on every avatar read. */
function AvatarPrivacySection() {
  const { user } = useAuth();
  const { value, saving, update } = useAvatarVisibility();

  if (!user) return null;

  const current = value ?? DEFAULT_AVATAR_VISIBILITY;

  const choose = async (next: AvatarVisibility) => {
    if (next === current) return;
    try {
      await update(next);
      toast.success(`Photo visible to: ${avatarVisibilityLabel(next)}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save privacy setting");
    }
  };

  return (
    <SettingsGroup title="Photo privacy">
      <SettingsStaticRow>
        <div className="flex items-center gap-3 pb-3">
          <MyAvatar size="lg" />
          <div className="min-w-0">
            <div className="text-sm text-foreground">Who can see your profile photo</div>
            <div className="text-xs text-muted-foreground">
              {value === null ? "Loading…" : avatarVisibilityLabel(current)}
            </div>
          </div>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label="Profile photo visibility">
          {AVATAR_VISIBILITY_OPTIONS.map((opt) => {
            const active = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving || value === null}
                onClick={() => void choose(opt.value)}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition disabled:opacity-60 ${
                  active ? "bg-surface-2" : "hover:bg-surface"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                    active ? "border-lime" : "border-border"
                  }`}
                >
                  {active && <span className="h-2 w-2 rounded-full bg-lime" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-foreground">{opt.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Your name and initials stay visible either way, so people can still find and recognize
          you.
        </p>
      </SettingsStaticRow>
    </SettingsGroup>
  );
}

function MyOrgsSection() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: orgs } = useQuery({
    queryKey: ["my-orgs", user?.id ?? "anon"],
    queryFn: () => listMyOrgs(),
    enabled: !!user,
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteTrainerOrg({ data: { id } }),
    onSuccess: () => {
      toast.success("Gym deleted");
      qc.invalidateQueries({ queryKey: ["my-orgs"] });
      qc.invalidateQueries({ queryKey: ["trainer-org-memberships"] });
      qc.invalidateQueries({ queryKey: ["trainer-org"] });
      qc.invalidateQueries({ queryKey: ["orgs-index"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to delete"),
  });

  if (!orgs || orgs.length === 0) return null;

  return (
    <SettingsGroup title="My gyms">
      <ul className="divide-y divide-border">
        {orgs.map((o) => (
          <li key={o.id} className="flex items-center gap-4 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2">
              {o.avatar ? (
                <img src={o.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <Building2 className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{o.name}</span>
              <span className="block truncate text-xs text-muted-foreground">@{o.handle}</span>
            </span>

            <Link
              to="/orgs/$orgId/edit"
              params={{ orgId: o.id }}
              aria-label={`Edit ${o.name}`}
              className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  aria-label={`Delete ${o.name}`}
                  className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {o.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the gym and its memberships. This action cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={del.isPending}
                    onClick={() => del.mutate(o.id)}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {del.isPending ? "Deleting…" : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </li>
        ))}
      </ul>
    </SettingsGroup>
  );
}

export function DeleteAccountButton() {
  const navigate = useNavigate();
  const del = useServerFn(deleteMyAccount);
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // A managed child's profile is deleted by their guardian from the Parent
  // Center (the server refuses it from here too). Covers every place this
  // button is rendered.
  if (isManagedUser(user)) return null;

  const primaryProvider = (user?.app_metadata as { provider?: string } | undefined)?.provider;
  const hasPassword = primaryProvider
    ? primaryProvider === "email"
    : !!user?.identities?.some((i) => i.provider === "email");
  const email = user?.email ?? "";
  const confirmOk = confirm.trim().toUpperCase() === "DELETE";
  const passwordOk = !hasPassword || !!password;
  const canDelete = confirmOk && passwordOk && !busy;
  const blockerHint = !confirmOk
    ? 'Type "DELETE" to confirm'
    : !passwordOk
      ? "Enter your password to confirm"
      : "";

  const onDelete = async () => {
    setBusy(true);
    try {
      if (hasPassword) {
        if (!password) throw new Error("Please enter your password to confirm.");
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error("Incorrect password. Please try again.");
      }
      await del();
      await supabase.auth.signOut();
      toast.success("Your account has been deleted.");
      navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete account");
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setConfirm("");
          setPassword("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface active:bg-surface-2"
        >
          <Trash2 className="h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <span className="flex-1 text-sm text-destructive">Delete account</span>
        </button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your account?</AlertDialogTitle>
          <AlertDialogDescription>
            This action is permanent and cannot be undone. The following data will be permanently
            removed:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
          <ul className="space-y-1.5 text-sm text-foreground">
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Your profile, avatar, cover photo, and bio</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Teams, trainer profiles, and gym pages you own</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Games you've hosted and your participation history</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Messages, comments, posts, and reactions</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Followers, following, blocks, and reports</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Ratings, reviews, and training session requests</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Availability, preferences, and saved locations</span>
            </li>
            <li className="flex gap-2">
              <span aria-hidden>•</span>
              <span>Login credentials and all connected sign-in methods</span>
            </li>
          </ul>
        </div>
        {hasPassword ? (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Re-enter your password for{" "}
              <span className="font-semibold text-foreground">{email}</span>
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Signed in via a social provider. Type DELETE below to confirm.
          </p>
        )}
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">DELETE</span> to confirm
          </label>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDelete}
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Deleting…" : "Permanently delete account"}
          </AlertDialogAction>
        </AlertDialogFooter>
        {blockerHint ? (
          <p className="mt-2 text-right text-xs text-muted-foreground">{blockerHint}</p>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
