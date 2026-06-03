import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SPORTS, type Sport } from "@/lib/sample-data";
import {
  useMyProfile,
  setProfileOverrides,
  useFeedPrefs,
  setFeedPrefs,
  DEFAULT_PREFS,
} from "@/lib/user-prefs-store";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/profile/edit")({
  head: () => ({ meta: [{ title: "Edit profile — OpenRun" }] }),
  component: EditProfile,
});

function EditProfile() {
  const { user, loading } = useAuth();
  const profile = useMyProfile();
  const prefs = useFeedPrefs();
  const nav = useNavigate();

  const [name, setName] = useState(profile?.name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [avatar, setAvatar] = useState(profile?.avatar ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [sports, setSports] = useState(profile?.sports ?? []);

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
    if (!loading && !user) {
      nav({ to: "/" });
    }
  }, [loading, user, nav]);

  if (!loading && !user) return null;

  const save = () => {
    if (!user) { toast.error("Sign in to save"); return; }
    const trimmedName = name.trim().slice(0, 60);
    if (!trimmedName) { toast.error("Name is required"); return; }
    setProfileOverrides(user.id, {
      name: trimmedName,
      username: username.trim().slice(0, 30),
      avatar: (avatar.trim() || trimmedName.slice(0, 2)).toUpperCase().slice(0, 3),
      city: city.trim().slice(0, 80),
      bio: bio.trim().slice(0, 280),
      sports,
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
        <Field label="City"><Input value={city} onChange={setCity} maxLength={80} /></Field>
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
