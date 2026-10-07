import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACCOUNT_TYPE_META,
  ACCOUNT_TYPES,
  ROLES,
  accountTypeForSetup,
  type SetupId,
} from "./account-type";
import { RolePicker } from "@/components/RolePicker";

/**
 * Canonical profile-type vocabulary contract.
 *
 * The app uses one label per account type everywhere it is named to a user
 * (see .lovable/plan.md). These tests defend the vocabulary from
 * regressions and check that key screens render the canonical strings
 * — not the retired synonyms ("Club", "Coach", "Facility") or the old
 * slash pairs ("Team / Club", "Trainer / Coach", "Gym / Facility").
 *
 * The role picker at sign-up and in onboarding is a separate vocabulary: it
 * names ROLES (Player, Parent / Guardian, Team / Coach, Facility / Gym), the
 * words people recognise themselves by, and the product asked for those words,
 * including "Coach" and "Facility". It does not rename the profile types they
 * lead to: ACCOUNT_TYPE_META and every screen below keep the canonical names.
 */

const RETIRED_PROFILE_TYPE_WORDS = ["Club", "Clubs", "Coach", "Coaches", "Facility", "Facilities"];
const RETIRED_SLASH_PAIRS = ["Team / Club", "Trainer / Coach", "Gym / Facility"];

function readSource(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** What React writes into markup for this text. */
const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

describe("ACCOUNT_TYPE_META canonical vocabulary", () => {
  it("exposes exactly the four supported account types", () => {
    expect(ACCOUNT_TYPES).toEqual(["player", "team", "trainer", "gym"]);
  });

  it.each([
    ["player", "Player", "Players"],
    ["team", "Team", "Teams"],
    ["trainer", "Trainer", "Trainers"],
    ["gym", "Gym", "Gyms"],
  ] as const)("uses canonical label/plural for %s", (type, label, plural) => {
    const meta = ACCOUNT_TYPE_META[type];
    expect(meta.label).toBe(label);
    expect(meta.plural).toBe(plural);
  });

  it("has no retired synonyms or slash pairs in any label or blurb", () => {
    for (const type of ACCOUNT_TYPES) {
      const { label, plural, blurb } = ACCOUNT_TYPE_META[type];
      for (const slash of RETIRED_SLASH_PAIRS) {
        expect(label).not.toContain(slash);
        expect(blurb).not.toContain(slash);
      }
      // Retired standalone words: check with word boundaries so we don't
      // false-positive on substrings like "Coaches" inside a longer word
      // (there shouldn't be one, but be strict).
      for (const word of RETIRED_PROFILE_TYPE_WORDS) {
        const re = new RegExp(`\\b${word}\\b`);
        expect(label, `${type} label`).not.toMatch(re);
        expect(plural, `${type} plural`).not.toMatch(re);
        expect(blurb, `${type} blurb`).not.toMatch(re);
      }
    }
  });
});

/**
 * One selection at sign-up and in onboarding. The four roles, their wording and
 * where each one goes are the product's table; these pin it.
 */
describe("RolePicker (sign-up and onboarding)", () => {
  const html = renderToStaticMarkup(<RolePicker value={null} onChange={() => {}} />);

  it("offers exactly the four roles, in this order", () => {
    expect(ROLES.map((r) => [r.emoji, r.label])).toEqual([
      ["🏃", "Player"],
      ["👪", "Parent / Guardian"],
      ["👥", "Team / Coach"],
      ["🏢", "Facility / Gym"],
    ]);
  });

  it("says who each role is for", () => {
    expect(Object.fromEntries(ROLES.map((r) => [r.label, r.blurb]))).toEqual({
      Player: "Athletes looking for games and runs",
      "Parent / Guardian": "Parents managing kids' sports schedules",
      "Team / Coach": "Coaches and captains organizing squads",
      "Facility / Gym": "Venue owners and sports facilities",
    });
  });

  it("renders each role's label and blurb", () => {
    for (const r of ROLES) {
      expect(html).toContain(`>${escapeHtml(r.label)}<`);
      expect(html).toContain(escapeHtml(r.blurb));
    }
  });

  it("renders no retired slash pair and no 'Club'", () => {
    for (const pair of RETIRED_SLASH_PAIRS) expect(html).not.toContain(pair);
    expect(html).not.toMatch(/\bClubs?\b/);
  });

  it("stores each setup as the nearest account type, never a fifth one", () => {
    const stored = Object.fromEntries(
      (["player", "child", "team", "coach", "facility"] as SetupId[]).map((s) => [
        s,
        accountTypeForSetup(s),
      ]),
    );
    expect(stored).toEqual({
      player: "player",
      child: "player",
      team: "team",
      coach: "trainer",
      facility: "gym",
    });
    expect(ACCOUNT_TYPES as string[]).not.toContain("parent");
  });

  it("keeps the word 'player' on the Player card alone", () => {
    // e2e/onboarding-null-account-type.spec.ts finds it with
    // getByRole("button", { name: /Player/i }), and Playwright refuses a locator
    // that matches two buttons. Checked with Team / Coach open, as that adds
    // buttons of its own.
    const open = renderToStaticMarkup(<RolePicker value="coach" onChange={() => {}} />);
    for (const markup of [html, open]) {
      const buttons = markup.match(/<button[\s\S]*?<\/button>/g) ?? [];
      expect(buttons.filter((b) => /player/i.test(b))).toHaveLength(1);
    }
  });

  it("leaves Parent / Guardian out for a member who is not an adult", () => {
    const minor = renderToStaticMarkup(
      <RolePicker value={null} onChange={() => {}} allowParent={false} />,
    );
    expect(minor).not.toContain("Parent / Guardian");
    for (const r of ROLES.filter((x) => !x.adultsOnly)) {
      expect(minor).toContain(`>${escapeHtml(r.label)}<`);
    }
  });

  it("asks Team or Coach on the same screen once that role is open, and not before", () => {
    expect(html).not.toContain("Which one are you setting up?");
    const team = renderToStaticMarkup(<RolePicker value="team" onChange={() => {}} />);
    expect(team).toContain("Which one are you setting up?");
    expect(team).toContain(">Team<");
    expect(team).toContain(">Coach<");
    // The role card and the chosen one, nothing else.
    expect((team.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
  });

  it("marks one card pressed for a role with a single setup", () => {
    for (const s of ["player", "child", "facility"] as const) {
      const markup = renderToStaticMarkup(<RolePicker value={s} onChange={() => {}} />);
      expect((markup.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
      expect(markup).not.toContain("Which one are you setting up?");
    }
  });
});

/**
 * Screen-level source assertions.
 *
 * A full render of feed/settings pulls in TanStack Router, Supabase,
 * and realtime subscriptions — heavy for a wording test. Instead we
 * check the compiled JSX source for canonical strings and the absence
 * of retired ones on the surfaces that were normalised in the plan.
 * If someone reintroduces "Club" or "Facility" copy on these screens,
 * this test fails at CI before it ships.
 */
describe("screen sources use canonical profile-type wording", () => {
  const screens = [
    "src/routes/_tabs.feed.tsx",
    "src/routes/_tabs.trainers.tsx",
    "src/routes/_tabs.teams.tsx",
    "src/routes/onboarding.account-type.tsx",
    "src/routes/onboarding.welcome.tsx",
    "src/routes/settings.tsx",
    "src/components/CreateOrgWizard.tsx",
    "src/components/create/CreateTrainerWizard.tsx",
  ];

  it.each(screens)("%s has no retired slash-pair labels", (path) => {
    const src = readSource(path);
    for (const pair of RETIRED_SLASH_PAIRS) {
      expect(src, `${path} still contains "${pair}"`).not.toContain(pair);
    }
  });

  it.each(screens)("%s has no retired 'Facilities' / 'Coaches' / 'Clubs' plurals", (path) => {
    const src = readSource(path);
    for (const word of ["Facilities", "Coaches", "Clubs"]) {
      expect(src, `${path} still contains "${word}"`).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("feed is pickup-only: no team posts or teams/gyms/trainers discovery", () => {
    const src = readSource("src/routes/_tabs.feed.tsx");
    expect(src).not.toContain("From teams");
    expect(src).not.toContain("DiscoverCategoryPills");
    expect(src).not.toContain("DiscoverResults");
  });
});
