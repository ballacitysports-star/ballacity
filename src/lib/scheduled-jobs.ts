/**
 * Scheduled jobs health as the SuperAdmin Scheduled jobs card shows it.
 *
 * The data comes from public.superadmin_scheduled_jobs (supabase/migrations/20261201100000_scheduled_jobs_health.sql):
 * pg_cron's jobs with their last runs, failures in 7 days and flags, plus counts of pg_net responses. The server never sends
 * a job's command, user or database, and redacts and shortens a failed run's message. This module reads that answer and
 * keeps only the fields it knows, so anything else the server might send never reaches the screen, and it keeps a message
 * only on a failed run.
 */

export const SCHEDULED_JOB_FLAGS = [
  "last_run_failed",
  "not_run_25h",
  "never_run",
  "inactive",
] as const;
export type ScheduledJobFlag = (typeof SCHEDULED_JOB_FLAGS)[number];

export const SCHEDULED_JOB_FLAG_LABELS: Record<ScheduledJobFlag, string> = {
  last_run_failed: "Last run failed",
  not_run_25h: "No run in 25 h",
  never_run: "Never ran",
  inactive: "Paused",
};

export type ScheduledJobRun = {
  status: string;
  startTime: string | null;
  endTime: string | null;
  /** Only on a failed run; already redacted and cut to 200 characters by the server. */
  message: string | null;
};

export type ScheduledJob = {
  jobid: number;
  name: string;
  schedule: string;
  active: boolean;
  lastStatus: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  failures7d: number;
  runs: ScheduledJobRun[];
  flags: ScheduledJobFlag[];
  attention: boolean;
};

export type HttpResponseCounts =
  | { available: false }
  | {
      available: true;
      windowHours: number;
      oldestAt: string | null;
      total: number;
      s2xx: number;
      s3xx: number;
      s4xx: number;
      s5xx: number;
      noResponse: number;
      other: number;
    };

export type ScheduledJobsReport = {
  available: true;
  generatedAt: string | null;
  runsPerJob: number;
  jobs: ScheduledJob[];
  http: HttpResponseCounts;
};

/** not_installed: no pg_cron here. unreadable: pg_cron is there but its tables could not be read. not_deployed: no function. */
export type ScheduledJobsUnavailable = {
  available: false;
  reason: "not_installed" | "unreadable" | "not_deployed";
};

export type ScheduledJobsResult = ScheduledJobsReport | ScheduledJobsUnavailable;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function readRun(raw: unknown): ScheduledJobRun | null {
  const r = obj(raw);
  if (!r || typeof r.status !== "string") return null;
  return {
    status: r.status,
    startTime: str(r.start_time),
    endTime: str(r.end_time),
    message: r.status === "failed" ? str(r.message) : null,
  };
}

function readJob(raw: unknown): ScheduledJob | null {
  const j = obj(raw);
  if (!j || typeof j.jobid !== "number" || typeof j.schedule !== "string") return null;
  const runs = Array.isArray(j.runs)
    ? j.runs.map(readRun).filter((r): r is ScheduledJobRun => r !== null)
    : [];
  const flags = Array.isArray(j.flags)
    ? j.flags.filter((f): f is ScheduledJobFlag =>
        (SCHEDULED_JOB_FLAGS as readonly unknown[]).includes(f),
      )
    : [];
  return {
    jobid: j.jobid,
    name: str(j.jobname) ?? `job ${j.jobid}`,
    schedule: j.schedule,
    active: j.active !== false,
    lastStatus: str(j.last_status),
    lastRunAt: str(j.last_run_at),
    lastSuccessAt: str(j.last_success_at),
    failures7d: num(j.failures_7d),
    runs,
    flags,
    attention: j.attention === true || flags.length > 0,
  };
}

function readHttp(raw: unknown): HttpResponseCounts {
  const h = obj(raw);
  if (!h || h.available !== true) return { available: false };
  return {
    available: true,
    windowHours: num(h.window_hours) || 24,
    oldestAt: str(h.oldest_at),
    total: num(h.total),
    s2xx: num(h.s2xx),
    s3xx: num(h.s3xx),
    s4xx: num(h.s4xx),
    s5xx: num(h.s5xx),
    noResponse: num(h.no_response),
    other: num(h.other),
  };
}

/** The function's answer, checked. null when it is not the shape the card expects. */
export function parseScheduledJobs(raw: unknown): ScheduledJobsResult | null {
  const o = obj(raw);
  if (!o) return null;
  if (o.available === false) {
    return { available: false, reason: o.reason === "unreadable" ? "unreadable" : "not_installed" };
  }
  if (o.available !== true || !Array.isArray(o.jobs)) return null;
  const jobs: ScheduledJob[] = [];
  for (const j of o.jobs) {
    const job = readJob(j);
    if (!job) return null;
    jobs.push(job);
  }
  return {
    available: true,
    generatedAt: str(o.generated_at),
    runsPerJob: num(o.runs_per_job),
    jobs,
    http: readHttp(o.http),
  };
}

/** "2 s", "1 min 5 s", "1 h 3 min"; null when the run has not ended or a time is missing. */
export function formatRunDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A run or job time in the viewer's locale, or "–". */
export function formatJobTime(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "–"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}
