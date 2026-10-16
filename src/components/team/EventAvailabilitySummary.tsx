import { useState } from "react";
import { CalendarCheck, ChevronDown } from "lucide-react";
import {
  AVAILABILITY_LABEL,
  summarizeAvailability,
  type AvailabilityAnswer,
  type AvailabilityStatus,
} from "@/lib/team-availability";

type RosterPerson = { userId: string; name: string; role: string };

/** Mirrors `is_team_manager`; kept local so this view doesn't pull in the Supabase client. */
const STAFF_ROLES = ["owner", "manager", "coach"];

const STATUS_CLASS: Record<AvailabilityStatus, string> = {
  available: "text-lime",
  maybe: "text-amber-500",
  unavailable: "text-coral",
};

/** Players and captains, plus any staff member who answered for this event. */
export function availabilityRoster(members: RosterPerson[], answers: AvailabilityAnswer[]): RosterPerson[] {
  const answered = new Set(answers.map((a) => a.userId));
  return members.filter((m) => !STAFF_ROLES.includes(m.role) || answered.has(m.userId));
}

/** Manager view of who on the roster can make one event. */
export function EventAvailabilitySummary({ members, answers }: { members: RosterPerson[]; answers: AvailabilityAnswer[] }) {
  const [open, setOpen] = useState(false);
  const roster = availabilityRoster(members, answers);
  if (roster.length === 0) return null;
  const summary = summarizeAvailability(roster.map((m) => m.userId), answers);
  const byUser = new Map(answers.map((a) => [a.userId, a]));

  return (
    <div className="text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex flex-wrap items-center gap-2 text-left text-muted-foreground hover:text-foreground">
        <CalendarCheck className="h-4 w-4 shrink-0" />
        <span><span className="text-lime">{summary.available} available</span> · {summary.maybe} maybe · {summary.unavailable} out · {summary.noReply} no reply</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-6">
          {roster.map((m) => {
            const answer = byUser.get(m.userId);
            return (
              <li key={m.userId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-foreground">{m.name}</span>
                <span className={answer ? STATUS_CLASS[answer.status] : "text-muted-foreground"}>
                  {answer ? AVAILABILITY_LABEL[answer.status] : "No reply"}
                  {answer?.byGuardian ? " (guardian)" : ""}
                  {answer?.note ? ` · ${answer.note}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
