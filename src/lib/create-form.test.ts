import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  CREATE_FIELD_ORDER,
  FEE_ERROR,
  MORE_OPTIONS_FIELDS,
  SPOTS_ERROR,
  defaultGameTitle,
  errorCount,
  firstErrorField,
  moreOptionsChanged,
  moreOptionsSummary,
  parseSpots,
  publishSummaryLines,
  skillHint,
  validateCreateForm,
  venueError,
  type CreateFormInput,
} from "./create-form";
import { defaultGamePolicy } from "./game-policy";
import { LEVELS_BY_SPORT, scaleForSport } from "./sport-levels";

const NOW = new Date("2026-11-20T12:00:00Z");
const TZ = "UTC";

const valid = (over: Partial<CreateFormInput> = {}): CreateFormInput => ({
  hasAffiliation: true,
  multiDay: false,
  when: {
    startDate: "2026-11-21",
    startTime: "18:00",
    endDate: "2026-11-21",
    endTime: "20:00",
    allDay: false,
  },
  schedule: [],
  repeat: { freq: "none", until: null },
  location: "Rucker Park, 155th St, New York",
  profileCity: "New York",
  spotsText: "10",
  paid: false,
  feeText: "10",
  policy: defaultGamePolicy(10),
  now: NOW,
  timeZone: TZ,
  ...over,
});

describe("validateCreateForm", () => {
  it("passes a complete quick form with every More options default", () => {
    expect(validateCreateForm(valid())).toEqual({});
  });

  it("reports every problem at once, in page order", () => {
    const errors = validateCreateForm(
      valid({
        hasAffiliation: false,
        when: { ...valid().when, startDate: "2026-11-01", endDate: "2026-11-01" },
        location: "",
        spotsText: "",
        paid: true,
        feeText: "0",
        policy: { ...defaultGamePolicy(10), cancellationPolicy: "custom", cancellationNotes: "" },
      }),
    );
    expect(Object.keys(errors)).toEqual([
      "hostAs",
      "when",
      "venue",
      "spots",
      "fee",
      "cancellationNotes",
    ]);
    expect(errorCount(errors)).toBe(6);
    expect(firstErrorField(errors)).toBe("hostAs");
    expect(errors.spots).toBe(SPOTS_ERROR);
    expect(errors.fee).toBe(FEE_ERROR);
  });

  it("checks the repeat end date for one-day games only", () => {
    const repeat = { freq: "weekly" as const, until: "2026-11-01" };
    expect(validateCreateForm(valid({ repeat })).repeatUntil).toMatch(/last date/i);
    expect(
      validateCreateForm(
        valid({ repeat, multiDay: true, schedule: [{ date: "2026-11-22", time: "18:00" }] }),
      ).repeatUntil,
    ).toBeUndefined();
  });

  it("checks the multi-day schedule instead of the one-day range", () => {
    expect(validateCreateForm(valid({ multiDay: true, schedule: [] })).when).toMatch(
      /at least one day/i,
    );
  });

  it("keeps minimum-to-play within the spots, as the database does", () => {
    const policy = { ...defaultGamePolicy(10), minPlayers: 12 };
    expect(validateCreateForm(valid({ policy })).minPlayers).toMatch(/more than the spots/);
    // Raising the spots clears it.
    expect(validateCreateForm(valid({ policy, spotsText: "14" })).minPlayers).toBeUndefined();
  });

  it("only checks the fee for a paid game", () => {
    expect(validateCreateForm(valid({ paid: false, feeText: "" })).fee).toBeUndefined();
    expect(validateCreateForm(valid({ paid: true, feeText: "" })).fee).toBe(FEE_ERROR);
    expect(validateCreateForm(valid({ paid: true, feeText: "0.5" })).fee).toBe(FEE_ERROR);
    expect(validateCreateForm(valid({ paid: true, feeText: "5" })).fee).toBeUndefined();
  });

  it("lists More options fields after the quick form", () => {
    const quick = CREATE_FIELD_ORDER.filter((f) => !MORE_OPTIONS_FIELDS.has(f) && f !== "form");
    const more = CREATE_FIELD_ORDER.filter((f) => MORE_OPTIONS_FIELDS.has(f));
    expect(Math.max(...quick.map((f) => CREATE_FIELD_ORDER.indexOf(f)))).toBeLessThan(
      Math.min(...more.map((f) => CREATE_FIELD_ORDER.indexOf(f))),
    );
  });
});

describe("venueError (a venue is required to publish)", () => {
  it("refuses a blank venue", () => {
    expect(venueError("   ")).toMatch(/where the game is/i);
  });

  it.each(["TBD", "tbd.", "TBA", "to be determined", "N/A", "?", "---"])(
    "refuses the placeholder %s",
    (v) => {
      expect(venueError(v)).toMatch(/real venue/i);
    },
  );

  it("refuses the host's profile city on its own", () => {
    expect(venueError("Austin, TX", "Austin, TX")).toMatch(/city/i);
    expect(venueError("austin", "Austin, TX")).toMatch(/city/i);
    expect(venueError("Zilker Park, Austin, TX", "Austin, TX")).toBeNull();
  });

  it("accepts a real place", () => {
    expect(venueError("YMCA Downtown")).toBeNull();
  });
});

describe("parseSpots", () => {
  it("accepts whole numbers between the limits only", () => {
    expect(parseSpots("10")).toBe(10);
    expect(parseSpots("2")).toBe(2);
    expect(parseSpots("30")).toBe(30);
    expect(parseSpots("1")).toBeNull();
    expect(parseSpots("31")).toBeNull();
    expect(parseSpots("7.5")).toBeNull();
    expect(parseSpots("")).toBeNull();
  });
});

describe("skillHint", () => {
  it("never shows the football example under Basketball or the generic scale", () => {
    for (const sport of ["Basketball", "Soccer", "Baseball", "Tennis"] as const) {
      const hint = skillHint(scaleForSport(sport)) ?? "";
      expect(hint).not.toMatch(/Flag|7v7/);
    }
  });

  it("builds the Football example from its real tier names", () => {
    const hint = skillHint(LEVELS_BY_SPORT.Football) ?? "";
    expect(hint).toContain('"Flag Rec · 7v7 Travel / Showcase"');
    const tiers = new Set(LEVELS_BY_SPORT.Football.tiers);
    const example = /"(.+) · (.+)"/.exec(hint);
    expect(example && tiers.has(example[1]) && tiers.has(example[2])).toBe(true);
    expect(hint).not.toContain("Elite");
  });

  it("says nothing for a single-choice scale", () => {
    expect(skillHint({ system: "X", tiers: ["A", "B"] })).toBeNull();
  });
});

describe("More options summary", () => {
  const defaults = {
    paid: false,
    price: 0,
    priv: false,
    requiresApproval: true,
    minAge: null,
    maxAge: null,
    signupCutoffMin: 0,
  };

  it("starts with approval on and nothing changed", () => {
    expect(moreOptionsChanged(defaults)).toBe(false);
    expect(moreOptionsSummary(defaults)).toEqual(["You approve each player", "Public", "Free"]);
  });

  it("names settings that decide who can join and what it costs", () => {
    const s = {
      ...defaults,
      paid: true,
      price: 12,
      priv: true,
      requiresApproval: false,
      minAge: 18,
    };
    expect(moreOptionsChanged(s)).toBe(true);
    expect(moreOptionsSummary(s)).toEqual([
      "Anyone can join without approval",
      "Private (invite only)",
      "$12 entry fee",
      "Ages 18+",
    ]);
  });

  it("treats each restored non-default as a change", () => {
    expect(moreOptionsChanged({ ...defaults, requiresApproval: false })).toBe(true);
    expect(moreOptionsChanged({ ...defaults, maxAge: 17 })).toBe(true);
    expect(moreOptionsChanged({ ...defaults, signupCutoffMin: 60 })).toBe(true);
  });
});

describe("publishSummaryLines", () => {
  it("shows the game that will go live, with a default title", () => {
    const lines = publishSummaryLines({
      title: "  ",
      sport: "Basketball",
      multiDay: false,
      when: valid().when,
      schedule: [],
      repeat: { freq: "weekly", until: null },
      location: " Rucker Park ",
      spots: 10,
      requiresApproval: true,
      priv: false,
      paid: false,
      price: 0,
    });
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel.Game).toBe(defaultGameTitle("Basketball"));
    expect(byLabel.Game).not.toMatch(/run/i);
    expect(byLabel.When).toMatch(/repeats every week/);
    expect(byLabel.Where).toBe("Rucker Park");
    expect(byLabel.Joining).toBe("You approve each player");
    expect(byLabel.Cost).toBe("Free");
  });
});

describe("create route keeps its protections (source checks)", () => {
  const src = readFileSync(resolve(__dirname, "../routes/_tabs.create.tsx"), "utf8");

  it("records the host acknowledgment for each created game", () => {
    expect(src).toMatch(/recordSafetyAck\(\{ gameId: game\.id, kind: "host_responsibility" \}\)/);
  });

  it("publishes only from the Publish step with the acknowledgment ticked", () => {
    expect(src).toMatch(
      /const publish = async \(\) => \{\s*if \(publishing \|\| !user\) return;\s*if \(!hostAck\) return;/,
    );
    // The form's own submit only checks the fields and opens the step.
    expect(src).toMatch(
      /onSubmit=\{\(e\) => \{\s*e\.preventDefault\(\);\s*reviewBeforePublish\(\);/,
    );
    expect(src).toContain("noValidate");
  });

  it("keeps approval on by default and never pre-checks the acknowledgment", () => {
    expect(src).toMatch(/const \[requiresApproval, setRequiresApproval\] = useState\(true\)/);
    expect(src).toMatch(/const \[hostAck, setHostAck\] = useState\(false\)/);
  });

  it("has no TBD path and no city or GPS auto-fill of the venue", () => {
    expect(src).not.toMatch(/["'`]TBD["'`]/);
    expect(src).toMatch(/const \[location, setLocation\] = useState\(""\)/);
    expect(src).not.toMatch(/reverseGeocode/);
  });

  it("keeps the hosting gates", () => {
    expect(src).toContain("HOSTING_BLOCKED_MESSAGE");
    expect(src).toContain("Sign in to host");
    expect(src).toContain("Host as a team");
    expect(src).toMatch(/<fieldset\s+disabled=\{!selectedAffiliation\}/);
  });
});
