import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Plus, X, Users, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { SPORTS, type Sport } from "@/lib/sample-data";
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
import { getCurrentUser, useAuth } from "@/hooks/use-auth";
import { LocationAutocomplete } from "@/components/LocationAutocomplete";
import { LINK_TYPES, LinkIcon } from "@/components/ProfileLinks";


export const Route = createFileRoute("/profile/edit")({
  head: () => ({ meta: [{ title: "Edit profile — OpenRun" }] }),
  component: EditProfile,
});

function EditProfile() {
  const { user, loading } = useAuth();
  const myOrgs = useMyOrgs();
  const [confirmedUser, setConfirmedUser] = useState<User | null>(null);
  const profileUser = user ?? confirmedUser;
  const profile = useMyProfile(profileUser);
  const prefs = useFeedPrefs();
  const nav = useNavigate();

  const [name, setName] = useState(profile?.name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [sports, setSports] = useState(profile?.sports ?? []);
  const [links, setLinks] = useState<ProfileLink[]>(profile?.links ?? []);

  const addLink = (type: ProfileLinkType) => {
    setLinks((prev) => [...prev, { type, url: "" }]);
  };
  const updateLink = (i: number, patch: Partial<ProfileLink>) => {
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const removeLink = (i: number) => setLinks((prev) => prev.filter((_, idx) => idx !== i));


  const [preferredSports, setPreferredSports] = useState<Sport[]>(prefs.preferredSports);
  const [sections, setSections] = useState(prefs.sections);

  const toggleSport = (s: Sport) => {
    setPreferredSports((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };
  const toggleSection = (k: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const addSport = (s: Sport) => {
    if (sports.some((x) => x.name === s)) return;
    setSports([...sports, { name: s, skill: 3 }]);
  };
  const removeSport = (s: Sport) => setSports(sports.filter((x) => x.name !== s));
  const setSkill = (s: Sport, skill: number) =>
    setSports(sports.map((x) => (x.name === s ? { ...x, skill } : x)));

  useEffect(() => {
    if (user) setConfirmedUser(user);
  }, [user]);

  useEffect(() => {
    if (loading || profileUser) return;
    let cancelled = false;
    getCurrentUser().then((currentUser) => {
      if (!cancelled && currentUser) setConfirmedUser(currentUser);
      if (!cancelled && !currentUser) setConfirmedUser(null);
    });
    return () => { cancelled = true; };
  }, [loading, profileUser, nav]);

  if (loading) return null;
  if (!profileUser) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl font-bold">Sign in to edit your profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Profile changes are saved to your account.</p>
        <Link to="/auth" className="mt-6 rounded-full bg-lime-gradient px-6 py-3 text-sm font-bold text-primary-foreground">
          Sign in
        </Link>
      </div>
    );
  }

  const save = () => {
    if (!profileUser) { toast.error("Sign in to save"); return; }
    const trimmedName = name.trim().slice(0, 60);
    if (!trimmedName) { toast.error("Name is required"); return; }
    setProfileOverrides(profileUser.id, {
      name: trimmedName,
      username: username.trim().slice(0, 30),
      avatar: (avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3),
      city: city.trim().slice(0, 80),
      bio: bio.trim().slice(0, 280),
      sports,
      links: links
        .map((l) => ({ ...l, url: l.url.trim(), label: l.label?.trim() || undefined }))
        .filter((l) => l.url),
    });

    setFeedPrefs({ preferredSports, sections });
    toast.success("Profile saved");
    nav({ to: "/profile" });
  };

  const reset = () => {
    setPreferredSports(DEFAULT_PREFS.preferredSports);
    setSections(DEFAULT_PREFS.sections);
  };


  return (
    <div className="mx-auto max-w-md px-4 py-6 pb-32">
      <div className="flex items-center justify-between mb-5">
        <Link to="/profile" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-lg font-bold">Edit profile</h1>
        <button onClick={save} className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground">
          <Check className="h-3.5 w-3.5" /> Save
        </button>
      </div>

      <Section title="Basics">
        <Field label="Display name"><Input value={name} onChange={setName} maxLength={60} /></Field>
        <Field label="Username"><Input value={username} onChange={setUsername} maxLength={30} placeholder="@you" /></Field>
        <Field label="Avatar initials"><Input value={avatar} onChange={setAvatar} maxLength={3} /></Field>
        <Field label="City"><LocationAutocomplete value={city} onChange={setCity} placeholder="Your city" mode="city" /></Field>
        <Field label="Bio">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            rows={3}
            className="w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-lime"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{bio.length}/280</div>
        </Field>
      </Section>

      <Section title="Sports & skill">
        <div className="space-y-2">
          {sports.map((s) => (
            <div key={s.name} className="rounded-2xl border border-border bg-surface p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{s.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-lime font-bold w-12 text-right">{s.skill.toFixed(1)} / 5</span>
                  <button onClick={() => removeSport(s.name)} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <input
                type="range" min={1} max={5} step={0.1} value={s.skill}
                onChange={(e) => setSkill(s.name, parseFloat(e.target.value))}
                className="mt-2 w-full accent-lime"
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <div className="text-xs text-muted-foreground mb-1.5">Add sport</div>
          <div className="flex flex-wrap gap-2">
            {SPORTS.filter((s) => !sports.some((x) => x.name === s.name)).map((s) => (
              <button key={s.name} onClick={() => addSport(s.name)} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:border-lime/40">
                <span>{s.emoji}</span>{s.name}
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
                      <option key={opt.type} value={opt.type}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <button onClick={() => removeLink(i)} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <Input
                value={l.url}
                onChange={(v) => updateLink(i, { url: v })}
                placeholder={LINK_TYPES.find((t) => t.type === l.type)?.placeholder ?? "https://"}
              />
              <div className="mt-2">
                <Input
                  value={l.label ?? ""}
                  onChange={(v) => updateLink(i, { label: v })}
                  maxLength={40}
                  placeholder="Optional label (e.g. @handle)"
                />
              </div>
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
          <Link to="/teams/create" className="inline-flex items-center gap-1 text-xs font-bold text-lime">
            <Plus className="h-3.5 w-3.5" /> New
          </Link>
        }
      >
        {myOrgs.length === 0 ? (
          <Link
            to="/teams/create"
            className="block rounded-3xl border border-dashed border-border bg-surface/40 p-5 text-center hover:border-lime/40"
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-lime/15 text-lime mb-2">
              <Users className="h-6 w-6" />
            </div>
            <div className="font-display text-base font-bold">Start a team or coach profile</div>
            <p className="text-xs text-muted-foreground mt-1">Post tryouts, run pickups, build your following.</p>
          </Link>
        ) : (
          <div className="space-y-3">
            {myOrgs.map((o, i) => <OrgCard key={o.id} org={o} index={i} />)}
          </div>
        )}
      </Section>

      <Section title="Plans & subscriptions">
        <Link to="/plans" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40 transition-colors">
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

      <Section title="Feed preferences" right={<button onClick={reset} className="text-xs font-bold text-coral">Reset</button>}>

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
                <span>{s.emoji}</span>{s.name}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground mb-2">Sections to show</div>
        <div className="space-y-2">
          <Toggle label="Needs players now (urgent)" checked={sections.showUrgent} onChange={() => toggleSection("showUrgent")} />
          <Toggle label='"For you" list' checked={sections.showForYou} onChange={() => toggleSection("showForYou")} />
          <Toggle label="Only games I host" checked={sections.hostedByMeOnly} onChange={() => toggleSection("hostedByMeOnly")} />
          <Toggle label="Only games I joined" checked={sections.joinedOnly} onChange={() => toggleSection("joinedOnly")} />
          <Toggle label="Free games only" checked={sections.freeOnly} onChange={() => toggleSection("freeOnly")} />
          <Toggle label="Paid games only" checked={sections.paidOnly} onChange={() => toggleSection("paidOnly")} />
        </div>
      </Section>

      <button onClick={save} className="mt-6 w-full rounded-full bg-lime-gradient py-3 text-sm font-bold text-primary-foreground">
        Save changes
      </button>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
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

function Input({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-full border border-border bg-surface px-4 py-2 text-sm outline-none focus:border-lime"
    />
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="w-full flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-semibold"
    >
      <span>{label}</span>
      <span className={`h-6 w-10 rounded-full p-0.5 transition-colors ${checked ? "bg-lime" : "bg-secondary"}`}>
        <span className={`block h-5 w-5 rounded-full bg-background transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
    </button>
  );
}
