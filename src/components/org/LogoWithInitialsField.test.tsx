// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/components/ImageUploader", () => ({
  ImageUploader: ({
    value,
    onChange,
    onClear,
  }: {
    value: string;
    onChange: (url: string) => void;
    onClear: () => void;
  }) => (
    <div>
      <span data-testid="uploader-value">{value}</span>
      <button type="button" onClick={() => onChange("https://cdn.example/logo.png")}>
        Upload
      </button>
      <button type="button" onClick={onClear}>
        Remove
      </button>
    </div>
  ),
}));

import { LogoWithInitialsField } from "./LogoWithInitialsField";

afterEach(cleanup);

function Harness({ initial }: { initial: string }) {
  const [avatar, setAvatar] = useState(initial);
  return (
    <>
      <LogoWithInitialsField
        value={avatar}
        onChange={setAvatar}
        defaultInitials="BS"
        bucket="team-avatars"
        pathPrefix="u-1"
        logo
      />
      <output data-testid="avatar">{avatar}</output>
    </>
  );
}

describe("LogoWithInitialsField", () => {
  it("offers initials while there is no logo", () => {
    render(<Harness initial="" />);
    const input = screen.getByLabelText("Initials") as HTMLInputElement;
    expect(input.placeholder).toBe("BS");
    fireEvent.change(input, { target: { value: "bsx9" } });
    expect(screen.getByTestId("avatar").textContent).toBe("BSX");
  });

  it("hides the initials once a logo is uploaded and never shows its URL as text", () => {
    render(<Harness initial="BS" />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.queryByLabelText("Initials")).toBeNull();
    expect(screen.getByTestId("uploader-value").textContent).toBe("https://cdn.example/logo.png");
  });

  it("brings the initials back when the logo is removed", () => {
    render(<Harness initial="https://cdn.example/logo.png" />);
    expect(screen.queryByLabelText("Initials")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByLabelText("Initials")).toBeTruthy();
    expect(screen.getByTestId("avatar").textContent).toBe("");
  });

  it("passes initials to the uploader as no image", () => {
    render(<Harness initial="BS" />);
    expect(screen.getByTestId("uploader-value").textContent).toBe("");
  });
});
