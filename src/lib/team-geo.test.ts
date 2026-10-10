import { describe, expect, it, vi } from "vitest";
import { geocodeTeamHome } from "./team-geo";

describe("geocodeTeamHome", () => {
  it("geocodes court and city together and returns venueGeo", async () => {
    const geocode = vi.fn().mockResolvedValue({ lat: 40.7, lng: -73.9, formatted: "x" });
    const geo = await geocodeTeamHome(geocode, "Rucker Park", "Harlem, NY");
    expect(geocode).toHaveBeenCalledWith({ data: { address: "Rucker Park, Harlem, NY" } });
    expect(geo).toEqual([{ address: "Rucker Park", placeId: "", lat: 40.7, lng: -73.9 }]);
  });

  it("falls back to the city when there is no court", async () => {
    const geocode = vi.fn().mockResolvedValue({ lat: 1, lng: 2, formatted: "x" });
    await geocodeTeamHome(geocode, "  ", "Austin, TX");
    expect(geocode).toHaveBeenCalledWith({ data: { address: "Austin, TX" } });
  });

  it("returns undefined instead of throwing when geocoding fails or input is empty", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("No location found"));
    expect(await geocodeTeamHome(failing, "Court", "Nowhere")).toBeUndefined();
    const never = vi.fn();
    expect(await geocodeTeamHome(never, "", "")).toBeUndefined();
    expect(never).not.toHaveBeenCalled();
  });
});
