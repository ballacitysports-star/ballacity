// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GameCardCue } from "./GameCardCue";
import { ParticipationBlockedNote } from "./ParticipationBlockedNote";

afterEach(cleanup);

describe("GameCardCue", () => {
  it("renders text only, with no button: the card is the single link", () => {
    render(<GameCardCue inFlow={false} locked={false} parentMode={false} />);
    expect(screen.getByTestId("game-card-cue").textContent).toBe("View & join");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("follows the state it is given", () => {
    const { rerender } = render(<GameCardCue inFlow locked={false} parentMode={false} />);
    expect(screen.getByTestId("game-card-cue").textContent).toBe("View your spot");
    rerender(<GameCardCue inFlow={false} locked parentMode={false} />);
    expect(screen.getByTestId("game-card-cue").textContent).toBe("View details");
  });
});

describe("ParticipationBlockedNote", () => {
  it("shows the existing reason, as a status", () => {
    render(<ParticipationBlockedNote reason="Ask your parent to approve games first." />);
    const note = screen.getByRole("status");
    expect(note.textContent).toContain("Can’t join yet:");
    expect(note.textContent).toContain("Ask your parent to approve games first.");
  });

  it("falls back to the same wording the tap handler uses when there is no reason", () => {
    render(<ParticipationBlockedNote reason={null} />);
    expect(screen.getByRole("status").textContent).toContain(
      "A parent or guardian must approve this account first.",
    );
  });
});
