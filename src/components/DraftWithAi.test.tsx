// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { suggestTeamPostDraft, toastError } = vi.hoisted(() => ({
  suggestTeamPostDraft: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/team-posts.functions", () => ({ suggestTeamPostDraft }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { DraftWithAi } from "./DraftWithAi";

beforeEach(() => {
  suggestTeamPostDraft.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

function Harness({ initial }: { initial: { title: string; body: string } }) {
  const [t, setT] = useState(initial);
  return (
    <div>
      <DraftWithAi kind="tryout" title={t.title} body={t.body} onApply={setT} />
      <output data-testid="title">{t.title}</output>
      <output data-testid="body">{t.body}</output>
    </div>
  );
}

const draftButton = () => screen.getByRole("button", { name: /draft with ai|drafting/i });

describe("DraftWithAi", () => {
  it("is disabled until there are enough notes to write from", () => {
    const { rerender } = render(
      <DraftWithAi kind="tryout" title="" body="too short" onApply={() => {}} />,
    );
    expect((draftButton() as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <DraftWithAi kind="tryout" title="" body="   u14 tryouts saturday   " onApply={() => {}} />,
    );
    expect((draftButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the kind, notes and title, then fills in the draft", async () => {
    suggestTeamPostDraft.mockResolvedValue({ title: "U14 tryouts", body: "Saturday at 9." });
    render(<Harness initial={{ title: "Tryouts", body: "u14 tryouts sat 9am lincoln gym" }} />);
    fireEvent.click(draftButton());
    await waitFor(() => expect(screen.getByTestId("title").textContent).toBe("U14 tryouts"));
    expect(screen.getByTestId("body").textContent).toBe("Saturday at 9.");
    expect(suggestTeamPostDraft).toHaveBeenCalledWith({
      data: { kind: "tryout", notes: "u14 tryouts sat 9am lincoln gym", title: "Tryouts" },
    });
  });

  it("sends a null title when the member hasn't written one", async () => {
    suggestTeamPostDraft.mockResolvedValue({ title: "T", body: "B" });
    render(<Harness initial={{ title: "", body: "pickup friday 6pm at the park" }} />);
    fireEvent.click(draftButton());
    await waitFor(() => expect(suggestTeamPostDraft).toHaveBeenCalled());
    expect(suggestTeamPostDraft.mock.calls[0][0].data.title).toBeNull();
  });

  it("puts back exactly what the member had typed when they tap Undo", async () => {
    suggestTeamPostDraft.mockResolvedValue({ title: "New title", body: "New body" });
    render(<Harness initial={{ title: "Mine", body: "my rough notes here" }} />);
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
    fireEvent.click(draftButton());
    await waitFor(() => expect(screen.getByTestId("body").textContent).toBe("New body"));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    expect(screen.getByTestId("title").textContent).toBe("Mine");
    expect(screen.getByTestId("body").textContent).toBe("my rough notes here");
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
  });

  it("leaves the form alone and shows the reason when drafting fails", async () => {
    suggestTeamPostDraft.mockRejectedValue(new Error("This didn't pass our safety check."));
    render(<Harness initial={{ title: "Mine", body: "my rough notes here" }} />);
    fireEvent.click(draftButton());
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("This didn't pass our safety check."),
    );
    expect(screen.getByTestId("title").textContent).toBe("Mine");
    expect(screen.getByTestId("body").textContent).toBe("my rough notes here");
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
    expect((draftButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("every post form offers it", () => {
  it.each([
    ["src/components/CreatePostSheet.tsx"],
    ["src/components/tryouts/TryoutsSection.tsx"],
    ["src/routes/teams.$teamId.events.tsx"],
  ])("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain('import { DraftWithAi } from "@/components/DraftWithAi";');
    expect(src).toContain("<DraftWithAi");
  });
});
