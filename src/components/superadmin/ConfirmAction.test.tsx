// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmAction } from "./ConfirmAction";

afterEach(cleanup);

const open = (over: Partial<Parameters<typeof ConfirmAction>[0]> = {}) =>
  render(
    <ConfirmAction
      open
      onOpenChange={() => {}}
      title="Delete account permanently"
      confirmWord="DELETE"
      confirmLabel="Confirm"
      onConfirm={() => {}}
      {...over}
    />,
  );

const confirmButton = () => screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
const boxes = () => screen.getAllByRole("textbox") as (HTMLInputElement | HTMLTextAreaElement)[];

describe("ConfirmAction", () => {
  it("typing the word alone does not enable the button, and the hint says a reason is needed", () => {
    open();
    const [reason, word] = boxes();
    fireEvent.change(word!, { target: { value: "DELETE" } });
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByTestId("confirm-hint").textContent).toMatch(/Enter a reason/);
    expect(screen.getByTestId("confirm-hint").textContent).not.toMatch(/Type DELETE/);
    expect(reason).toBeTruthy();
  });

  it("the reason label says it is required", () => {
    open();
    expect(screen.getByText(/Reason \(required, at least 3 characters/)).toBeTruthy();
  });

  it("a reason alone does not enable it and the hint asks for the word", () => {
    open();
    const [reason] = boxes();
    fireEvent.change(reason!, { target: { value: "spam account" } });
    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByTestId("confirm-hint").textContent).toMatch(/Type DELETE to continue/);
  });

  it("with both, the button is enabled, the hint is gone and confirming passes the reason", () => {
    const onConfirm = vi.fn();
    open({ onConfirm });
    const [reason, word] = boxes();
    fireEvent.change(reason!, { target: { value: "  spam account " } });
    fireEvent.change(word!, { target: { value: "delete" } });
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByTestId("confirm-hint")).toBeNull();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("spam account");
  });

  it("a dialog that needs no word or reason shows no hint", () => {
    open({ confirmWord: undefined, requireReason: false });
    expect(confirmButton().disabled).toBe(false);
    expect(screen.queryByTestId("confirm-hint")).toBeNull();
  });
});
