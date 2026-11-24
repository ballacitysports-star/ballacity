// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formatRunDuration,
  parseScheduledJobs,
  type ScheduledJobsResult,
} from "@/lib/scheduled-jobs";

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
const loadJobs = vi.fn();
vi.mock("@/lib/superadmin.functions", () => ({
  superadminScheduledJobs: (a: unknown) => loadJobs(a),
}));

import { ScheduledJobsCard } from "./ScheduledJobsCard";

const FAILED_MESSAGE = "ERROR: insert failed. Key (user_id)=([value]) for [email]";

// The function's answer as the database sends it, with a field the card must never pass on (command).
const RAW = {
  available: true,
  generated_at: "2026-11-24T12:00:00+00:00",
  runs_per_job: 5,
  jobs: [
    {
      jobid: 2,
      jobname: "purge-diagnostics",
      schedule: "37 3 * * *",
      active: true,
      last_status: "failed",
      last_run_at: "2026-11-24T03:37:00+00:00",
      last_success_at: "2026-11-23T03:37:00+00:00",
      failures_7d: 2,
      flags: ["last_run_failed"],
      attention: true,
      command: "SELECT net.http_post('https://secret.example.test/api')",
      runs: [
        {
          status: "failed",
          start_time: "2026-11-24T03:37:00+00:00",
          end_time: "2026-11-24T03:37:02+00:00",
          message: FAILED_MESSAGE,
        },
        {
          status: "succeeded",
          start_time: "2026-11-23T03:37:00+00:00",
          end_time: "2026-11-23T03:38:05+00:00",
          message: "DELETE 12 should never show",
        },
      ],
    },
    {
      jobid: 1,
      jobname: "flush-held-notifications",
      schedule: "*/5 * * * *",
      active: true,
      last_status: "succeeded",
      last_run_at: "2026-11-24T11:55:00+00:00",
      last_success_at: "2026-11-24T11:55:00+00:00",
      failures_7d: 0,
      flags: [],
      attention: false,
      runs: [
        {
          status: "succeeded",
          start_time: "2026-11-24T11:55:00+00:00",
          end_time: "2026-11-24T11:55:01+00:00",
          message: null,
        },
      ],
    },
    {
      jobid: 4,
      jobname: "expire-managed-handovers",
      schedule: "51 4 * * *",
      active: true,
      last_status: null,
      last_run_at: null,
      last_success_at: null,
      failures_7d: 0,
      flags: ["never_run"],
      attention: true,
      runs: [],
    },
  ],
  http: {
    available: true,
    window_hours: 24,
    oldest_at: "2026-11-24T06:00:00+00:00",
    total: 9,
    s2xx: 4,
    s3xx: 1,
    s4xx: 1,
    s5xx: 2,
    no_response: 1,
    other: 0,
  },
};

function parsed(raw: unknown = RAW): ScheduledJobsResult {
  const r = parseScheduledJobs(raw);
  if (!r) throw new Error("bad fixture");
  return r;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduledJobsCard />
    </QueryClientProvider>,
  );
}

const jobRow = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

afterEach(cleanup);
beforeEach(() => {
  loadJobs.mockReset();
});

describe("parseScheduledJobs", () => {
  it("keeps only known fields: no command, and no message on a run that did not fail", () => {
    const r = parsed();
    const text = JSON.stringify(r);
    expect(text).not.toContain("secret.example.test");
    expect(text).not.toContain("command");
    expect(text).not.toContain("DELETE 12");
    if (!r.available) throw new Error("expected available");
    expect(r.jobs[0].runs[0].message).toBe(FAILED_MESSAGE);
    expect(r.jobs[0].runs[1].message).toBeNull();
  });

  it("reads not available, and refuses a shape it does not know", () => {
    expect(parseScheduledJobs({ available: false, reason: "not_installed", jobs: [] })).toEqual({
      available: false,
      reason: "not_installed",
    });
    expect(parseScheduledJobs({ available: false, reason: "unreadable", jobs: [] })).toEqual({
      available: false,
      reason: "unreadable",
    });
    expect(parseScheduledJobs(null)).toBeNull();
    expect(parseScheduledJobs({ available: true })).toBeNull();
    expect(parseScheduledJobs({ available: true, jobs: [{ jobname: "x" }] })).toBeNull();
  });

  it("formats run durations", () => {
    expect(formatRunDuration("2026-11-24T03:37:00Z", "2026-11-24T03:37:02Z")).toBe("2 s");
    expect(formatRunDuration("2026-11-24T03:37:00Z", "2026-11-24T03:38:05Z")).toBe("1 min 5 s");
    expect(formatRunDuration("2026-11-24T03:00:00Z", "2026-11-24T04:03:00Z")).toBe("1 h 3 min");
    expect(formatRunDuration("2026-11-24T03:37:00Z", null)).toBeNull();
  });
});

describe("ScheduledJobsCard", () => {
  it("lists one row per job with schedule, last status and failures in 7 days", async () => {
    loadJobs.mockResolvedValue(parsed());
    renderCard();
    expect(await screen.findByText("purge-diagnostics")).toBeTruthy();
    const purge = within(jobRow("purge-diagnostics"));
    expect(purge.getByText("37 3 * * *")).toBeTruthy();
    expect(purge.getByText("failed")).toBeTruthy();
    expect(purge.getByText("2 failed in 7 days")).toBeTruthy();
    expect(purge.getByText("Last run failed")).toBeTruthy();
    const flush = within(jobRow("flush-held-notifications"));
    expect(flush.getByText("succeeded")).toBeTruthy();
    expect(flush.getByText("0 failed in 7 days")).toBeTruthy();
    expect(within(jobRow("expire-managed-handovers")).getByText("Never ran")).toBeTruthy();
    expect(screen.getByText("2 need attention")).toBeTruthy();
    expect(screen.queryByText(/secret\.example\.test/)).toBeNull();
    expect(loadJobs).toHaveBeenCalledWith({ data: {} });
  });

  it("marks flagged jobs with the warning style, and only those", async () => {
    loadJobs.mockResolvedValue(parsed());
    renderCard();
    await screen.findByText("purge-diagnostics");
    expect(jobRow("purge-diagnostics").dataset.attention).toBe("true");
    expect(jobRow("purge-diagnostics").className).toContain("border-destructive");
    expect(jobRow("expire-managed-handovers").dataset.attention).toBe("true");
    expect(jobRow("flush-held-notifications").dataset.attention).toBe("false");
    expect(jobRow("flush-held-notifications").className).not.toContain("border-destructive");
  });

  it("shows a failed run's message only on request, and never one for a run that succeeded", async () => {
    loadJobs.mockResolvedValue(parsed());
    renderCard();
    await screen.findByText("purge-diagnostics");
    expect(screen.queryByText(FAILED_MESSAGE)).toBeNull();
    fireEvent.click(within(jobRow("purge-diagnostics")).getByText("Last 2 runs"));
    const runs = within(screen.getByRole("list", { name: "Last runs of purge-diagnostics" }));
    expect(runs.getAllByText("Show message")).toHaveLength(1);
    expect(runs.getByText("· 1 min 5 s")).toBeTruthy();
    fireEvent.click(runs.getByText("Show message"));
    expect(screen.getByText(FAILED_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/DELETE 12/)).toBeNull();
    fireEvent.click(runs.getByText("Hide message"));
    expect(screen.queryByText(FAILED_MESSAGE)).toBeNull();
  });

  it("shows the pg_net response counts, with server errors and no responses marked", async () => {
    loadJobs.mockResolvedValue(parsed());
    renderCard();
    const http = await screen.findByTestId("scheduled-jobs-http");
    expect(http.textContent).toContain("4 ok · 1 redirect · 1 client error");
    expect(within(http).getByText("2 server error · 1 no response").className).toContain(
      "text-destructive",
    );
  });

  it("says when pg_net results cannot be read", async () => {
    loadJobs.mockResolvedValue(parsed({ ...RAW, http: { available: false } }));
    renderCard();
    expect(await screen.findByText(/still shows as succeeded/)).toBeTruthy();
  });

  it("says when every job is healthy", async () => {
    loadJobs.mockResolvedValue(parsed({ ...RAW, jobs: [RAW.jobs[1]] }));
    renderCard();
    expect(await screen.findByText("All healthy")).toBeTruthy();
  });

  it.each([
    ["not_installed", /pg_cron is not installed here/],
    ["unreadable", /could not be read/],
    ["not_deployed", /20261201100000/],
  ] as const)("says scheduled jobs are not available (%s)", async (reason, detail) => {
    loadJobs.mockResolvedValue({ available: false, reason });
    renderCard();
    expect(
      await screen.findByText("Scheduled jobs are not available on this database"),
    ).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Scheduled jobs" })).toBeNull();
  });

  it("shows a loading state first", () => {
    loadJobs.mockReturnValue(new Promise(() => {}));
    renderCard();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("words a refusal through the error catalog, never the raw text", async () => {
    loadJobs.mockRejectedValue(new Error("SUPERADMIN_ONLY"));
    renderCard();
    expect(await screen.findByText("You don't have access to that.")).toBeTruthy();
    expect(screen.queryByText(/SUPERADMIN_ONLY/)).toBeNull();
  });
});
