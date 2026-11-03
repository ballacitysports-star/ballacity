import { describe, expect, it } from "vitest";
import { buildGameShare, platformShareUrl } from "./social-share";

describe("sharing a game", () => {
  const game = {
    id: "g1",
    title: "Saturday 13-17 hoops",
    sport: "basketball",
    // A shared game object may still carry a venue; the share content must not.
    location: "Lincoln Park Court 3, 12 Main St",
    lat: 33.77412,
    lng: -84.29631,
  } as { id: string; title: string; sport: string };

  it("never puts the venue or coordinates in the caption, title or link", () => {
    const c = buildGameShare(game, "Sat 10:00 AM", "https://ballacity.example");
    const everything =
      JSON.stringify(c) + platformShareUrl("x", c) + platformShareUrl("whatsapp", c);
    expect(everything).not.toContain("Lincoln Park");
    expect(everything).not.toContain("Main St");
    expect(everything).not.toContain("33.774");
    expect(c.url).toBe("https://ballacity.example/games/g1");
  });
});
