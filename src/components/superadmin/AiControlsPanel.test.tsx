// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const setSetting = vi.fn(async (_: unknown) => ({ ok: true }));
let settings: { key: string; value: unknown }[] = [];

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/superadmin.functions", () => ({
  superadminListSettings: async () => ({ settings }),
  superadminSetSetting: (arg: unknown) => setSetting(arg),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import type { AiLimitsConfig } from "@/lib/ai/config";
import { AiControlsPanel } from "./AiControlsPanel";

afterEach(() => {
  cleanup();
  setSetting.mockClear();
  settings = [];
});

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AiControlsPanel />
    </QueryClientProvider>,
  );
}

describe("AiControlsPanel", () => {
  it("shows moderation as always on, with no switch to turn it off", async () => {
    renderPanel();
    expect(await screen.findByText("AI running")).toBeTruthy();
    expect(screen.getAllByText("Always on")).toHaveLength(2);
    expect(screen.queryByRole("switch", { name: "Text moderation" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Highlight reels" })).toBeTruthy();
  });

  it("saves a feature toggle as the full ai_features row", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("switch", { name: "Reel Coach" }));
    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1));
    const { data } = setSetting.mock.calls[0][0] as {
      data: { key: string; value: { killSwitch: boolean; features: Record<string, unknown> } };
    };
    expect(data.key).toBe("ai_features");
    expect(data.value.killSwitch).toBe(false);
    expect(data.value.features.reel_coach).toMatchObject({ enabled: false });
    expect(data.value.features.reel_pipeline).toMatchObject({ enabled: true });
  });

  it("loads the recommended preset into the draft and saves it as ai_limits", async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: /Load recommended preset/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save all tiers" }));
    await waitFor(() => expect(setSetting).toHaveBeenCalledTimes(1));
    const { data } = setSetting.mock.calls[0][0] as {
      data: { key: string; value: AiLimitsConfig };
    };
    expect(data.key).toBe("ai_limits");
    expect(data.value.free.perFeature.reel_pipeline).toEqual({ daily: 3, monthly: 3 });
    expect(data.value.gym.perFeature.reel_pipeline).toEqual({ daily: 60, monthly: 400 });
    expect(data.value.free.maxConcurrentJobs).toBe(1);
  });

  it("reflects a halted kill switch from the database", async () => {
    settings = [{ key: "ai_features", value: { killSwitch: true } }];
    renderPanel();
    expect(await screen.findByText("All AI halted")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume AI" })).toBeTruthy();
  });
});
