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

function Harness({
  initialLogo = "",
  initialInitials = "",
}: {
  initialLogo?: string;
  initialInitials?: string;
}) {
  const [logo, setLogo] = useState(initialLogo);
  const [initials, setInitials] = useState(initialInitials);
  return (
    <>
      <LogoWithInitialsField
        logoUrl={logo}
        onLogoChange={setLogo}
        initials={initials}
        onInitialsChange={setInitials}
        defaultInitials="BS"
        bucket="team-avatars"
        pathPrefix="u-1"
        logo
      />
      <output data-testid="logo">{logo}</output>
      <output data-testid="initials">{initials}</output>
    </>
  );
}

describe("LogoWithInitialsField", () => {
  it("offers initials while there is no logo", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Initials") as HTMLInputElement;
    expect(input.placeholder).toBe("BS");
    fireEvent.change(input, { target: { value: "bsx9" } });
    expect(screen.getByTestId("initials").textContent).toBe("BSX");
    expect(screen.getByTestId("logo").textContent).toBe("");
  });

  it("hides the initials input once a logo is uploaded, keeping the initials", () => {
    render(<Harness initialInitials="BS" />);
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(screen.queryByLabelText("Initials")).toBeNull();
    expect(screen.getByTestId("uploader-value").textContent).toBe("https://cdn.example/logo.png");
    expect(screen.getByTestId("initials").textContent).toBe("BS");
  });

  it("brings the typed initials back when the logo is removed", () => {
    render(<Harness initialLogo="https://cdn.example/logo.png" initialInitials="BS" />);
    expect(screen.queryByLabelText("Initials")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect((screen.getByLabelText("Initials") as HTMLInputElement).value).toBe("BS");
    expect(screen.getByTestId("logo").textContent).toBe("");
  });

  it("passes the logo, and only the logo, to the uploader", () => {
    render(<Harness initialInitials="BS" />);
    expect(screen.getByTestId("uploader-value").textContent).toBe("");
  });
});
