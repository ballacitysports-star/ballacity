// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FUNNEL_COUNT_KEYS, parseFunnelReport, type FunnelResult } from "@/lib/funnel";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
const loadFunnel = vi.fn();
const setMinors = vi.fn();
vi.mock("@/lib/superadmin.functions", () => ({
  superadminFunnel: (a: unknown) => loadFunnel(a),
  superadminSetFunnelMinorCounts: (a: unknown) => setMinors(a),
}));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => toastError(m) } }));

import { FunnelCard } from "./FunnelCard";

const group = (over: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(FUNNEL_COUNT_KEYS.map((k) => [k, 0])),
  marked_coverage_pct: null,
  show_up_rate_pct: null,
  ...over,
});

function result(minors: boolean, week: Record<string, unknown> = {}): FunnelResult {
  const report = parseFunnelReport({
    timezone: "America/New_York",
    from: "2026-11-09",
    to: "2026-11-21",
    pilot_start: null,
    minors_column: minors,
    history: { available: false, frozen_before: "2026-10-26", days_used: 0 },
    weeks: [
      {
        week_start: "2026-11-09",
        first_day: "2026-11-09",
        last_day: "2026-11-15",
        source: "live",
        adults: group({ posters: 6 }),
      },
      {
        week_start: "2026-11-16",
        first_day: "2026-11-16",
        last_day: "2026-11-21",
        source: "live",
        adults: group({
          posters: 23,
          invites_sent: 17,
          invites_game_started: 7,
          invites_attendance_marked: 6,
          invites_showed_up: 5,
          invites_late_leaves: "<5",
          marked_coverage_pct: 86,
          show_up_rate_pct: 83,
        }),
        ...week,
      },
    ],
  });
  if (!report) throw new Error("bad fixture");
  return { available: true, report };
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FunnelCard />
    </QueryClientProvider>,
  );
}

const row = (label: string) => screen.getByText(label).closest("tr") as HTMLElement;

afterEach(cleanup);
beforeEach(() => {
  loadFunnel.mockReset();
  setMinors.mockReset();
  toastError.mockReset();
});

describe("FunnelCard", () => {
  it("shows the weekly steps with small counts masked, newest week first", async () => {
    loadFunnel.mockResolvedValue(result(false));
    renderCard();
    expect(await screen.findByText("Nov 16 – 21")).toBeTruthy();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers.slice(1)).toEqual(["Nov 16 – 21", "Nov 9 – 15"]);
    expect(
      within(row("Posted availability"))
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(expect.arrayContaining(["23", "6"]));
    expect(within(row("Late leaves")).getByText("<5")).toBeTruthy();
    expect(loadFunnel).toHaveBeenCalledWith({ data: { weeks: 8 } });
  });

  it("puts the marked coverage next to the show-up rate", async () => {
    loadFunnel.mockResolvedValue(result(false));
    renderCard();
    const rates = within(
      await screen
        .findByText("Show-up rate · marked coverage")
        .then((e) => e.closest("tr") as HTMLElement),
    );
    expect(rates.getByText("83% · 86% marked")).toBeTruthy();
    // a week whose counts are masked or empty shows no rate at all
    expect(rates.getByText("– · – marked")).toBeTruthy();
  });

  it("hides the under-18 column while the switch is off, even if a week carries one", async () => {
    loadFunnel.mockResolvedValue(result(false, { not_confirmed_adult: group({ posters: 941 }) }));
    renderCard();
    await screen.findByText("Nov 16 – 21");
    expect(screen.queryByText("Under 18 or age unknown")).toBeNull();
    expect(screen.queryByText("941")).toBeNull();
    expect(screen.getByText("Off")).toBeTruthy();
  });

  it("shows it, masked, while the switch is on", async () => {
    loadFunnel.mockResolvedValue(result(true, { not_confirmed_adult: group({ posters: "<5" }) }));
    renderCard();
    await screen.findByText("Nov 16 – 21");
    expect(screen.getAllByText("Under 18 or age unknown").length).toBe(2);
    expect(within(row("Posted availability")).getByText("<5")).toBeTruthy();
    expect(screen.getByText("On")).toBeTruthy();
  });

  it('says "Not available yet" when the database has no funnel report', async () => {
    loadFunnel.mockResolvedValue({ available: false });
    renderCard();
    expect(await screen.findByText("Not available yet")).toBeTruthy();
    expect(screen.queryByText(/Turn on/)).toBeNull();
  });

  it("words a refusal through the error catalog, never the raw text", async () => {
    loadFunnel.mockRejectedValue(new Error("SUPERADMIN_ONLY"));
    renderCard();
    expect(await screen.findByText("You don't have access to that.")).toBeTruthy();
    expect(screen.queryByText(/SUPERADMIN_ONLY/)).toBeNull();
  });

  it("turns the column on only with a reason and the typed word", async () => {
    loadFunnel.mockResolvedValue(result(false));
    setMinors.mockRejectedValue(
      new Error("FUNNEL_MINOR_COUNTS_REASON_REQUIRED: say why, and name the counsel sign-off."),
    );
    renderCard();
    fireEvent.click(await screen.findByText("Turn on…"));
    const confirm = screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Why are you doing this?"), {
      target: { value: "Counsel ok" },
    });
    expect(confirm.disabled).toBe(true);
    const typed = screen.getAllByRole("textbox").at(-1) as HTMLElement;
    fireEvent.change(typed, { target: { value: "counsel" } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(setMinors).toHaveBeenCalledWith({ data: { enabled: true, reason: "Counsel ok" } }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Say why. To turn the under-18 column on, name counsel's sign-off and its date (at least 20 characters).",
      ),
    );
  });
});
