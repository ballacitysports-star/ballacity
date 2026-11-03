import { describe, expect, it } from "vitest";
import { shapeGameForApi } from "./game-output";

const row = {
  id: "g",
  title: "Run",
  location: "Lincoln Park Court 3, 12 Main St",
  neighborhood: "Decatur",
  lat: 33.77412,
  lng: -84.29631,
  host_id: "teen-host",
  min_age: 13,
  max_age: 17,
};

describe("API output for games", () => {
  it("gives a youth-inclusive game the coarse location and no host id", () => {
    const out = shapeGameForApi(row, "someone-else") as Record<string, unknown>;
    expect(out.location).toBe("Decatur");
    expect(out.lat).toBe(33.77);
    expect(out.host_id).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain("Lincoln Park");
    expect("min_age" in out).toBe(false);
  });

  it("treats a game with no age limit the same way", () => {
    const out = shapeGameForApi({ ...row, min_age: null, max_age: null }, null) as Record<
      string,
      unknown
    >;
    expect(out.location).toBe("Decatur");
    expect(out.host_id).toBeUndefined();
  });

  it("keeps the host id for the host themself", () => {
    expect((shapeGameForApi(row, "teen-host") as Record<string, unknown>).host_id).toBe(
      "teen-host",
    );
  });

  it("leaves an adult-only game exactly as it was", () => {
    const out = shapeGameForApi({ ...row, min_age: 21, max_age: null }, "x") as Record<
      string,
      unknown
    >;
    expect(out.location).toBe(row.location);
    expect(out.host_id).toBe("teen-host");
  });
});
