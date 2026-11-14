import { describe, it, expect } from "vitest";
import {
  blockOutranksApproval,
  checkStateOf,
  payEntryBlock,
  gameTakesNoPayment,
  payEntryView,
  payHostLinkShown,
  payPalOffered,
  PARTICIPATION_BLOCKED_FALLBACK,
  type PayEntryInput,
} from "./pay-entry-gate";
import { can, DEFAULT_CHILD_CONTROLS } from "./child-policy";
import { resolveJoinGate, type JoinState } from "./live-status";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_GUARDIAN_APPROVAL_MESSAGE,
} from "./payments-policy";
import type { Game } from "./sample-data";

const open = { locked: false, reason: "", joinState: "open" as const };
const closed = {
  locked: true,
  reason: "The host has closed joining for this game.",
  joinState: "closed_by_host" as const,
};
const allowed = { allowed: true, level: "allowed" as const, reason: null };

const fresh = { holdsPlace: false, paymentIn: false, approved: false };
const inFlowCases = [
  { name: "holds a place", holdsPlace: true, paymentIn: false, approved: false },
  { name: "has a payment in", holdsPlace: false, paymentIn: true, approved: false },
  { name: "is approved", holdsPlace: false, paymentIn: false, approved: true },
];

function input(over: Partial<PayEntryInput> = {}): PayEntryInput {
  return {
    ...fresh,
    gate: open,
    participation: allowed,
    payments: allowed,
    guardianReady: true,
    ...over,
  };
}

/** The real join gate for a game in each lock state, so the tests use the reasons the page shows. */
function gateFor(state: JoinState) {
  const now = Date.parse("2026-11-14T18:00:00Z");
  const base = {
    id: "g",
    date: new Date(now + 24 * 3600_000).toISOString(),
    duration: "90 min",
    status: "scheduled",
  } as unknown as Game;
  const game: Game = {
    ...base,
    ...(state === "cancelled" ? { status: "cancelled" } : {}),
    ...(state === "completed" ? { date: new Date(now - 5 * 3600_000).toISOString() } : {}),
    ...(state === "in_progress" ? { date: new Date(now - 30 * 60_000).toISOString() } : {}),
    ...(state === "closed_by_host" ? { joinsClosed: true } : {}),
    ...(state === "closed_cutoff"
      ? { date: new Date(now + 30 * 60_000).toISOString(), signupCutoffMin: 60 }
      : {}),
  } as Game;
  const gate = resolveJoinGate(game, now);
  expect(gate.joinState).toBe(state);
  return gate;
}

describe("payEntryBlock", () => {
  it("lets an allowed viewer pay on an open game", () => {
    expect(payEntryBlock(input())).toBeNull();
  });

  describe("payments (enforce_game_payment_cohort refuses every new claim)", () => {
    it("blocks a 13-15 account with the payments message, before any other rule", () => {
      const subject = { cohort: "teen_13_15" as const, consent: { status: "approved" } };
      const block = payEntryBlock(
        input({
          gate: gateFor("cancelled"),
          participation: can("game_participation", subject as never),
          payments: can("game_payments", subject as never),
          guardianReady: false,
        }),
      );
      expect(block).toEqual({ kind: "payments", message: PAYMENTS_BLOCKED_MESSAGE });
    });

    it("blocks an under-13 account", () => {
      const subject = { cohort: "child_under_13" as const, consent: { status: "approved" } };
      expect(payEntryBlock(input({ payments: can("game_payments", subject as never) }))?.kind).toBe(
        "payments",
      );
    });

    it("tells an account with no date of birth to add it", () => {
      const subject = { cohort: "unknown" as const };
      expect(
        payEntryBlock(
          input({ payments: can("game_payments", subject as never), ageUnknown: true }),
        ),
      ).toEqual({ kind: "payments", message: PAYMENTS_AGE_REQUIRED_MESSAGE });
    });

    it("gives the consent reason when a parent has not approved the account", () => {
      const block = payEntryBlock(
        input({
          payments: {
            allowed: false,
            level: "protected",
            reason: "A parent or guardian must approve this account first.",
          },
        }),
      );
      expect(block).toEqual({
        kind: "payments",
        message: "A parent or guardian must approve this account first.",
      });
    });

    it("applies even to a viewer already in the flow: the database refuses any new claim", () => {
      expect(
        payEntryBlock(
          input({
            holdsPlace: true,
            paymentIn: true,
            approved: true,
            payments: { allowed: false, level: "blocked", reason: "Not available" },
          }),
        )?.kind,
      ).toBe("payments");
    });

    it("lets a 16-17 account and an adult pay", () => {
      for (const cohort of ["teen_16_17", "adult"] as const) {
        const subject = { cohort, consent: { status: "approved" } };
        expect(
          payEntryBlock(
            input({
              participation: can("game_participation", subject as never),
              payments: can("game_payments", subject as never),
            }),
          ),
        ).toBeNull();
      }
    });
  });

  describe("participation (the roster gate refuses the place whoever writes it)", () => {
    it("blocks a 16-17 whose guardian turned games off", () => {
      const subject = {
        cohort: "teen_16_17" as const,
        consent: { status: "approved" },
        controls: { ...DEFAULT_CHILD_CONTROLS, gameParticipation: false },
      };
      expect(
        payEntryBlock(
          input({
            participation: can("game_participation", subject as never),
            payments: can("game_payments", subject as never),
          }),
        ),
      ).toEqual({ kind: "participation", message: "A parent or guardian has turned this off." });
    });

    it("blocks a viewer with a payment in or an approval too (no place can follow)", () => {
      expect(
        payEntryBlock(
          input({
            paymentIn: true,
            approved: true,
            participation: { allowed: false, reason: null },
          }),
        ),
      ).toEqual({ kind: "participation", message: PARTICIPATION_BLOCKED_FALLBACK });
    });

    it("leaves a viewer who already holds a place alone", () => {
      expect(
        payEntryBlock(input({ holdsPlace: true, participation: { allowed: false, reason: "x" } })),
      ).toBeNull();
    });
  });

  describe("guardian (enforce_guardian_before_payment, game_payment_guardian_ready)", () => {
    it("blocks a guarded 16-17 whose request the host approved but the guardian has not", () => {
      // The host's approval clears the approval card and makes the host's handles readable; the guardian's is
      // still missing, so game_payment_guardian_ready answers false.
      const subject = { cohort: "teen_16_17" as const, consent: { status: "approved" } };
      expect(
        payEntryBlock(
          input({
            approved: true,
            participation: can("game_participation", subject as never),
            payments: can("game_payments", subject as never),
            guardianReady: false,
          }),
        ),
      ).toEqual({ kind: "guardian", message: PAYMENTS_GUARDIAN_APPROVAL_MESSAGE });
    });

    it("applies to a viewer on the roster or with a payment in too: the trigger refuses every claim", () => {
      for (const c of inFlowCases) {
        expect(payEntryBlock(input({ ...c, guardianReady: false }))?.kind).toBe("guardian");
      }
    });

    it("lets the guarded minor pay once the guardian has approved", () => {
      expect(payEntryBlock(input({ approved: true, guardianReady: true }))).toBeNull();
    });

    it("says a cancelled game first: asking a parent would not help", () => {
      expect(payEntryBlock(input({ gate: gateFor("cancelled"), guardianReady: false }))?.kind).toBe(
        "locked",
      );
    });
  });

  describe("locked game, by join state", () => {
    it("cancelled: blocks every viewer, even one on the roster, with a payment in or approved", () => {
      const gate = gateFor("cancelled");
      for (const c of [fresh, ...inFlowCases]) {
        expect(payEntryBlock(input({ ...c, gate }))).toEqual({
          kind: "locked",
          message: "The host cancelled this game.",
          joinState: "cancelled",
        });
      }
    });

    it("completed: blocks anyone who does not hold a place, approved or with a payment in included", () => {
      const gate = gateFor("completed");
      for (const c of [fresh, inFlowCases[1], inFlowCases[2]]) {
        expect(payEntryBlock(input({ ...c, gate }))).toEqual({
          kind: "locked",
          message: "This game has ended.",
          joinState: "completed",
        });
      }
      expect(payEntryBlock(input({ ...inFlowCases[0], gate }))).toBeNull();
    });

    for (const state of ["in_progress", "closed_by_host", "closed_cutoff"] as const) {
      it(`${state}: blocks a new viewer with the gate's reason`, () => {
        const gate = gateFor(state);
        expect(payEntryBlock(input({ gate }))).toEqual({
          kind: "locked",
          message: gate.reason,
          joinState: state,
        });
      });

      it(`${state}: keeps the way to pay for a viewer already in the flow, as the server does`, () => {
        const gate = gateFor(state);
        for (const c of inFlowCases) {
          expect(payEntryBlock(input({ ...c, gate })), c.name).toBeNull();
        }
      });
    }

    it("open: no block", () => {
      expect(payEntryBlock(input({ gate: gateFor("open") }))).toBeNull();
    });
  });
});

describe("payEntryBlock: the viewer's flow state only ever lifts a block", () => {
  // payEntryView relies on this to show 'clear' (and account-level blocks) before that state has loaded.
  it("never blocks a viewer in the flow whom it lets through as a fresh viewer, nor changes an account-level block", () => {
    const states: JoinState[] = [
      "open",
      "cancelled",
      "completed",
      "in_progress",
      "closed_by_host",
      "closed_cutoff",
    ];
    const participations = [allowed, { allowed: false, reason: "off" }];
    for (const state of states) {
      for (const participation of participations) {
        for (const guardianReady of [true, false]) {
          const asFresh = payEntryBlock(
            input({
              gate: state === "open" ? open : gateFor(state),
              participation,
              guardianReady,
            }),
          );
          for (const c of [...inFlowCases, { holdsPlace: true, paymentIn: true, approved: true }]) {
            const inFlow = payEntryBlock(
              input({
                ...c,
                gate: state === "open" ? open : gateFor(state),
                participation,
                guardianReady,
              }),
            );
            if (!asFresh) expect(inFlow).toBeNull();
            if (asFresh && (asFresh.kind === "guardian" || asFresh.joinState === "cancelled")) {
              expect(inFlow).toEqual(asFresh);
            }
          }
        }
      }
    }
  });
});

describe("checkStateOf", () => {
  it("prefers data, then an error, else loading", () => {
    expect(checkStateOf({ data: false, isError: true })).toEqual({ state: "ready", value: false });
    expect(checkStateOf({ data: undefined, isError: true })).toEqual({ state: "error" });
    expect(checkStateOf({ data: null, isError: false })).toEqual({ state: "loading" });
  });
});

describe("payEntryView", () => {
  const readyChild = {
    state: "ready" as const,
    value: { participation: allowed, payments: allowed, ageUnknown: false },
  };
  const ready = (value: boolean) => ({ state: "ready" as const, value });
  const base = {
    ...fresh,
    flow: "ready" as const,
    gate: open,
    child: readyChild,
    guardian: ready(true),
    paymentStarted: false,
    onProofStep: false,
  };

  describe("fails closed for minor safety", () => {
    it("is 'checking' while the child status loads, never clear", () => {
      expect(payEntryView({ ...base, child: { state: "loading" } })).toEqual({ kind: "checking" });
    });

    it("is 'checking' while the guardian check loads, even for a host-approved viewer", () => {
      expect(payEntryView({ ...base, approved: true, guardian: { state: "loading" } })).toEqual({
        kind: "checking",
      });
    });

    it("is 'check_failed' when the child status errored with nothing loaded", () => {
      expect(payEntryView({ ...base, child: { state: "error" } })).toEqual({
        kind: "check_failed",
      });
    });

    it("is 'check_failed' when the guardian check errored", () => {
      expect(payEntryView({ ...base, guardian: { state: "error" } })).toEqual({
        kind: "check_failed",
      });
    });

    it("an error outranks a check still loading", () => {
      expect(
        payEntryView({ ...base, child: { state: "loading" }, guardian: { state: "error" } }).kind,
      ).toBe("check_failed");
    });
  });

  describe("waits for the viewer's own flow state before a block it could lift", () => {
    const participationOff = {
      state: "ready" as const,
      value: {
        participation: { allowed: false, reason: "off" },
        payments: allowed,
        ageUnknown: false,
      },
    };

    it("approved not yet known on closed_by_host: 'checking', not blocked", () => {
      // The request has not been read yet, so approved is still false.
      expect(payEntryView({ ...base, gate: gateFor("closed_by_host"), flow: "loading" })).toEqual({
        kind: "checking",
      });
    });

    it("does not trust in-flow values that are not known yet: still 'checking', never clear", () => {
      for (const c of inFlowCases) {
        expect(
          payEntryView({ ...base, ...c, gate: gateFor("closed_by_host"), flow: "loading" }),
        ).toEqual({ kind: "checking" });
      }
    });

    it("waits on every lock a place, a payment or an approval could lift", () => {
      for (const state of ["in_progress", "closed_cutoff", "completed"] as const) {
        expect(payEntryView({ ...base, gate: gateFor(state), flow: "loading" })).toEqual({
          kind: "checking",
        });
      }
      expect(payEntryView({ ...base, child: participationOff, flow: "loading" })).toEqual({
        kind: "checking",
      });
    });

    it("is 'check_failed' when the request, payments or roster read failed", () => {
      expect(payEntryView({ ...base, gate: gateFor("closed_by_host"), flow: "error" })).toEqual({
        kind: "check_failed",
      });
      expect(payEntryView({ ...base, child: participationOff, flow: "error" })).toEqual({
        kind: "check_failed",
      });
    });

    it("says an account-level block or a cancelled game at once", () => {
      expect(
        payEntryView({ ...base, approved: true, gate: gateFor("cancelled"), flow: "loading" }),
      ).toMatchObject({ kind: "blocked", block: { kind: "locked", joinState: "cancelled" } });
      expect(
        payEntryView({
          ...base,
          flow: "error",
          child: {
            state: "ready",
            value: {
              participation: allowed,
              payments: { allowed: false, level: "blocked", reason: null },
              ageUnknown: false,
            },
          },
        }),
      ).toMatchObject({ kind: "blocked", block: { kind: "payments" } });
      expect(payEntryView({ ...base, guardian: ready(false), flow: "loading" })).toMatchObject({
        kind: "blocked",
        block: { kind: "guardian" },
      });
    });

    it("is clear on an open game while the flow state loads: those inputs only ever lift a block", () => {
      expect(payEntryView({ ...base, flow: "loading" })).toEqual({ kind: "clear" });
      expect(payEntryView({ ...base, flow: "error" })).toEqual({ kind: "clear" });
    });

    it("decides once the flow state is known", () => {
      expect(
        payEntryView({ ...base, approved: true, gate: gateFor("closed_by_host"), flow: "ready" }),
      ).toEqual({ kind: "clear" });
      expect(
        payEntryView({ ...base, gate: gateFor("closed_by_host"), flow: "ready" }),
      ).toMatchObject({ kind: "blocked", block: { kind: "locked" } });
    });

    it("never warns above the proof form before the flow state is known", () => {
      expect(
        payEntryView({
          ...base,
          gate: gateFor("closed_cutoff"),
          flow: "loading",
          paymentStarted: true,
          onProofStep: true,
        }),
      ).toEqual({ kind: "checking" });
    });
  });

  it("is clear for an allowed viewer once both checks answered", () => {
    expect(payEntryView(base)).toEqual({ kind: "clear" });
  });

  it("blocks a host-approved guarded minor whose guardian has not approved", () => {
    const view = payEntryView({ ...base, approved: true, guardian: ready(false) });
    expect(view).toMatchObject({ kind: "blocked", mode: "replace", block: { kind: "guardian" } });
  });

  describe("a viewer who already started paying (don't strand them)", () => {
    it("warns above the proof form on a locked game: the claim is still recorded", () => {
      const view = payEntryView({
        ...base,
        gate: gateFor("closed_cutoff"),
        paymentStarted: true,
        onProofStep: true,
      });
      expect(view).toMatchObject({
        kind: "blocked",
        mode: "warn",
        paymentStarted: true,
        block: { kind: "locked" },
      });
    });

    it("warns above the proof form on a cancelled game too", () => {
      const view = payEntryView({
        ...base,
        approved: true,
        gate: gateFor("cancelled"),
        paymentStarted: true,
        onProofStep: true,
      });
      expect(view).toMatchObject({ kind: "blocked", mode: "warn" });
    });

    it("warns above the proof form when a guardian turned games off", () => {
      const view = payEntryView({
        ...base,
        child: {
          state: "ready",
          value: {
            participation: { allowed: false, reason: "off" },
            payments: allowed,
            ageUnknown: false,
          },
        },
        paymentStarted: true,
        onProofStep: true,
      });
      expect(view).toMatchObject({
        kind: "blocked",
        mode: "warn",
        block: { kind: "participation" },
      });
    });

    it("replaces the options when the claim would be refused anyway (payments, guardian)", () => {
      const payments = payEntryView({
        ...base,
        child: {
          state: "ready",
          value: {
            participation: allowed,
            payments: { allowed: false, level: "blocked", reason: null },
            ageUnknown: false,
          },
        },
        paymentStarted: true,
        onProofStep: true,
      });
      expect(payments).toMatchObject({ kind: "blocked", mode: "replace", paymentStarted: true });
      const guardian = payEntryView({
        ...base,
        guardian: ready(false),
        paymentStarted: true,
        onProofStep: true,
      });
      expect(guardian).toMatchObject({ kind: "blocked", mode: "replace", paymentStarted: true });
    });

    it("replaces the options when no method is on screen (the picker would show the handles)", () => {
      const view = payEntryView({
        ...base,
        gate: gateFor("closed_by_host"),
        paymentStarted: true,
        onProofStep: false,
      });
      expect(view).toMatchObject({ kind: "blocked", mode: "replace" });
    });

    it("replaces the options for a viewer who has not started (a preselected method is not a start)", () => {
      const view = payEntryView({
        ...base,
        gate: gateFor("closed_by_host"),
        paymentStarted: false,
        onProofStep: true,
      });
      expect(view).toMatchObject({ kind: "blocked", mode: "replace", paymentStarted: false });
    });
  });
});

describe("blockOutranksApproval", () => {
  it("puts an account-level or permanent block before 'Payment unlocks after the host approves you'", () => {
    for (const block of [
      { kind: "payments" as const, message: "" },
      { kind: "participation" as const, message: "" },
      { kind: "guardian" as const, message: "" },
      { kind: "locked" as const, message: "", joinState: "cancelled" as const },
      { kind: "locked" as const, message: "", joinState: "completed" as const },
    ]) {
      expect(blockOutranksApproval(block, true)).toBe(true);
    }
  });

  it("keeps the approval card for a pending request on a lock the host's approval lifts", () => {
    for (const joinState of ["in_progress", "closed_by_host", "closed_cutoff"] as const) {
      expect(blockOutranksApproval({ kind: "locked", message: "", joinState }, true)).toBe(false);
      // No request (or a declined one): the host cannot approve their way in, so the block is said.
      expect(blockOutranksApproval({ kind: "locked", message: "", joinState }, false)).toBe(true);
    }
  });
});

describe("gameTakesNoPayment", () => {
  it("is a cancelled game for everyone and an ended one for a viewer without a place", () => {
    expect(gameTakesNoPayment("cancelled", false)).toBe(true);
    expect(gameTakesNoPayment("cancelled", true)).toBe(true);
    expect(gameTakesNoPayment("completed", false)).toBe(true);
    expect(gameTakesNoPayment("completed", true)).toBe(false);
    for (const state of ["open", "in_progress", "closed_by_host", "closed_cutoff"] as const) {
      expect(gameTakesNoPayment(state, false)).toBe(false);
    }
  });

  it("agrees with payEntryBlock for a host-approved viewer with a payment in", () => {
    for (const state of ["cancelled", "completed"] as const) {
      for (const holdsPlace of [false, true]) {
        const block = payEntryBlock(
          input({ holdsPlace, paymentIn: true, approved: true, gate: gateFor(state) }),
        );
        expect(!!block).toBe(gameTakesNoPayment(state, holdsPlace));
      }
    }
  });
});

describe("payPalOffered", () => {
  it("is not offered on an ended or cancelled game (paypal_payment_precondition refuses every player)", () => {
    expect(payPalOffered("completed")).toBe(false);
    expect(payPalOffered("cancelled")).toBe(false);
  });

  it("is offered wherever the server can still take it", () => {
    for (const state of ["open", "in_progress", "closed_by_host", "closed_cutoff"] as const) {
      expect(payPalOffered(state)).toBe(true);
    }
  });

  it("leaves a rostered player on an ended game a way to pay: the page clears them, PayPal aside", () => {
    expect(payEntryBlock(input({ holdsPlace: true, gate: gateFor("completed") }))).toBeNull();
  });
});

describe("payHostLinkShown (the game page's paid CTA)", () => {
  const link = {
    joinState: "open" as JoinState,
    holdsPlace: false,
    paymentPending: false,
    isPaid: true,
    paymentCleared: false,
    approvalCleared: true,
    canEnterPaymentFlow: true,
    parentAsk: false,
    lockedForNewJoin: false,
    consentBlocksNewJoin: false,
  };

  it("is a link for a viewer who may pay", () => {
    expect(payHostLinkShown(link)).toBe(true);
  });

  it("is the disabled button for a new viewer on a locked game", () => {
    expect(payHostLinkShown({ ...link, lockedForNewJoin: true })).toBe(false);
  });

  it("is the disabled button for a consent-blocked new viewer", () => {
    expect(payHostLinkShown({ ...link, consentBlocksNewJoin: true })).toBe(false);
  });

  it("is not a link on a cancelled game, even for a host-approved viewer or one on the roster", () => {
    expect(payHostLinkShown({ ...link, joinState: "cancelled" })).toBe(false);
    expect(payHostLinkShown({ ...link, joinState: "cancelled", holdsPlace: true })).toBe(false);
  });

  it("is not a link on an ended game for a viewer without a place", () => {
    expect(payHostLinkShown({ ...link, joinState: "completed" })).toBe(false);
    expect(payHostLinkShown({ ...link, joinState: "completed", holdsPlace: true })).toBe(true);
  });

  it("keeps a pending payment's 'View status' link on a game that takes no payment", () => {
    expect(payHostLinkShown({ ...link, joinState: "cancelled", paymentPending: true })).toBe(true);
    expect(payHostLinkShown({ ...link, joinState: "completed", paymentPending: true })).toBe(true);
  });

  it("keeps the link on a lock the host's approval lifts (the lockedForNewJoin exemptions decide)", () => {
    for (const joinState of ["in_progress", "closed_by_host", "closed_cutoff"] as const) {
      expect(payHostLinkShown({ ...link, joinState })).toBe(true);
    }
  });

  it("keeps the existing conditions", () => {
    expect(payHostLinkShown({ ...link, isPaid: false })).toBe(false);
    expect(payHostLinkShown({ ...link, paymentCleared: true })).toBe(false);
    expect(payHostLinkShown({ ...link, approvalCleared: false })).toBe(false);
    expect(payHostLinkShown({ ...link, canEnterPaymentFlow: false })).toBe(false);
    expect(payHostLinkShown({ ...link, parentAsk: true })).toBe(false);
  });
});
