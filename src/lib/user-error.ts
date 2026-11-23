/**
 * WP 4.0: one place that turns any error into a sentence a member can act on.
 *
 * The database refuses with `CODE` or `CODE: detail` (RAISE EXCEPTION in supabase/migrations and drizzle/migrations),
 * or, in the newest functions, with a plain sentence and the code in HINT. PostgREST hands that back as a plain object
 * {message, code, details, hint} whose `code` is the SQLSTATE, server functions rethrow it as an Error, and some
 * callers pass the bare message string. `userErrorMessage` reads all of these, finds the code, and answers with the
 * catalog's sentence; for the generic failures (offline, permission, duplicate, expired session) it answers with a
 * generic sentence; for anything else it answers with the caller's fallback. It never returns the raw database or
 * network text.
 *
 * The feature mappers (gameInviteErrorMessage, joinGateErrorMessage, teamRosterErrorMessage and the rest) keep their
 * own fallbacks but take their sentences from here, so a code reads the same wherever it is raised. Payment sentences
 * stay owned by payments-policy.ts; the payment variants below point at them.
 */
import { AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { minorMessagingMessage } from "@/lib/minor-messaging";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_GUARDIAN_APPROVAL_MESSAGE,
  PAYMENTS_HOST_AGE_REQUIRED_MESSAGE,
  PAYMENTS_HOST_BLOCKED_MESSAGE,
  PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE,
  PAYMENT_CLAIM_REFUSAL_CODES,
  PAYMENT_POLICY_MESSAGES,
  PAYMENT_SAVE_FAILED_MESSAGE,
  PAYMENT_TRIGGER_REFUSALS,
  paymentClaimRefusalMessage,
  type PaymentClaimRefusalCode,
} from "@/lib/payments-policy";
import { POST_BLOCKED_MESSAGE } from "@/lib/post-moderation";

/**
 * Every code the database (or a server function) raises at a member, with the one sentence it reads as.
 *
 * Vocabulary: game, spot, host, venue (facilities and gyms), listing (claimable team and gym pages), invite, clip,
 * date of birth, parent or guardian. Codes that only mean an app bug or a cron failure with no better words than
 * "something went wrong" (UNKNOWN_LISTING_KIND, INVALID_WINDOW, INVALID_WORKER_PATH), and codes only superadmin tools
 * or no screen at all can meet (Content Studio, device pairing, hotfix guards), are left out on purpose, so the
 * caller's own fallback names what failed. user-error.test.ts reads every code both migration folders raise and fails
 * on one that is in neither place.
 */
export const USER_ERROR_MESSAGES = {
  ADULT_HOST_REQUIRED: "Only adults can host events.",
  ADULT_REQUIRED:
    "Only an adult account with a confirmed email and a date of birth on file can add a child. Finish setting up your own account first.",
  AGE_MINIMUM_13: "You need to be at least 13 to use BallaCity.",
  AGE_RANGE_LOCKED: "You can't change the age range once players have signed up.",
  AGE_RANGE_REQUIRED: "Add an age range for this event.",
  AGE_REQUIREMENT_NOT_MET:
    "This game has an age requirement, so the host has to approve your request for a spot first.",
  AGE_UNKNOWN: "Add a date of birth to this player's profile before signing up for this event.",
  AGE_VERIFICATION_REQUIRED: "Add your date of birth in your profile first.",
  ALREADY_CLAIMED: "Someone has already claimed this listing.",
  ALREADY_IN_GAME: "This player already has a spot in this game.",
  ALREADY_LINKED: "You're already connected to this parent or guardian.",
  ALREADY_MEMBER: "This player is already on the roster.",
  ALREADY_ON_ROSTER:
    "Your child is already in this game. To take them out, cancel their spot from the game page.",
  ALREADY_OWNER: "You already own this team.",
  ALREADY_PROVISIONED: "This child's profile is already set up.",
  // register_for_event refuses the signer, who can be a parent's child (onBehalfOf): name the player, not "you".
  ALREADY_REGISTERED: "This player is already signed up for this event.",
  ALREADY_REVIEWED: "That request was already decided.",
  ATTACHMENT_NOT_CHECKED:
    "This file hasn't finished its safety check, so it can't be sent yet. Try attaching it again.",
  ATTENDANCE_CANCELLED: "You can't take attendance for a cancelled game.",
  ATTENDANCE_FORBIDDEN: "Only the host can mark attendance.",
  ATTENDANCE_TOO_EARLY: "You can mark attendance once the game starts.",
  // Raised bare only by a listing claim; the child and waiver forms carry detail text (see the variants).
  ATTESTATION_REQUIRED:
    "Confirm that your claim is accurate and that you're authorized to make it.",
  AUTH_REQUIRED: "Sign in to continue.",
  AVAILABILITY_FIELD_FORBIDDEN:
    "This availability post can't be changed. If it was closed or hidden, post a new time instead.",
  BIRTHDAY_AUDIT_IMMUTABLE: "Date of birth history can't be changed.",
  BIRTHDAY_LOCKED: "Your date of birth is locked. Request a correction and support will review it.",
  BLOCKED: "You've blocked this player. Unblock them before you invite them.",
  BLOCKED_BY_HOST: "You can't join this game.",
  CANNOT_REPORT_SELF: "You can't report your own message.",
  CAPACITY_BELOW_REGISTERED:
    "You can't set fewer spots than the number of players already signed up.",
  CHILD_ACTIVITY_LOCKED:
    "A parent or guardian needs to approve this account before it can join a team.",
  // block_child_hosting refuses every cohort below 16, and also an account with no date of birth ('unknown').
  CHILD_CANNOT_HOST:
    "You need to be 16 or older to host games. If you are, add your date of birth in your profile first.",
  CHILD_CANNOT_INQUIRE: "An adult needs to contact the venue for you.",
  CHILD_CONSENT_REQUIRED: "A parent or guardian needs to approve your account first.",
  CHILD_GAME_PARTICIPATION_BLOCKED:
    "A parent or guardian needs to allow games on this account first.",
  CHILD_IS_ADULT: "That date of birth makes them an adult. Adults sign up with their own account.",
  CLAIM_ALREADY_PENDING: "You already have a claim on this listing waiting for review.",
  CLAIM_NOT_AWAITING_INFO: "This claim isn't waiting for more information.",
  CLAIM_NOT_FOUND: "That claim no longer exists.",
  CLAIM_NOT_PENDING: "That claim has already been reviewed.",
  CLAIM_OPEN: "Someone has filed a claim on this listing. Review the claim first.",
  COACH_ANALYTICS_GUARDIAN_REQUIRED: "A parent or guardian has to turn this on.",
  COACH_ANALYTICS_NOT_AVAILABLE: "Sharing analytics with coaches isn't available for this account.",
  COACH_ANALYTICS_NOT_ON_TEAM: "The player needs to be on this team first.",
  COACH_ANALYTICS_OFF: "Sharing analytics with coaches isn't available yet.",
  COACH_ANALYTICS_SELF_ONLY: "Only the player can turn this on.",
  CONSENT_ALREADY_APPROVED: "Your parent or guardian has already approved your account.",
  CONSENT_METHOD_NOT_ALLOWED: "That way of approving isn't available.",
  CONSENT_NOT_FOUND: "There's no approval on file to withdraw for this child.",
  CONSENT_TOKEN_EXPIRED: "This approval link has expired. Ask your child to send a new one.",
  CONSENT_TOKEN_INVALID:
    "This approval link isn't valid or was already used. Ask your child to send a new one.",
  // A host reopening what has ended: a declined request, a reviewed waitlist entry, a settled payment (20261125100000).
  DECISION_FINAL: "That was already decided, so it can't be reopened.",
  DOB_INVALID: "That date of birth isn't valid. Check the month, day and year.",
  DOB_IN_FUTURE: "A date of birth can't be in the future.",
  DOB_REQUIRED: "Enter your date of birth.",
  DOB_UNCHANGED: "That's already the date of birth on your profile.",
  EMPTY_WAIVER: "Add waiver text before publishing.",
  EVALUATION_MIRROR_NO_RSVP: "We couldn't save this evaluation. Refresh the page and try again.",
  EVENT_FULL: "This event is full.",
  EVENT_NOT_FOUND: "This event is no longer available.",
  EVENT_STARTED: "This event has already started.",
  EVIDENCE_TOO_LONG: "That proof is too long. Keep it under 500 characters.",
  FACILITY_NOT_FOUND: "This venue isn't available right now.",
  FAMILY_POSTS_OFF: "Family clips aren't available yet.",
  FAMILY_POST_AI_OFF:
    "Turn on AI video analysis for this child in the Parent Center first. Every clip is analysed by AI.",
  FAMILY_POST_NOT_GUARDIAN: "Only a verified parent or guardian of this child can do that.",
  // Raised by databases before 20261020160000, which replaced it with FAMILY_POST_UNDER_16_ONLY.
  FAMILY_POST_UNDER_13_ONLY: "Family clips are only for children under 16.",
  FAMILY_POST_UNDER_16_ONLY: "Family clips are only for children under 16.",
  FAMILY_SHARE_BAD_EXPIRY: "Choose a link that lasts between 1 and 30 days.",
  FAMILY_SHARE_NOT_ALLOWED: "Turn on private links for this child in the Parent Center first.",
  FAMILY_SHARE_NOT_OWNER: "Only the parent who added this clip can share it.",
  FAMILY_SHARE_NOT_READY: "This clip isn't ready to share yet, or is on hold.",
  FAMILY_SHARE_OFF: "Sharing links aren't available yet.",
  FAMILY_SHARE_TOO_MANY: "This clip already has 5 active links. Revoke one first.",
  FAMILY_TEAM_CHILD_NOT_ON_TEAM: "Your child isn't on that team.",
  FAMILY_TEAM_NOT_ALLOWED: "Turn on team sharing for this child in the Parent Center first.",
  FAMILY_TEAM_NOT_FAMILY_POST: "Only a family clip can be shared with a team.",
  FAMILY_TEAM_SHARE_OFF: "Sharing with a team isn't available yet.",
  FEATURED_NOT_ALLOWED: "Only BallaCity can feature a venue.",
  // Blocked and unavailable read the same, so a refusal never reveals a block.
  FOLLOW_BLOCKED: "This isn't available to follow.",
  FOLLOW_LOCKED: "A parent or guardian needs to approve your account first.",
  FOLLOW_NOT_ALLOWED: "You can't change this account's followers.",
  FORBIDDEN: "You don't have access to that.",
  // Superadmin only (20261127100000): the funnel's under-18 column changes only through the Funnel card, with a reason.
  FUNNEL_MINOR_COUNTS_LOCKED:
    "The under-18 funnel column changes only from the Funnel card on the Overview tab, which records who changed it and why.",
  FUNNEL_MINOR_COUNTS_REASON_REQUIRED:
    "Say why. To turn the under-18 column on, name counsel's sign-off and its date (at least 20 characters).",
  GAME_APPROVAL_REQUIRED: "The host has to approve your request before you can join.",
  GAME_CANCELLED: "This game was cancelled by the host.",
  // A host reopening a game that is over or called off (20261125100000).
  GAME_CLOSED: "This game is over or called off, so it can't be reopened. Post a new game instead.",
  GAME_COMPLETED: "This game has already ended.",
  // A host can turn the waitlist off, so the join caller adds the waitlist step (joinGateErrorMessage).
  GAME_FULL: "This game is full.",
  GAME_JOINS_CLOSED: "The host has closed joining for this game.",
  GAME_NOT_OPEN: "This game isn't taking players right now.",
  GAME_PARTICIPATION_BLOCKED:
    "A parent or guardian has to allow game participation before you can pay.",
  GAME_PAYMENT_REQUIRED: "The host has to confirm your entry fee before you can join.",
  GAME_SIGNUP_CLOSED: "Signups for this game are closed.",
  // Hint-coded (20261121100000): the database's own sentence, so a message that lost its hint still reads as vetted.
  GAME_TEAM_NOT_MANAGED: "You can only host under a team profile you own or manage.",
  GROUP_LIMIT: "You can have up to 20 groups, with up to 50 players in each.",
  GUARDIAN_APPROVAL_FORBIDDEN:
    "Only the player's parent or guardian can approve this, from their own account.",
  GUARDIAN_APPROVAL_REQUIRED: "A parent or guardian has to approve this first.",
  GUARDIAN_NOT_ELIGIBLE:
    "Your account can't approve for a child right now. Contact support if you think this is a mistake.",
  // set_child_controls (drizzle 0011): a moderator, not the child's guardian, tried to make the profile public.
  GUARDIAN_REQUIRED: "Only a verified parent or guardian can make a child's profile public.",
  HANDLE_TAKEN: "That handle is already taken.",
  HANDOVER_ALREADY_PENDING:
    "A handover is already waiting for this account. Cancel it first if you want to start a new one.",
  HANDOVER_BUSY: "This handover is being finished right now. Try again in a minute.",
  HANDOVER_EMAIL_FAILED:
    "We couldn't send the email, so nothing was changed. Check the address and try again.",
  HANDOVER_EMAIL_INVALID: "Enter a full email address, like name@example.com.",
  HANDOVER_EMAIL_IS_OWN:
    "Use the adult's own email address, not yours. They need to be the one who receives it.",
  HANDOVER_EMAIL_UNUSABLE:
    "That email address can't be used. Try a different address, or ask the adult which one to use.",
  HANDOVER_EXPIRED:
    "This link has expired. Ask the person who manages this account to start again.",
  HANDOVER_FAILED: "Something went wrong and nothing was changed. Please try again.",
  HANDOVER_INVALID:
    "This link isn't valid any more. If you already finished, sign in with your email address.",
  HANDOVER_LIMIT: "Too many handover attempts for now. Please try again tomorrow.",
  HANDOVER_NOT_ADULT: "An account can be handed over once the person is 18 or over.",
  HANDOVER_NOT_ALLOWED: "Only the adult who manages this account can hand it over.",
  HANDOVER_UNAVAILABLE: "Handing over an account isn't available yet. Please try again later.",
  // The outcome could not be confirmed (the database did not answer): nothing is put back until it can be read.
  HANDOVER_UNSURE:
    "That did not finish cleanly. Wait two minutes, then open the link again. If it still does not work, ask the person who started it to cancel and start again.",
  HOST_AS_SELF_ADULTS_ONLY:
    "Only adults can host a game without a team profile. Host it under your team instead.",
  ID_TAKEN: "A listing with that handle already exists.",
  IMMUTABLE_FIELDS: "This claim can't be changed that way.",
  INQUIRY_PENDING_LIMIT: "You already have open inquiries with this venue. Wait for a reply first.",
  INQUIRY_RATE_LIMIT: "You've sent a lot of court inquiries today. Try again tomorrow.",
  INVALID_EVALUATION: "Check the score and shorten the notes, then try again.",
  INVALID_EVENT: "Something went wrong saving this event. Please try again.",
  INVALID_FOLLOW_TARGET: "This isn't available to follow.",
  INVALID_KIND: "Choose a team or a trainer.",
  INVALID_LOCATION: "That location couldn't be saved. Pick the place again.",
  INVALID_MESSAGE: "Write a message first (up to 2,000 characters).",
  INVALID_PARENT_EMAIL: "Enter a valid email address for your parent or guardian.",
  INVALID_STATUS: "Pick available, maybe or can't make it.",
  INVALID_TYPE: "That kind of listing can't be removed here.",
  INVITE_DECLINED_RECENTLY: "This player turned down an invite to this game in the last week.",
  INVITE_EXPIRED: "This invite has expired. Ask for a new one.",
  INVITE_INVALID: "This invite link isn't valid.",
  INVITE_LIMIT: "You've reached the invite limit for now. Try again later.",
  INVITE_NOT_AVAILABLE: "This player can't be invited to this game.",
  INVITE_NOT_FOUND: "This invite is no longer available.",
  INVITE_NOT_PENDING: "This invite has already been answered.",
  INVITE_REVOKED: "This invite was cancelled.",
  INVITE_SELF: "You can't accept your own invite.",
  INVITE_USED: "This invite link has already been used.",
  KIND_NOT_ALLOWED: "This type of event can't be listed here.",
  LEGAL_VERSION_INVALID:
    "Our Terms or Privacy Policy couldn't be loaded. Reload the page and try again.",
  LEGAL_VERSION_STALE:
    "Our Terms or Privacy Policy were just updated. Reload the page and try again.",
  LISTING_HIDDEN_MODERATOR_ONLY: "Only BallaCity can change that.",
  LISTING_HIDE_RPC_ONLY: "Couldn't change who can see this. Use Hide or Show on the page instead.",
  LISTING_IN_USE:
    "People have started using this listing (members, posts or reviews), so it can't be removed. Hide it from the Content tab instead.",
  LISTING_NOT_FOUND: "We couldn't find this listing, or you can't change it.",
  LOCATION_IN_PUBLIC_TEXT:
    "Players under 18 can't put an address, map link or gym name in their note. Just mention the sport and the days.",
  MANAGED_CHILD_DELETE_INSTEAD:
    "This child only exists under your account. Delete their profile instead of ending the link.",
  MANAGED_LIMIT:
    "You've reached the limit for child profiles right now. Contact support if you need more.",
  // Thrown by the managed-child and account server functions, not the database.
  MANAGED_SESSION_NOT_ALLOWED: "Switch back to your own account to do that.",
  MANAGED_UNAVAILABLE: "Adding a child isn't available yet. Please try again later.",
  MANAGES_CHECK_FAILED:
    "We couldn't check whether your account manages any children, so nothing was deleted. Please try again.",
  MANAGES_CHILDREN: "Your account can't be deleted while it manages child profiles.",
  MEMBERS_SHARING_NOT_AVAILABLE:
    "Clips of children and young teens can only be shared with family and, if you approve, one team.",
  MEMBER_IDENTITY_FIXED:
    "A membership can't be moved to another person or team. Remove it and send a new invite instead.",
  MEMBER_IDENTITY_LOCKED: "Only a member's role can be changed here.",
  MESSAGE_FIELD_FORBIDDEN: "You can only mark this message as read or accept the request.",
  MESSAGE_NOT_FOUND: "That message isn't available.",
  MESSAGE_REQUIRED: "Write a reply first.",
  MESSAGE_TOO_LONG: "Your message is too long. Keep it under 1,000 characters.",
  MINOR_HANDLE_UNSAFE:
    "Remove personal details like an email, phone number, address or date of birth from the name or username.",
  // The neutral line; the suffix (<reason>:<side>) is worded by minor-messaging.ts.
  MINOR_MESSAGING_BLOCKED: "This person can't receive messages from you right now.",
  MIN_AGE: "You need to be at least 13 to use BallaCity.",
  NAME_INVALID: "Use letters only in your child's name.",
  NAME_REQUIRED: "Enter a name.",
  NOTE_REQUIRED: "Say what information you need from the claimant.",
  NOTE_TOO_LONG: "That note is too long.",
  NOT_ALLOWED: "You can't do that for this player.",
  NOT_AUTHENTICATED: "Sign in to continue.",
  NOT_AUTHORIZED: "Only this child's parent or guardian can do that.",
  NOT_A_MEMBER: "This player isn't on the roster.",
  NOT_CLAIM_OWNER: "That claim belongs to someone else.",
  NOT_FACILITY_STAFF: "Only this venue's owner and admins can do that.",
  NOT_FOUND: "We couldn't find that. It may have been removed or already changed.",
  NOT_GAME_HOST: "Only the game's host can do that.",
  NOT_GUARDIAN: "Only this player's parent or guardian can answer this.",
  NOT_INVITEE: "This invite was sent to someone else.",
  NOT_IN_TEAM_CHAT: "You're not in this team's chat.",
  // Thrown by the managed-child server functions, not the database.
  NOT_MANAGED: "That child has their own login, so you can't switch into their profile.",
  NOT_MODERATOR: "Only moderators can do that.",
  NOT_ON_TEAM: "This player isn't on this team's roster.",
  NOT_REGISTERED: "This player isn't signed up for this event.",
  NOT_SIGNED_IN: "Sign in to continue.",
  NOT_TEAM_MANAGER: "Only the team's owner, managers or coaches can do that.",
  NOT_TEAM_MEMBER_OR_INVITEE: "Only team members or invited players can sign this waiver.",
  NOT_TEAM_OWNER: "Only the team's owner can hand the team over.",
  NOT_TEAM_STAFF: "Only the team's staff can do that.",
  NOT_TRAINER_STAFF: "Only this trainer's staff can do that.",
  NOT_UNCLAIMED_LISTING: "This isn't an unclaimed listing, so it can't be removed here.",
  NOT_YOUR_GUARDIAN_LINK: "You're not a linked parent or guardian for this player.",
  NOT_YOUR_MANAGED_CHILD: "That profile isn't one you created.",
  NO_SUCH_FOLLOW_REQUEST: "That follow request is no longer there.",
  ORG_FLAGS_READONLY: "Those venue settings can't be changed from here.",
  ORG_HIDDEN: "This venue hid this game, so it can't be listed there again.",
  ORG_NOT_MANAGER: "Only the venue's owner or admins can do that.",
  ORG_PRIVATE_RUN: "Only public games can be listed on a venue's page.",
  OUTSIDE_AGE_RANGE: "This event is for a different age group.",
  OWNER_NOT_INVITABLE:
    "The owner role can't be given out. To hand the team over, use Transfer ownership.",
  OWNER_NOT_REMOVABLE: "The team owner can't be removed from the team.",
  OWNER_ROLE_FIXED:
    "The owner role can't be changed here. To hand the team over, use Transfer ownership.",
  OWNER_SET_BY_CLAIM_ONLY: "Ownership can only change through an approved claim or a transfer.",
  OWN_CLAIM: "You can't review your own claim. Another moderator has to.",
  PARTICIPANT_FIELD_FORBIDDEN: "You can only change your own position in this game.",
  PAYMENTS_NOT_AVAILABLE: PAYMENTS_BLOCKED_MESSAGE,
  PAYMENT_DESTINATION_INVALID: "This payment has to go to the game's host.",
  PAYMENT_FIELD_FORBIDDEN: "This payment can't be changed right now.",
  POST_AGE_NOT_ALLOWED: "Posting isn't available for your account.",
  POST_AUDIENCE_NOT_ALLOWED: "You can't share a post with that audience.",
  POST_DELETED: "That post was deleted.",
  POST_LOCKED: "A parent or guardian needs to approve your account first.",
  POST_OWNER_FIXED: "You can't change who a post is from.",
  POST_TARGET_INVALID: "You can't post for that team or venue.",
  RATE_LIMITED: "You're sending messages too fast. Wait a moment and try again.",
  REASON_REQUIRED: "Tell us why your date of birth needs correcting (at least 10 characters).",
  REASON_TOO_LONG: "That reason is too long.",
  REEL_MEDIA_PATH_FORBIDDEN: "This video couldn't be attached. Upload it again.",
  REEL_MEDIA_PATH_INVALID: "This video couldn't be attached. Upload it again.",
  RELATIONSHIP_REQUIRED: "Say how you're connected to this listing.",
  REPORT_FIELDS_FIXED: "Only the review status and notes of a report can be changed.",
  REQUEST_NOT_FOUND: "This join request no longer exists.",
  REQUEST_NOT_PENDING: "This join request is already closed.",
  REQUEST_PENDING: "You already have a date of birth correction waiting for review.",
  REVIEW_HELD_FOR_SCREENING: "Your review will be published after screening.",
  ROLE_WRITE_FORBIDDEN: "You don't have access to that.",
  // A waitlist entry or payment submission keeps who and which game it is about (20261125100000).
  ROW_IDENTITY_FIXED: "This can't be moved to another person or game.",
  SELF_INVITE: "You can't invite yourself.",
  // Hint-coded (20261122100000), in the database's own words like GAME_TEAM_NOT_MANAGED.
  SERIES_ALREADY: "This game is already part of a series.",
  SERIES_BAD_FREQ: "A game can repeat every week or every 2 weeks.",
  SERIES_BAD_UNTIL: "The last date must be on or after the first game.",
  SERIES_GAME_NOT_OPEN: "Only an upcoming, listed game can repeat.",
  SERIES_NOT_HOST: "Only the host can make this game repeat.",
  SUPERADMIN_ONLY: "You don't have access to that.",
  TARGET_NOT_MANAGER: "You can only hand the team to a manager. Make them a manager first.",
  TEAM_NOT_FOUND: "That team no longer exists.",
  TEEN_TEAM_GUARDIAN_ONLY: "Only a verified parent or guardian can approve this.",
  TEEN_TEAM_INCOMPLETE: "Choose a team to approve.",
  TEEN_TEAM_NOT_AVAILABLE: "Team sharing is only for reels from players aged 13 to 15.",
  TEEN_TEAM_NOT_ON_TEAM: "Your child needs to be on that team.",
  TEEN_TEAM_NOT_READY: "The reel has to be finished, posted and not on hold first.",
  TOKEN_INVALID: "We couldn't create the invite link. Please try again.",
  TOO_MANY_INVITES: "You have too many open family invites. Cancel one first.",
  TRAINER_NOT_FOUND: "This trainer isn't available right now.",
  // The old rsvp_tryout (drizzle 0013), read as the events codes that replaced them.
  TRYOUT_FULL: "This event is full.",
  TRYOUT_NOT_FOUND: "This event is no longer available.",
  TRYOUT_PASSED: "This event has already started.",
  UNKNOWN_FIELD: "Something went wrong saving this event. Please try again.",
  USER_MISMATCH: "You can only claim a listing for yourself.",
  WAIVER_NOT_FOUND: "That waiver no longer exists. Reload the page and try again.",
  WAIVER_NOT_PUBLISHED: "This waiver was updated. Reload the page and sign the new one.",
  WAIVER_REQUIRED: "Sign the waiver first.",
} as const satisfies Record<string, string>;

export type UserErrorCode = keyof typeof USER_ERROR_MESSAGES;

/**
 * A code the database raises with different detail text in different situations, and the sentence for each. Matched
 * against the whole message in order; the first match wins, else the code's catalog sentence.
 */
export type UserErrorVariant = { code: UserErrorCode; when: RegExp; message: string };

export const USER_ERROR_VARIANTS: readonly UserErrorVariant[] = [
  // create_minor_invite checks only that the caller is an adult; provision_managed_child also wants a confirmed email.
  {
    code: "ADULT_REQUIRED",
    when: /add a minor/i,
    message: "Only adult accounts can invite a child.",
  },
  // Payments (20261111120000, 20261119200000): the payment sentences live in payments-policy.ts.
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /this player must add .*before paying/i,
    message: PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE,
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /before taking payments/i,
    message: PAYMENTS_HOST_AGE_REQUIRED_MESSAGE,
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /before paying for a game/i,
    message: PAYMENTS_AGE_REQUIRED_MESSAGE,
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /your player must add/i,
    message:
      "Your child's account needs a date of birth before they can join a team. Once it's added, approve again.",
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /this player must add .*joining games/i,
    message: "This player needs to add their date of birth before they can join games.",
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /before joining a team/i,
    message: "Add your date of birth in your profile before joining a team.",
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /before joining games/i,
    message: "Add your date of birth in your profile before joining games.",
  },
  {
    code: "AGE_VERIFICATION_REQUIRED",
    when: /add your date of birth first/i,
    message: "Add your date of birth first, then open the invite again.",
  },
  {
    code: "ATTESTATION_REQUIRED",
    when: /parent or legal guardian/i,
    message: "Confirm that you're this child's parent or legal guardian.",
  },
  {
    code: "ATTESTATION_REQUIRED",
    when: /behalf/i,
    message: "Confirm that you're signing on your child's behalf.",
  },
  { code: "AUTH_REQUIRED", when: /add your child/i, message: "Sign in to add your child." },
  { code: "AUTH_REQUIRED", when: /family invitation/i, message: "Sign in to accept this invite." },
  {
    code: "AUTH_REQUIRED",
    when: /date of birth/i,
    message: "Sign in again, then add your date of birth.",
  },
  { code: "DOB_REQUIRED", when: /child/i, message: "Enter your child's date of birth." },
  // The claim-refusal codes of a manual payment (enforce_payment_claim_preconditions): what to do about money sent.
  ...(
    [
      "GAME_CANCELLED",
      "GAME_COMPLETED",
      "GAME_JOINS_CLOSED",
      "GAME_FULL",
      "GAME_PARTICIPATION_BLOCKED",
      "BLOCKED_BY_HOST",
    ] as const
  ).map((code) => ({ code, when: /payment/i, message: paymentClaimRefusalMessage(code) })),
  {
    code: "AGE_REQUIREMENT_NOT_MET",
    when: /age requirement/i,
    message: paymentClaimRefusalMessage("AGE_REQUIREMENT_NOT_MET"),
  },
  {
    code: "GUARDIAN_APPROVAL_REQUIRED",
    when: /payment/i,
    message: PAYMENTS_GUARDIAN_APPROVAL_MESSAGE,
  },
  {
    code: "GUARDIAN_APPROVAL_REQUIRED",
    when: /join request/i,
    message: "A parent or guardian has to approve this request before you can join.",
  },
  {
    code: "GUARDIAN_APPROVAL_REQUIRED",
    when: /invite/i,
    message: "A parent or guardian has to approve this invite first.",
  },
  {
    code: "INVITE_LIMIT",
    when: /30 players/i,
    message: "You can invite up to 30 players at once.",
  },
  {
    code: "INVITE_LIMIT",
    when: /waiting for an answer/i,
    message: "This game already has 50 invites waiting for an answer. Wait for some replies first.",
  },
  {
    code: "INVITE_LIMIT",
    when: /a day/i,
    message: "You can send up to 100 invites a day. Try again tomorrow.",
  },
  {
    code: "INVITE_NOT_AVAILABLE",
    when: /can't be accepted/i,
    message: "This invite can't be accepted.",
  },
  { code: "NAME_REQUIRED", when: /child/i, message: "Enter your child's first name." },
  { code: "NOT_FOUND", when: /invitation/i, message: "This invite is no longer open." },
  {
    code: "NOT_FOUND",
    when: /correction/i,
    message: "That correction request no longer exists.",
  },
  { code: "NOT_FOUND", when: /facility/i, message: "This game isn't listed at this venue." },
  { code: "PAYMENTS_NOT_AVAILABLE", when: /host account/i, message: PAYMENTS_HOST_BLOCKED_MESSAGE },
  {
    code: "SERIES_NOT_HOST",
    when: /stop this series/i,
    message: "Only the host can stop this series.",
  },
];

/**
 * Words for a code that one feature says better than the catalog can, because the database raises it bare (no detail
 * text for a variant to match) and the feature knows what the member may do instead. Its mapper checks the code
 * (errorCode) before it asks the catalog.
 */
export const FEATURE_ERROR_MESSAGES = {
  // set_team_event_availability (20261016130000) and set_event_availability (20261106220000): NOT_ALLOWED, bare.
  availabilityNotAllowed:
    "You can only answer for yourself or a child you're the verified parent or guardian of.",
  // cancel_event_registration (20261107180000), the tryout sign-up screens: NOT_ALLOWED, bare.
  signupNotAllowed: "You can only change your own or your linked children's sign-ups.",
  // reviewJoinRequest (payments.ts): a host's decline that reached a request already approved, e.g. the player accepted
  // the host's invitation meanwhile (WP 5.5).
  declineAlreadyApproved:
    "This player already has a place in this game, so there's nothing to decline. To take it back, use Remove on the roster.",
} as const;

/**
 * Refusals some database functions and triggers raise as a plain sentence with no code, and the sentence each reads
 * as. They tell the member why the action can't work (retrying won't help), so they must not fall to a "Please try
 * again" fallback. Each pattern matches the whole message, so a sentence wrapped in other text is not taken for one.
 */
export const DATABASE_SENTENCE_REFUSALS: readonly { when: RegExp; message: string }[] = [
  // enforce_review_integrity (20261108100000_minor_review_privacy.sql).
  {
    when: /^The 14-day review window for this game has closed\.?$/,
    message: "The 14-day review window for this game has closed.",
  },
  {
    when: /^Daily review limit reached\. Try again tomorrow\.?$/,
    message: "You've reached today's review limit. Try again tomorrow.",
  },
  {
    when: /^You can only review people you have played, trained or teamed up with\.?$/,
    message: "You can only review people you have played, trained or teamed up with.",
  },
  {
    when: /^Review is too long \(max 2000 characters\)\.?$/,
    message: "Your review is too long. Keep it under 2,000 characters.",
  },
  {
    when: /^Review must be at least 8 characters\.?$/,
    message: "Your review is too short. Write at least 8 characters.",
  },
  {
    when: /^Title too long \(max 120 characters\)\.?$/,
    message: "That title is too long. Keep it under 120 characters.",
  },
  { when: /^Pick up to 5 tags\.?$/, message: "Pick up to 5 tags." },
  // validate_join_request (20261103140000_payment_settings_host_guard.sql).
  { when: /^This game has ended\.?$/, message: USER_ERROR_MESSAGES.GAME_COMPLETED },
  // Also guardian_cancel_child_game (20261008160000).
  { when: /^This game has already started\.?$/, message: "This game has already started." },
  {
    when: /^Signups are closed for this game\.?$/,
    message: USER_ERROR_MESSAGES.GAME_SIGNUP_CLOSED,
  },
  {
    when: /^Hosts cannot request to join their own game\.?$/,
    message: "You're hosting this game, so you don't need to request a spot in it.",
  },
  // validate_join_request and the venue join-request trigger (20260719232124).
  {
    when: /^Message too long \(max 500 characters\)\.?$/,
    message: "Your message is too long. Keep it under 500 characters.",
  },
  // guardian_cancel_child_game (20261008160000_guardian_cancel_child_game.sql).
  { when: /^Game not found\.?$/, message: "This game is no longer available." },
  {
    when: /^This game is no longer on\.?$/,
    message: "This game was cancelled or has already ended.",
  },
  {
    when: /^You can only cancel for a child linked to your account\.?$/,
    message: "You can only cancel for a child linked to your account.",
  },
  // approve_org_member_request / deny_org_member_request (20260719232124).
  {
    when: /^Request is no longer pending\.?$/,
    message: "This request was already handled. Refresh to see it.",
  },
  {
    when: /^Request not found\.?$/,
    message: "This request no longer exists. Refresh to see the latest.",
  },
  {
    when: /^Already a member of this organization\.?$/,
    message: "You're already a member of this venue.",
  },
  // accept_trainer_org_invite (20261027160000_trainer_org_no_forged_affiliation.sql).
  { when: /^Invite is no longer pending\.?$/, message: USER_ERROR_MESSAGES.INVITE_NOT_PENDING },
  { when: /^Invite not found\.?$/, message: USER_ERROR_MESSAGES.INVITE_NOT_FOUND },
  // game_series_start / game_series_stop (20261122100000_game_series.sql) raise these with SQLSTATE 42501 and no
  // HINT; matched here, before the 42501 permission sentence, so a signed-out host is told to sign in.
  { when: /^Sign in to make a game repeat\.?$/, message: "Sign in to make a game repeat." },
  { when: /^Sign in first\.?$/, message: USER_ERROR_MESSAGES.AUTH_REQUIRED },
  // mark_refund_sent (20261008170000_guardian_refund_notices.sql).
  {
    when: /^Payment not found\.?$/,
    message: "This payment no longer exists. Refresh to see the latest.",
  },
];

/** The sentences for failures that carry no code of ours. */
export const GENERIC_ERROR_MESSAGES = {
  offline: "We couldn't connect. Check your internet connection and try again.",
  session: "Your session has ended. Sign in again to continue.",
  permission: "You don't have permission to do that.",
  duplicate: "That already exists. Refresh the page to see it.",
} as const;

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Whether `code` has a sentence in the catalog. */
export function isUserErrorCode(code: string | null | undefined): code is UserErrorCode {
  return !!code && hasOwn(USER_ERROR_MESSAGES, code);
}

/**
 * Sentences that are already ours: a server function that mapped its error before throwing, an AI error, a payment
 * refusal, a post the moderation screen blocked. Passed on as they are instead of being replaced by a fallback.
 */
const VETTED: ReadonlySet<string> = new Set<string>([
  ...Object.values(USER_ERROR_MESSAGES),
  ...USER_ERROR_VARIANTS.map((v) => v.message),
  ...Object.values(FEATURE_ERROR_MESSAGES),
  ...DATABASE_SENTENCE_REFUSALS.map((r) => r.message),
  ...Object.values(GENERIC_ERROR_MESSAGES),
  ...Object.values(AI_ERROR_MESSAGES),
  ...PAYMENT_POLICY_MESSAGES,
  ...PAYMENT_TRIGGER_REFUSALS.map((r) => r.message),
  PAYMENT_SAVE_FAILED_MESSAGE,
  POST_BLOCKED_MESSAGE,
]);

function textOf(err: unknown, depth: number): string | undefined {
  if (typeof err === "string") return err.trim() || undefined;
  if (!err || typeof err !== "object" || depth > 2) return undefined;
  const o = err as Record<string, unknown>;
  for (const key of ["message", "error_description", "msg"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  // A {data, error} result passed whole.
  return textOf(o.error, depth + 1);
}

/**
 * The message an error carries: an Error's message, a PostgREST {message, code, details, hint} object's message, a
 * string, or a server function's error. Undefined when there is none. Never throws.
 */
export function errorText(err: unknown): string | undefined {
  try {
    return textOf(err, 0);
  } catch {
    return undefined;
  }
}

/** `CODE` or `CODE: detail` (also `CODE:detail` and a bare `CODE`) at the start of the message. */
const LEADING_CODE = /^\s*([A-Z][A-Z0-9_]*[A-Z0-9])\s*(?::|$)/;
/**
 * An all-caps token not glued to other word characters (no lookbehind: older Safari can't parse it). Only a token
 * with an underscore counts as a code inside other text: a plain capital word such as BLOCKED or FORBIDDEN in the
 * middle of a gateway's or proxy's answer ("Request BLOCKED by policy", "403 FORBIDDEN") is not ours.
 */
const CODE_TOKEN = /(?:^|[^A-Za-z0-9_])([A-Z][A-Z0-9_]*[A-Z0-9])(?=[^A-Za-z0-9_]|$)/g;
/** A HINT that is a code (`USING HINT = 'SERIES_NOT_HOST'`), not a sentence of advice. */
const HINT_CODE = /^[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]$/;

function hintOf(err: unknown, depth: number): string | undefined {
  if (!err || typeof err !== "object" || depth > 2) return undefined;
  const o = err as Record<string, unknown>;
  const hint = typeof o.hint === "string" ? o.hint.trim() : "";
  if (HINT_CODE.test(hint)) return hint;
  // A {data, error} result passed whole.
  return hintOf(o.error, depth + 1);
}

/**
 * The machine code in an error: the `CODE` of `CODE: text` (any code with an underscore, or a catalog code), else a
 * catalog code with an underscore found as a whole token anywhere in the message (Postgres and PostgREST sometimes
 * wrap it, as in "P0001: ADULT_REQUIRED: ..."), else a code-shaped HINT (the newest functions raise a plain sentence with the code
 * there). Undefined when there is none. Never the SQLSTATE in a PostgREST error's `code`.
 */
export function errorCode(err: unknown): string | undefined {
  try {
    const text = errorText(err) ?? "";
    const lead = LEADING_CODE.exec(text)?.[1];
    if (lead && (lead.includes("_") || isUserErrorCode(lead))) return lead;
    for (const m of text.matchAll(CODE_TOKEN)) {
      if (m[1].includes("_") && isUserErrorCode(m[1])) return m[1];
    }
    return hintOf(err, 0);
  } catch {
    return undefined;
  }
}

/**
 * The catalog sentence for an error we know: one carrying a catalog code (worded per its detail text where the
 * database raises it in several situations), a plain-sentence database refusal (DATABASE_SENTENCE_REFUSALS), or one
 * whose message is already one of our sentences. Undefined
 * otherwise; no generic shapes and no fallback, so feature mappers can keep their own.
 */
export function knownErrorMessage(err: unknown): string | undefined {
  const text = errorText(err) ?? "";
  const code = errorCode(err);
  if (isUserErrorCode(code)) {
    if (code === "MINOR_MESSAGING_BLOCKED") {
      return minorMessagingMessage(text, "chat") ?? USER_ERROR_MESSAGES[code];
    }
    const variant = USER_ERROR_VARIANTS.find((v) => v.code === code && v.when.test(text));
    return variant?.message ?? USER_ERROR_MESSAGES[code];
  }
  const refusal = DATABASE_SENTENCE_REFUSALS.find((r) => r.when.test(text));
  if (refusal) return refusal.message;
  return VETTED.has(text) ? text : undefined;
}

const OFFLINE_TEXT =
  /failed to fetch|networkerror|network request failed|network error|load failed|fetch failed|err_network|err_internet_disconnected|econnrefused|econnreset|enotfound|eai_again|etimedout|socket hang up/i;
const SESSION_TEXT =
  /jwt expired|invalid jwt|jwserror|jwt malformed|auth session missing|refresh token|session (?:has )?expired|session_not_found|^unauthorized\b|^not authenticated\b/i;
// The last alternative is the bare "Forbidden" that assertModerator / assertSuperadmin throw for a missing role.
const PERMISSION_TEXT =
  /row-level security|permission denied|insufficient privilege|^Forbidden\.?$/i;
const DUPLICATE_TEXT = /duplicate key value|violates unique constraint/i;

function field(err: unknown, key: string): unknown {
  try {
    return err && typeof err === "object" ? (err as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}

/** The generic failure an uncoded error is, if it is one we can name. */
function genericMessage(err: unknown, text: string): string | undefined {
  const sqlState = field(err, "code");
  const name = field(err, "name");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline || OFFLINE_TEXT.test(text) || name === "AuthRetryableFetchError") {
    return GENERIC_ERROR_MESSAGES.offline;
  }
  if (
    sqlState === "PGRST301" ||
    sqlState === "PGRST302" ||
    sqlState === "PGRST303" ||
    field(err, "status") === 401 ||
    SESSION_TEXT.test(text)
  ) {
    return GENERIC_ERROR_MESSAGES.session;
  }
  if (sqlState === "42501" || PERMISSION_TEXT.test(text)) return GENERIC_ERROR_MESSAGES.permission;
  if (sqlState === "23505" || DUPLICATE_TEXT.test(text)) return GENERIC_ERROR_MESSAGES.duplicate;
  return undefined;
}

/**
 * What to show a member for any error: the catalog sentence for a known code, a generic sentence for a network,
 * session, permission or duplicate failure, else `fallback`. Never the raw database or network text.
 */
export function userErrorMessage(err: unknown, fallback: string): string {
  try {
    return knownErrorMessage(err) ?? genericMessage(err, errorText(err) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

/** The claim-refusal code a database error starts with ("GAME_FULL: ..."), whole codes only. */
function claimRefusalCodeOf(raw: string): PaymentClaimRefusalCode | null {
  const code = /^\s*([A-Z][A-Z_]*):/.exec(raw)?.[1];
  return (PAYMENT_CLAIM_REFUSAL_CODES as readonly string[]).includes(code ?? "")
    ? (code as PaymentClaimRefusalCode)
    : null;
}

/**
 * What the payment screens show when a player's payment claim, or a host's review of one, fails. The triggers
 * enforce_game_payment_cohort, enforce_guardian_before_payment and enforce_payment_claim_preconditions answer with a
 * code, read here in the payment's context (the sentences are payments-policy.ts's); the older triggers that refuse
 * with a plain sentence (card or bank details, host approval, host-only review) read as PAYMENT_TRIGGER_REFUSALS words
 * them; anything else reads as userErrorMessage reads it, with PAYMENT_SAVE_FAILED_MESSAGE when there are no better
 * words. Pass the error itself where there is one, so its SQLSTATE and hint are read too. It lives here, not in
 * payments-policy.ts, because this module imports that one.
 */
export function paymentSubmissionErrorMessage(err: unknown): string {
  const raw = errorText(err) ?? "";
  const refusal = claimRefusalCodeOf(raw);
  if (refusal) return paymentClaimRefusalMessage(refusal);
  if (raw.includes("AGE_VERIFICATION_REQUIRED")) {
    // A host confirming another player's claim, or a host whose own account has no date of birth.
    if (raw.includes("this player must add")) return PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE;
    if (raw.includes("before taking payments")) return PAYMENTS_HOST_AGE_REQUIRED_MESSAGE;
    return PAYMENTS_AGE_REQUIRED_MESSAGE;
  }
  if (raw.includes("GUARDIAN_APPROVAL_REQUIRED")) return PAYMENTS_GUARDIAN_APPROVAL_MESSAGE;
  if (raw.includes("PAYMENTS_NOT_AVAILABLE"))
    return raw.includes("host account") ? PAYMENTS_HOST_BLOCKED_MESSAGE : PAYMENTS_BLOCKED_MESSAGE;
  const trigger = PAYMENT_TRIGGER_REFUSALS.find((r) => r.when.test(raw));
  if (trigger) return trigger.message;
  return userErrorMessage(err, PAYMENT_SAVE_FAILED_MESSAGE);
}
