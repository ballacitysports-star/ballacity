import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeLocationInPublicText, textDisclosesLocation } from "./youth-location-text";
import { invitationLocation } from "./youth-game-location";

const SQL_TEST = readFileSync(
  new URL("../../supabase/tests/360_youth_location_text_and_invites.test.sql", import.meta.url),
  "utf8",
);
const unq = (s: string) => s.replace(/''/g, "'");

describe("textDisclosesLocation", () => {
  it("refuses the clear disclosures", () => {
    expect(textDisclosesLocation("12 Oak St")).toBe("street_address");
    expect(textDisclosesLocation("Meet at 1200 N Lake Shore Dr, east gate")).toBe("street_address");
    expect(textDisclosesLocation("5th Ave")).toBe("street_address");
    expect(textDisclosesLocation("https://maps.google.com/?q=33.7,-84.3")).toBe("map_link");
    expect(textDisclosesLocation("33.77712, -84.38812")).toBe("coordinates");
    expect(textDisclosesLocation("Apt 4B")).toBe("unit");
    expect(
      textDisclosesLocation("Meet at Lincoln Elementary", "Lincoln Elementary Gym, 12 Oak St"),
    ).toBe("venue_name");
  });

  it("accepts ordinary descriptions of an area", () => {
    for (const ok of [
      "Brooklyn",
      "Park Slope, Brooklyn",
      "Downtown Atlanta",
      "North side",
      "U12 pickup Saturday 10am",
      "Bring water. 5v5 half court. Games to 11.",
      "3 on 3 half court",
      "Meet 7 pm court 2",
      "10 players max",
      "Come 15 minutes early",
      "1st place gets bragging rights",
    ]) {
      expect(
        textDisclosesLocation(ok, "Lincoln Elementary Gym, 12 Oak St, Brooklyn, NY"),
        ok,
      ).toBeNull();
    }
    expect(textDisclosesLocation("Brooklyn", "Brooklyn")).toBeNull();
    expect(textDisclosesLocation("Gym", "Gym, 5 Elm St")).toBeNull();
  });

  it("gives the same answer as the database detector for every case in the SQL test", () => {
    const cases = [
      ...SQL_TEST.matchAll(
        /text_discloses_location\('((?:[^']|'')*)', (NULL|'(?:(?:[^']|'')*)')\), '([a-z_]+)'/g,
      ),
    ];
    expect(cases.length).toBeGreaterThan(8);
    for (const m of cases) {
      const exact = m[2] === "NULL" ? null : unq(m[2].slice(1, -1));
      expect(textDisclosesLocation(unq(m[1]), exact), m[1]).toBe(m[3]);
    }
    const accepted = SQL_TEST.match(/unnest\(ARRAY\[([\s\S]*?)\]\) AS x/);
    expect(accepted).not.toBeNull();
    const items = [...accepted![1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => unq(m[1]));
    expect(items.length).toBeGreaterThan(8);
    for (const it of items) {
      expect(
        textDisclosesLocation(it, "Lincoln Elementary Gym, 12 Oak St, Brooklyn, NY"),
        it,
      ).toBeNull();
    }
  });
});

describe("describeLocationInPublicText", () => {
  it("names the field and explains what to do", () => {
    const msg = describeLocationInPublicText(
      { title: "U12 pickup", description: "Meet at 12 Oak St" },
      "Gym, 12 Oak St",
    );
    expect(msg).toMatch(/Your description includes a street address/);
    expect(msg).toMatch(/Describe the area instead/);
  });
  it("returns null for acceptable text", () => {
    expect(
      describeLocationInPublicText(
        { title: "U12 pickup", description: "Midtown, bring water" },
        "Gym, 12 Oak St",
      ),
    ).toBeNull();
  });
  it("catches the venue name taken from the exact location", () => {
    expect(
      describeLocationInPublicText(
        { title: "Pickup at Lincoln Elementary" },
        "Lincoln Elementary Gym, 12 Oak St",
      ),
    ).toMatch(/venue name/);
  });
});

describe("invitationLocation", () => {
  it("never shares the exact venue of a game that may include children", () => {
    expect(
      invitationLocation({
        location: "Lincoln Elementary Gym, 12 Oak St",
        neighborhood: "Midtown",
        minAge: 8,
        maxAge: 12,
      }),
    ).toBe("Midtown");
    expect(
      invitationLocation({
        location: "Park Court, 5 Elm St",
        neighborhood: "",
        minAge: null,
        maxAge: null,
      }),
    ).toBe("Location shared after you join");
  });
  it("leaves an adult-only game's (public) location alone", () => {
    expect(
      invitationLocation({
        location: "Rec Center, 1 Main St",
        neighborhood: "Westside",
        minAge: 21,
        maxAge: 40,
      }),
    ).toBe("Rec Center, 1 Main St");
  });
});
