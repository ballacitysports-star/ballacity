import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACCOUNT_TYPE_META,
  ACCOUNT_TYPES,
  MANAGER_META,
  accountTypeForStartingPoint,
} from "./account-type";
import { AccountTypePicker } from "@/components/AccountTypePicker";

/**
 * Canonical profile-type vocabulary contract.
 *
 * The app uses one label per account type everywhere it is named to a
 * user (see .lovable/plan.md). These tests defend the vocabulary from
 * regressions and check that key screens render the canonical strings
 * — not the retired synonyms ("Club", "Coach", "Facility") or the old
 * slash pairs ("Team / Club", "Trainer / Coach", "Gym / Facility").
 */

const RETIRED_PROFILE_TYPE_WORDS = ["Club", "Clubs", "Coach", "Coaches", "Facility", "Facilities"];
const RETIRED_SLASH_PAIRS = ["Team / Club", "Trainer / Coach", "Gym / Facility"];

function readSource(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

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

describe("AccountTypePicker (onboarding)", () => {
  const html = renderToStaticMarkup(<AccountTypePicker value={null} onChange={() => {}} />);

  it("renders each canonical label and its blurb", () => {
    for (const t of ACCOUNT_TYPES) {
      const meta = ACCOUNT_TYPE_META[t];
      expect(html).toContain(`>${meta.label}<`);
      expect(html).toContain(meta.blurb);
    }
  });

  it("renders no retired slash-pair labels", () => {
    for (const pair of RETIRED_SLASH_PAIRS) {
      expect(html).not.toContain(pair);
    }
  });

  it("renders no retired standalone profile-type words", () => {
    for (const word of RETIRED_PROFILE_TYPE_WORDS) {
      expect(html).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });
});

/**
 * Parent / Guardian / Owner is a starting point, not a fifth account type: the
 * database only holds the four above, and this contract pins them. The tile is
 * named in the same vocabulary as the rest of the picker.
 */
describe("Parent / Guardian / Owner starting point", () => {
  it("is not an account type", () => {
    expect(ACCOUNT_TYPES).toEqual(["player", "team", "trainer", "gym"]);
    expect(ACCOUNT_TYPES as string[]).not.toContain("manager");
  });

  it("uses the label the product asked for", () => {
    expect(MANAGER_META.label).toBe("Parent / Guardian / Owner");
  });

  it("keeps the retired vocabulary out of its copy", () => {
    for (const word of RETIRED_PROFILE_TYPE_WORDS) {
      const re = new RegExp(`\\b${word}\\b`);
      expect(MANAGER_META.label).not.toMatch(re);
      expect(MANAGER_META.blurb).not.toMatch(re);
    }
    for (const pair of RETIRED_SLASH_PAIRS) {
      expect(MANAGER_META.label).not.toContain(pair);
      expect(MANAGER_META.blurb).not.toContain(pair);
    }
  });

  it("never says 'player', so the Player tile stays the only match for /Player/i", () => {
    // e2e/onboarding-null-account-type.spec.ts finds the Player tile with
    // getByRole("button", { name: /Player/i }), and Playwright refuses a
    // locator that matches two buttons.
    expect(`${MANAGER_META.label} ${MANAGER_META.blurb}`).not.toMatch(/player/i);
  });

  it("is stored as a player, and every real type is stored as itself", () => {
    expect(accountTypeForStartingPoint("manager")).toBe("player");
    for (const t of ACCOUNT_TYPES) expect(accountTypeForStartingPoint(t)).toBe(t);
  });

  it("is offered in the picker by default and can be left out", () => {
    const offered = renderToStaticMarkup(<AccountTypePicker value={null} onChange={() => {}} />);
    expect(offered).toContain(`>${MANAGER_META.label}<`);
    expect(offered).toContain(MANAGER_META.blurb);

    const left = renderToStaticMarkup(
      <AccountTypePicker value={null} onChange={() => {}} allowManager={false} />,
    );
    expect(left).not.toContain(MANAGER_META.label);
    // The four real types are unaffected either way.
    for (const t of ACCOUNT_TYPES) expect(left).toContain(`>${ACCOUNT_TYPE_META[t].label}<`);
  });

  it("marks only the chosen tile as pressed", () => {
    const html = renderToStaticMarkup(<AccountTypePicker value="manager" onChange={() => {}} />);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    const plain = renderToStaticMarkup(<AccountTypePicker value="team" onChange={() => {}} />);
    expect((plain.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
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

  it("feed renders the canonical 'From teams' heading, not 'From teams & clubs'", () => {
    const src = readSource("src/routes/_tabs.feed.tsx");
    expect(src).toContain("From teams");
    expect(src).not.toContain("From teams & clubs");
  });
});
