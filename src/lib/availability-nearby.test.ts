import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Players search asks the database for one page (players_available_near, migration 20261114120000), and a new post
 * carries a point rounded to about a kilometre so that search can measure distance. Geocoding is best effort.
 */

const server = {
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  rpcResult: { data: [] as unknown[] | null, error: null as unknown },
  inserted: [] as Record<string, unknown>[],
};
const geocode = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    rpc: (fn: string, args: Record<string, unknown>) => {
      server.rpcCalls.push({ fn, args });
      return Promise.resolve(server.rpcResult);
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        server.inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
      },
    }),
  },
}));
vi.mock("@/lib/geocode.functions", () => ({ geocodeAddress: geocode }));

const { coarseCoordinates, createAvailability, listPlayersAvailableNear } =
  await import("./availability");

beforeEach(() => {
  server.rpcCalls = [];
  server.rpcResult = { data: [], error: null };
  server.inserted = [];
  geocode.mockReset();
});

describe("listPlayersAvailableNear", () => {
  it("sends every parameter, with the database's defaults", async () => {
    await listPlayersAvailableNear({
      lat: 34.12,
      lng: -84,
      sport: "Basketball",
      intent: "pickup",
      skill: [],
    });
    expect(server.rpcCalls).toEqual([
      {
        fn: "players_available_near",
        args: {
          _lat: 34.12,
          _lng: -84,
          _radius_mi: 15,
          _sport: "Basketball",
          _from: null,
          _to: null,
          _intent: "pickup",
          _skill: null,
          _include_unlocated: false,
          _order: "nearest",
          _limit: 20,
          _offset: 0,
        },
      },
    ]);
  });

  it("keeps only known intents and never returns undefined levels", async () => {
    server.rpcResult = {
      data: [
        {
          availability_id: "a",
          looking_for: ["pickup", "nope"],
          skill_levels: null,
          distance_mi: 2,
        },
      ],
      error: null,
    };
    const [row] = await listPlayersAvailableNear();
    expect(row.looking_for).toEqual(["pickup"]);
    expect(row.skill_levels).toEqual({});
  });

  it("surfaces a database error", async () => {
    server.rpcResult = { data: null, error: { message: "permission denied" } };
    await expect(listPlayersAvailableNear()).rejects.toEqual({ message: "permission denied" });
  });
});

describe("coarseCoordinates", () => {
  it("rounds given coordinates to two decimals without geocoding", async () => {
    expect(await coarseCoordinates({ lat: 34.123456, lng: -84.009876, city: "Buford" })).toEqual({
      lat: 34.12,
      lng: -84.01,
    });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("geocodes the city and rounds the result", async () => {
    geocode.mockResolvedValue({ lat: 34.120987, lng: -84.004321, formatted: "Buford, GA" });
    expect(await coarseCoordinates({ city: " Buford, GA " })).toEqual({ lat: 34.12, lng: -84 });
    expect(geocode).toHaveBeenCalledWith({ data: { address: "Buford, GA" } });
  });

  it("saves no point when there is no city or geocoding fails", async () => {
    expect(await coarseCoordinates({ city: "" })).toEqual({ lat: null, lng: null });
    geocode.mockRejectedValue(new Error("Maps credentials missing"));
    expect(await coarseCoordinates({ city: "Buford" })).toEqual({ lat: null, lng: null });
  });

  it("a new post carries the rounded point and never the geocoder's street address", async () => {
    geocode.mockResolvedValue({
      lat: 34.1234,
      lng: -84.0056,
      formatted: "123 Main St, Buford, GA",
    });
    await createAvailability({ sports: ["Basketball"], city: "Buford" });
    expect(server.inserted[0]).toMatchObject({ lat: 34.12, lng: -84.01, formatted_address: null });
  });
});
