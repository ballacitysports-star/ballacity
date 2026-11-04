import { describe, expect, it } from "vitest";
import {
  TEAM_CONTENT_REPORT_REASONS,
  describeReportError,
  reasonsFor,
  reportReasonLabel,
} from "./moderation";

describe("team content reporting", () => {
  it("offers the content reasons for posts and comments only", () => {
    expect(reasonsFor("team_post")).toBe(TEAM_CONTENT_REPORT_REASONS);
    expect(reasonsFor("comment")).toBe(TEAM_CONTENT_REPORT_REASONS);
    expect(reasonsFor("user")).not.toBe(TEAM_CONTENT_REPORT_REASONS);
  });
  it("only uses reasons the database accepts", () => {
    const accepted = new Set([
      "spam",
      "harassment",
      "inappropriate",
      "impersonation",
      "safety",
      "other",
      "threats",
      "fake_account",
      "scam",
      "unsafe_behavior",
      "minor_safety",
      "fake_game",
      "unsafe_location",
      "misleading",
      "illegal",
      "payment_scam",
      "payment_not_received",
      "payment_pressure",
      "unsafe_conditions",
      "injury_risk",
      "location_disclosed",
    ]);
    for (const r of TEAM_CONTENT_REPORT_REASONS) expect(accepted.has(r.value)).toBe(true);
  });
  it("labels every reason", () => {
    for (const r of TEAM_CONTENT_REPORT_REASONS)
      expect(reportReasonLabel(r.value)).not.toBe(r.value);
  });
  it("turns database refusals into plain sentences without raw codes", () => {
    expect(
      describeReportError({
        message:
          'duplicate key value violates unique constraint "user_reports_open_team_post_uidx"',
      }),
    ).toMatch(/already reported/);
    expect(describeReportError({ message: "REPORT_RATE_LIMIT: too many" })).toMatch(
      /lot of reports/,
    );
    expect(describeReportError({ message: "CONTENT_NOT_FOUND: x" })).toMatch(/no longer available/);
    expect(describeReportError(null)).toBe("Couldn't send your report");
  });
});
