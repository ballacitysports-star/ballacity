// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JoinGameDialog } from "./JoinGameDialog";
import { RiskAcknowledgmentDialog } from "@/components/safety/RiskAcknowledgmentDialog";
import { LEGAL_REVIEW_LABEL, RISK_ACKNOWLEDGMENT } from "@/lib/safety";
import { isLegalReviewed } from "@/lib/legal-review";
import { endDialogExit, holdDialogExitAnimation } from "@/components/ui/hold-dialog-exit.testutil";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderJoin(props: Partial<Parameters<typeof JoinGameDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <JoinGameDialog
      open
      onOpenChange={onOpenChange}
      gameTitle="Friday pickup"
      rosterNote="You'll be added to the roster. Cancel any time."
      needsAck
      onConfirm={onConfirm}
      {...props}
    >
      <div>Remind me before it starts</div>
    </JoinGameDialog>,
  );
  return { ...utils, onConfirm, onOpenChange };
}

describe("JoinGameDialog (free game, one dialog)", () => {
  it("is a single role=dialog holding the reminder picker and the risk acknowledgment", () => {
    renderJoin();
    const dialog = screen.getByRole("dialog", { name: /join this game\?/i });
    expect(dialog.textContent).toContain("Remind me before it starts");
    expect(dialog.textContent).toContain(RISK_ACKNOWLEDGMENT.title);
    expect(dialog.textContent).toContain(RISK_ACKNOWLEDGMENT.text);
    for (const p of RISK_ACKNOWLEDGMENT.points) expect(dialog.textContent).toContain(p);
    expect(dialog.textContent).toContain(RISK_ACKNOWLEDGMENT.disclaimer);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("shows the LEGAL REVIEW REQUIRED tag while the acknowledgments are unreviewed", () => {
    renderJoin();
    const dialog = screen.getByRole("dialog");
    if (isLegalReviewed("safetyAcknowledgments")) {
      expect(dialog.textContent).not.toContain(LEGAL_REVIEW_LABEL);
    } else {
      expect(dialog.textContent).toContain(LEGAL_REVIEW_LABEL);
    }
  });

  it("starts unticked and keeps Agree & join disabled until the box is ticked", () => {
    const { onConfirm } = renderJoin();
    const box = screen.getByRole("checkbox", { name: RISK_ACKNOWLEDGMENT.checkboxLabel });
    const agree = screen.getByRole("button", { name: /^agree & join$/i });
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect((agree as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(agree);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect((agree as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(agree);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clears the tick when the dialog closes, so the next open asks again", () => {
    const { rerender, onConfirm, onOpenChange } = renderJoin();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    const again = (open: boolean) => (
      <JoinGameDialog
        open={open}
        onOpenChange={onOpenChange}
        gameTitle="Friday pickup"
        rosterNote="You'll be added to the roster."
        needsAck
        onConfirm={onConfirm}
      />
    );
    rerender(again(false));
    rerender(again(true));
    expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(
      (screen.getByRole("button", { name: /^agree & join$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps the acknowledgment and its button while closing, when the caller has cleared needsAck", () => {
    holdDialogExitAnimation();
    const { rerender, onConfirm, onOpenChange } = renderJoin();
    // The route closes with open=false and needsAck falling back to false in the same render.
    rerender(
      <JoinGameDialog
        open={false}
        onOpenChange={onOpenChange}
        gameTitle="Friday pickup"
        rosterNote="You'll be added to the roster."
        needsAck={false}
        onConfirm={onConfirm}
      />,
    );
    // Radix keeps the content mounted for the exit animation: it must not change during it.
    const closing = screen.getByRole("dialog", { hidden: true });
    expect(closing.getAttribute("data-state")).toBe("closed");
    expect(closing.textContent).toContain(RISK_ACKNOWLEDGMENT.title);
    expect(screen.queryByRole("button", { name: /^join game$/i, hidden: true })).toBeNull();
    const agree = screen.getByRole("button", { name: /^agree & join$/i, hidden: true });
    expect((agree as HTMLButtonElement).disabled).toBe(true);
    endDialogExit();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    // Reopened without the acknowledgment due: the new state shows at once.
    rerender(
      <JoinGameDialog
        open
        onOpenChange={onOpenChange}
        gameTitle="Friday pickup"
        rosterNote="You'll be added to the roster."
        needsAck={false}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("button", { name: /^join game$/i })).toBeTruthy();
  });

  it("Cancel closes without confirming", () => {
    const { onConfirm, onOpenChange } = renderJoin();
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both the tick and the confirm while submitting", () => {
    renderJoin({ submitting: true });
    expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /^agree & join$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("with the current version already on file: no checkbox, Join game is enabled", () => {
    const { onConfirm } = renderJoin({ needsAck: false });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("dialog").textContent).not.toContain(RISK_ACKNOWLEDGMENT.text);
    const join = screen.getByRole("button", { name: /^join game$/i });
    expect((join as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(join);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("RiskAcknowledgmentDialog (request, parent ask and pay page) is unchanged", () => {
  it("keeps role=dialog named Before you join, unticked, Agree & join disabled until ticked", () => {
    const onConfirm = vi.fn();
    render(
      <RiskAcknowledgmentDialog
        open
        onOpenChange={() => {}}
        gameTitle="Friday pickup"
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /before you join/i });
    const box = screen.getByRole("checkbox", { name: RISK_ACKNOWLEDGMENT.checkboxLabel });
    const agree = screen.getByRole("button", { name: /^agree & join$/i });
    expect(dialog.textContent).toContain(RISK_ACKNOWLEDGMENT.text);
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect((agree as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box);
    fireEvent.click(agree);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
