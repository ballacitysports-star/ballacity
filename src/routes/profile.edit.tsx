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
import { SPORTS, POSITIONS_BY_SPORT, type Sport } from "@/lib/sample-data";
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
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { LINK_TYPES, LinkIcon } from "@/components/ProfileLinks";
import { ImageUploader } from "@/components/ImageUploader";
import { Dumbbell } from "lucide-react";

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

  const addSport = (s: Sport) => {
    if (sports.some((x) => x.name === s)) return;
    markDirty();
    setSports([...sports, { name: s, skill: 3 }]);
  };
  const removeSport = (s: Sport) => {
    markDirty();
    setSports(sports.filter((x) => x.name !== s));
  };
  const setSkill = (s: Sport, skill: number) => {
    markDirty();
    setSports(sports.map((x) => (x.name === s ? { ...x, skill } : x)));
  };
  const togglePosition = (s: Sport, pos: string) => {
    markDirty();
    setSports(
      sports.map((x) => {
        if (x.name !== s) return x;
        const cur = x.positions ?? [];
        const next = cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos];
        return { ...x, positions: next };
      }),
    );
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

  function validateBirthday(value: string): string | null {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a valid date (YYYY-MM-DD)";
    const [y, m, day] = value.split("-").map(Number);
    const d = new Date(y, m - 1, day);
    if (
      isNaN(d.getTime()) ||
      d.getFullYear() !== y ||
      d.getMonth() !== m - 1 ||
      d.getDate() !== day
    ) {
      return "Enter a valid date (e.g., 2005-06-15)";
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d > today) return "Birthday cannot be in the future";
    return null;
  }

  const save = async () => {
    if (!profileUser) {
      toast.error("Sign in to save");
      return;
    }
    const trimmedName = name.trim().slice(0, 60);
    if (!trimmedName) {
      toast.error("Name is required");
      return;
    }
    if (linkErrors.some((e) => e !== null)) {
      toast.error("Fix invalid profile links before saving");
      return;
    }
    const cleanedLinks = links
      .map((l) => ({ ...l, url: normalizeUrl(l.url), label: l.label?.trim() || undefined }))
      .filter((l) => l.url);
    const trimmedCity = city.trim().slice(0, 80);
    const birthdayErr = validateBirthday(birthday);
    if (birthdayErr) {
      toast.error(birthdayErr);
      return;
    }
    const birthdayClean = birthday && /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : undefined;
    const gradNum = graduatingClass.trim() ? parseInt(graduatingClass, 10) : NaN;
    const currentYear = new Date().getFullYear();
    const gradClean =
      Number.isFinite(gradNum) && gradNum >= 1950 && gradNum <= currentYear + 15
        ? gradNum
        : undefined;
    if (graduatingClass.trim() && gradClean === undefined) {
      toast.error("Graduating class must be a valid year");
      return;
    }
    setProfileOverrides(profileUser.id, {
      name: trimmedName,
      username: username.trim().slice(0, 30),
      avatar: (avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3),
      avatarUrl,
      coverUrl,
      city: trimmedCity,
      bio: bio.trim().slice(0, 280),
      birthday: birthdayClean,
      graduatingClass: gradClean,
      sports,
      links: cleanedLinks,
    });

    // Persist publicly visible fields to the profiles table so other users can see them
    let syncedToServer = false;
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const profilePayload = {
        id: profileUser.id,
        display_name: trimmedName,
        username: username.trim().replace(/^@/, "").slice(0, 30) || null,
        avatar_initials: (avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3),
        bio: bio.trim().slice(0, 280) || null,
        city: trimmedCity || null,
        avatar_url: avatarUrl ?? null,
        cover_url: coverUrl ?? null,
        birthday: birthdayClean ?? null,
        graduating_class: gradClean ?? null,
        ...(linksDirty ? { links: cleanedLinks as any } : {}),
      };
      const { error } = await supabase
        .from("profiles")
        .upsert(profilePayload as any, { onConflict: "id" });
      if (error) throw error;
      syncedToServer = true;
    } catch (e: any) {
      console.error("Failed to sync profile to server", e);
      toast.error(`Saved locally, but couldn't sync to server: ${e?.message ?? "unknown error"}`);
    }

    setFeedPrefs({ ...prefs, preferredSports, sections });
    if (syncedToServer) toast.success("Profile saved & synced");
    nav({ to: "/profile" });
  };

  const reset = () => {
    markDirty();
    setPreferredSports(DEFAULT_PREFS.preferredSports);
    setSections(DEFAULT_PREFS.sections);
  };

  return (
    <div className="mx-auto w-full max-w-md sm:max-w-2xl lg:max-w-4xl px-4 py-6 pb-32">
      <div className="flex items-center justify-between mb-5">
        <Link
          to="/profile"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-lg font-bold">Edit profile</h1>
        <button
          onClick={save}
          className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground"
        >
          <Check className="h-3.5 w-3.5" /> Save
        </button>
      </div>

      <Section title="Basics">
        <Field label="Cover photo">
          <ImageUploader
            kind="cover"
            bucket="covers"
            pathPrefix={profileUser?.id}
            value={coverUrl ?? ""}
            onChange={(url) => {
              markDirty();
              setCoverUrl(url);
            }}
            onClear={() => {
              markDirty();
              setCoverUrl(undefined);
            }}
          />
        </Field>
        <Field label="Photo">
          <ImageUploader
            kind="avatar"
            bucket="avatars"
            pathPrefix={profileUser?.id}
            value={avatarUrl ?? ""}
            onChange={(url) => {
              markDirty();
              setAvatarUrl(url);
            }}
            onClear={() => {
              markDirty();
              setAvatarUrl(undefined);
            }}
          />
        </Field>
        <Field label="Display name">
          <Input
            value={name}
            onChange={(v) => {
              markDirty();
              setName(v);
            }}
            maxLength={60}
          />
        </Field>
        <Field label="Username">
          <Input
            value={username}
            onChange={(v) => {
              markDirty();
              setUsername(v);
            }}
            maxLength={30}
            placeholder="@you"
          />
        </Field>
        <Field label="Avatar initials (fallback)">
          <Input
            value={avatar}
            onChange={(v) => {
              markDirty();
              setAvatar(v);
            }}
            maxLength={3}
          />
        </Field>
        <Field label="City">
          <LocationAutocomplete
            value={city}
            onChange={(v) => {
              markDirty();
              setCity(v);
            }}
            placeholder="Your city"
            mode="city"
          />
        </Field>
        <Field label="Bio">
          <textarea
            value={bio}
            onChange={(e) => {
              markDirty();
              setBio(e.target.value);
            }}
            maxLength={280}
            rows={3}
            className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{bio.length}/280</div>
        </Field>
        <Field label="Birthday">
          <input
            type="date"
            value={birthday}
            onChange={(e) => {
              markDirty();
              const v = e.target.value;
              setBirthday(v);
              setBirthdayError(validateBirthday(v));
            }}
            max={new Date().toISOString().slice(0, 10)}
            aria-invalid={birthdayError ? true : undefined}
            className={`w-full rounded-2xl border bg-surface px-3 py-2 text-sm outline-none focus:border-lime ${birthdayError ? "border-destructive" : "border-border"}`}
          />
          {birthdayError && <p className="mt-1 text-xs text-destructive">{birthdayError}</p>}
        </Field>
        <Field label="Graduating class">
          <Input
            value={graduatingClass}
            onChange={(v) => {
              markDirty();
              setGraduatingClass(v.replace(/[^0-9]/g, "").slice(0, 4));
            }}
            placeholder={`e.g. ${new Date().getFullYear() + 4}`}
            maxLength={4}
          />
        </Field>
      </Section>

      <Section title="Sports & skill">
        <div className="space-y-2">
          {sports.map((s) => (
            <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{s.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-lime font-bold w-12 text-right">
                    {s.skill.toFixed(1)} / 5
                  </span>
                  <button
                    onClick={() => removeSport(s.name)}
                    className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={0.1}
                value={s.skill}
                onChange={(e) => setSkill(s.name, parseFloat(e.target.value))}
                className="mt-2 w-full accent-lime"
              />
              {POSITIONS_BY_SPORT[s.name]?.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                    Positions
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {POSITIONS_BY_SPORT[s.name].map((pos) => {
                      const active = (s.positions ?? []).includes(pos);
                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => togglePosition(s.name, pos)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            active
                              ? "border-lime bg-lime/15 text-lime"
                              : "border-border bg-background text-muted-foreground hover:border-lime/40 hover:text-foreground"
                          }`}
                        >
                          {pos}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1.5">Add sport</div>
          <div className="flex flex-wrap gap-2">
            {SPORTS.filter((s) => !sports.some((x) => x.name === s.name)).map((s) => (
              <button
                key={s.name}
                onClick={() => addSport(s.name)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40"
              >
                <span>{s.emoji}</span>
                {s.name}
              </button>
            ))}
          </div>
        </div>
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
          </div>
        }
      >
        {myOrgs.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-surface/40 p-5 text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime mb-2">
              <Users className="h-6 w-6" />
            </div>
            <div className="font-display text-base font-bold">Start a team or trainer profile</div>
            <p className="text-xs text-muted-foreground mt-1">
              Post tryouts, run pickups, build your following.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                to="/teams/create"
                className="rounded-2xl bg-lime-gradient py-2.5 text-xs font-bold text-primary-foreground glow-lime"
              >
                Start a team
              </Link>
              <Link
                to="/trainers/create"
                className="rounded-2xl border border-border bg-surface py-2.5 text-xs font-bold hover:border-lime/40"
              >
                Trainer profile
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {myOrgs.map((o, i) => (
              <OrgCard key={o.id} org={o} index={i} />
            ))}
          </div>
        )}
      </Section>

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
          <Toggle
            label="Only games I host"
            checked={sections.hostedByMeOnly}
            onChange={() => toggleSection("hostedByMeOnly")}
          />
          <Toggle
            label="Only games I joined"
            checked={sections.joinedOnly}
            onChange={() => toggleSection("joinedOnly")}
          />
          <Toggle
            label="Free games only"
            checked={sections.freeOnly}
            onChange={() => toggleSection("freeOnly")}
          />
          <Toggle
            label="Paid games only"
            checked={sections.paidOnly}
            onChange={() => toggleSection("paidOnly")}
          />
        </div>
      </Section>

      <button
        onClick={save}
        className="mt-6 w-full rounded-full bg-lime-gradient py-3 text-sm font-bold text-primary-foreground"
      >
        Save changes
      </button>
    </div>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {right}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  ...rest
}: { value: string; onChange: (v: string) => void } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-lime"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
    >
      <span>{label}</span>
      <span
        className={`h-6 w-10 rounded-full p-0.5 transition-colors ${checked ? "bg-lime" : "bg-secondary"}`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-background transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}


