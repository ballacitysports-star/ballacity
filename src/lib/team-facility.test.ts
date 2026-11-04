import { describe, expect, it } from "vitest";
import { clearedFacilityFields, facilityMap, withExactFacility } from "./team-facility";

const exact = facilityMap([
  {
    team_id: "t1",
    home_court: "Lincoln Gym",
    venues: ["Lincoln Gym"],
    venue_addresses: ["12 Oak St"],
    primary_venue: null,
    venue_geo: [{ lat: 1, lng: 2 }],
  },
]);

describe("withExactFacility", () => {
  it("fills the empty public columns of a youth team from what the database released", () => {
    const row = withExactFacility(
      { id: "t1", kind: "team", home_court: null, venues: [], venue_addresses: [], venue_geo: [] },
      exact,
    );
    expect(row).toMatchObject({
      home_court: "Lincoln Gym",
      venues: ["Lincoln Gym"],
      venue_addresses: ["12 Oak St"],
    });
    expect(row.venue_geo).toEqual([{ lat: 1, lng: 2 }]);
  });
  it("never overrides a public value (a verified public facility) and never touches a business listing", () => {
    const pub = { id: "t1", kind: "team", home_court: "Park Courts", venues: ["Park Courts"] };
    expect(withExactFacility(pub, exact).home_court).toBe("Park Courts");
    const biz = { id: "t1", kind: "coach", home_court: null, venues: [] as string[] };
    expect(withExactFacility(biz, exact)).toBe(biz);
  });
  it("leaves a team alone when nothing was released for it", () => {
    const row = { id: "t2", kind: "team", home_court: null, venues: [] as string[] };
    expect(withExactFacility(row, exact)).toBe(row);
  });
});

describe("clearedFacilityFields", () => {
  it("names the details an edit removes, and nothing when they are only changed", () => {
    expect(
      clearedFacilityFields({ homeCourt: "", venues: [], venueAddresses: [], venueGeo: [] }),
    ).toEqual(["home_court", "venues", "venue_addresses", "venue_geo"]);
    expect(clearedFacilityFields({ homeCourt: "New Gym", venues: ["A"] })).toEqual([]);
    expect(clearedFacilityFields({})).toEqual([]);
  });
});
