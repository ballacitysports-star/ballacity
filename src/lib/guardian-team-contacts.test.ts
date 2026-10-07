import { describe, expect, it } from "vitest";
import { selectGuardianTeamContacts } from "./guardian-team-contacts.functions";

const profile = (name: string) => ({
  display_name: name,
  username: null,
  avatar_url: null,
  avatar_initials: name.slice(0, 2),
});

describe("selectGuardianTeamContacts", () => {
  it("keeps owners, managers and coaches in role order", () => {
    const result = selectGuardianTeamContacts(
      [
        { user_id: "coach", role: "coach", profiles: profile("Coach") },
        { user_id: "player", role: "player", profiles: profile("Player") },
        { user_id: "owner", role: "owner", profiles: profile("Owner") },
        { user_id: "manager", role: "manager", profiles: profile("Manager") },
      ],
      "parent",
    );
    expect(result.map((contact) => contact.role)).toEqual(["owner", "manager", "coach"]);
  });

  it("excludes the signed-in parent from recipients", () => {
    const result = selectGuardianTeamContacts(
      [
        { user_id: "parent", role: "owner", profiles: profile("Parent") },
        { user_id: "coach", role: "coach", profiles: profile("Coach") },
      ],
      "parent",
    );
    expect(result.map((contact) => contact.userId)).toEqual(["coach"]);
  });

  it("falls back safely when profile details are unavailable", () => {
    const [contact] = selectGuardianTeamContacts(
      [{ user_id: "leader", role: "manager", profiles: null }],
      "parent",
    );
    expect(contact?.displayName).toBe("Team leader");
  });
});