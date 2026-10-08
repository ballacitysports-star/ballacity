import { describe, expect, it } from "vitest";
import { describeFamilyActivity } from "@/lib/family-activity";

describe("describeFamilyActivity", () => {
  it("words the members sharing choice in plain language", () => {
    const d = describeFamilyActivity({
      action: "controls.changed",
      context: { media_visibility: "members" },
    });
    expect(d.detail).toContain("Video visibility");
    expect(d.detail).toContain("signed-in members");
  });

  it("labels control creation", () => {
    expect(describeFamilyActivity({ action: "controls.created" })).toEqual({
      title: "Safety settings created",
      detail: "Default protections applied.",
    });
  });

  it("lists each changed control with a friendly value", () => {
    const d = describeFamilyActivity({
      action: "controls.changed",
      context: { messaging: "guardian_only", notifications: false },
    });
    expect(d.title).toBe("Safety settings changed");
    expect(d.detail).toBe("Messaging → guardians only, Notifications → off");
  });

  it("handles an empty change set", () => {
    expect(describeFamilyActivity({ action: "controls.changed", context: {} }).detail).toBeNull();
  });

  it("describes consent transitions", () => {
    expect(
      describeFamilyActivity({ action: "consent.approved", context: { method: "email" } }),
    ).toEqual({ title: "Parental consent approved", detail: "By email confirmation" });
    expect(describeFamilyActivity({ action: "consent.revoked" }).title).toBe(
      "Parental consent withdrawn",
    );
    expect(
      describeFamilyActivity({ action: "consent.pending", context: { method: "credit_card" } })
        .detail,
    ).toBe("By credit card");
  });

  it("describes family link transitions", () => {
    expect(
      describeFamilyActivity({ action: "link.active", context: { relationship: "parent" } }),
    ).toEqual({ title: "Family link connected", detail: "Relationship: parent" });
    expect(describeFamilyActivity({ action: "link.revoked" }).title).toBe("Family link ended");
  });

  it("falls back readably for unknown keys", () => {
    expect(describeFamilyActivity({ action: "consent.reverify_due" }).title).toBe(
      "Consent reverify due",
    );
    expect(describeFamilyActivity({ action: "link.paused" }).title).toBe("Family link paused");
    expect(describeFamilyActivity({ action: "something.else_new" }).title).toBe(
      "something else new",
    );
  });

  it("tolerates a null context", () => {
    expect(describeFamilyActivity({ action: "controls.changed", context: null }).detail).toBeNull();
  });
});

describe("family clip visibility in the activity trail", () => {
  it("words team sharing and the child's view", () => {
    expect(describeFamilyActivity({ action: "family_post.team_shared" }).title).toBe(
      "Family clip shared with a team",
    );
    expect(describeFamilyActivity({ action: "family_post.team_unshared" }).title).toBe(
      "Family clip made private again",
    );
    expect(
      describeFamilyActivity({ action: "family_post.child_view_changed", context: { enabled: false } })
        .detail,
    ).toContain("no longer");
    expect(
      describeFamilyActivity({ action: "family_post.child_view_changed", context: { enabled: true } })
        .detail,
    ).toContain("can watch");
  });
});

describe("family post share links in the activity trail", () => {
  it("describes creating and turning off a private link", () => {
    expect(
      describeFamilyActivity({ action: "family_post.link_created", context: { days: 14 } }),
    ).toEqual({ title: "Private share link created", detail: "Valid for 14 days" });
    expect(describeFamilyActivity({ action: "family_post.link_revoked" }).title).toBe(
      "Private share link turned off",
    );
  });
});

describe("family clip sharing toggles in the activity trail", () => {
  it("words each switch", () => {
    expect(
      describeFamilyActivity({
        action: "family_post.sharing_changed",
        context: { kind: "team", enabled: true },
      }).detail,
    ).toBe("Team sharing turned on");
    expect(
      describeFamilyActivity({
        action: "family_post.sharing_changed",
        context: { kind: "link", enabled: false },
      }).detail,
    ).toBe("Private links turned off");
  });
});

describe("public XP toggle in the activity trail", () => {
  it("words both states", () => {
    expect(
      describeFamilyActivity({ action: "child.public_xp_changed", context: { enabled: true } }).detail,
    ).toContain("shown on the Player Card");
    expect(
      describeFamilyActivity({ action: "child.public_xp_changed", context: { enabled: false } }).detail,
    ).toContain("no longer");
  });
});
