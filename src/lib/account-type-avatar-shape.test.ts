import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, hasLogoAvatar } from "@/lib/account-type";

describe("hasLogoAvatar", () => {
  it("gives teams and gyms a logo, and people a circle", () => {
    expect(Object.fromEntries(ACCOUNT_TYPES.map((k) => [k, hasLogoAvatar(k)]))).toEqual({
      player: false,
      team: true,
      trainer: false,
      gym: true,
    });
  });
});
