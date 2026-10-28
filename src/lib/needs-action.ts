/**
 * "What needs me now": the few things waiting on the signed-in member, in the
 * order that matters. Pure, so what is shown (and what is left out) can be tested.
 * Counts come from queries the member's own access already allows; nothing here
 * widens what anyone can see.
 */
export type TodayGame = {
  id: string;
  title: string;
  startsAt: string;
  role: "host" | "player";
};

export type NeedsActionInput = {
  /** Pending join requests on the member's own live games, oldest first. */
  hostRequests: { count: number; oldestGameId: string | null; oldestGameTitle: string | null };
  unreadMessages: number;
  messageRequests: number;
  /** Games the member hosts or has joined that start within the day, soonest first. */
  gamesToday: readonly TodayGame[];
};

export type NeedsActionItem = {
  id: "host-requests" | "today" | "messages";
  label: string;
  detail: string | null;
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  tone: "urgent" | "info";
};

/** Most rows the strip ever shows, so it stays a glance, not a second inbox. */
export const MAX_NEEDS_ACTION_ITEMS = 4;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatStartTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? time : `Tomorrow ${time}`;
}

export function buildNeedsAction(
  input: NeedsActionInput,
  now: Date = new Date(),
): NeedsActionItem[] {
  const items: NeedsActionItem[] = [];

  const { hostRequests } = input;
  if (hostRequests.count > 0) {
    items.push({
      id: "host-requests",
      label: plural(hostRequests.count, "join request to answer", "join requests to answer"),
      detail: hostRequests.oldestGameTitle,
      ...(hostRequests.oldestGameId
        ? { to: "/games/$gameId", params: { gameId: hostRequests.oldestGameId } }
        : { to: "/feed" }),
      tone: "urgent",
    });
  }

  const [next, ...later] = input.gamesToday;
  if (next) {
    const when = formatStartTime(next.startsAt, now);
    const role = next.role === "host" ? "hosting" : "you're in";
    items.push({
      id: "today",
      label: next.title,
      detail:
        [when, role].filter(Boolean).join(" · ") +
        (later.length > 0 ? ` · +${plural(later.length, "more game", "more games")}` : ""),
      to: "/games/$gameId",
      params: { gameId: next.id },
      tone: "info",
    });
  }

  const messageParts: string[] = [];
  if (input.unreadMessages > 0) {
    messageParts.push(plural(input.unreadMessages, "unread message", "unread messages"));
  }
  if (input.messageRequests > 0) {
    messageParts.push(plural(input.messageRequests, "message request", "message requests"));
  }
  if (messageParts.length > 0) {
    items.push({
      id: "messages",
      label: messageParts.join(" · "),
      detail: null,
      to: "/messages",
      search: { tab: "messages" },
      tone: input.messageRequests > 0 ? "urgent" : "info",
    });
  }

  return items.slice(0, MAX_NEEDS_ACTION_ITEMS);
}
