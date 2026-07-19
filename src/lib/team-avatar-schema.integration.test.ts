import { describe, it, expect } from "vitest";
import { TeamInput, TeamPatch } from "./teams.functions";

const LONG_URL =
  "https://cpqihhcqeivbgxqbzatv.supabase.co/storage/v1/object/public/trainer-avatars/" +
  "user-abc-123/" +
  "avatar-" +
  "x".repeat(200) +
  ".png";

const SIGNED_URL =
  "https://cpqihhcqeivbgxqbzatv.supabase.co/storage/v1/object/sign/team-avatars/" +
  "user-xyz/avatar.png?token=" +
  "y".repeat(400);

const DATA_URL = "data:image/png;base64," + "A".repeat(1500);

const baseCreate = {
  id: "team-1",
  kind: "team" as const,
  name: "Test Team",
  handle: "test-team",
};

describe("team schema accepts full avatar URLs", () => {
  it("TeamInput accepts a long public storage URL", () => {
    const result = TeamInput.safeParse({ ...baseCreate, avatar: LONG_URL });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avatar).toBe(LONG_URL);
  });

  it("TeamInput accepts a signed URL with a long token", () => {
    const result = TeamInput.safeParse({ ...baseCreate, avatar: SIGNED_URL });
    expect(result.success).toBe(true);
  });

  it("TeamInput accepts a data: URL preview", () => {
    const result = TeamInput.safeParse({ ...baseCreate, avatar: DATA_URL });
    expect(result.success).toBe(true);
  });

  it("TeamInput still accepts short initials fallback", () => {
    const result = TeamInput.safeParse({ ...baseCreate, avatar: "TT" });
    expect(result.success).toBe(true);
  });

  it("TeamPatch accepts full avatar URL on edit", () => {
    const result = TeamPatch.safeParse({ id: "team-1", avatar: LONG_URL });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avatar).toBe(LONG_URL);
  });

  it("TeamPatch accepts cover URL of typical storage length", () => {
    const result = TeamPatch.safeParse({ id: "team-1", cover: LONG_URL });
    expect(result.success).toBe(true);
  });

  it("TeamPatch rejects avatar over 2048 chars", () => {
    const tooLong = "https://x/" + "a".repeat(2100);
    const result = TeamPatch.safeParse({ id: "team-1", avatar: tooLong });
    expect(result.success).toBe(false);
  });
});
