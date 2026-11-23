import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_ERROR_MESSAGES, AiError } from "@/lib/ai/errors";
import { minorMessagingMessage } from "@/lib/minor-messaging";
import { PAYMENT_CLAIM_REFUSAL_CODES, PAYMENT_TRIGGER_REFUSALS } from "@/lib/payments-policy";
import { POST_BLOCKED_MESSAGE } from "@/lib/post-moderation";
import {
  DATABASE_SENTENCE_REFUSALS,
  FEATURE_ERROR_MESSAGES,
  GENERIC_ERROR_MESSAGES,
  USER_ERROR_MESSAGES,
  USER_ERROR_VARIANTS,
  errorCode,
  errorText,
  isUserErrorCode,
  knownErrorMessage,
  paymentSubmissionErrorMessage,
  userErrorMessage,
} from "@/lib/user-error";

const FALLBACK = "FALLBACK SENTENCE";

/** A code-shaped token: what must never reach a member. */
const CODE_SHAPE = /[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]/;

/**
 * Every message the database raises with a code, one line per wording, from the WP 4.0 sweep of supabase/migrations
 * and drizzle/migrations (current definitions only). A format argument is filled with a sample value. The codes raised
 * in HINT, with a plain sentence as the message, are in HINT_RAISES.
 */
const DB_RAISES: readonly string[] = [
  "ADULT_HOST_REQUIRED",
  "ADULT_REQUIRED: only an adult account can add a minor.",
  "ADULT_REQUIRED: only a verified adult account can add a child.",
  "AGE_MINIMUM_13: OpenRun requires members to be at least 13 years old.",
  "AGE_RANGE_LOCKED",
  "AGE_RANGE_REQUIRED",
  "AGE_REQUIREMENT_NOT_MET: this game has an age requirement, so the host has to approve your request first.",
  "AGE_UNKNOWN",
  "AGE_VERIFICATION_REQUIRED: add your date of birth first.",
  "AGE_VERIFICATION_REQUIRED: add your date of birth before using ballaCity.",
  "AGE_VERIFICATION_REQUIRED: add your date of birth before joining a team.",
  "AGE_VERIFICATION_REQUIRED: add your date of birth before paying for a game.",
  "AGE_VERIFICATION_REQUIRED: this player must add their date of birth before paying for a game.",
  "AGE_VERIFICATION_REQUIRED: add your date of birth before taking payments.",
  "AGE_VERIFICATION_REQUIRED: your player must add their date of birth before joining a team.",
  "AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.",
  "AGE_VERIFICATION_REQUIRED: this player must add their date of birth before joining games.",
  "ALREADY_CLAIMED",
  "ALREADY_IN_GAME: this player already has a place.",
  "ALREADY_LINKED: you are already connected to this parent or guardian.",
  "ALREADY_MEMBER",
  "ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.",
  "ALREADY_OWNER",
  "ALREADY_PROVISIONED: that profile is already set up.",
  "ALREADY_REGISTERED",
  "ALREADY_REVIEWED: that request was already decided.",
  "ATTACHMENT_NOT_CHECKED: this file has not been checked, so it cannot be sent.",
  "ATTENDANCE_CANCELLED: this game was cancelled.",
  "ATTENDANCE_FORBIDDEN: only the host can mark attendance.",
  "ATTENDANCE_TOO_EARLY: attendance opens when the game starts.",
  "ATTESTATION_REQUIRED: confirm you are this child's parent or legal guardian.",
  "ATTESTATION_REQUIRED",
  "ATTESTATION_REQUIRED: confirm you are signing on this child's behalf.",
  "AUTH_REQUIRED",
  "AUTH_REQUIRED: sign in first.",
  "AUTH_REQUIRED: sign in to accept a family invitation.",
  "AUTH_REQUIRED: sign in to add your child.",
  "AUTH_REQUIRED: sign in before saving a date of birth.",
  "AVAILABILITY_FIELD_FORBIDDEN: a new post starts open or paused.",
  "AVAILABILITY_FIELD_FORBIDDEN: this post's visibility is managed by BallaCity.",
  "BIRTHDAY_AUDIT_IMMUTABLE: birthday history cannot be changed.",
  "BIRTHDAY_LOCKED: a stored date of birth cannot be removed. Request a birthday correction instead.",
  "BIRTHDAY_LOCKED: your date of birth cannot be changed after registration. Request a birthday correction instead.",
  "BLOCKED",
  "BLOCKED_BY_HOST: you can't join this host's games.",
  "BLOCKED_BY_HOST: you can't join this host's games, so a payment cannot be recorded.",
  "CANNOT_REPORT_SELF",
  "CAPACITY_BELOW_REGISTERED",
  "CHILD_ACTIVITY_LOCKED",
  "CHILD_CANNOT_HOST: an adult must host games that include children.",
  "CHILD_CANNOT_INQUIRE: an adult needs to contact the facility for you.",
  "CHILD_CONSENT_REQUIRED: a parent or guardian must approve this account first.",
  "CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.",
  "CHILD_IS_ADULT: an adult signs up with their own account.",
  "CLAIM_ALREADY_PENDING",
  "CLAIM_NOT_AWAITING_INFO",
  "CLAIM_NOT_FOUND",
  "CLAIM_NOT_PENDING",
  "CLAIM_OPEN",
  "COACH_ANALYTICS_GUARDIAN_REQUIRED",
  "COACH_ANALYTICS_NOT_AVAILABLE",
  "COACH_ANALYTICS_NOT_ON_TEAM",
  "COACH_ANALYTICS_OFF",
  "COACH_ANALYTICS_SELF_ONLY",
  "CONSENT_ALREADY_APPROVED",
  "CONSENT_METHOD_NOT_ALLOWED",
  "CONSENT_NOT_FOUND",
  "CONSENT_TOKEN_EXPIRED",
  "CONSENT_TOKEN_INVALID",
  "DECISION_FINAL: a declined request can only be sent again by the player.",
  "DECISION_FINAL: a reviewed waitlist entry cannot be put back to waiting.",
  "DECISION_FINAL: a settled payment can only be reopened by the player.",
  "DOB_INVALID: enter a valid date of birth.",
  "DOB_IN_FUTURE: enter a date of birth in the past.",
  "DOB_REQUIRED: enter your child's date of birth.",
  "DOB_REQUIRED: enter your date of birth.",
  "DOB_UNCHANGED: that is already your date of birth on file.",
  "EMPTY_WAIVER",
  "EVALUATION_MIRROR_NO_RSVP",
  "EVENT_FULL",
  "EVENT_NOT_FOUND",
  "EVENT_STARTED",
  "EVIDENCE_TOO_LONG",
  "FACILITY_NOT_FOUND",
  "FAMILY_POSTS_OFF",
  "FAMILY_POST_AI_OFF",
  "FAMILY_POST_NOT_GUARDIAN",
  "FAMILY_POST_UNDER_16_ONLY",
  "FAMILY_SHARE_BAD_EXPIRY",
  "FAMILY_SHARE_NOT_ALLOWED",
  "FAMILY_SHARE_NOT_OWNER",
  "FAMILY_SHARE_NOT_READY",
  "FAMILY_SHARE_OFF",
  "FAMILY_SHARE_TOO_MANY",
  "FAMILY_TEAM_CHILD_NOT_ON_TEAM",
  "FAMILY_TEAM_NOT_ALLOWED",
  "FAMILY_TEAM_NOT_FAMILY_POST",
  "FAMILY_TEAM_SHARE_OFF",
  "FEATURED_NOT_ALLOWED: only moderators can feature a facility.",
  "FOLLOW_BLOCKED",
  "FOLLOW_LOCKED",
  "FOLLOW_NOT_ALLOWED",
  "FORBIDDEN: only support staff can review birthday corrections.",
  "FORBIDDEN: admin access required.",
  "GAME_APPROVAL_REQUIRED: the host has to approve your request to join first.",
  "GAME_CANCELLED: this game was cancelled by the host.",
  "GAME_CANCELLED: this game was cancelled, so a payment for it cannot be recorded.",
  "GAME_CLOSED: a game that is over or called off cannot be reopened.",
  "GAME_COMPLETED: this game has already ended.",
  "GAME_COMPLETED: this game has already ended, so a payment for it cannot be recorded.",
  "GAME_FULL: the roster is full.",
  "GAME_FULL: this game is full, so a payment for a place in it cannot be recorded.",
  "GAME_FULL: this game has no free places.",
  "GAME_JOINS_CLOSED: the host has closed joining for this game.",
  "GAME_JOINS_CLOSED: joining is closed for this game, so a payment cannot be recorded.",
  "GAME_NOT_OPEN: this game is not taking players now.",
  "GAME_PARTICIPATION_BLOCKED: a parent or guardian has to allow game participation before a payment can be recorded.",
  "GAME_PAYMENT_REQUIRED: the entry fee has to be confirmed by the host first.",
  "GAME_SIGNUP_CLOSED: signups closed before start time.",
  "GROUP_LIMIT: at most 20 groups.",
  "GROUP_LIMIT: at most 50 people in a group.",
  "GUARDIAN_APPROVAL_FORBIDDEN: a request starts without a guardian's approval; the guardian approves it from their account.",
  "GUARDIAN_APPROVAL_FORBIDDEN: only the child's guardian can approve, from their account.",
  "GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.",
  "GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this invite first.",
  "GUARDIAN_APPROVAL_REQUIRED: a parent or guardian must approve this join request first.",
  "GUARDIAN_NOT_ELIGIBLE",
  "GUARDIAN_REQUIRED",
  "HANDLE_TAKEN",
  "HANDOVER_ALREADY_PENDING: a handover is already waiting for this account.",
  "HANDOVER_FAILED: the handover could not be started.",
  "HANDOVER_LIMIT: too many handover attempts for now.",
  "HANDOVER_NOT_ADULT: an account can be handed over once its person is 18 or over.",
  "HANDOVER_NOT_ALLOWED: only the adult who manages this account can hand it over.",
  "HANDOVER_NOT_ALLOWED: only the adult who manages this account can cancel its handover.",
  "HANDOVER_BUSY: the handover is being finished right now. Try again in a minute.",
  "AUTH_REQUIRED: sign in to hand over an account.",
  "AUTH_REQUIRED: sign in to cancel a handover.",
  "ID_TAKEN",
  "IMMUTABLE_FIELDS",
  "INQUIRY_PENDING_LIMIT: you already have open inquiries with this facility.",
  "INQUIRY_RATE_LIMIT: too many court inquiries today, try again tomorrow.",
  "INVALID_EVALUATION",
  "INVALID_EVENT",
  "INVALID_FOLLOW_TARGET",
  "INVALID_KIND",
  "INVALID_LOCATION",
  "INVALID_MESSAGE",
  "INVALID_PARENT_EMAIL",
  "INVALID_STATUS",
  "INVALID_TYPE",
  "INVALID_WINDOW",
  "INVALID_WORKER_PATH",
  "INVITE_DECLINED_RECENTLY: this player declined an invitation to this game in the last 7 days.",
  "INVITE_EXPIRED: that invitation has expired.",
  "INVITE_EXPIRED",
  "INVITE_INVALID: that invitation link is not valid.",
  "INVITE_LIMIT: at most 30 players at once.",
  "INVITE_LIMIT: a game can have at most 50 invitations waiting for an answer.",
  "INVITE_LIMIT: at most 100 invitations a day.",
  "INVITE_NOT_AVAILABLE: this invitation can't be accepted.",
  "INVITE_NOT_AVAILABLE: this player can't be invited to this game.",
  "INVITE_NOT_FOUND",
  "INVITE_NOT_PENDING",
  "INVITE_REVOKED: that invitation was cancelled.",
  "INVITE_SELF: you cannot accept your own invitation.",
  "INVITE_USED: that invitation was already used.",
  "KIND_NOT_ALLOWED",
  "LEGAL_VERSION_INVALID: accept the current Terms and Privacy Policy.",
  "LEGAL_VERSION_STALE: the Terms were just updated.",
  "LEGAL_VERSION_STALE: the Privacy Policy was just updated.",
  "LISTING_HIDDEN_MODERATOR_ONLY",
  "LISTING_HIDE_RPC_ONLY",
  "LISTING_IN_USE",
  "LISTING_NOT_FOUND",
  "LOCATION_IN_PUBLIC_TEXT: the note on an availability post by someone under 18 cannot contain an address, map link, coordinates or a venue name (found: address). Describe the sport and the days instead.",
  "MANAGED_CHILD_DELETE_INSTEAD",
  "MANAGED_LIMIT: too many child profiles for one account.",
  "MEMBERS_SHARING_NOT_AVAILABLE",
  "MEMBER_IDENTITY_FIXED: a membership cannot be moved to another person or team; remove it and invite instead.",
  "MEMBER_IDENTITY_LOCKED: only the role of a facility member can be changed.",
  "MESSAGE_FIELD_FORBIDDEN: recipients may only mark a message read or accept a request.",
  "MESSAGE_NOT_FOUND",
  "MESSAGE_REQUIRED",
  "MESSAGE_TOO_LONG",
  "MINOR_HANDLE_UNSAFE: remove personal details (email, phone, address or date of birth) from the name or username.",
  "MINOR_MESSAGING_BLOCKED:messaging_off:self",
  "MINOR_MESSAGING_BLOCKED:recipient_restricted:other",
  "MIN_AGE: you need to be at least 13 to use BallaCity.",
  "NAME_INVALID: use letters only in your child's name.",
  "NAME_REQUIRED: add the child's first name.",
  "NAME_REQUIRED",
  "NAME_REQUIRED: enter your child's first name.",
  "NOTE_REQUIRED",
  "NOTE_TOO_LONG",
  "NOT_ALLOWED",
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  "NOT_A_MEMBER",
  "NOT_CLAIM_OWNER",
  "NOT_FACILITY_STAFF",
  "NOT_FOUND: that invitation is no longer open.",
  "NOT_FOUND: that correction request no longer exists.",
  "NOT_FOUND: game is not listed at a facility.",
  "NOT_FOUND",
  "NOT_GAME_HOST: only the game's host can invite players to it.",
  "NOT_GAME_HOST: only the game's host can see whom to invite.",
  "NOT_GUARDIAN",
  "NOT_INVITEE",
  "NOT_IN_TEAM_CHAT",
  "NOT_MODERATOR",
  "NOT_ON_TEAM",
  "NOT_REGISTERED",
  "NOT_SIGNED_IN",
  "NOT_SIGNED_IN: minor_messaging_block_me needs a signed-in caller",
  "NOT_TEAM_MANAGER",
  "NOT_TEAM_MEMBER_OR_INVITEE",
  "NOT_TEAM_OWNER",
  "NOT_TEAM_STAFF",
  "NOT_TRAINER_STAFF",
  "NOT_UNCLAIMED_LISTING",
  "NOT_YOUR_GUARDIAN_LINK",
  "NOT_YOUR_MANAGED_CHILD: that profile was not created for your account.",
  "NO_SUCH_FOLLOW_REQUEST",
  "ORG_FLAGS_READONLY: facility listing flags are set by the server.",
  "ORG_HIDDEN: this game was hidden by the facility and cannot be re-tagged.",
  "ORG_NOT_MANAGER: only a facility owner or admin can moderate its events.",
  "ORG_PRIVATE_RUN: only public runs can be listed on a facility page.",
  "OUTSIDE_AGE_RANGE",
  "OWNER_NOT_INVITABLE",
  "OWNER_NOT_REMOVABLE",
  "OWNER_ROLE_FIXED",
  "OWNER_SET_BY_CLAIM_ONLY",
  "OWN_CLAIM",
  "PARTICIPANT_FIELD_FORBIDDEN: you may only change your own position.",
  "PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this account yet.",
  "PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this host account yet.",
  "PAYMENT_DESTINATION_INVALID: payment for this game must go to its host.",
  "PAYMENT_FIELD_FORBIDDEN: payment evidence and host review fields cannot be changed while cancelling or disputing.",
  "PAYMENT_FIELD_FORBIDDEN: refund details are set by BallaCity, not by the player or host.",
  "POST_AGE_NOT_ALLOWED",
  "POST_AUDIENCE_NOT_ALLOWED",
  "POST_DELETED",
  "POST_LOCKED",
  "POST_OWNER_FIXED",
  "POST_TARGET_INVALID",
  "RATE_LIMITED",
  "REASON_REQUIRED: explain why the date needs correcting.",
  "REASON_TOO_LONG",
  "REEL_MEDIA_PATH_FORBIDDEN: reel media must live in the owner's own folder.",
  'REEL_MEDIA_PATH_INVALID: media paths cannot contain "..".',
  "RELATIONSHIP_REQUIRED",
  "REPORT_FIELDS_FIXED: only the review status and notes of a report can be changed.",
  "REQUEST_NOT_FOUND",
  "REQUEST_NOT_PENDING",
  "REQUEST_PENDING: you already have a correction under review.",
  "REVIEW_HELD_FOR_SCREENING: your review is published after screening.",
  "ROLE_WRITE_FORBIDDEN: roles are granted and revoked by the server on a superadmin's instruction, never written through the API",
  "ROW_IDENTITY_FIXED: user_id cannot be changed on this row.",
  "SELF_INVITE",
  "SUPERADMIN_ONLY",
  "TARGET_NOT_MANAGER",
  "TEAM_NOT_FOUND",
  "TEEN_TEAM_GUARDIAN_ONLY",
  "TEEN_TEAM_INCOMPLETE",
  "TEEN_TEAM_NOT_AVAILABLE",
  "TEEN_TEAM_NOT_ON_TEAM",
  "TEEN_TEAM_NOT_READY",
  "TOKEN_INVALID: invitation could not be created.",
  "TOO_MANY_INVITES: cancel an open invitation first.",
  "TRAINER_NOT_FOUND",
  "TRYOUT_FULL",
  "TRYOUT_NOT_FOUND",
  "TRYOUT_PASSED",
  "UNKNOWN_FIELD: venue_id",
  "UNKNOWN_LISTING_KIND",
  "USER_MISMATCH",
  "WAIVER_NOT_FOUND",
  "WAIVER_NOT_PUBLISHED",
  "WAIVER_REQUIRED",
  "WAIVER_REQUIRED: this team requires a signed waiver before you can join.",
];

/**
 * The refusals that carry their code in HINT (20261121100000, 20261122100000), as PostgREST hands them back: the
 * message is a sentence written for the member, the code is SQLSTATE 42501 or 22023.
 */
const HINT_RAISES: readonly { message: string; code: string; hint: string }[] = [
  {
    message: "You can only host under a team profile you own or manage.",
    code: "42501",
    hint: "GAME_TEAM_NOT_MANAGED",
  },
  {
    message: "Only adults can host a game without a team profile. Host it under your team instead.",
    code: "42501",
    hint: "HOST_AS_SELF_ADULTS_ONLY",
  },
  {
    message: "A game can repeat every week or every 2 weeks.",
    code: "22023",
    hint: "SERIES_BAD_FREQ",
  },
  { message: "Only the host can make this game repeat.", code: "42501", hint: "SERIES_NOT_HOST" },
  { message: "This game is already part of a series.", code: "22023", hint: "SERIES_ALREADY" },
  {
    message: "Only an upcoming, listed game can repeat.",
    code: "22023",
    hint: "SERIES_GAME_NOT_OPEN",
  },
  {
    message: "The last date must be on or after the first game.",
    code: "22023",
    hint: "SERIES_BAD_UNTIL",
  },
  { message: "Only the host can stop this series.", code: "42501", hint: "SERIES_NOT_HOST" },
];

/** Codes deliberately left to the caller's fallback: an app bug or a cron failure with nothing better to say. */
const LEFT_TO_FALLBACK = new Set(["INVALID_WINDOW", "INVALID_WORKER_PATH", "UNKNOWN_LISTING_KIND"]);

/**
 * Codes deliberately not in the catalog because no member meets them: Content Studio, which only superadmins use and
 * which words its own refusals (drizzle 0023); device pairing, which has no screen (drizzle 0002); the hotfix guard
 * that stops a write path outright; and the server-only sweep stamps (WP 5.4 push_sent_at, WP 5.6
 * attendance_prompted_at), which no screen writes.
 */
const NOT_FOR_MEMBERS = new Set([
  "ALREADY_PUBLISHED",
  "APPROVAL_IMMUTABLE",
  "APPROVAL_STALE",
  "ATTENDANCE_PROMPT_SERVER_ONLY",
  "ATTEMPT_FINISHED",
  "ATTEMPT_NOT_FOUND",
  "CONNECTION_NOT_ACTIVE",
  "CONNECTION_NOT_FOUND",
  "DESTINATION_CHANGED",
  "DRAFT_CHANGED",
  "DRAFT_LOCKED",
  "DRAFT_NOT_APPROVABLE",
  "DRAFT_NOT_APPROVED",
  "DRAFT_NOT_FOUND",
  "DRAFT_NOT_REJECTABLE",
  "DRAFT_STATUS_SET_BY_WORKFLOW_ONLY",
  "EXTERNAL_ID_REQUIRED",
  "HOTFIX_STOPPED",
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_KEY_REUSED",
  "NOT_SUPERADMIN",
  "NO_DESTINATION_PAGE",
  "PAIRING_INVALID",
  "PAIRING_NOT_FOUND",
  "PUBLISH_IN_PROGRESS",
  "PUSH_SENT_AT_SERVER_ONLY",
]);

/**
 * Every code either migration folder raises (both are replayed, so both are live), old definitions included:
 * `RAISE EXCEPTION 'CODE…'` and `HINT = 'CODE'`. Read from the files, so a new raise cannot be missed the way a
 * hand-copied list can miss it.
 */
function codesRaisedByMigrations(): Map<string, string> {
  const raised = new Map<string, string>();
  for (const dir of ["supabase/migrations", "drizzle/migrations"]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, file), "utf8");
      const found = [
        ...sql.matchAll(/RAISE\s+EXCEPTION\s+'([A-Z][A-Z0-9_]*[A-Z0-9])(?=[:'\s%])/g),
        ...sql.matchAll(/HINT\s*=\s*'([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])'/g),
      ];
      for (const [, code] of found) {
        // A bare all-caps word is a sentence's first word, not a code (RAISE EXCEPTION 'OK').
        if (code!.includes("_") || code!.length >= 4) raised.set(code!, `${dir}/${file}`);
      }
    }
  }
  return raised;
}

const codeOf = (raw: string) => /^[A-Z][A-Z0-9_]*[A-Z0-9]/.exec(raw)![0];
const detailOf = (raw: string) => raw.slice(codeOf(raw).length).replace(/^:\s*/, "");

const vetted = new Set<string>([
  ...Object.values(USER_ERROR_MESSAGES),
  ...USER_ERROR_VARIANTS.map((v) => v.message),
]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the catalog", () => {
  it("maps every code, bare and with detail text", () => {
    for (const code of Object.keys(USER_ERROR_MESSAGES)) {
      for (const raw of [code, `${code}: x`, `${code}:x`]) {
        const msg = userErrorMessage(raw, FALLBACK);
        expect(msg, raw).not.toBe(FALLBACK);
        expect(msg, raw).not.toMatch(CODE_SHAPE);
      }
    }
  });

  it("has a sentence for every code either migration folder raises, or leaves it out on purpose", () => {
    const raised = codesRaisedByMigrations();
    // The scan really read both folders and both ways of raising a code.
    expect(raised.size).toBeGreaterThan(200);
    expect(raised.get("EMPTY_WAIVER")).toMatch(/^drizzle\//);
    expect(raised.get("HOST_AS_SELF_ADULTS_ONLY")).toMatch(/^supabase\//);
    const unworded = [...raised]
      .filter(([code]) => !isUserErrorCode(code))
      .filter(([code]) => !LEFT_TO_FALLBACK.has(code) && !NOT_FOR_MEMBERS.has(code))
      .map(([code, file]) => `${code} (${file})`);
    expect(unworded).toEqual([]);
    // The codes left out are really raised, so neither list can go stale.
    for (const code of [...LEFT_TO_FALLBACK, ...NOT_FOR_MEMBERS]) {
      expect(raised.has(code), code).toBe(true);
      expect(isUserErrorCode(code), code).toBe(false);
    }
  });

  it("has a sentence for every code the database raises at a member", () => {
    for (const raw of DB_RAISES) {
      const code = codeOf(raw);
      const msg = userErrorMessage(raw, FALLBACK);
      if (LEFT_TO_FALLBACK.has(code)) {
        expect(msg, raw).toBe(FALLBACK);
        continue;
      }
      expect(msg, raw).not.toBe(FALLBACK);
      expect(errorCode(raw), raw).toBe(code);
    }
  });

  it("never shows a code or the database's own text (every raise, every shape)", () => {
    for (const raw of DB_RAISES) {
      const detail = detailOf(raw);
      for (const err of [
        raw,
        new Error(raw),
        { message: raw, code: "P0001", details: null, hint: null },
      ]) {
        const msg = userErrorMessage(err, FALLBACK);
        if (msg === FALLBACK) continue;
        expect(msg, raw).not.toMatch(CODE_SHAPE);
        expect(msg, raw).not.toContain(raw);
        if (detail) expect(msg, raw).not.toContain(detail);
        if (codeOf(raw) === "MINOR_MESSAGING_BLOCKED") {
          expect(msg, raw).toBe(minorMessagingMessage(raw, "chat"));
        } else {
          expect(vetted.has(msg), `${raw} -> ${msg}`).toBe(true);
        }
      }
    }
  });

  it("writes every sentence as a sentence, in the app's words", () => {
    for (const msg of vetted) {
      expect(msg).not.toMatch(CODE_SHAPE);
      expect(msg).toMatch(/^[A-Z]/);
      expect(msg).toMatch(/[.!?]$/);
      // venue, invite, date of birth: one word for each thing.
      expect(msg).not.toMatch(/\bfacilit(y|ies)\b|\binvitations?\b|\bbirthday\b/i);
    }
  });

  it("reaches every variant from a real raise, so neither a reworded raise nor a reorder can hide one", () => {
    const raises = [...DB_RAISES, ...HINT_RAISES];
    for (const v of USER_ERROR_VARIANTS) {
      expect(v.when.global, v.message).toBe(false);
      const reached = raises.some((raw) => userErrorMessage(raw, FALLBACK) === v.message);
      expect(reached, `${v.code} ${v.when}: no raise reads as "${v.message}"`).toBe(true);
    }
  });
});

describe("errorText", () => {
  it("reads Errors, PostgREST objects, strings and wrapped results", () => {
    expect(errorText(new Error("GAME_FULL: x"))).toBe("GAME_FULL: x");
    expect(errorText({ message: "GAME_FULL: x", code: "P0001", details: null, hint: null })).toBe(
      "GAME_FULL: x",
    );
    expect(errorText("  EVENT_FULL  ")).toBe("EVENT_FULL");
    expect(errorText({ data: null, error: { message: "NOT_ALLOWED" } })).toBe("NOT_ALLOWED");
    expect(errorText({ error_description: "Invalid Refresh Token" })).toBe("Invalid Refresh Token");
  });

  it("answers undefined for anything without a message, and never throws", () => {
    for (const v of [undefined, null, "", "   ", 42, {}, [], new Error(""), Symbol("x")]) {
      expect(errorText(v)).toBeUndefined();
    }
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    expect(() => errorText(hostile)).not.toThrow();
    expect(errorText(hostile)).toBeUndefined();
    const circular: Record<string, unknown> = {};
    circular.error = circular;
    expect(errorText(circular)).toBeUndefined();
  });
});

describe("errorCode", () => {
  it("reads the code at the start of the message", () => {
    expect(errorCode({ message: "GAME_FULL: the roster is full.", code: "P0001" })).toBe(
      "GAME_FULL",
    );
    expect(errorCode(new Error("MINOR_MESSAGING_BLOCKED:recipient_restricted:other"))).toBe(
      "MINOR_MESSAGING_BLOCKED",
    );
    expect(errorCode("EVENT_FULL")).toBe("EVENT_FULL");
    expect(errorCode("BLOCKED")).toBe("BLOCKED");
    // A code we have no words for is still a code.
    expect(errorCode("PAIRING_INVALID: could not create a pairing code.")).toBe("PAIRING_INVALID");
  });

  it("reads a code the database put in HINT when the message carries none", () => {
    for (const raise of HINT_RAISES) {
      expect(errorCode(raise), raise.message).toBe(raise.hint);
      expect(errorCode({ data: null, error: raise }), raise.message).toBe(raise.hint);
    }
    // A hint that is advice, not a code, is not a code.
    expect(
      errorCode({
        message: "x",
        code: "42501",
        hint: "Sharing reels with members is only available for ages 13 to 15.",
      }),
    ).toBeUndefined();
    // The message's own code comes first.
    expect(errorCode({ message: "GAME_FULL: x", hint: "SERIES_NOT_HOST" })).toBe("GAME_FULL");
  });

  it("finds a known code wrapped in other text, as a whole token only", () => {
    expect(errorCode("P0001: ADULT_REQUIRED: only a verified adult")).toBe("ADULT_REQUIRED");
    expect(errorCode({ message: "P0001 FAMILY_SHARE_OFF" })).toBe("FAMILY_SHARE_OFF");
    expect(errorCode("Error: GAME_FULL: x")).toBe("GAME_FULL");
    expect(errorCode("you are BLOCKED_BY_HOST here")).toBe("BLOCKED_BY_HOST");
    expect(errorCode("CLAIM_NOT_FOUND")).toBe("CLAIM_NOT_FOUND");
  });

  it("is never the SQLSTATE and never a plain word", () => {
    expect(
      errorCode({ message: "permission denied for table games", code: "42501" }),
    ).toBeUndefined();
    expect(errorCode(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(errorCode("JWT expired")).toBeUndefined();
    expect(errorCode("HTTP error")).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
    // A catalog code with no underscore is a code only at the start, never a capital word inside an upstream answer.
    expect(errorCode("Request BLOCKED by policy")).toBeUndefined();
    expect(errorCode("403 FORBIDDEN")).toBeUndefined();
    expect(errorCode({ message: "upstream said FORBIDDEN", code: "" })).toBeUndefined();
    expect(userErrorMessage("Request BLOCKED by policy", FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage("403 FORBIDDEN", FALLBACK)).toBe(FALLBACK);
    expect(errorCode("FORBIDDEN")).toBe("FORBIDDEN");
    expect(errorCode("BLOCKED: x")).toBe("BLOCKED");
  });
});

describe("userErrorMessage", () => {
  it("maps a code inside a PostgREST object, an Error and a 'CODE: text' string alike", () => {
    const raw = "GAME_APPROVAL_REQUIRED: the host has to approve your request to join first.";
    const expected = USER_ERROR_MESSAGES.GAME_APPROVAL_REQUIRED;
    expect(userErrorMessage(raw, FALLBACK)).toBe(expected);
    expect(userErrorMessage(new Error(raw), FALLBACK)).toBe(expected);
    expect(
      userErrorMessage({ message: raw, code: "P0001", details: null, hint: null }, FALLBACK),
    ).toBe(expected);
    expect(userErrorMessage({ data: null, error: { message: raw } }, FALLBACK)).toBe(expected);
  });

  it("words a code by the situation its detail text names", () => {
    expect(
      userErrorMessage(
        "AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.",
        FALLBACK,
      ),
    ).toBe("Add your date of birth in your profile before joining games.");
    expect(
      userErrorMessage(
        "AGE_VERIFICATION_REQUIRED: your player must add their date of birth before joining a team.",
        FALLBACK,
      ),
    ).toMatch(/Your child's account needs a date of birth/);
    // A host can turn the waitlist off, so the shared sentence does not offer one (joinGateErrorMessage may).
    expect(userErrorMessage("GAME_FULL: the roster is full.", FALLBACK)).toBe("This game is full.");
    expect(userErrorMessage("GAME_FULL: this game has no free places.", FALLBACK)).toBe(
      "This game is full.",
    );
    // create_minor_invite asks only for an adult; provision_managed_child also for an email and a date of birth.
    expect(
      userErrorMessage("ADULT_REQUIRED: only an adult account can add a minor.", FALLBACK),
    ).toBe("Only adult accounts can invite a child.");
    expect(
      userErrorMessage("ADULT_REQUIRED: only a verified adult account can add a child.", FALLBACK),
    ).toMatch(/confirmed email and a date of birth/);
    expect(userErrorMessage("INVITE_LIMIT: at most 30 players at once.", FALLBACK)).toBe(
      "You can invite up to 30 players at once.",
    );
    expect(userErrorMessage("NOT_FOUND: that invitation is no longer open.", FALLBACK)).toBe(
      "This invite is no longer open.",
    );
    expect(userErrorMessage("NOT_FOUND", FALLBACK)).toBe(USER_ERROR_MESSAGES.NOT_FOUND);
  });

  it("says a payment refusal exactly as the payment screens do", () => {
    const worded = new Set<string>([
      ...PAYMENT_CLAIM_REFUSAL_CODES,
      "AGE_VERIFICATION_REQUIRED",
      "GUARDIAN_APPROVAL_REQUIRED",
      "PAYMENTS_NOT_AVAILABLE",
    ]);
    const payments = DB_RAISES.filter(
      (r) => worded.has(codeOf(r)) && /payment|paying|age requirement/i.test(r),
    );
    expect(payments.length).toBeGreaterThanOrEqual(12);
    for (const raw of payments) {
      expect(userErrorMessage(raw, FALLBACK), raw).toBe(paymentSubmissionErrorMessage(raw));
    }
  });

  it("lets minor-messaging word the reason, neutrally when it is about the other person", () => {
    expect(userErrorMessage("MINOR_MESSAGING_BLOCKED:recipient_restricted:other", FALLBACK)).toBe(
      USER_ERROR_MESSAGES.MINOR_MESSAGING_BLOCKED,
    );
    expect(userErrorMessage("MINOR_MESSAGING_BLOCKED:messaging_off:self", FALLBACK)).toMatch(
      /Your parent or guardian has turned off direct messages/,
    );
    expect(userErrorMessage("MINOR_MESSAGING_BLOCKED", FALLBACK)).toBe(
      USER_ERROR_MESSAGES.MINOR_MESSAGING_BLOCKED,
    );
  });

  it("keeps a block secret: a blocked follow reads like an unavailable one", () => {
    expect(userErrorMessage("FOLLOW_BLOCKED", FALLBACK)).toBe(
      userErrorMessage("INVALID_FOLLOW_TARGET", FALLBACK),
    );
    expect(userErrorMessage("FOLLOW_BLOCKED", FALLBACK)).not.toMatch(/block/i);
  });

  it("words a refusal raised with its code in HINT, even one whose SQLSTATE says permission", () => {
    for (const raise of HINT_RAISES) {
      const msg = userErrorMessage(raise, FALLBACK);
      expect(msg, raise.hint).not.toBe(FALLBACK);
      expect(msg, raise.hint).not.toBe(GENERIC_ERROR_MESSAGES.permission);
      expect(vetted.has(msg), `${raise.hint} -> ${msg}`).toBe(true);
    }
    // A 16-17-year-old hosting without a team is told what to do, not that they lack permission.
    expect(userErrorMessage(HINT_RAISES[1], FALLBACK)).toMatch(/Host it under your team/);
    expect(userErrorMessage(HINT_RAISES[7], FALLBACK)).toBe("Only the host can stop this series.");
    // The sentences are the database's own, so the message alone (rethrown as an Error, its hint lost) still reads.
    for (const raise of HINT_RAISES) {
      expect(userErrorMessage(new Error(raise.message), FALLBACK)).toBe(raise.message);
    }
  });

  it("passes on a sentence that is already ours", () => {
    expect(userErrorMessage(new Error(USER_ERROR_MESSAGES.EVENT_FULL), FALLBACK)).toBe(
      USER_ERROR_MESSAGES.EVENT_FULL,
    );
    expect(userErrorMessage(new AiError("QUOTA_EXCEEDED"), FALLBACK)).toBe(
      AI_ERROR_MESSAGES.QUOTA_EXCEEDED,
    );
    expect(userErrorMessage(new Error(GENERIC_ERROR_MESSAGES.offline), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.offline,
    );
    // A post the moderation screen blocked (a server function throws it).
    expect(userErrorMessage(new Error(POST_BLOCKED_MESSAGE), FALLBACK)).toBe(POST_BLOCKED_MESSAGE);
    // A feature's own words for a bare code, and a payment trigger's words, read the same when mapped again.
    for (const msg of [
      ...Object.values(FEATURE_ERROR_MESSAGES),
      ...PAYMENT_TRIGGER_REFUSALS.map((r) => r.message),
    ]) {
      expect(userErrorMessage(new Error(msg), FALLBACK)).toBe(msg);
    }
  });

  it("names a network failure as one", () => {
    for (const err of [
      new TypeError("Failed to fetch"),
      { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" },
      new TypeError("Load failed"),
      new Error("NetworkError when attempting to fetch resource."),
      "fetch failed",
    ]) {
      expect(userErrorMessage(err, FALLBACK)).toBe(GENERIC_ERROR_MESSAGES.offline);
    }
  });

  it("says offline when the browser is offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(userErrorMessage(new Error("something odd"), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.offline,
    );
    // A coded refusal still came from the server, so it keeps its own sentence.
    expect(userErrorMessage("EVENT_FULL", FALLBACK)).toBe(USER_ERROR_MESSAGES.EVENT_FULL);
  });

  it("names a refused permission, a duplicate and an expired session", () => {
    expect(
      userErrorMessage({ message: "permission denied for table games", code: "42501" }, FALLBACK),
    ).toBe(GENERIC_ERROR_MESSAGES.permission);
    expect(
      userErrorMessage(
        { message: 'new row violates row-level security policy for table "games"', code: "42501" },
        FALLBACK,
      ),
    ).toBe(GENERIC_ERROR_MESSAGES.permission);
    expect(
      userErrorMessage(
        { message: 'duplicate key value violates unique constraint "x_key"', code: "23505" },
        FALLBACK,
      ),
    ).toBe(GENERIC_ERROR_MESSAGES.duplicate);
    expect(userErrorMessage({ message: "JWT expired", code: "PGRST301" }, FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.session,
    );
    expect(userErrorMessage(new Error("Unauthorized: Invalid token"), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.session,
    );
    expect(userErrorMessage({ message: "Request failed", status: 401 }, FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.session,
    );
  });

  it("answers the fallback for anything else, never the raw text", () => {
    for (const err of [
      "relation public.teams does not exist",
      { message: 'syntax error at or near "select"', code: "42601" },
      // A plain database sentence that is not in DATABASE_SENTENCE_REFUSALS.
      new Error("host_id does not match the game host."),
      "PAIRING_INVALID: invalid pairing code lifetime.",
      { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      undefined,
      null,
      {},
      42,
    ]) {
      expect(userErrorMessage(err, FALLBACK)).toBe(FALLBACK);
    }
  });

  it("never throws", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    expect(userErrorMessage(hostile, FALLBACK)).toBe(FALLBACK);
  });
});

describe("knownErrorMessage", () => {
  it("knows codes and our own sentences, and nothing generic", () => {
    expect(knownErrorMessage("EVENT_FULL")).toBe(USER_ERROR_MESSAGES.EVENT_FULL);
    expect(knownErrorMessage(new TypeError("Failed to fetch"))).toBeUndefined();
    expect(knownErrorMessage("network down")).toBeUndefined();
  });
});

describe("plain-sentence database refusals", () => {
  /** The sentence each function raises, as PostgREST hands it back or a server function rethrows it. */
  const RAISED: [string, string][] = [
    ["enforce_review_integrity", "The 14-day review window for this game has closed."],
    ["enforce_review_integrity", "Daily review limit reached. Try again tomorrow."],
    [
      "enforce_review_integrity",
      "You can only review people you have played, trained or teamed up with.",
    ],
    ["enforce_review_integrity", "Review is too long (max 2000 characters)."],
    ["validate_join_request", "This game has ended."],
    ["validate_join_request", "This game has already started."],
    ["validate_join_request", "Signups are closed for this game."],
    ["validate_join_request", "Hosts cannot request to join their own game."],
    ["guardian_cancel_child_game", "Game not found."],
    ["guardian_cancel_child_game", "This game is no longer on."],
    ["approve_org_member_request", "Request is no longer pending"],
    ["approve_org_member_request", "Request not found"],
    ["accept_trainer_org_invite", "Invite is no longer pending"],
    ["accept_trainer_org_invite", "Invite not found"],
    ["mark_refund_sent", "Payment not found."],
  ];

  it.each(RAISED)("%s: %s reads as a sentence, not the fallback", (_fn, raised) => {
    for (const err of [
      raised,
      new Error(raised),
      { message: raised, code: "P0001", details: null, hint: null },
    ]) {
      const shown = userErrorMessage(err, FALLBACK);
      expect(shown).not.toBe(FALLBACK);
      expect(knownErrorMessage(err)).toBe(shown);
    }
  });

  it("maps the join refusals to the catalog's game wording", () => {
    expect(userErrorMessage("This game has ended.", FALLBACK)).toBe(
      USER_ERROR_MESSAGES.GAME_COMPLETED,
    );
    expect(userErrorMessage("Signups are closed for this game.", FALLBACK)).toBe(
      USER_ERROR_MESSAGES.GAME_SIGNUP_CLOSED,
    );
    expect(userErrorMessage("Invite is no longer pending", FALLBACK)).toBe(
      USER_ERROR_MESSAGES.INVITE_NOT_PENDING,
    );
  });

  it("tells a signed-out host to sign in, not that they lack permission (game_series_start / _stop)", () => {
    // Raised with SQLSTATE 42501 and no HINT (20261122100000_game_series.sql), as PostgREST hands them back.
    expect(
      userErrorMessage(
        { message: "Sign in to make a game repeat.", code: "42501", hint: null },
        FALLBACK,
      ),
    ).toBe("Sign in to make a game repeat.");
    expect(
      userErrorMessage({ message: "Sign in first.", code: "42501", hint: null }, FALLBACK),
    ).toBe(USER_ERROR_MESSAGES.AUTH_REQUIRED);
    // The host-only refusals keep their HINT-coded sentences for start and stop.
    expect(
      userErrorMessage(
        {
          message: "Only the host can make this game repeat.",
          code: "42501",
          hint: "SERIES_NOT_HOST",
        },
        FALLBACK,
      ),
    ).toBe("Only the host can make this game repeat.");
    expect(
      userErrorMessage(
        { message: "Only the host can stop this series.", code: "42501", hint: "SERIES_NOT_HOST" },
        FALLBACK,
      ),
    ).toBe("Only the host can stop this series.");
  });

  it("reads a bare Forbidden (assertModerator / assertSuperadmin) as a permission failure", () => {
    expect(userErrorMessage(new Error("Forbidden"), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.permission,
    );
    expect(userErrorMessage(new Error("Forbidden."), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGES.permission,
    );
    // Only the whole message: a sentence that merely mentions it is left to the fallback.
    expect(userErrorMessage(new Error("Forbidden word in title"), FALLBACK)).toBe(FALLBACK);
  });

  it("wins over the generic permission sentence for a 42501 refusal of ours", () => {
    const err = {
      message: "You can only cancel for a child linked to your account.",
      code: "42501",
    };
    expect(userErrorMessage(err, FALLBACK)).toBe(
      "You can only cancel for a child linked to your account.",
    );
  });

  it("matches the whole message only", () => {
    expect(userErrorMessage("Error: Game not found. at line 3", FALLBACK)).toBe(FALLBACK);
    expect(userErrorMessage("Request not found in table x", FALLBACK)).toBe(FALLBACK);
  });

  it("answers with sentences that are vetted, so a second pass keeps them", () => {
    for (const r of DATABASE_SENTENCE_REFUSALS) {
      expect(userErrorMessage(r.message, FALLBACK)).toBe(r.message);
    }
  });
});
