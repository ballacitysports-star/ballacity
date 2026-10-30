// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { SPORTS } from "./sample-data";
import {
  SPORT_HUBS,
  clearSportContext,
  hubBySlug,
  makePrimarySport,
  orderSportsForViewer,
  parseSportContext,
  readSportContext,
  rememberSportContext,
} from "./sport-hubs";

describe("sport hubs", () => {
  it("has exactly one hub per canonical sport", () => {
    expect(SPORT_HUBS.map((h) => h.sport).sort()).toEqual(SPORTS.map((s) => s.name).sort());
  });

  it("uses the agreed headlines for the five launch sports", () => {
    expect(hubBySlug("basketball")?.headline).toBe("Find Your Next Run.");
    expect(hubBySlug("baseball")?.headline).toBe("Find Your Team. Build Your Game.");
    expect(hubBySlug("soccer")?.headline).toBe("Your Next Match Starts Here.");
    expect(hubBySlug("pickleball")?.headline).toBe("Find Your Court Crew.");
    expect(hubBySlug("volleyball")?.headline).toBe("Find Your Squad.");
  });

  it("does not treat existing site paths as sports", () => {
    for (const slug of ["feed", "auth", "admin", "sitemap.xml", "", "constructor"]) {
      expect(hubBySlug(slug)).toBeUndefined();
    }
  });
});

describe("sport context", () => {
  beforeEach(() => clearSportContext());

  it("accepts only canonical sports", () => {
    expect(parseSportContext("basketball")).toBe("Basketball");
    expect(parseSportContext("Pickleball")).toBe("Pickleball");
    expect(parseSportContext("<script>")).toBeNull();
    expect(parseSportContext("curling")).toBeNull();
    expect(parseSportContext(42)).toBeNull();
    expect(parseSportContext("x".repeat(100))).toBeNull();
  });

  it("round-trips through session storage and clears", () => {
    rememberSportContext("Soccer");
    expect(readSportContext()).toBe("Soccer");
    clearSportContext();
    expect(readSportContext()).toBeNull();
  });

  it("ignores a tampered stored value", () => {
    window.sessionStorage.setItem("openrun:sport-context", "admin");
    expect(readSportContext()).toBeNull();
  });
});

describe("makePrimarySport", () => {
  const list = [{ name: "Soccer" }, { name: "Tennis" }, { name: "Baseball" }];

  it("moves the chosen sport first and keeps the rest in order", () => {
    expect(makePrimarySport(list, "Baseball").map((s) => s.name)).toEqual([
      "Baseball",
      "Soccer",
      "Tennis",
    ]);
  });

  it("is a no-op for the current primary or an unknown sport", () => {
    expect(makePrimarySport(list, "Soccer")).toBe(list);
    expect(makePrimarySport(list, "Curling")).toBe(list);
  });
});

describe("orderSportsForViewer", () => {
  const all = [
    { name: "Baseball" },
    { name: "Basketball" },
    { name: "Soccer" },
    { name: "Tennis" },
  ];

  it("puts the viewer's sports first in their order and keeps every sport", () => {
    const out = orderSportsForViewer(all, ["Tennis", "Baseball"]).map((s) => s.name);
    expect(out).toEqual(["Tennis", "Baseball", "Basketball", "Soccer"]);
  });

  it("ignores unknown or repeated names and is unchanged with none", () => {
    expect(orderSportsForViewer(all, ["Curling", "Soccer", "Soccer"]).map((s) => s.name)).toEqual([
      "Soccer",
      "Baseball",
      "Basketball",
      "Tennis",
    ]);
    expect(orderSportsForViewer(all, [])).toEqual(all);
  });
});
