// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listSettings = vi.fn();
const setSetting = vi.fn();
const activity = vi.fn();

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/superadmin.functions", () => ({
  superadminListSettings: (a: unknown) => listSettings(a),
  superadminSetSetting: (a: unknown) => setSetting(a),
  superadminSportActivity: (a: unknown) => activity(a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SportHubsPanel } from "./SportHubsPanel";

const masked = { value: null, small: true };
const shown = (n: number) => ({ value: n, small: false });

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SportHubsPanel />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  listSettings.mockResolvedValue({
    settings: [{ key: "sport_hubs", value: { enabled: true } }],
  });
  setSetting.mockResolvedValue({});
  activity.mockResolvedValue({
    rows: [
      {
        sport: "Basketball",
        gamesCreated30d: shown(42),
        upcomingGames: shown(9),
        teams: shown(17),
      },
      { sport: "Tennis", gamesCreated30d: masked, upcomingGames: masked, teams: shown(6) },
    ],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SportHubsPanel", () => {
  it("shows exact counts at or above the threshold and a floor below it", async () => {
    renderPanel();
    expect(await screen.findByText("42")).toBeTruthy();
    expect(screen.getAllByText("<5").length).toBe(2);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("saves the switch as a public setting, so anonymous visitors can read it", async () => {
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: "Sport hubs" });
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1));
    expect(setSetting.mock.calls[0][0].data).toMatchObject({
      key: "sport_hubs",
      value: { enabled: false },
      isPublic: true,
    });
  });

  it("treats a missing setting as on", async () => {
    listSettings.mockResolvedValue({ settings: [] });
    renderPanel();
    const toggle = await screen.findByRole("switch", { name: "Sport hubs" });
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
  });

  it("says so when the activity cannot load", async () => {
    activity.mockRejectedValue(new Error("nope"));
    renderPanel();
    expect(await screen.findByText("Could not load sport activity.")).toBeTruthy();
  });
});
