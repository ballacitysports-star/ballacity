import { Shield, Star, Trophy } from "lucide-react";
import { SPORTS, type Sport } from "@/lib/sample-data";
import { formatSportLevel, type SportLevel } from "@/lib/sport-levels";
import { PlayerPassportSection } from "@/components/players/PlayerPassportSection";

export type PassportSport = { name: Sport; positions?: string[]; level?: SportLevel | null };

type Props = {
  userId: string;
  sports: PassportSport[];
  city?: string;
  /** Age in years; only the coarse "Youth"/"Adult" division is shown. */
  age?: number | null;
  played: number;
  reliability: number;
  sportsmanship: number;
  badgeCount: number;
};

const emojiFor = (name: Sport) => SPORTS.find((s) => s.name === name)?.emoji ?? "🏅";

/**
 * The Athlete Passport header on the owner's profile: sport and position
 * badges, division, reliability and the teams / attendance / runs that
 * `PlayerPassportSection` renders. Stats are the same figures already shown in
 * About; this only gathers them under one identity.
 */
export function AthletePassportCard({
  userId,
  sports,
  city,
  age,
  played,
  reliability,
  sportsmanship,
  badgeCount,
}: Props) {
  const division = age == null ? null : age < 18 ? "Youth" : "Adult";
  const stats = [
    { icon: Trophy, k: played, v: "Played" },
    { icon: Shield, k: `${reliability}%`, v: "Reliable" },
    { icon: Star, k: sportsmanship, v: "Sport" },
  ];

  return (
    <section
      aria-label="Your athlete passport"
      className="mt-5 rounded-2xl border border-border/60 bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-eyebrow text-foreground">Athlete passport</h2>
        <span className="micro-label text-muted-foreground">
          {[division, city].filter(Boolean).join(" · ")}
        </span>
      </div>

      {sports.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Sports">
          {sports.map((s) => {
            const level = formatSportLevel(s.level);
            const detail = [s.positions?.join(", "), level].filter(Boolean).join(" · ");
            return (
              <li
                key={s.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-lime/40 bg-lime/10 px-2.5 py-1 text-xs font-semibold text-foreground"
              >
                <span aria-hidden>{emojiFor(s.name)}</span>
                {s.name}
                {detail && <span className="font-normal text-muted-foreground">{detail}</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Add your sports and positions in Edit profile so runs and teams match you.
        </p>
      )}

      <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
        {stats.map(({ icon: Icon, k, v }) => (
          <div key={v} className="rounded-xl bg-surface-2 py-2">
            <dt className="micro-label flex items-center justify-center gap-1 text-muted-foreground">
              <Icon className="h-3 w-3" aria-hidden /> {v}
            </dt>
            <dd className="font-display text-base font-bold">{k}</dd>
          </div>
        ))}
        <div className="rounded-xl bg-surface-2 py-2">
          <dt className="micro-label text-muted-foreground">Badges</dt>
          <dd className="font-display text-base font-bold">{badgeCount}</dd>
        </div>
      </dl>

      <PlayerPassportSection userId={userId} enabled />
    </section>
  );
}
