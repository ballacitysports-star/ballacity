import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Calendar, MapPin, Users, DollarSign, Lock, Home } from "lucide-react";
import { SPORTS, type Sport } from "@/lib/sample-data";

export const Route = createFileRoute("/_tabs/create")({
  head: () => ({ meta: [{ title: "Host a game — OpenRun" }] }),
  component: Create,
});

function Create() {
  const nav = useNavigate();
  const [sport, setSport] = useState<Sport>("Basketball");
  const [skill, setSkill] = useState("All Levels");
  const [size, setSize] = useState(10);
  const [price, setPrice] = useState(0);
  const [indoor, setIndoor] = useState(false);
  const [priv, setPriv] = useState(false);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/feed" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Host a game</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          nav({ to: "/feed" });
        }}
        className="space-y-5"
      >
        {/* Sport */}
        <Section title="Sport">
          <div className="grid grid-cols-3 gap-2">
            {SPORTS.map((s) => {
              const active = sport === s.name;
              return (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => setSport(s.name)}
                  className={`flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-semibold transition-all ${
                    active ? "border-lime bg-lime/10 text-lime" : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  <span className="text-2xl">{s.emoji}</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {/* Title */}
        <Section title="Game title">
          <input
            required
            placeholder="Friday Night Run · 5v5 Full Court"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime"
          />
        </Section>

        {/* Date + Location */}
        <Section title="When & where" icon={<Calendar className="h-4 w-4" />}>
          <input
            type="datetime-local"
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
          />
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3">
            <MapPin className="h-4 w-4 text-coral" />
            <input
              placeholder="Court, park or venue"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </Section>

        {/* Skill */}
        <Section title="Skill level">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {["All Levels", "Beginner", "Intermediate", "Advanced"].map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setSkill(s)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${
                  skill === s ? "border-lime bg-lime text-primary-foreground" : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Section>

        {/* Players */}
        <Section title="Max players" icon={<Users className="h-4 w-4" />}>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">Total spots</span>
              <span className="font-display text-2xl font-bold text-lime">{size}</span>
            </div>
            <input
              type="range"
              min={2}
              max={30}
              value={size}
              onChange={(e) => setSize(+e.target.value)}
              className="w-full accent-lime"
            />
          </div>
        </Section>

        {/* Toggles */}
        <Section title="Details">
          <Toggle
            icon={<DollarSign className="h-4 w-4" />}
            label="Paid game"
            value={price > 0}
            onChange={(v) => setPrice(v ? 10 : 0)}
            right={price > 0 ? `$${price}` : "Free"}
          />
          <Toggle
            icon={<Home className="h-4 w-4" />}
            label="Indoor venue"
            value={indoor}
            onChange={setIndoor}
          />
          <Toggle
            icon={<Lock className="h-4 w-4" />}
            label="Private (invite only)"
            value={priv}
            onChange={setPriv}
          />
        </Section>

        {/* Description */}
        <Section title="Description">
          <textarea
            rows={4}
            placeholder="Format, vibe, what to bring..."
            className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-lime resize-none"
          />
        </Section>

        <motion.button
          whileTap={{ scale: 0.98 }}
          type="submit"
          className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground glow-lime"
        >
          Publish game
        </motion.button>
        <p className="text-center text-xs text-muted-foreground pb-6">
          Hosting is free. Pro hosts get unlimited games + analytics.
        </p>
      </form>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {icon}{title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Toggle({
  icon, label, value, onChange, right,
}: { icon: React.ReactNode; label: string; value: boolean; onChange: (v: boolean) => void; right?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3 text-sm"
    >
      <span className="flex items-center gap-2.5">
        <span className={value ? "text-lime" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{label}</span>
      </span>
      <span className="flex items-center gap-2">
        {right && <span className="text-xs text-muted-foreground">{right}</span>}
        <span className={`relative h-6 w-10 rounded-full transition-colors ${value ? "bg-lime" : "bg-secondary"}`}>
          <motion.span
            layout
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute top-0.5 h-5 w-5 rounded-full bg-background shadow"
            style={{ left: value ? "calc(100% - 1.375rem)" : "0.125rem" }}
          />
        </span>
      </span>
    </button>
  );
}
