// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/superadmin.functions", () => ({}));
vi.mock("@/lib/push.functions", () => ({}));

import { SettingRow } from "./OpsTab";

afterEach(() => cleanup());

const row = (key: string, value: unknown = true) =>
  render(
    <SettingRow
      setting={{ key, value, description: "Seeded flag", is_public: true }}
      onSave={() => {}}
    />,
  );

describe("Ops feature flags", () => {
  it.each(["signups_enabled", "games_creation_enabled", "reels_enabled", "maintenance_mode"])(
    "marks %s as not enforced",
    (key) => {
      row(key);
      expect(screen.getByText("not enforced")).toBeTruthy();
      expect(screen.getByText(/^Not enforced\./)).toBeTruthy();
    },
  );

  it("marks the text flag announcement_banner as not enforced", () => {
    row("announcement_banner", "");
    expect(screen.getByText("not enforced")).toBeTruthy();
  });

  it("leaves a flag the app reads unmarked", () => {
    row("team_chat", { enabled: true });
    expect(screen.queryByText("not enforced")).toBeNull();
  });
});
