import { beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
  createTeam: vi.fn(),
  updateTeam: vi.fn(),
  listTeams: vi.fn(async () => []),
  deleteTeam: vi.fn(),
}));

vi.mock("./teams.functions", () => server);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
  },
}));

import { addOrg, updateOrg } from "./org-store";
import { ORGS, type Org } from "./sample-data";

const logo = "https://x.supabase.co/storage/v1/object/public/team-avatars/u/logo.png";

/** What the server returns for a team row. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    owner_id: null,
    kind: "team",
    name: "Ballacity Scout 14U",
    handle: "@bs",
    tagline: "",
    city: "Buford",
    founded: 2024,
    sports: ["Baseball"],
    bio: "",
    achievements: [],
    accent: "#a3ff12",
    avatar: "BS",
    avatar_url: null,
    cover: "",
    league: null,
    home_court: null,
    wins: 0,
    losses: 0,
    staff: [],
    credentials: [],
    skill_min: 1,
    skill_max: 5,
    followers: 0,
    verified: false,
    ...over,
  };
}

function team(over: Partial<Org> = {}): Org {
  return {
    id: "t-1",
    kind: "team",
    name: "Ballacity Scout 14U",
    handle: "@bs",
    tagline: "",
    city: "Buford",
    founded: 2024,
    sports: ["Baseball"],
    verified: false,
    cover: "",
    avatar: "BS",
    accent: "#a3ff12",
    followers: 0,
    roster: 0,
    bio: "",
    achievements: [],
    upcoming: [],
    posts: [],
    ...over,
  } as Org;
}

beforeEach(() => {
  server.createTeam.mockReset();
  server.updateTeam.mockReset();
  ORGS.length = 0;
});

describe("saving a new team's mark", () => {
  it("writes initials to avatar and the logo to avatar_url", async () => {
    server.createTeam.mockResolvedValue(row({ avatar: "BS", avatar_url: logo }));
    await addOrg(team({ avatar: logo, avatarUrl: logo, avatarInitials: "BS" }));
    const sent = server.createTeam.mock.calls[0][0].data;
    expect(sent.avatar).toBe("BS");
    expect(sent.avatar_url).toBe(logo);
  });

  it("sends no avatar_url for a team without a logo", async () => {
    server.createTeam.mockResolvedValue(row());
    await addOrg(team({ avatar: "BS", avatarInitials: "BS" }));
    const sent = server.createTeam.mock.calls[0][0].data;
    expect(sent.avatar).toBe("BS");
    expect("avatar_url" in sent).toBe(false);
  });

  it("still handles callers that put the logo URL in avatar", async () => {
    server.createTeam.mockResolvedValue(row({ avatar: "", avatar_url: logo }));
    await addOrg(team({ avatar: logo }));
    const sent = server.createTeam.mock.calls[0][0].data;
    expect(sent.avatar).toBe("");
    expect(sent.avatar_url).toBe(logo);
  });
});

describe("updating a team's mark", () => {
  beforeEach(() => {
    ORGS.push(team());
    server.updateTeam.mockResolvedValue(row());
  });

  it("changes the logo without touching the initials", async () => {
    await updateOrg("t-1", { avatarUrl: logo });
    expect(server.updateTeam.mock.calls[0][0].data).toEqual({ id: "t-1", avatar_url: logo });
  });

  it("removes the logo by clearing only avatar_url", async () => {
    await updateOrg("t-1", { avatarUrl: "" });
    expect(server.updateTeam.mock.calls[0][0].data).toEqual({ id: "t-1", avatar_url: null });
  });

  it("changes the initials without touching the logo", async () => {
    await updateOrg("t-1", { avatarInitials: "BC" });
    expect(server.updateTeam.mock.calls[0][0].data).toEqual({ id: "t-1", avatar: "BC" });
  });

  it("saves both when an editor sends the full mark", async () => {
    await updateOrg("t-1", { avatar: logo, avatarUrl: logo, avatarInitials: "BS" });
    expect(server.updateTeam.mock.calls[0][0].data).toEqual({
      id: "t-1",
      avatar: "BS",
      avatar_url: logo,
    });
  });

  it("sends nothing about the mark when it isn't part of the patch", async () => {
    await updateOrg("t-1", { tagline: "New tagline" });
    expect(server.updateTeam.mock.calls[0][0].data).toEqual({ id: "t-1", tagline: "New tagline" });
  });
});

describe("reading a team's mark", () => {
  beforeEach(() => {
    ORGS.push(team());
  });

  it("exposes logo and initials separately, and the logo as the display value", async () => {
    server.updateTeam.mockResolvedValue(row({ avatar: "BS", avatar_url: logo }));
    await updateOrg("t-1", { tagline: "x" });
    const org = ORGS.find((o) => o.id === "t-1")!;
    expect(org.avatarUrl).toBe(logo);
    expect(org.avatarInitials).toBe("BS");
    expect(org.avatar).toBe(logo);
  });

  it("reads an older row that kept the logo in avatar", async () => {
    server.updateTeam.mockResolvedValue(row({ avatar: logo, avatar_url: null }));
    await updateOrg("t-1", { tagline: "x" });
    const org = ORGS.find((o) => o.id === "t-1")!;
    expect(org.avatarUrl).toBe(logo);
    expect(org.avatarInitials).toBe("");
    expect(org.avatar).toBe(logo);
  });

  it("shows initials for a team with no logo", async () => {
    server.updateTeam.mockResolvedValue(row({ avatar: "BS", avatar_url: null }));
    await updateOrg("t-1", { tagline: "x" });
    const org = ORGS.find((o) => o.id === "t-1")!;
    expect(org.avatarUrl).toBeUndefined();
    expect(org.avatar).toBe("BS");
  });
});
