import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGE_POLICY,
  hourInCurfew,
  localHourIn,
  notificationCurfewDecision,
  type AgeCohort,
} from "@/lib/child-policy";
import { curfewGateFor, loadAgePolicy } from "@/lib/push-curfew.server";

const NIGHT = DEFAULT_AGE_POLICY.notificationCurfew; // { startHour: 0, endHour: 6 }
const DAY = { startHour: 9, endHour: 17 };

describe("hourInCurfew — non-wrapping window", () => {
  it("matches hours inside the window", () => {
    expect(hourInCurfew(12, DAY)).toBe(true);
  });

  it("includes the start boundary", () => {
    expect(hourInCurfew(9, DAY)).toBe(true);
  });

  it("excludes the end boundary", () => {
    expect(hourInCurfew(17, DAY)).toBe(false);
  });

  it("rejects hours outside the window", () => {
    expect(hourInCurfew(8, DAY)).toBe(false);
    expect(hourInCurfew(23, DAY)).toBe(false);
  });
});

describe("hourInCurfew — window crossing midnight", () => {
  it("matches midnight itself", () => {
    expect(hourInCurfew(0, NIGHT)).toBe(true);
  });

  it("matches the small hours inside the window", () => {
    expect(hourInCurfew(2, NIGHT)).toBe(true);
    expect(hourInCurfew(5, NIGHT)).toBe(true);
  });

  it("excludes the end boundary", () => {
    expect(hourInCurfew(6, NIGHT)).toBe(false);
  });

  it("rejects daytime and late-evening hours", () => {
    expect(hourInCurfew(12, NIGHT)).toBe(false);
    expect(hourInCurfew(23, NIGHT)).toBe(false);
  });

  it("matches the tail of a late-evening wrapping window", () => {
    const ct = { startHour: 21, endHour: 8 };
    expect(hourInCurfew(21, ct)).toBe(true);
    expect(hourInCurfew(23, ct)).toBe(true);
    expect(hourInCurfew(3, ct)).toBe(true);
    expect(hourInCurfew(8, ct)).toBe(false);
    expect(hourInCurfew(20, ct)).toBe(false);
  });
});

describe("hourInCurfew — degenerate inputs", () => {
  it("never matches when the curfew is disabled", () => {
    expect(hourInCurfew(2, null)).toBe(false);
  });

  it("never matches a zero-length window", () => {
    expect(hourInCurfew(6, { startHour: 6, endHour: 6 })).toBe(false);
  });

  it("normalizes out-of-range and fractional hours", () => {
    expect(hourInCurfew(24, NIGHT)).toBe(true); // wraps to 0
    expect(hourInCurfew(-1, NIGHT)).toBe(false); // wraps to 23
    expect(hourInCurfew(2.9, NIGHT)).toBe(true);
  });
});

describe("localHourIn", () => {
  const instant = new Date("2026-06-15T06:30:00.000Z");

  it("falls back to the UTC hour without a timezone", () => {
    expect(localHourIn(instant, null)).toBe(6);
    expect(localHourIn(instant, undefined)).toBe(6);
  });

  it("converts to the recipient's timezone", () => {
    expect(localHourIn(instant, "America/New_York")).toBe(2); // UTC-4 in June
    expect(localHourIn(instant, "Asia/Tokyo")).toBe(15);
  });

  it("uses 24-hour numbering rather than 12-hour", () => {
    const evening = new Date("2026-06-15T23:10:00.000Z");
    expect(localHourIn(evening, "UTC")).toBe(23);
  });

  it("reports midnight as hour 0", () => {
    expect(localHourIn(new Date("2026-06-15T00:05:00.000Z"), "UTC")).toBe(0);
  });

  it("honours daylight saving offsets", () => {
    const winter = new Date("2026-01-15T06:30:00.000Z");
    expect(localHourIn(winter, "America/New_York")).toBe(1); // UTC-5 in January
  });

  it("falls back to UTC for an invalid timezone", () => {
    expect(localHourIn(instant, "Not/AZone")).toBe(6);
  });
});

describe("notificationCurfewDecision", () => {
  const at = (iso: string) => new Date(iso);

  it("always sends to adults, even at 2am local time", () => {
    const d = notificationCurfewDecision({
      cohort: "adult",
      timezone: "America/New_York",
      now: at("2026-06-15T06:00:00.000Z"),
    });
    expect(d).toEqual({ send: true, deliverAfter: null, reason: "not_a_minor" });
  });

  it("sends to an unknown-age recipient rather than queueing forever", () => {
    expect(notificationCurfewDecision({ cohort: "unknown" }).reason).toBe("not_a_minor");
  });

  it("suppresses a 15-year-old's push at 2am local time", () => {
    const d = notificationCurfewDecision({
      cohort: "teen_13_15",
      timezone: "America/New_York",
      now: at("2026-06-15T06:00:00.000Z"),
    });
    expect(d.send).toBe(false);
    expect(d.reason).toBe("in_curfew");
    expect(d.deliverAfter).toBeInstanceOf(Date);
  });

  it("suppresses every minor cohort inside the window", () => {
    for (const cohort of ["child_under_13", "teen_13_15", "teen_16_17"] as AgeCohort[]) {
      const d = notificationCurfewDecision({
        cohort,
        timezone: "UTC",
        now: at("2026-06-15T01:00:00.000Z"),
      });
      expect(d.send).toBe(false);
    }
  });

  it("sends to a minor outside the window", () => {
    const d = notificationCurfewDecision({
      cohort: "teen_13_15",
      timezone: "UTC",
      now: at("2026-06-15T15:00:00.000Z"),
    });
    expect(d).toEqual({ send: true, deliverAfter: null, reason: "outside_curfew" });
  });

  it("sends when a guardian has lifted the curfew", () => {
    const d = notificationCurfewDecision({
      cohort: "child_under_13",
      curfewLifted: true,
      timezone: "UTC",
      now: at("2026-06-15T01:00:00.000Z"),
    });
    expect(d).toEqual({
      send: true,
      deliverAfter: null,
      reason: "curfew_lifted_by_guardian",
    });
  });

  it("sends when the curfew is disabled by policy", () => {
    const d = notificationCurfewDecision({
      cohort: "child_under_13",
      timezone: "UTC",
      now: at("2026-06-15T01:00:00.000Z"),
      config: { ...DEFAULT_AGE_POLICY, notificationCurfew: null },
    });
    expect(d.reason).toBe("curfew_disabled");
    expect(d.send).toBe(true);
  });

  it("queues until the window closes in the recipient's local time", () => {
    // 01:00 UTC = 01:00 local, curfew ends at 06:00 → 5 hours later.
    const d = notificationCurfewDecision({
      cohort: "teen_13_15",
      timezone: "UTC",
      now: at("2026-06-15T01:20:00.000Z"),
    });
    expect(d.deliverAfter?.toISOString()).toBe("2026-06-15T06:00:00.000Z");
  });

  it("queues past midnight for a wrapping evening window", () => {
    const config = {
      ...DEFAULT_AGE_POLICY,
      notificationCurfew: { startHour: 21, endHour: 8 },
    };
    const d = notificationCurfewDecision({
      cohort: "teen_16_17",
      timezone: "UTC",
      now: at("2026-06-15T22:15:00.000Z"),
      config,
    });
    expect(d.send).toBe(false);
    expect(d.deliverAfter?.toISOString()).toBe("2026-06-16T08:00:00.000Z");
  });

  it("uses a custom window from the active policy", () => {
    const config = { ...DEFAULT_AGE_POLICY, notificationCurfew: DAY };
    expect(
      notificationCurfewDecision({
        cohort: "teen_13_15",
        timezone: "UTC",
        now: at("2026-06-15T10:00:00.000Z"),
        config,
      }).send,
    ).toBe(false);
    expect(
      notificationCurfewDecision({
        cohort: "teen_13_15",
        timezone: "UTC",
        now: at("2026-06-15T02:00:00.000Z"),
        config,
      }).send,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Resolution layer: push-curfew.server.ts                             */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown> | null;

function fakeAdmin(rows: {
  settings?: Row;
  profile?: Row;
  controls?: Row;
  throwOn?: string;
}) {
  const table = (name: string) => {
    if (rows.throwOn === name) {
      throw new Error(`boom: ${name}`);
    }
    const data =
      name === "app_settings"
        ? (rows.settings ?? null)
        : name === "profiles"
          ? (rows.profile ?? null)
          : (rows.controls ?? null);
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data, error: null }),
    };
    return builder;
  };
  return { from: table };
}

describe("loadAgePolicy", () => {
  it("parses the stored settings row", async () => {
    const policy = await loadAgePolicy(
      fakeAdmin({
        settings: { value: { notification_curfew_start_hour: 22, notification_curfew_end_hour: 7 } },
      }),
    );
    expect(policy.notificationCurfew).toEqual({ startHour: 22, endHour: 7 });
  });

  it("falls back to the default policy when no row exists", async () => {
    expect(await loadAgePolicy(fakeAdmin({}))).toEqual(DEFAULT_AGE_POLICY);
  });

  it("falls back to the default policy when the lookup throws", async () => {
    expect(await loadAgePolicy(fakeAdmin({ throwOn: "app_settings" }))).toEqual(
      DEFAULT_AGE_POLICY,
    );
  });
});

describe("curfewGateFor", () => {
  const night = new Date("2026-06-15T06:00:00.000Z"); // 2am in New York

  it("sends for an adult recipient regardless of the hour", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({ profile: { age_cohort: "adult", timezone: "America/New_York" } }),
      "u1",
      night,
    );
    expect(gate).toEqual({ action: "send" });
  });

  it("queues a minor's push inside their local curfew", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({ profile: { age_cohort: "teen_13_15", timezone: "America/New_York" } }),
      "u2",
      night,
    );
    expect(gate.action).toBe("queue");
    if (gate.action === "queue") {
      expect(typeof gate.deliverAfter).toBe("string");
      expect(gate.decision.reason).toBe("in_curfew");
    }
  });

  it("sends a minor's push outside the curfew", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({ profile: { age_cohort: "teen_16_17", timezone: "UTC" } }),
      "u3",
      new Date("2026-06-15T15:00:00.000Z"),
    );
    expect(gate).toEqual({ action: "send" });
  });

  it("sends when the guardian lifted the curfew for their child", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({
        profile: { age_cohort: "child_under_13", timezone: "UTC" },
        controls: { notifications: true, notification_curfew_lifted: true },
      }),
      "u4",
      new Date("2026-06-15T01:00:00.000Z"),
    );
    expect(gate).toEqual({ action: "send" });
  });

  it("blocks entirely when the guardian turned notifications off", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({
        profile: { age_cohort: "teen_13_15", timezone: "UTC" },
        controls: { notifications: false, notification_curfew_lifted: true },
      }),
      "u5",
      new Date("2026-06-15T15:00:00.000Z"),
    );
    expect(gate).toEqual({ action: "blocked", reason: "guardian_notifications_off" });
  });

  it("ignores a guardian notifications switch attached to an adult row", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({
        profile: { age_cohort: "adult", timezone: "UTC" },
        controls: { notifications: false },
      }),
      "u6",
      night,
    );
    expect(gate).toEqual({ action: "send" });
  });

  it("treats a missing profile as unknown age and still sends", async () => {
    const gate = await curfewGateFor(fakeAdmin({}), "u7", night);
    expect(gate).toEqual({ action: "send" });
  });

  it("uses the stored policy window rather than the hard-coded default", async () => {
    const gate = await curfewGateFor(
      fakeAdmin({
        settings: {
          value: { notification_curfew_start_hour: 9, notification_curfew_end_hour: 17 },
        },
        profile: { age_cohort: "teen_13_15", timezone: "UTC" },
      }),
      "u8",
      new Date("2026-06-15T10:00:00.000Z"),
    );
    expect(gate.action).toBe("queue");
  });
});
