// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGE_POLICY, can, type ChildPolicyState } from "@/lib/child-policy";

/** P0-12: a minor whose join is off for want of a parent's approval sees why, and where to ask. */

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const { ParentApprovalNotice, consentBlocksNewJoin } = await import("./ParentApprovalNotice");

afterEach(cleanup);

const participation = (subject: Parameters<typeof can>[1]) =>
  can("game_participation", subject, DEFAULT_AGE_POLICY);

const teenWithoutGuardian = participation({ cohort: "teen_13_15", consent: null });
const teenAwaitingParent = participation({
  cohort: "teen_13_15",
  consent: { status: "pending" } as never,
});
const adult = participation({ cohort: "adult", consent: null });

describe("consentBlocksNewJoin", () => {
  it("blocks a new join for a teen with no approving guardian", () => {
    expect(teenWithoutGuardian.allowed).toBe(false);
    expect(consentBlocksNewJoin({ alreadyInFlow: false, participation: teenWithoutGuardian })).toBe(
      true,
    );
  });

  it("never blocks an adult", () => {
    expect(consentBlocksNewJoin({ alreadyInFlow: false, participation: adult })).toBe(false);
  });

  it("keeps leave and cancel for a minor already in the flow", () => {
    expect(consentBlocksNewJoin({ alreadyInFlow: true, participation: teenWithoutGuardian })).toBe(
      false,
    );
  });
});

describe("ParentApprovalNotice", () => {
  it("shows a blocked teen the reason and a link to ask their parent", () => {
    render(
      <ParentApprovalNotice
        reason={teenWithoutGuardian.reason}
        consentState="PARENTAL_CONSENT_REQUIRED"
      />,
    );
    const notice = screen.getByTestId("parent-approval-notice");
    expect(notice.textContent).toMatch(/A parent or guardian must approve this account first\./);
    const link = screen.getByRole("link", { name: /ask your parent or guardian/i });
    expect(link.getAttribute("href")).toBe("/onboarding/child");
  });

  it("points a teen whose request is out to the same flow to check on it", () => {
    render(
      <ParentApprovalNotice
        reason={teenAwaitingParent.reason}
        consentState="PARENTAL_CONSENT_PENDING"
      />,
    );
    const link = screen.getByRole("link", { name: /check your approval request/i });
    expect(link.getAttribute("href")).toBe("/onboarding/child");
  });

  it("offers the approval flow again after a parent withdrew consent", () => {
    render(
      <ParentApprovalNotice
        reason="A parent or guardian withdrew consent for this account."
        consentState="PARENTAL_CONSENT_REVOKED"
      />,
    );
    expect(screen.getByText(/withdrew consent/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/onboarding/child");
  });

  it.each<ChildPolicyState>(["TEEN_13_15", "AGE_REVIEW_REQUIRED", "PARENTAL_CONSENT_APPROVED"])(
    "gives the reason without an approval link when approval is not the missing step (%s)",
    (state) => {
      render(
        <ParentApprovalNotice
          reason="A parent or guardian has turned this off."
          consentState={state}
        />,
      );
      expect(screen.getByText(/turned this off/)).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("falls back to a reason when the policy gives none", () => {
    render(<ParentApprovalNotice reason={null} consentState="PARENTAL_CONSENT_REQUIRED" />);
    expect(screen.getByTestId("parent-approval-notice").textContent).toMatch(
      /must approve this account first/,
    );
  });
});

describe("game page wiring", () => {
  const route = readFileSync(resolve(__dirname, "../../routes/games.$gameId.index.tsx"), "utf8");

  it("renders the notice only when a parent blocks a new join, outside parent mode and for non-hosts", () => {
    expect(route).toMatch(
      /!isParentMode && !isHost && parentBlocksNewJoin && \(\s*<ParentApprovalNotice/,
    );
  });

  it("keeps the join button disabled while a parent blocks a new join", () => {
    expect(route).toMatch(/const buttonDisabled =[^;]*parentBlocksNewJoin;/);
  });
});
