import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Person follows (`request_follow`, `follows.followee_id`) point at accounts. Team, trainer
 * and facility pages are not accounts, so they follow through the entity follow API
 * (`follow_entity`, lib/entity-follows.ts, FollowEntityButton). Two earlier mistakes must
 * not come back: a local toggle that showed "Following" when nothing was saved, and
 * calling the person-follow API with a team id.
 */
const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

const ENTITY_PAGES: Array<[string, "team" | "org"]> = [
  ["routes/teams.$teamId.index.tsx", "team"],
  ["routes/trainers.$trainerId.index.tsx", "team"],
  ["routes/orgs.$orgId.index.tsx", "org"],
];

describe("team, trainer and facility pages follow through the entity follow API", () => {
  for (const [file, kind] of ENTITY_PAGES) {
    it(`${file} keeps no local follow toggle`, () => {
      const src = read(file);
      expect(src).not.toMatch(/setFollowing\s*\(/);
      expect(src).not.toMatch(/Following ✓/);
    });

    it(`${file} does not call the person-follow API`, () => {
      const src = read(file);
      expect(src).not.toMatch(/\buseFollow\s*\(/);
      expect(src).not.toMatch(/\bfollowUser\s*\(/);
      expect(src).not.toMatch(/<FollowButton\b/);
    });

    it(`${file} renders the entity Follow button for kind "${kind}"`, () => {
      expect(read(file)).toMatch(new RegExp(`<FollowEntityButton kind="${kind}"`));
    });
  }

  it("the directory cards do not call the person-follow API with a team id", () => {
    const src = read("components/TrainerActions.tsx");
    expect(src).not.toMatch(/\buseFollow\s*\(/);
    expect(src).not.toMatch(/\bfollowUser\s*\(/);
  });

  it("the team page does not show the never-written teams.followers column", () => {
    expect(read("routes/teams.$teamId.index.tsx")).not.toMatch(/org\.followers/);
  });
});
