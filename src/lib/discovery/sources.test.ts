import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERPASS_ENDPOINTS, fetchOverpass } from "./sources.server";

const ENDPOINTS = [
  "https://one.example/api",
  "https://two.example/api",
  "https://three.example/api",
];
const good = () =>
  new Response(
    JSON.stringify({ elements: [{ type: "node", id: 1, tags: { website: "https://a.com" } }] }),
    {
      status: 200,
    },
  );

afterEach(() => {
  delete process.env["OVERPASS_URL"];
});

describe("fetchOverpass", () => {
  it("moves to the next server when one is down or timing out, as the first live run's 521 and 522 were", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 522 }))
      .mockResolvedValueOnce(new Response("", { status: 521 }))
      .mockResolvedValueOnce(good());
    const json = (await fetchOverpass("QUERY", { endpoints: ENDPOINTS, fetchFn })) as {
      elements: unknown[];
    };
    expect(json.elements).toHaveLength(1);
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual(ENDPOINTS);
  });

  it("sends the query as a form, identifies the crawler, and gives each try a time limit", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(good());
    await fetchOverpass("[out:json];node(1);out;", { endpoints: ENDPOINTS, fetchFn });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(ENDPOINTS[0]);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(`data=${encodeURIComponent("[out:json];node(1);out;")}`);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toMatch(/BallaCityBot/);
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("skips a server that is unreachable, too slow, or answers with something unreadable", async () => {
    const slow = new DOMException("The operation timed out.", "TimeoutError");
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(slow)
      .mockResolvedValueOnce(new Response("<html>maintenance</html>", { status: 200 }))
      .mockResolvedValueOnce(good());
    await expect(fetchOverpass("Q", { endpoints: ENDPOINTS, fetchFn })).resolves.toBeTruthy();
    const net = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(good());
    await expect(fetchOverpass("Q", { endpoints: ENDPOINTS, fetchFn: net })).resolves.toBeTruthy();
  });

  it("treats busy (429) like down, but stops at once on a rejected query", async () => {
    const busy = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(good());
    await expect(fetchOverpass("Q", { endpoints: ENDPOINTS, fetchFn: busy })).resolves.toBeTruthy();

    // A malformed query is wrong on every server; do not hammer the others.
    const bad = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("syntax error", { status: 400 }));
    await expect(fetchOverpass("Q", { endpoints: ENDPOINTS, fetchFn: bad })).rejects.toThrow(
      "OpenStreetMap lookup failed (HTTP 400).",
    );
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("names every server and why it failed when none answers", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 522 }))
      .mockRejectedValueOnce(new DOMException("t", "TimeoutError"))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    await expect(fetchOverpass("Q", { endpoints: ENDPOINTS, fetchFn })).rejects.toThrow(
      "The OpenStreetMap servers are busy or down (one.example: HTTP 522; two.example: too slow; three.example: HTTP 503).",
    );
  });

  it("tries a configured server first, then the built-in list without repeating it", async () => {
    process.env["OVERPASS_URL"] = OVERPASS_ENDPOINTS[1];
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 500 }));
    await expect(fetchOverpass("Q", { fetchFn })).rejects.toThrow(/busy or down/);
    expect(fetchFn.mock.calls.map(([u]) => u)).toEqual([
      OVERPASS_ENDPOINTS[1],
      OVERPASS_ENDPOINTS[0],
      OVERPASS_ENDPOINTS[2],
    ]);
  });
});
