import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ArrowLeft, Check, Plus, Users, Trophy, BarChart3, CreditCard, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { buildProfileRow, validateProfileSafety } from "@/lib/profile-payload";

import {
  useMyProfile,
  setProfileOverrides,
  useFeedPrefs,
  setFeedPrefs,
  DEFAULT_PREFS,
  type ProfileLink,
} from "@/lib/user-prefs-store";
import { useMyOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, useAuth } from "@/hooks/use-auth";
import { Dumbbell } from "lucide-react";

import {
  Section,
  Field,
  Input,
  Toggle,
  validateBirthday,
} from "@/components/profile/ProfileFormPrimitives";
import { ProfileBasicsFields } from "@/components/profile/ProfileBasicsFields";
import { ProfileSportsFields } from "@/components/profile/ProfileSportsFields";
import { ProfileLocationFields } from "@/components/profile/ProfileLocationFields";
import {
  ProfileLinksFields,
  cleanProfileLinks,
  validateProfileUrl,
} from "@/components/profile/ProfileLinksFields";

import { useAutosave } from "@/hooks/use-autosave";
import { useMyProfiles } from "@/lib/account-profiles";
import { SaveStatus } from "@/components/SaveStatus";
import { useMyBirthdayLock } from "@/lib/birthday-lock";

export const Route = createFileRoute("/profile/edit")({
  head: () =>
    pageHead({
      path: "/profile/edit",
      title: "Edit your profile — ballaCity",
      description: "Update your sports, skill levels, photos, location, and links.",
      noindex: true,
    }),
  component: EditProfile,
});

function EditProfile() {
  const { user, loading } = useAuth();
  const queryClient = useQueryClient();
  const myOrgs = useMyOrgs();

  const { data: allGyms = [] } = useQuery({
    queryKey: ["profile-edit", "my-gyms"],
    queryFn: () => listTrainerOrgs({ data: {} }),
    staleTime: 30_000,
  });
  const [confirmedUser, setConfirmedUser] = useState<User | null>(null);
  const profileUser = user ?? confirmedUser;
  const profile = useMyProfile(profileUser);
  const prefs = useFeedPrefs();
  const { active: activeProfile, loading: accountTypeLoading } = useMyProfiles();
  // Date of birth is locked once saved; corrections go through support review.
  const { data: birthdayLock } = useMyBirthdayLock(Boolean(profileUser));
  const showOrgs = !accountTypeLoading && !!activeProfile && activeProfile.kind !== "player";
  const nav = useNavigate();

  const [name, setName] = useState(profile?.name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(profile?.avatarUrl);
  const [coverUrl, setCoverUrl] = useState<string | undefined>(profile?.coverUrl);
  const [city, setCity] = useState(profile?.city ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [birthday, setBirthday] = useState<string>(profile?.birthday ?? "");
  const [graduatingClass, setGraduatingClass] = useState<string>(
    profile?.graduatingClass != null ? String(profile.graduatingClass) : "",
  );
  const [birthdayError, setBirthdayError] = useState<string | null>(null);
  // Location preference: saved search radius, canonical in miles.
  const [searchRadiusMi, setSearchRadiusMi] = useState<number>(
    profile?.searchRadiusMi ?? prefs.maxDistanceMi ?? 25,
  );
  const [sports, setSports] = useState(profile?.sports ?? []);
  const [links, setLinks] = useState<ProfileLink[]>(profile?.links ?? []);
  const [isDirty, setIsDirty] = useState(false);
  const [linksDirty, setLinksDirty] = useState(false);
  const profileSignature = profile
    ? JSON.stringify({
        name: profile.name,
        username: profile.username,
        avatar: profile.avatar,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        city: profile.city,
        bio: profile.bio,
        birthday: profile.birthday,
        graduatingClass: profile.graduatingClass,
        searchRadiusMi: profile.searchRadiusMi,
        sports: profile.sports,
        links: profile.links,
      })
    : "";

  const markDirty = () => setIsDirty(true);

  const [preferredSports, setPreferredSports] = useState<Sport[]>(prefs.preferredSports);

  const toggleSport = (s: Sport) => {
    markDirty();
    setPreferredSports((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  useEffect(() => {
    if (user) setConfirmedUser(user);
  }, [user]);

  useEffect(() => {
    if (!profile || isDirty) return;
    setName(profile.name);
    setUsername(profile.username);
    setAvatar(profile.avatar);
    setAvatarUrl(profile.avatarUrl);
    setCoverUrl(profile.coverUrl);
    setCity(profile.city);
    setBio(profile.bio);
    setBirthday(profile.birthday ?? "");
    setGraduatingClass(profile.graduatingClass != null ? String(profile.graduatingClass) : "");
    if (profile.searchRadiusMi != null) setSearchRadiusMi(profile.searchRadiusMi);
    setSports(profile.sports);
    setLinks(profile.links);
  }, [profileUser?.id, profileSignature, isDirty]);

  useEffect(() => {
    if (loading || profileUser) return;
    let cancelled = false;
    getCurrentUser().then((currentUser) => {
      if (!cancelled && currentUser) setConfirmedUser(currentUser);
      if (!cancelled && !currentUser) setConfirmedUser(null);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, profileUser, nav]);

  if (loading) return null;
  if (!profileUser) {
    return (
      <div className="page-shell-content flex min-h-dvh flex-col items-center justify-center text-center">
        <h1 className="page-title">Sign in to edit your profile</h1>
        <p className="mt-2 page-subtitle">Profile changes are saved to your account.</p>
        <Link
          to="/auth"
          className="mt-6 rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const linkErrors = links.map((l) => validateProfileUrl(l.url));

  const gradNum = graduatingClass.trim() ? parseInt(graduatingClass, 10) : NaN;
  const currentYear = new Date().getFullYear();
  const gradClean =
    Number.isFinite(gradNum) && gradNum >= 1950 && gradNum <= currentYear + 15
      ? gradNum
      : undefined;

  const validate = (): string | null => {
    if (!name.trim()) return "name is required";
    if (linkErrors.some((e) => e !== null)) return "fix your profile links";
    const birthdayErr = validateBirthday(birthday);
    if (birthdayErr) return birthdayErr.toLowerCase();
    if (graduatingClass.trim() && gradClean === undefined) return "graduating class must be a year";
    return null;
  };

  const persist = async () => {
    if (!profileUser) throw new Error("Sign in to save");
    const trimmedName = name.trim().slice(0, 60);
    const cleanedLinks = cleanProfileLinks(links);

    const trimmedCity = city.trim().slice(0, 80);
    const birthdayClean = birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : undefined;
    const initials = (avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3);

    setProfileOverrides(profileUser.id, {
      name: trimmedName,
      username: username.trim().slice(0, 30),
      avatar: initials,
      avatarUrl,
      coverUrl,
      city: trimmedCity,
      bio: bio.trim().slice(0, 280),
      birthday: birthdayClean,
      graduatingClass: gradClean,
      searchRadiusMi,
      sports,
      links: cleanedLinks,
    });
    // Keep the feed's distance filter aligned with the profile preference.
    setFeedPrefs({ ...prefs, preferredSports, maxDistanceMi: searchRadiusMi });

    // Minor-safety: refuse identifying usernames before hitting the database.
    const safetyErr = validateProfileSafety({
      username,
      name: trimmedName,
      birthday: birthdayClean,
    });
    if (safetyErr) {
      toast.error(safetyErr);
      throw new Error(safetyErr);
    }

    // Persist publicly visible fields so other users can see them.
    const { supabase } = await import("@/integrations/supabase/client");
    const profilePayload = buildProfileRow({
      userId: profileUser.id,
      name: trimmedName,
      username,
      avatarInitials: initials,
      bio,
      city: trimmedCity,
      avatarUrl,
      coverUrl,
      birthday: birthdayClean,
      graduatingClass: gradClean,
      searchRadiusMi,
      sports,
      links: linksDirty ? cleanedLinks : undefined,
    });
    const { saveProfileRow } = await import("@/lib/profile-payload");
    await saveProfileRow(supabase, profilePayload);

    // Mirror sports / skill level / location onto my open availability posts.
    const { syncAvailabilitiesFromProfile } = await import("@/lib/availability-sync");
    const syncedPosts = await syncAvailabilitiesFromProfile({
      sports,
      city: trimmedCity,
      searchRadiusMi,
    });
    if (syncedPosts > 0) {
      await queryClient.invalidateQueries({ queryKey: ["my-availabilities"] });
      await queryClient.invalidateQueries({ queryKey: ["availabilities"] });
      toast.success(
        syncedPosts === 1
          ? "Updated your availability post to match"
          : `Updated ${syncedPosts} availability posts to match`,
      );
    }

    // Onboarding skips its write when the fingerprint matches its last save.
    // Clearing it here keeps the two screens in sync: re-entering onboarding
    // after editing here always persists the values it shows.
    try {
      const { onboardingSaveKey } = await import("@/lib/profile-payload");
      localStorage.removeItem(onboardingSaveKey(profileUser.id));
    } catch {
      /* ignore */
    }

    // Same keys onboarding invalidates, so either screen sees fresh values.
    await queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          typeof k === "string" &&
          (k.startsWith("feed") || k.startsWith("games") || k === "profile" || k === "me")
        );
      },
    });
  };

  const autosave = useAutosave({
    value: {
      name,
      username,
      avatar,
      avatarUrl,
      coverUrl,
      city,
      bio,
      birthday,
      graduatingClass,
      searchRadiusMi,
      sports,
      links,
      preferredSports,
    },
    enabled: !!profileUser,
    validate,
    save: persist,
  });

  const done = async () => {
    await autosave.flush();
    nav({ to: "/profile" });
  };

  const reset = () => {
    markDirty();
    setPreferredSports(DEFAULT_PREFS.preferredSports);
  };

  return (
    <div className="page-shell-content pt-6 pb-32">
      <div className="flex items-center justify-between gap-2 mb-5">
        <Link
          to="/profile"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="bar-title">Edit profile</h1>
          <SaveStatus {...autosave} variant="pill" className="mt-1" />
        </div>
        <button
          onClick={done}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
        >
          <Check className="h-3.5 w-3.5" /> Done
        </button>
      </div>

      <Section title="Basics">
        <ProfileBasicsFields
          userId={profileUser?.id}
          value={{
            name,
            username,
            avatar,
            avatarUrl,
            coverUrl,
            city,
            bio,
            birthday,
            graduatingClass,
          }}
          birthdayError={birthdayError}
          birthdayLocked={birthdayLock?.locked === true}
          onChange={(patch) => {
            markDirty();
            if ("name" in patch) setName(patch.name!);
            if ("username" in patch) setUsername(patch.username!);
            if ("avatar" in patch) setAvatar(patch.avatar!);
            if ("avatarUrl" in patch) setAvatarUrl(patch.avatarUrl);
            if ("coverUrl" in patch) setCoverUrl(patch.coverUrl);
            if ("city" in patch) setCity(patch.city!);
            if ("bio" in patch) setBio(patch.bio!);
            if ("birthday" in patch) {
              setBirthday(patch.birthday!);
              setBirthdayError(validateBirthday(patch.birthday!));
            }
            if ("graduatingClass" in patch) setGraduatingClass(patch.graduatingClass!);
          }}
        />
      </Section>

      <Section title="Location preference">
        <ProfileLocationFields
          showCity={false}
          value={{ city, searchRadiusMi }}
          onChange={(patch) => {
            markDirty();
            if ("city" in patch) setCity(patch.city!);
            if ("searchRadiusMi" in patch) setSearchRadiusMi(patch.searchRadiusMi!);
          }}
        />
      </Section>

      <Section title="Sports">
        <ProfileSportsFields
          sports={sports}
          onChange={(next) => {
            markDirty();
            setSports(next);
          }}
        />
      </Section>

      <Section title="Profile links">
        <ProfileLinksFields
          links={links}
          onChange={(next) => {
            markDirty();
            setLinksDirty(true);
            setLinks(next);
          }}
        />
      </Section>

      {showOrgs && (
        <Section
          title="My organizations"
          right={
            <div className="flex items-center gap-1.5">
              <Link
                to="/teams/create"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold hover:border-lime/40"
              >
                <Plus className="h-3 w-3" /> Team
              </Link>
              <Link
                to="/trainers/create"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold hover:border-lime/40"
              >
                <Plus className="h-3 w-3" /> Trainer
              </Link>
              <Link
                to="/orgs/create"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold hover:border-lime/40"
              >
                <Plus className="h-3 w-3" /> Gym
              </Link>
            </div>
          }
        >
          {(() => {
            const myGyms = allGyms.filter((g) => g.owner_id === profileUser?.id);
            const isEmpty = myOrgs.length === 0 && myGyms.length === 0;
            if (isEmpty) {
              return (
                <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-5 text-center">
                  <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime mb-2">
                    <Users className="h-6 w-6" />
                  </div>
                  <div className="font-display text-base font-bold">
                    Start a team, trainer, or gym
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Post tryouts, run pickups, build your following.
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <Link
                      to="/teams/create"
                      className="rounded-2xl bg-lime-gradient py-2.5 text-xs font-bold text-primary-foreground glow-lime"
                    >
                      Team
                    </Link>
                    <Link
                      to="/trainers/create"
                      className="rounded-2xl border border-border bg-surface py-2.5 text-xs font-bold hover:border-lime/40"
                    >
                      Trainer
                    </Link>
                    <Link
                      to="/orgs/create"
                      className="rounded-2xl border border-border bg-surface py-2.5 text-xs font-bold hover:border-lime/40"
                    >
                      Gym
                    </Link>
                  </div>
                </div>
              );
            }
            return (
              <div className="space-y-3">
                {myOrgs.map((o, i) => (
                  <OrgCard key={o.id} org={o} index={i} />
                ))}
                {myGyms.map((g) => {
                  const img = g.cover_url || g.avatar_url || null;
                  const isImg =
                    typeof g.avatar === "string" && /^(https?:\/\/|\/|data:)/i.test(g.avatar);
                  return (
                    <Link
                      key={g.id}
                      to="/orgs/$orgId"
                      params={{ orgId: g.id }}
                      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
                    >
                      <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-lime/15 text-lime">
                        {g.avatar_url ? (
                          <img
                            src={g.avatar_url}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : isImg ? (
                          <img
                            src={g.avatar as string}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : img ? (
                          <img
                            src={img}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <Dumbbell className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-sm truncate">{g.name}</div>
                          <span className="rounded-full bg-lime/15 px-1.5 py-0.5 text-[10px] font-bold text-lime">
                            Gym
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          @{g.handle}
                          {g.city ? ` · ${g.city}` : ""}
                        </div>
                      </div>
                      <div className="text-lime text-xs font-bold">→</div>
                    </Link>
                  );
                })}
              </div>
            );
          })()}
        </Section>
      )}

      <Section title="Reviews">
        <Link
          to="/reviews"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Reviews Hub</div>
            <div className="text-xs text-muted-foreground">
              Trust scores and AI insights across ballaCity
            </div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>
      </Section>

      <Section title="Payments">
        <Link
          to="/payments"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <CreditCard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Payments</div>
            <div className="text-xs text-muted-foreground">
              Manage payout methods & verify player payments
            </div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>
      </Section>

      <Section title="AI Highlight Reels">
        <Link
          to="/reels"
          search={{ game: "", title: "", upload: "" }}
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <Video className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">AI Highlight Reels</div>
            <div className="text-xs text-muted-foreground">3 free, then $15/mo unlimited</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>
      </Section>


      <Section title="Plans & subscriptions">
        <Link
          to="/plans"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <Trophy className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Plans & Subscriptions</div>
            <div className="text-xs text-muted-foreground">Host, Team, Org & Reel plans</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>
      </Section>

      <Section title="Notifications">
        <Link
          to="/account/notifications"
          className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
        >
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-lime/15 text-lime">
            <span className="text-lg">🔔</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm">Notification settings</div>
            <div className="text-xs text-muted-foreground">Push & in-app alerts per type</div>
          </div>
          <div className="text-lime text-xs font-bold">→</div>
        </Link>
      </Section>

      <Section
        title="Feed preferences"
        right={
          <button onClick={reset} className="text-xs font-bold text-coral">
            Reset
          </button>
        }
      >
        <div className="text-xs text-muted-foreground mb-2">Preferred sports (empty = all)</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {SPORTS.map((s) => {
            const active = preferredSports.includes(s.name);
            return (
              <button
                key={s.name}
                onClick={() => toggleSport(s.name)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface"}`}
              >
                <span>{s.emoji}</span>
                {s.name}
              </button>
            );
          })}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Price, distance and “my games” filters now live in the feed's filter sheet, where you can
          also save them as reusable views.
        </p>
      </Section>

      <div className="mt-6 flex items-center justify-between gap-3">
        <SaveStatus {...autosave} variant="pill" />
        <button
          onClick={done}
          className="rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground"
        >
          Done
        </button>
      </div>
    </div>
  );
}
