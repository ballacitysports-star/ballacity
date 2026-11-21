import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { removalMessage } from "@/lib/discovery/review.server";
import { entityFollowErrorMessage } from "@/lib/entity-follows";
import { FEATURED_LIMIT_MESSAGE } from "@/lib/featured-orgs";
import { followErrorMessage } from "@/lib/follows";
import { joinGateErrorMessage } from "@/lib/game-status";
import { listingErrorMessage } from "@/lib/listings";
import { postErrorMessage } from "@/lib/network-posts-rules";
import { teamChatErrorMessage } from "@/lib/team-chat";
import { USER_ERROR_MESSAGES, paymentSubmissionErrorMessage } from "@/lib/user-error";
import { venueEventErrorMessage } from "@/lib/venue-events";

/**
 * WP 4.0 review: the feature mappers whose results are toasted or rethrown by a server function used to pass any
 * error they did not know through word for word. What Postgres, PostgREST, the gateway, Cloudflare, the browser and
 * a server function's input check write when something breaks, each of which used to reach a member that way.
 */
const FAILURE_TEXTS = [
  "TypeError: Failed to fetch",
  "Load failed",
  "JWT expired",
  'new row violates row-level security policy for table "event_registrations"',
  "permission denied for function follow_entity",
  "Could not find the function public.register_for_event(_event) in the schema cache",
  "Could not find the function public.send_team_chat_message(_body, _team) in the schema cache",
  'relation "public.team_chat_messages" does not exist',
  "<!DOCTYPE html><html><head><title>abc.supabase.co | 502: Bad gateway</title></head><body>502 Bad Gateway</body></html>",
  "canceling statement due to statement timeout",
  "connection reset",
  "network down",
  'duplicate key value violates unique constraint "follows_pkey"',
  "JSON object requested, multiple (or no) rows returned",
  // An older trigger's plain sentence: not ours, so not shown.
  "Hosts cannot request to join their own game.",
  // A server function's input check, as TanStack throws it.
  '[{"code":"too_big","maximum":2000,"message":"String must contain at most 2000 character(s)","path":["body"]}]',
];

/** Words that only the raw failures above use. */
const RAW =
  /schema cache|row-level|jwt|doctype|<|relation|permission denied for|typeerror|duplicate key|statement|connection reset|network down|json|hosts cannot|too_big/i;

const MAPPERS: [name: string, map: (raw: string) => string][] = [
  ["entityFollowErrorMessage", entityFollowErrorMessage],
  ["followErrorMessage", followErrorMessage],
  ["teamChatErrorMessage", teamChatErrorMessage],
  ["venueEventErrorMessage", venueEventErrorMessage],
  ["postErrorMessage", postErrorMessage],
  ["listingErrorMessage (a string)", listingErrorMessage],
  ["listingErrorMessage (an Error)", (raw) => listingErrorMessage(new Error(raw))],
  [
    "listingErrorMessage (a PostgREST error)",
    (raw) => listingErrorMessage({ message: raw, code: "", details: null, hint: null }),
  ],
  ["removalMessage", removalMessage],
  ["paymentSubmissionErrorMessage", paymentSubmissionErrorMessage],
  ["joinGateErrorMessage", (raw) => joinGateErrorMessage({ message: raw })],
];

describe("the feature mappers never show a failure's own text", () => {
  it.each(MAPPERS)("%s", (_name, map) => {
    for (const raw of FAILURE_TEXTS) {
      const msg = map(raw);
      expect(msg, raw).not.toBe(raw);
      expect(msg, raw).not.toContain(raw);
      expect(msg, `${raw} -> ${msg}`).not.toMatch(RAW);
      expect(msg, raw).toMatch(/^[A-Z][^]*[.!?]$/);
      expect(msg, raw).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]/);
    }
  });

  it.each(MAPPERS)("%s still words a known refusal", (_name, map) => {
    expect(map("EVENT_FULL")).toBe(USER_ERROR_MESSAGES.EVENT_FULL);
  });

  it("keeps the moderators' featured-venue limit as it is", () => {
    expect(listingErrorMessage(new Error(FEATURED_LIMIT_MESSAGE))).toBe(FEATURED_LIMIT_MESSAGE);
  });
});

describe("server functions that replace a failure keep it for the error report", () => {
  it.each([
    ["src/lib/team-chat.functions.ts", "teamChatErrorMessage", 1],
    ["src/lib/venue-events.functions.ts", "venueEventErrorMessage", 2],
    ["src/lib/network-posts.functions.ts", "postErrorMessage", 1],
    ["src/lib/court-inquiries.functions.ts", "inquiryErrorMessage", 1],
    ["src/lib/discovery/review.server.ts", "removalMessage", 1],
  ])("%s throws errorInsteadOf(failure, %s(...))", (file, mapper, count) => {
    const src = readFileSync(file, "utf8");
    // A plain `new Error(words)` would hide the database failure from error-report-middleware.ts.
    expect(src).not.toMatch(new RegExp(`new Error\\(${mapper}\\(`));
    expect(src.match(new RegExp(`throw errorInsteadOf\\(\\w+, ${mapper}\\(`, "g"))).toHaveLength(
      count,
    );
  });
});
