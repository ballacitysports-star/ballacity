import { Info } from "lucide-react";

/** Plain-language "how is this calculated" for reputation and skill ratings. */
export function RatingExplainer({ className = "" }: { className?: string }) {
  return (
    <details className={`rounded-2xl border border-border bg-surface p-3 text-sm ${className}`}>
      <summary className="flex cursor-pointer items-center gap-1.5 font-semibold">
        <Info className="h-4 w-4" /> How ratings work
      </summary>
      <div className="mt-3 space-y-3 text-xs leading-relaxed text-muted-foreground">
        <section>
          <h3 className="font-bold text-foreground">Reputation (conduct)</h3>
          <p>
            Only people who actually played, trained or teamed up with someone can review them,
            within 14 days of a game, and the role shown on a review (player or host) comes from
            that game, not from the reviewer. Reviews older than a month gradually count for less,
            repeat reviews from the same person count less each time, and a review whose stars
            clearly contradict its own words counts for half.
          </p>
          <p className="mt-2">
            Reviews ask one headline question (would you do this with them again?), three quick yes
            / mostly / no questions about behaviour, and let you tap up to five praise tags. Showing
            up, lateness and cancellations aren't asked about: the app tracks those itself and shows
            them as "Tracked automatically". If you answer "No" to a safety question, it also goes
            privately to our moderators.
          </p>
          <p className="mt-2">
            The trust score is a cautious estimate: the low end of what the star ratings so far
            suggest. It starts out modest, climbs as consistent good reviews come in, and a poor
            review always pulls it down. Profiles show "New" until their first review and
            "Provisional" while there are only a few. Levels need both a score and enough recent
            reviews: Rising needs 3, Pro 5, Elite 15 and Legend 40.
          </p>
        </section>
        <section>
          <h3 className="font-bold text-foreground">Skill rating (adults only)</h3>
          <p>
            Skill is shown as a range on your sport's own scale. It starts from the level you chose
            yourself, then moves with anonymous "below / about right / above this game's level"
            votes from people you played with and with Pro Analytics scores from your highlight
            clips. Each source counts in proportion to how reliable and recent it is. Skill and
            conduct are kept separate: one never changes the other.
          </p>
        </section>
        <section>
          <h3 className="font-bold text-foreground">Where AI is used</h3>
          <p>
            AI checks review text before it posts, tags traits like fair play, writes the summary
            and scouting report, and can draft wording from points you tap. AI is never the one
            deciding who can review whom or what your number is — those are fixed rules. AI features
            for reviews are adults-only and respect your AI privacy settings.
          </p>
        </section>
        <section>
          <h3 className="font-bold text-foreground">Disagree with something?</h3>
          <p>
            Report a review from its card and our moderators will look. You can hide your skill
            rating from others at any time.
          </p>
        </section>
      </div>
    </details>
  );
}
