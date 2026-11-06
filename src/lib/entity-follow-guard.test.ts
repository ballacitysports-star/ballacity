import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Follows point at people only: `request_follow(_target uuid)` and `follows.followee_id`
 * reference accounts. Team and trainer profiles are `teams` rows with text ids such as
 * `c-name-ab12`, so there is nothing to follow them with yet (backlog P1-1, entity follows).
 *
 * Until that exists, a Follow control on a team or trainer must not come back: a local
 * toggle tells the viewer they follow when nothing was saved, and calling the person-follow
 * API with a team id fails. Delete this guard in the change that adds entity follows.
 */
const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

const ENTITY_SURFACES = [
  "routes/teams.$teamId.index.tsx",
  "routes/trainers.$trainerId.index.tsx",
  "components/TrainerActions.tsx",
];

describe("team and trainer profiles have no Follow control until entity follows exist", () => {
  for (const file of ENTITY_SURFACES) {
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
  }

  it("the team page does not show a follower count nothing can change", () => {
    expect(read("routes/teams.$teamId.index.tsx")).not.toMatch(/label="Followers"/);
  });
});
