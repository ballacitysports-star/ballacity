import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { superadminScheduledJobs } from "@/lib/superadmin.functions";
import {
  SCHEDULED_JOB_FLAG_LABELS,
  formatJobTime,
  formatRunDuration,
  type HttpResponseCounts,
  type ScheduledJob,
  type ScheduledJobRun,
  type ScheduledJobsResult,
  type ScheduledJobsUnavailable,
} from "@/lib/scheduled-jobs";
import { userErrorMessage } from "@/lib/user-error";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const UNAVAILABLE_DETAIL: Record<ScheduledJobsUnavailable["reason"], string> = {
  not_installed: "pg_cron is not installed here. The E2E sandbox and the CI database have none.",
  unreadable: "pg_cron is installed, but its job tables could not be read.",
  not_deployed:
    "This database doesn't have the report yet. It appears once migration 20261201100000 is applied.",
};

/**
 * The pg_cron jobs (flush, reminders, nightly purges and sweeps) with their last runs, so a failing job is seen without
 * querying the database. The server never sends a job's command, user or database; a failed run's message comes redacted
 * (no ids, emails, long numbers or links) and cut short, and is shown only on request.
 */
export function ScheduledJobsCard() {
  const load = useServerFn(superadminScheduledJobs);
  const { data, isLoading, isError, error } = useQuery<ScheduledJobsResult>({
    queryKey: ["superadmin-scheduled-jobs"],
    queryFn: () => load({ data: {} }),
    refetchInterval: 120_000,
  });

  const flagged = data?.available ? data.jobs.filter((j) => j.attention).length : 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Scheduled jobs</CardTitle>
          {data?.available ? (
            <Badge variant={flagged > 0 ? "destructive" : "secondary"}>
              {flagged > 0 ? `${flagged} need${flagged === 1 ? "s" : ""} attention` : "All healthy"}
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Database jobs (pg_cron) and their last runs. A job is flagged when its last run failed or
          it has not run in 25 hours. Commands are never shown.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : isError || !data ? (
          <div className="text-sm text-destructive">
            {userErrorMessage(error, "Couldn't load the scheduled jobs.")}
          </div>
        ) : !data.available ? (
          <div
            className="rounded-lg border border-dashed p-3 text-sm"
            data-testid="scheduled-jobs-unavailable"
          >
            <div className="font-medium">Scheduled jobs are not available on this database</div>
            <div className="text-xs text-muted-foreground">{UNAVAILABLE_DETAIL[data.reason]}</div>
          </div>
        ) : (
          <>
            {data.jobs.length === 0 ? (
              <div className="text-sm text-muted-foreground">No scheduled jobs.</div>
            ) : (
              <ul className="space-y-1.5" aria-label="Scheduled jobs">
                {data.jobs.map((job) => (
                  <JobRow key={job.jobid} job={job} />
                ))}
              </ul>
            )}
            <HttpNote http={data.http} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function statusVariant(status: string | null): "destructive" | "secondary" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "succeeded") return "secondary";
  return "outline";
}

function JobRow({ job }: { job: ScheduledJob }) {
  const [open, setOpen] = useState(false);
  return (
    <li
      className={cn(
        "rounded-lg border p-2 text-xs",
        job.attention && "border-destructive/40 bg-destructive/10",
      )}
      data-attention={job.attention ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="font-mono font-medium break-all">{job.name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{job.schedule}</div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">{formatJobTime(job.lastRunAt)}</span>
          <Badge variant={statusVariant(job.lastStatus)}>{job.lastStatus ?? "no runs"}</Badge>
          <span
            className={cn(
              "tabular-nums",
              job.failures7d > 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {job.failures7d} failed in 7 days
          </span>
        </div>
      </div>
      {job.flags.length > 0 || job.runs.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {job.flags.map((f) => (
            <Badge key={f} variant="outline" className="border-destructive/40 text-destructive">
              {SCHEDULED_JOB_FLAG_LABELS[f]}
            </Badge>
          ))}
          {job.lastSuccessAt && job.lastStatus !== "succeeded" ? (
            <span className="text-[11px] text-muted-foreground">
              Last success {formatJobTime(job.lastSuccessAt)}
            </span>
          ) : null}
          {job.runs.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-6 px-2 text-[11px]"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide runs" : `Last ${job.runs.length} runs`}
            </Button>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <ul className="mt-1 space-y-1 border-t pt-1" aria-label={`Last runs of ${job.name}`}>
          {job.runs.map((run, i) => (
            <RunRow key={`${run.startTime ?? "none"}-${i}`} run={run} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function RunRow({ run }: { run: ScheduledJobRun }) {
  const [show, setShow] = useState(false);
  const duration = formatRunDuration(run.startTime, run.endTime);
  return (
    <li>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant(run.status)} className="px-1.5 py-0 text-[10px]">
          {run.status}
        </Badge>
        <span className="text-muted-foreground">{formatJobTime(run.startTime)}</span>
        {duration ? <span className="text-muted-foreground">· {duration}</span> : null}
        {run.status === "failed" && run.message ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-5 px-1.5 text-[11px]"
            aria-expanded={show}
            onClick={() => setShow((s) => !s)}
          >
            {show ? "Hide message" : "Show message"}
          </Button>
        ) : null}
      </div>
      {show && run.status === "failed" && run.message ? (
        <div className="mt-0.5 rounded bg-muted px-2 py-1 font-mono text-[11px] break-words">
          {run.message}
        </div>
      ) : null}
    </li>
  );
}

function HttpNote({ http }: { http: HttpResponseCounts }) {
  if (!http.available) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Worker call results (pg_net) can&rsquo;t be read here, so a job that called a failing
        endpoint still shows as succeeded.
      </p>
    );
  }
  const bad = http.s5xx + http.noResponse;
  return (
    <div className="text-[11px] text-muted-foreground" data-testid="scheduled-jobs-http">
      <span>
        Worker calls (pg_net), last {http.windowHours} h
        {http.oldestAt ? `, kept since ${formatJobTime(http.oldestAt)}` : ""}:{" "}
      </span>
      <span className="tabular-nums">
        {http.s2xx} ok · {http.s3xx} redirect · {http.s4xx} client error ·{" "}
        <span className={cn(bad > 0 && "font-medium text-destructive")}>
          {http.s5xx} server error · {http.noResponse} no response
        </span>
      </span>
      <div>
        A job that calls a worker succeeds once the call is sent, so endpoint errors show only here.
      </div>
    </div>
  );
}
