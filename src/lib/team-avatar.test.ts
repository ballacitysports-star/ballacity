import { describe, expect, it } from "vitest";
import {
  isImageUrl,
  splitTeamAvatar,
  teamAvatarDisplay,
  teamInitials,
  teamLogoUrl,
} from "./team-avatar";

const logo = "https://x.supabase.co/storage/v1/object/public/team-avatars/u/1.png";

describe("reading a team's mark", () => {
  it("uses the separate logo column when it is set", () => {
    const row = { avatar: "BS", avatar_url: logo };
    expect(teamLogoUrl(row)).toBe(logo);
    expect(teamInitials(row)).toBe("BS");
    expect(teamAvatarDisplay(row)).toBe(logo);
  });

  it("falls back to initials with no logo", () => {
    expect(teamLogoUrl({ avatar: "BS", avatar_url: null })).toBeNull();
    expect(teamAvatarDisplay({ avatar: "BS" })).toBe("BS");
    expect(teamAvatarDisplay({})).toBe("");
  });

  it("understands older rows that keep the logo URL in avatar", () => {
    const row = { avatar: logo, avatar_url: null };
    expect(teamLogoUrl(row)).toBe(logo);
    expect(teamInitials(row)).toBe("");
    expect(teamAvatarDisplay(row)).toBe(logo);
  });

  it("recognises image URLs", () => {
    expect(isImageUrl(logo)).toBe(true);
    expect(isImageUrl("data:image/png;base64,AA")).toBe(true);
    expect(isImageUrl("BS")).toBe(false);
    expect(isImageUrl(null)).toBe(false);
  });
});

describe("splitTeamAvatar", () => {
  it("saves initials and logo to their own columns", () => {
    expect(splitTeamAvatar({ avatar: "BS", avatarUrl: logo })).toEqual({
      avatar: "BS",
      avatar_url: logo,
    });
  });

  it("moves a URL passed the old way into the logo column", () => {
    expect(splitTeamAvatar({ avatar: logo })).toEqual({ avatar: "", avatar_url: logo });
  });

  it("clears only the logo when it is removed", () => {
    expect(splitTeamAvatar({ avatarUrl: "" })).toEqual({ avatar_url: null });
    expect(splitTeamAvatar({ avatarUrl: null })).toEqual({ avatar_url: null });
  });

  it("changes only initials when only initials are given", () => {
    expect(splitTeamAvatar({ avatar: "BC" })).toEqual({ avatar: "BC" });
  });

  it("leaves both alone when neither is given", () => {
    expect(splitTeamAvatar({})).toEqual({});
  });

  it("prefers an explicit logo over a URL in avatar", () => {
    expect(splitTeamAvatar({ avatar: "https://old/x.png", avatarUrl: logo })).toEqual({
      avatar: "",
      avatar_url: logo,
    });
  });
});
