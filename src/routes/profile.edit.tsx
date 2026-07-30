import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Plus,
  X,
  Users,
  Trophy,
  BarChart3,
  CreditCard,
  Video,
  ExternalLink,
} from "lucide-react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { buildProfileRow } from "@/lib/profile-payload";

import {
  useMyProfile,
  setProfileOverrides,
  useFeedPrefs,
  setFeedPrefs,
  DEFAULT_PREFS,
  type ProfileLink,
  type ProfileLinkType,
} from "@/lib/user-prefs-store";
import { useMyOrgs } from "@/lib/org-store";
import { OrgCard } from "@/components/OrgCard";
import { listTrainerOrgs } from "@/lib/trainer-orgs.functions";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, useAuth } from "@/hooks/use-auth";
import { LINK_TYPES, LinkIcon } from "@/components/ProfileLinks";
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
import { useAutosave } from "@/hooks/use-autosave";
import { useAccountType } from "@/lib/account-type";
import { SaveStatus } from "@/components/SaveStatus";

export const Route = createFileRoute("/profile/edit")({
  head: () => ({ meta: [{ title: "Edit profile — OpenRun" }] }),
  component: EditProfile,
});

function EditProfile() {
  const { user, loading } = useAuth();
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
  const { accountType, loading: accountTypeLoading } = useAccountType();
  const showOrgs = !accountTypeLoading && accountType !== null && accountType !== "player";
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
        sports: profile.sports,
        links: profile.links,
      })
    : "";

  const markDirty = () => setIsDirty(true);


  const addLink = (type: ProfileLinkType) => {
    markDirty();
    setLinksDirty(true);
    setLinks((prev) => [...prev, { type, url: "" }]);
  };
  const updateLink = (i: number, patch: Partial<ProfileLink>) => {
    markDirty();
    setLinksDirty(true);
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeLink = (i: number) => {
    markDirty();
    setLinksDirty(true);
    setLinks((prev) => prev.filter((_, idx) => idx !== i));
  };

  const [preferredSports, setPreferredSports] = useState<Sport[]>(prefs.preferredSports);
  const [sections, setSections] = useState(prefs.sections);

  const toggleSport = (s: Sport) => {
    markDirty();
    setPreferredSports((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };
  const toggleSection = (k: keyof typeof sections) => {
    markDirty();
    setSections((prev) => ({ ...prev, [k]: !prev[k] }));
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
      <div className="mx-auto flex min-h-dvh w-full max-w-md sm:max-w-2xl lg:max-w-4xl flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl font-bold">Sign in to edit your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Profile changes are saved to your account.
        </p>
        <Link
          to="/auth"
          className="mt-6 rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const normalizeUrl = (raw: string): string => {
    const t = raw.trim().replace(/\s+/g, "");
    if (!t) return "";
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    try {
      const u = new URL(withProto);
      u.hostname = u.hostname.toLowerCase();
      if (
        (u.protocol === "https:" && u.port === "443") ||
        (u.protocol === "http:" && u.port === "80")
      ) {
        u.port = "";
      }
      let out = u.toString();
      if (u.pathname === "/" && !u.search && !u.hash) out = out.replace(/\/$/, "");
      return out;
    } catch {
      return withProto;
    }
  };
  const validateUrl = (raw: string): string | null => {
    const t = raw.trim();
    if (!t) return "URL is required";
    if (t.length > 500) return "URL is too long (max 500 chars)";
    if (/\s/.test(t)) return "URL cannot contain spaces";
    let u: URL;
    try {
      u = new URL(normalizeUrl(t));
    } catch {
      return "Enter a valid URL";
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
      return "Must start with http:// or https://";
    const host = u.hostname;
    if (!host || host.length > 253) return "Enter a valid domain";
    if (!/^[a-z0-9.-]+$/i.test(host)) return "Domain has invalid characters";
    if (!host.includes(".")) return "Enter a valid domain (missing .com, .org, etc.)";
    const tld = host.split(".").pop() ?? "";
    if (tld.length < 2 || !/^[a-z]+$/i.test(tld)) return "Enter a valid domain extension";
    if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host))
      return "Use a public website URL";
    return null;
  };
  const linkErrors = links.map((l) => validateUrl(l.url));


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
    const cleanedLinks = links
      .map((l) => ({ ...l, url: normalizeUrl(l.url), label: l.label?.trim() || undefined }))
      .filter((l) => l.url);
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
      sports,
      links: cleanedLinks,
    });
    setFeedPrefs({ ...prefs, preferredSports, sections });

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
      sports,
      links: linksDirty ? cleanedLinks : undefined,
    });
    const { error } = await supabase
      .from("profiles")
      .upsert(profilePayload as any, { onConflict: "id" });
    if (error) throw error;
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
      sports,
      links,
      preferredSports,
      sections,
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
    setSections(DEFAULT_PREFS.sections);
  };

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 py-6 pb-32">
      <div className="flex items-center justify-between gap-2 mb-5">
        <Link
          to="/profile"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="font-display text-lg font-bold leading-tight">Edit profile</h1>
          <SaveStatus {...autosave} className="mt-0.5" />
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
        <p className="text-xs text-muted-foreground mb-2">
          Add links to Perfect Game, PBR, Hudl, socials, or your own site.
        </p>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <LinkIcon type={l.type} className="h-3.5 w-3.5" />
                  <select
                    value={l.type}
                    onChange={(e) => updateLink(i, { type: e.target.value as ProfileLinkType })}
                    className="bg-transparent text-xs font-semibold outline-none"
                  >
                    {LINK_TYPES.map((opt) => (
                      <option key={opt.type} value={opt.type}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => removeLink(i)}
                  className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                value={l.url}
                onChange={(v) => updateLink(i, { url: v })}
                placeholder={LINK_TYPES.find((t) => t.type === l.type)?.placeholder ?? "https://"}
                aria-invalid={linkErrors[i] ? true : undefined}
                className={
                  linkErrors[i] ? "border-destructive focus-visible:ring-destructive" : undefined
                }
              />
              {linkErrors[i] && <p className="mt-1 text-xs text-destructive">{linkErrors[i]}</p>}
              <div className="mt-2">
                <Input
                  value={l.label ?? ""}
                  onChange={(v) => updateLink(i, { label: v })}
                  maxLength={40}
                  placeholder="Optional label (e.g. @handle)"
                />
              </div>
              {!linkErrors[i] &&
                l.url.trim() &&
                (() => {
                  const href = normalizeUrl(l.url);
                  let host = "";
                  let path = "";
                  try {
                    const u = new URL(href);
                    host = u.hostname.replace(/^www\./, "");
                    path = (u.pathname === "/" ? "" : u.pathname) + u.search + u.hash;
                  } catch {
                    /* noop */
                  }
                  const title =
                    l.label?.trim() || (LINK_TYPES.find((t) => t.type === l.type)?.label ?? host);
                  return (
                    <div className="mt-3">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                        Preview
                      </div>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 hover:border-lime/40 transition-colors"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface overflow-hidden">
                          <LinkIcon type={l.type} url={href} className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">{title}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            <span className="font-medium text-foreground/80">{host}</span>
                            {path && <span className="opacity-70">{path}</span>}
                          </div>
                        </div>
                        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </a>
                    </div>
                  );
                })()}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1.5">Add link</div>
          <div className="flex flex-wrap gap-2">
            {LINK_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => addLink(t.type)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40"
              >
                <Plus className="h-3 w-3" /> {t.label}
              </button>
            ))}
          </div>
        </div>
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
                <div className="font-display text-base font-bold">Start a team, trainer, or gym</div>
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
                const isImg = typeof g.avatar === "string" && /^(https?:\/\/|\/|data:)/i.test(g.avatar);
                return (
                  <Link
                    key={g.id}
                    to="/orgs/$orgId"
                    params={{ orgId: g.id }}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors"
                  >
                    <div className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-lime/15 text-lime">
                      {g.avatar_url ? (
                        <img src={g.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : isImg ? (
                        <img src={g.avatar as string} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : img ? (
                        <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />
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
                        @{g.handle}{g.city ? ` · ${g.city}` : ""}
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
              Trust scores and AI insights across OpenRun
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

      <Section title="OpenRun Pro">
        <motion.div
          whileHover={{ scale: 1.01 }}
          className="rounded-3xl border border-coral/40 bg-coral-gradient p-5 text-white relative overflow-hidden"
        >
          <Video className="absolute right-4 top-4 h-16 w-16 opacity-10" />
          <div className="text-xs font-bold uppercase tracking-wider opacity-80">OpenRun Pro</div>
          <h3 className="font-display text-xl font-bold mt-1">
            AI highlight reels, unlimited hosting.
          </h3>
          <p className="text-sm opacity-90 mt-1">
            Cinematic clips from raw gameplay. One-tap export to TikTok & Reels.
          </p>
          <button className="mt-3 rounded-full bg-background px-4 py-2 text-sm font-bold text-foreground">
            Upgrade · $7.99 / mo
          </button>
        </motion.div>
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

        <div className="text-xs text-muted-foreground mb-2">Sections to show</div>
        <div className="space-y-2">
          <Toggle
            label="Needs players now (urgent)"
            checked={sections.showUrgent}
            onChange={() => toggleSection("showUrgent")}
          />
          <Toggle
            label='"For you" list'
            checked={sections.showForYou}
            onChange={() => toggleSection("showForYou")}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Price, distance and “my games” filters now live in the feed's filter sheet, where you can
          also save them as reusable views.
        </p>

      </Section>

      <div className="mt-6 flex items-center justify-between gap-3">
        <SaveStatus {...autosave} />
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



