import { createHash } from "crypto";

/**
 * The fingerprint of a network post's text that report_post keeps as user_reports.post_body_md5 (20261205100000), so the
 * moderation queue can say when a post was edited after it was reported.
 *
 * Server only: node's crypto is not in the browser bundle. moderation.functions.ts imports these inside its handlers,
 * which the server-function split leaves out of the client build; a helper exported from that module itself would pull
 * `crypto` into the client build and break it.
 */

/** md5 of a post's text, as Postgres md5(text) computes it (UTF-8, lowercase hex). */
export function postBodyMd5(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

/**
 * Whether a reported post's text changed after the report: its md5 now against the one report_post kept. null when the
 * report kept none (a row written before 20261205100000 or by server code), so nobody can tell.
 */
export function postEditedSinceReport(
  body: string,
  reportedMd5: string | null | undefined,
): boolean | null {
  return reportedMd5 ? postBodyMd5(body) !== reportedMd5 : null;
}
