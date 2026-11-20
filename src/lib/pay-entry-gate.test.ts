import { describe, it, expect } from "vitest";
import {
  blockOutranksApproval,
  checkStateOf,
  payEntryBlock,
  gameTakesNoPayment,
  payEntryView,
  payHostLinkShown,
  payAwaitsApproval,
  payManualMethodsStep,
  payPalOffered,
  payRiskAckStep,
  payRiskAckView,
  unpaidOnGameTakingNoPayment,
  PARTICIPATION_BLOCKED_FALLBACK,
  MANUAL_GUARDIAN_HOLD_MESSAGE,
  MANUAL_GUARDIAN_HOLD_END_LINK,
  manualGuardianHoldNext,
  type PayEntryInput,
} from "./pay-entry-gate";
import { ageGateMessage, ageGateState, type AgeRequirement } from "./game-age";
import { riskAckReadFrom } from "./risk-ack-tap";
import { SAFETY_ACK_VERSION } from "./safety";
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

describe("payEntryBlock: the game's age range (owner decision 2026-11-18, #430 question 4)", () => {
  const adultsOnly: AgeRequirement = { minAge: 18, maxAge: null };
  const teens: AgeRequirement = { minAge: 13, maxAge: 17 };
  const ageOf = (req: AgeRequirement, viewerAge: number | null) => ({
    state: ageGateState({ req, viewerAge }),
    req,
  });

  it("blocks a fresh viewer outside the range with the game page's wording", () => {
    const block = payEntryBlock(input({ age: ageOf(adultsOnly, 16) }));
    expect(block).toEqual({
      kind: "age",
      message: "This game is 18+ — the host reviews requests outside that range.",
    });
    expect(block?.message).toBe(ageGateMessage("needs_approval", adultsOnly));
    expect(payEntryBlock(input({ age: ageOf(teens, 19) }))?.kind).toBe("age");
    expect(payEntryBlock(input({ age: ageOf(teens, 12) }))?.kind).toBe("age");
  });

  it("blocks a fresh viewer with no birthday on file, as the game page asks them to add one or request", () => {
    const block = payEntryBlock(input({ age: ageOf(adultsOnly, null) }));
    expect(block).toEqual({
      kind: "age",
      message:
        "This game is 18+. Add your birthday to your profile, or request the host's approval.",
    });
  });

  it("lets a viewer inside the range through, at either bound", () => {
    expect(payEntryBlock(input({ age: ageOf(adultsOnly, 18) }))).toBeNull();
    expect(payEntryBlock(input({ age: ageOf(teens, 13) }))).toBeNull();
    expect(payEntryBlock(input({ age: ageOf(teens, 17) }))).toBeNull();
  });

  it("does not apply to a game without a range", () => {
    expect(payEntryBlock(input({ age: ageOf({ minAge: null, maxAge: null }, null) }))).toBeNull();
    expect(payEntryBlock(input({ age: undefined }))).toBeNull();
  });

  it("exempts a viewer in the flow (the server's age rule lets approved and rostered players through)", () => {
    for (const c of inFlowCases) {
      expect(payEntryBlock(input({ ...c, age: ageOf(adultsOnly, 15) }))).toBeNull();
      expect(payEntryBlock(input({ ...c, age: ageOf(adultsOnly, null) }))).toBeNull();
    }
  });

  it("exempts the host, as the game page does", () => {
    expect(payEntryBlock(input({ isHost: true, age: ageOf(adultsOnly, 15) }))).toBeNull();
  });

  it("is said after every other block", () => {
    const age = ageOf(adultsOnly, 15);
    expect(
      payEntryBlock(input({ age, payments: { allowed: false, level: "blocked", reason: null } }))
        ?.kind,
    ).toBe("payments");
    expect(payEntryBlock(input({ age, gate: gateFor("cancelled") }))?.kind).toBe("locked");
    expect(
      payEntryBlock(input({ age, participation: { allowed: false, reason: "off" } }))?.kind,
    ).toBe("participation");
    expect(payEntryBlock(input({ age, guardianReady: false }))?.kind).toBe("guardian");
    expect(payEntryBlock(input({ age, gate: closed }))?.kind).toBe("locked");
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
    const adultsOnly = { minAge: 18, maxAge: null };
    const ages = [
      undefined,
      { state: "eligible" as const, req: adultsOnly },
      { state: "needs_approval" as const, req: adultsOnly },
      { state: "unknown_age" as const, req: adultsOnly },
    ];
    for (const state of states) {
      for (const participation of participations) {
        for (const guardianReady of [true, false]) {
          for (const age of ages) {
            const asFresh = payEntryBlock(
              input({
                gate: state === "open" ? open : gateFor(state),
                participation,
                guardianReady,
                age,
              }),
            );
            for (const c of [
              ...inFlowCases,
              { holdsPlace: true, paymentIn: true, approved: true },
            ]) {
              const inFlow = payEntryBlock(
                input({
                  ...c,
                  gate: state === "open" ? open : gateFor(state),
                  participation,
                  guardianReady,
                  age,
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

    it("never shows a block before the flow state is known, even after a start", () => {
      expect(
        payEntryView({
          ...base,
          gate: gateFor("closed_cutoff"),
          flow: "loading",
          paymentStarted: true,
        }),
      ).toEqual({ kind: "checking" });
    });
  });

  it("is clear for an allowed viewer once both checks answered", () => {
    expect(payEntryView(base)).toEqual({ kind: "clear" });
  });

  describe("the game's age range", () => {
    const adultsOnly = { minAge: 18, maxAge: null };
    const age = (value: number | null) => ({ state: "ready" as const, value });

    it("does not wait for the viewer's age on a game without a range", () => {
      expect(payEntryView({ ...base, viewerAge: { state: "loading" } })).toEqual({ kind: "clear" });
      expect(
        payEntryView({
          ...base,
          ageReq: { minAge: null, maxAge: null },
          viewerAge: { state: "error" },
        }),
      ).toEqual({ kind: "clear" });
    });

    it("fails closed while the age loads: 'checking', never clear", () => {
      expect(
        payEntryView({ ...base, ageReq: adultsOnly, viewerAge: { state: "loading" } }),
      ).toEqual({ kind: "checking" });
      // No age passed at all counts as still loading.
      expect(payEntryView({ ...base, ageReq: adultsOnly })).toEqual({ kind: "checking" });
    });

    it("is 'check_failed' when the age read failed, not 'add your birthday'", () => {
      expect(payEntryView({ ...base, ageReq: adultsOnly, viewerAge: { state: "error" } })).toEqual({
        kind: "check_failed",
      });
    });

    it("blocks a fresh viewer outside the range, and clears one inside it", () => {
      expect(payEntryView({ ...base, ageReq: adultsOnly, viewerAge: age(16) })).toMatchObject({
        kind: "blocked",
        block: { kind: "age" },
      });
      expect(payEntryView({ ...base, ageReq: adultsOnly, viewerAge: age(null) })).toMatchObject({
        kind: "blocked",
        block: { kind: "age" },
      });
      expect(payEntryView({ ...base, ageReq: adultsOnly, viewerAge: age(30) })).toEqual({
        kind: "clear",
      });
    });

    it("never waits on the age for an approved viewer, nor for the host", () => {
      expect(
        payEntryView({
          ...base,
          approved: true,
          ageReq: adultsOnly,
          viewerAge: { state: "loading" },
        }),
      ).toEqual({ kind: "clear" });
      expect(
        payEntryView({ ...base, isHost: true, ageReq: adultsOnly, viewerAge: { state: "error" } }),
      ).toEqual({ kind: "clear" });
    });

    it("waits for the flow state before blocking: an approval or a place lifts it", () => {
      expect(
        payEntryView({ ...base, flow: "loading", ageReq: adultsOnly, viewerAge: age(15) }),
      ).toEqual({ kind: "checking" });
      expect(
        payEntryView({ ...base, flow: "error", ageReq: adultsOnly, viewerAge: age(15) }),
      ).toEqual({ kind: "check_failed" });
      expect(
        payEntryView({
          ...base,
          flow: "ready",
          holdsPlace: true,
          ageReq: adultsOnly,
          viewerAge: age(15),
        }),
      ).toEqual({ kind: "clear" });
    });

    it("says a block that comes first without waiting for the age", () => {
      expect(
        payEntryView({
          ...base,
          gate: gateFor("cancelled"),
          ageReq: adultsOnly,
          viewerAge: { state: "loading" },
        }),
      ).toMatchObject({ kind: "blocked", block: { kind: "locked", joinState: "cancelled" } });
    });

    it("replaces the proof form for a viewer who already started paying: the database refuses the claim", () => {
      const view = payEntryView({
        ...base,
        ageReq: adultsOnly,
        viewerAge: age(15),
        paymentStarted: true,
      });
      expect(view).toEqual({
        kind: "blocked",
        block: { kind: "age", message: expect.any(String) },
        paymentStarted: true,
      });
    });
  });

  it("blocks a host-approved guarded minor whose guardian has not approved", () => {
    const view = payEntryView({ ...base, approved: true, guardian: ready(false) });
    expect(view).toMatchObject({ kind: "blocked", block: { kind: "guardian" } });
  });

  describe("a viewer who already started paying", () => {
    // The database refuses their own manual claim for every block (zz_payment_claim_preconditions, the cohort and
    // guardian triggers), so the card replaces the proof form and tells them to ask the host for a refund.
    const started = { ...base, paymentStarted: true };
    const participationOff = {
      state: "ready" as const,
      value: {
        participation: { allowed: false, reason: "off" },
        payments: allowed,
        ageUnknown: false,
      },
    };
    const paymentsOff = {
      state: "ready" as const,
      value: {
        participation: allowed,
        payments: { allowed: false, level: "blocked" as const, reason: null },
        ageUnknown: false,
      },
    };

    it.each([
      ["closed past the cutoff", { gate: gateFor("closed_cutoff") }, "locked"],
      ["closed by the host", { gate: gateFor("closed_by_host") }, "locked"],
      [
        "cancelled, even for an approved viewer",
        { approved: true, gate: gateFor("cancelled") },
        "locked",
      ],
      ["ended", { gate: gateFor("completed") }, "locked"],
      ["in progress", { gate: gateFor("in_progress") }, "locked"],
      ["a guardian turned games off", { child: participationOff }, "participation"],
      ["payments not available", { child: paymentsOff }, "payments"],
      ["no guardian approval", { guardian: ready(false) }, "guardian"],
    ] as const)("%s: one block card, no proof form, refund advice", (_label, over, kind) => {
      const view = payEntryView({ ...started, ...over });
      expect(view).toEqual({
        kind: "blocked",
        paymentStarted: true,
        block: expect.objectContaining({ kind }),
      });
    });

    it("says nothing about a refund to a viewer who has not started", () => {
      const view = payEntryView({ ...base, gate: gateFor("closed_by_host") });
      expect(view).toMatchObject({ kind: "blocked", paymentStarted: false });
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

  it("keeps the approval card for a pending request on an age range (the host's approval lifts it)", () => {
    expect(blockOutranksApproval({ kind: "age", message: "" }, true)).toBe(false);
    expect(blockOutranksApproval({ kind: "age", message: "" }, false)).toBe(true);
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

describe("payRiskAckView ('Before you join' on the pay page, section 7 Option B)", () => {
  const answered = (version: string | null) => ({ state: "answered" as const, version });
  const base = {
    isHost: false,
    ...fresh,
    flow: "ready" as const,
    read: answered(null),
  };

  it("asks a fresh viewer with no acknowledgment on file", () => {
    expect(payRiskAckView(base)).toBe("ask");
  });

  it("asks again when only an older version is on file", () => {
    expect(payRiskAckView({ ...base, read: answered("2025-old-version") })).toBe("ask");
  });

  it("does not ask once the current version is on file", () => {
    expect(payRiskAckView({ ...base, read: answered(SAFETY_ACK_VERSION) })).toBe("none");
  });

  it("never asks the host, whatever the read says", () => {
    for (const read of [
      answered(null),
      { state: "failed" as const },
      { state: "pending" as const },
    ]) {
      expect(payRiskAckView({ ...base, isHost: true, read })).toBe("none");
      expect(payRiskAckView({ ...base, isHost: true, flow: "loading", read })).toBe("none");
    }
  });

  it("never asks a viewer already in the flow (approved, on the roster, a payment in)", () => {
    for (const c of inFlowCases) {
      expect(payRiskAckView({ ...base, ...c, read: answered(null) })).toBe("none");
      expect(payRiskAckView({ ...base, ...c, read: { state: "failed" } })).toBe("none");
      expect(payRiskAckView({ ...base, ...c, read: { state: "pending" } })).toBe("none");
    }
  });

  it("fails closed while the read has not answered: the loading card, never the payment options", () => {
    expect(payRiskAckView({ ...base, read: { state: "pending" } })).toBe("checking");
    expect(payRiskAckView({ ...base, read: riskAckReadFrom("pending", undefined) })).toBe(
      "checking",
    );
  });

  it("asks when the read failed with no answer (as the join tap does)", () => {
    expect(payRiskAckView({ ...base, read: { state: "failed" } })).toBe("ask");
    expect(payRiskAckView({ ...base, read: riskAckReadFrom("error", undefined) })).toBe("ask");
  });

  it("keeps the last answer when a refresh failed", () => {
    expect(payRiskAckView({ ...base, read: riskAckReadFrom("error", SAFETY_ACK_VERSION) })).toBe(
      "none",
    );
  });

  it("waits for the flow state before asking: an approval or a place exempts the viewer", () => {
    // In-flow values are not trusted until the flow is known.
    for (const c of inFlowCases) {
      expect(payRiskAckView({ ...base, ...c, flow: "loading" })).toBe("checking");
    }
    expect(payRiskAckView({ ...base, flow: "loading" })).toBe("checking");
    // An acknowledgment on file needs no flow state.
    expect(payRiskAckView({ ...base, flow: "loading", read: answered(SAFETY_ACK_VERSION) })).toBe(
      "none",
    );
  });

  it("asks when the flow state failed to load (the viewer counts as not in the flow)", () => {
    expect(payRiskAckView({ ...base, approved: true, flow: "error" })).toBe("ask");
  });
});

describe("unpaidOnGameTakingNoPayment (the game page's join button on a game that takes no payment)", () => {
  const owes = {
    joinState: "cancelled" as JoinState,
    holdsPlace: true,
    isPaid: true,
    paymentCleared: false,
    pending: false,
  };

  it("is true for a rostered player who still owes the fee on a cancelled game (no 'Pay Host')", () => {
    expect(unpaidOnGameTakingNoPayment(owes)).toBe(true);
    expect(unpaidOnGameTakingNoPayment({ ...owes, holdsPlace: false })).toBe(true);
  });

  it("is true on an ended game only without a place: a rostered player keeps the host's manual methods", () => {
    expect(
      unpaidOnGameTakingNoPayment({ ...owes, joinState: "completed", holdsPlace: false }),
    ).toBe(true);
    expect(unpaidOnGameTakingNoPayment({ ...owes, joinState: "completed", holdsPlace: true })).toBe(
      false,
    );
  });

  it("leaves a paid-up, free or pending viewer's own button alone", () => {
    expect(unpaidOnGameTakingNoPayment({ ...owes, paymentCleared: true })).toBe(false);
    expect(unpaidOnGameTakingNoPayment({ ...owes, isPaid: false })).toBe(false);
    expect(unpaidOnGameTakingNoPayment({ ...owes, pending: true })).toBe(false);
  });

  it("is false wherever the game still takes payment", () => {
    for (const joinState of ["open", "in_progress", "closed_by_host", "closed_cutoff"] as const) {
      expect(unpaidOnGameTakingNoPayment({ ...owes, joinState })).toBe(false);
      expect(unpaidOnGameTakingNoPayment({ ...owes, joinState, holdsPlace: false })).toBe(false);
    }
  });

  it("agrees with payHostLinkShown: where it holds, the link is not shown either", () => {
    for (const joinState of ["cancelled", "completed"] as const) {
      for (const holdsPlace of [false, true]) {
        if (!unpaidOnGameTakingNoPayment({ ...owes, joinState, holdsPlace })) continue;
        expect(
          payHostLinkShown({
            joinState,
            holdsPlace,
            paymentPending: false,
            isPaid: true,
            paymentCleared: false,
            approvalCleared: true,
            canEnterPaymentFlow: true,
            parentAsk: false,
            lockedForNewJoin: false,
            consentBlocksNewJoin: false,
          }),
        ).toBe(false);
      }
    }
  });
});

describe("payRiskAckStep ('Before you join' waits for the host's payment settings)", () => {
  it("never opens the dialog before the settings have answered: they decide whether the approval card comes first", () => {
    // A fresh viewer on an approval-gated game (the default host setting): the ack read answers before the settings,
    // and the dialog used to open, then close itself when "Waiting on host approval" arrived.
    for (const riskAck of ["ask", "checking"] as const) {
      expect(payRiskAckStep({ riskAck, outranked: false, settings: "loading" })).toBe("held");
    }
  });

  it("does not ask in front of 'Couldn't reach the payment service'", () => {
    for (const riskAck of ["ask", "checking"] as const) {
      expect(payRiskAckStep({ riskAck, outranked: false, settings: "error" })).toBe("held");
    }
  });

  it("asks once the settings are known and nothing outranks it", () => {
    expect(payRiskAckStep({ riskAck: "ask", outranked: false, settings: "ready" })).toBe("ask");
    expect(payRiskAckStep({ riskAck: "checking", outranked: false, settings: "ready" })).toBe(
      "checking",
    );
  });

  it("gives way to a block card, a pending check or the approval card", () => {
    for (const settings of ["loading", "error", "ready"] as const) {
      for (const riskAck of ["ask", "checking", "none"] as const) {
        expect(payRiskAckStep({ riskAck, outranked: true, settings })).toBe("none");
      }
    }
  });

  it("is 'none' only where payRiskAckView owes nothing (or something outranks it)", () => {
    for (const settings of ["loading", "error", "ready"] as const) {
      expect(payRiskAckStep({ riskAck: "none", outranked: false, settings })).toBe("none");
    }
  });

  it("with the approval gate decided from loaded settings: an approval-gated game never asks a fresh viewer", () => {
    const riskAck = payRiskAckView({
      isHost: false,
      ...fresh,
      flow: "ready",
      read: { state: "answered", version: null },
    });
    expect(riskAck).toBe("ask");
    const gate = (hostRequiresApproval: boolean) =>
      payAwaitsApproval({
        hostRequiresApproval,
        approved: false,
        requestPending: false,
        replaceBlock: null,
      });
    // Settings still loading: the gate reads requires_approval as false, but the step holds.
    expect(payRiskAckStep({ riskAck, outranked: gate(false), settings: "loading" })).toBe("held");
    // Settings arrive with requires_approval: the approval card, no dialog at any point.
    expect(payRiskAckStep({ riskAck, outranked: gate(true), settings: "ready" })).toBe("none");
    // An open game: the dialog, once.
    expect(payRiskAckStep({ riskAck, outranked: gate(false), settings: "ready" })).toBe("ask");
  });
});

describe("payAwaitsApproval ('Waiting on host approval' on the pay page)", () => {
  const age = { kind: "age" as const, message: "This game is 18+ — the host reviews requests." };
  const base = {
    hostRequiresApproval: false,
    approved: false,
    requestPending: false,
    replaceBlock: null,
  };

  it("follows the host's setting until the viewer is approved", () => {
    expect(payAwaitsApproval({ ...base, hostRequiresApproval: true })).toBe(true);
    expect(payAwaitsApproval({ ...base, hostRequiresApproval: true, requestPending: true })).toBe(
      true,
    );
    expect(payAwaitsApproval({ ...base, hostRequiresApproval: true, approved: true })).toBe(false);
    expect(payAwaitsApproval(base)).toBe(false);
  });

  it("on an open game, waits on the host for a pending viewer outside the age range (as the game page does)", () => {
    expect(payAwaitsApproval({ ...base, requestPending: true, replaceBlock: age })).toBe(true);
    // The card that would otherwise show is the age block, and the host's approval lifts it.
    expect(blockOutranksApproval(age, true)).toBe(false);
  });

  it("keeps the age block card without a pending request (none, or declined)", () => {
    expect(payAwaitsApproval({ ...base, replaceBlock: age })).toBe(false);
  });

  it("never turns another block into an approval wait", () => {
    for (const block of [
      { kind: "payments" as const, message: "" },
      { kind: "participation" as const, message: "" },
      { kind: "guardian" as const, message: "" },
      { kind: "locked" as const, message: "", joinState: "cancelled" as const },
      { kind: "locked" as const, message: "", joinState: "closed_by_host" as const },
    ]) {
      expect(payAwaitsApproval({ ...base, requestPending: true, replaceBlock: block })).toBe(false);
    }
  });
});

describe("payManualMethodsStep (manual methods vs the manual-claim guardian rule, section 6 (d))", () => {
  const base = {
    manualClaim: { state: "ready", value: true } as const,
    hasManualMethods: true,
    paypalOffered: true,
    paypalSettled: true,
    methodPicked: false,
    paymentStarted: false,
    managedAccount: false,
  };
  const no = { state: "ready", value: false } as const;
  const withPayPal =
    "You can pay with PayPal now. Or go back to the game to ask your guardian to approve it.";
  const withoutPayPal = "Go back to the game to ask your guardian to approve it.";

  it("offers every method when the trigger would accept the viewer's manual claim", () => {
    expect(payManualMethodsStep(base)).toEqual({ kind: "offer_all" });
    expect(payManualMethodsStep({ ...base, paypalOffered: false })).toEqual({ kind: "offer_all" });
  });

  it("fails closed on the manual methods while the check loads, and offers a retry when it failed: never the handles", () => {
    expect(payManualMethodsStep({ ...base, manualClaim: { state: "loading" } })).toMatchObject({
      kind: "checking",
    });
    expect(payManualMethodsStep({ ...base, manualClaim: { state: "error" } })).toMatchObject({
      kind: "check_failed",
    });
  });

  it("keeps PayPal while the check loads or failed: PayPal's server precondition does not depend on it", () => {
    for (const manualClaim of [{ state: "loading" } as const, { state: "error" } as const]) {
      expect(payManualMethodsStep({ ...base, manualClaim })).toEqual({
        kind: manualClaim.state === "loading" ? "checking" : "check_failed",
        paypal: true,
      });
      // No PayPal for the game: nothing to keep.
      expect(payManualMethodsStep({ ...base, manualClaim, paypalOffered: false })).toMatchObject({
        paypal: false,
      });
      // A picked method's proof step stood in PayPal's place before this check existed: still no PayPal there.
      expect(payManualMethodsStep({ ...base, manualClaim, methodPicked: true })).toMatchObject({
        paypal: false,
      });
    }
  });

  it("an adult with an old guardian link: PayPal kept, manual methods and the proof form held back", () => {
    const step = payManualMethodsStep({ ...base, manualClaim: no });
    expect(step).toEqual({
      kind: "paypal_only",
      message: MANUAL_GUARDIAN_HOLD_MESSAGE,
      next: `${withPayPal} ${MANUAL_GUARDIAN_HOLD_END_LINK}`,
      paymentStarted: false,
    });
    // Also with a method picked (resumed from the pay-opened marker): its proof step is held back too.
    expect(payManualMethodsStep({ ...base, manualClaim: no, methodPicked: true }).kind).toBe(
      "paypal_only",
    );
  });

  it("no PayPal for the game: the block card, not an empty method list", () => {
    const step = payManualMethodsStep({ ...base, manualClaim: no, paypalOffered: false });
    expect(step).toEqual({
      kind: "blocked",
      block: {
        kind: "manual_guardian",
        message: `${MANUAL_GUARDIAN_HOLD_MESSAGE} ${withoutPayPal} ${MANUAL_GUARDIAN_HOLD_END_LINK}`,
      },
      paymentStarted: false,
    });
  });

  it("a managed account is not told its guardian can end the link (revoke_guardian_link refuses that)", () => {
    const paypalOnly = payManualMethodsStep({ ...base, manualClaim: no, managedAccount: true });
    expect(paypalOnly).toMatchObject({ kind: "paypal_only", next: withPayPal });
    const blocked = payManualMethodsStep({
      ...base,
      manualClaim: no,
      paypalOffered: false,
      managedAccount: true,
    });
    if (blocked.kind !== "blocked") throw new Error("expected the block card");
    expect(blocked.block.message).toBe(`${MANUAL_GUARDIAN_HOLD_MESSAGE} ${withoutPayPal}`);
    for (const paypal of [true, false]) {
      expect(manualGuardianHoldNext({ paypal, managedAccount: true })).not.toMatch(
        /end the family link|Parent Center/,
      );
      expect(manualGuardianHoldNext({ paypal, managedAccount: false })).toMatch(/Parent Center/);
    }
  });

  it("waits for PayPal to settle before saying the viewer cannot pay at all", () => {
    expect(
      payManualMethodsStep({
        ...base,
        manualClaim: no,
        paypalOffered: false,
        paypalSettled: false,
      }),
    ).toEqual({ kind: "checking", paypal: false });
  });

  it("a viewer who was already shown how to pay is told about a refund, with or without PayPal", () => {
    const paid = payManualMethodsStep({ ...base, manualClaim: no, paymentStarted: true });
    expect(paid).toMatchObject({ kind: "paypal_only", paymentStarted: true });
    const without = payManualMethodsStep({
      ...base,
      manualClaim: no,
      paypalOffered: false,
      paymentStarted: true,
    });
    expect(without).toMatchObject({ kind: "blocked", paymentStarted: true });
  });

  it("a host with no manual method has nothing to hold back (the page's own options and empty state)", () => {
    for (const manualClaim of [no, { state: "loading" } as const, { state: "error" } as const]) {
      expect(payManualMethodsStep({ ...base, manualClaim, hasManualMethods: false })).toEqual({
        kind: "offer_all",
      });
    }
  });

  it("uses adult wording: no 'ask your parent', names PayPal only when it is offered", () => {
    const texts = [MANUAL_GUARDIAN_HOLD_MESSAGE, MANUAL_GUARDIAN_HOLD_END_LINK];
    for (const paypal of [true, false]) {
      for (const managedAccount of [true, false]) {
        texts.push(manualGuardianHoldNext({ paypal, managedAccount }));
      }
    }
    for (const text of texts) {
      expect(text).not.toMatch(/parent needs|ask your parent|ask them/i);
    }
    expect(MANUAL_GUARDIAN_HOLD_MESSAGE).toMatch(/before you turned 18/);
    expect(MANUAL_GUARDIAN_HOLD_MESSAGE).toMatch(/Venmo, Cash App/);
    expect(manualGuardianHoldNext({ paypal: true, managedAccount: false })).toMatch(/PayPal/);
    expect(manualGuardianHoldNext({ paypal: false, managedAccount: false })).not.toMatch(/PayPal/);
  });

  it("the block it gives is not one the viewer's place, payment or the host's approval lifts", () => {
    const step = payManualMethodsStep({ ...base, manualClaim: no, paypalOffered: false });
    if (step.kind !== "blocked") throw new Error("expected the block card");
    expect(blockOutranksApproval(step.block, true)).toBe(true);
  });
});
