// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));

import { PublishStepDialog } from "./PublishStepDialog";
import { HOST_ACK_CHECKBOX_LABEL, HOST_ACK_ITEMS } from "@/lib/game-policy";
import { LEGAL_REVIEW_LABEL } from "@/lib/safety";
import { isLegalReviewed } from "@/lib/legal-review";

function Harness({
  onPublish,
  publishing = false,
}: {
  onPublish: () => void;
  publishing?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [accepted, setAccepted] = useState(false);
  return (
    <PublishStepDialog
      open={open}
      onOpenChange={setOpen}
      summary={[
        { label: "Where", value: "Rucker Park" },
        { label: "Joining", value: "You approve each player" },
      ]}
      accepted={accepted}
      onAcceptedChange={setAccepted}
      publishing={publishing}
      onPublish={onPublish}
    />
  );
}

describe("PublishStepDialog", () => {
  afterEach(cleanup);

  it("asks for the host acknowledgment, unticked, before publishing", () => {
    const onPublish = vi.fn();
    render(<Harness onPublish={onPublish} />);
    const dialog = screen.getByRole("dialog", { name: /publish this game/i });
    expect(dialog.textContent).toContain("Rucker Park");

    // Same copy as before, never pre-checked.
    for (const item of HOST_ACK_ITEMS) expect(dialog.textContent).toContain(item.text);
    expect(screen.getByText(HOST_ACK_CHECKBOX_LABEL)).toBeTruthy();
    const box = screen.getByRole("checkbox");
    expect(box.getAttribute("aria-checked")).toBe("false");

    const publish = screen.getByRole("button", { name: /acknowledge to publish/i });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(publish);
    expect(onPublish).not.toHaveBeenCalled();

    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^publish game$/i }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("keeps the legal review tag while the acknowledgment copy is a draft", () => {
    render(<Harness onPublish={() => {}} />);
    if (!isLegalReviewed("safetyAcknowledgments")) {
      expect(screen.getByText(LEGAL_REVIEW_LABEL)).toBeTruthy();
    }
  });

  it("can't be published twice or closed while publishing", () => {
    const onPublish = vi.fn();
    render(<Harness onPublish={onPublish} publishing />);
    const publish = screen.getByRole("button", { name: /publishing/i }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: /back to edit/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
