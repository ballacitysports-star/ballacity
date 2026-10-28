import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIRECRAWL_GATEWAY_URL,
  OVERPASS_ENDPOINTS,
  fetchOverpass,
  firecrawlConfigured,
  firecrawlRequest,
  searchWeb,
} from "./sources.server";

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
  delete process.env["FIRECRAWL_API_KEY"];
  delete process.env["LOVABLE_API_KEY"];
  vi.unstubAllGlobals();
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

describe("Firecrawl through the connector gateway", () => {
  const connect = () => {
    process.env["FIRECRAWL_API_KEY"] = "conn-key";
    process.env["LOVABLE_API_KEY"] = "lov-key";
  };

  it("is on only when both the connection key and the gateway key are present", () => {
    expect(firecrawlConfigured()).toBe(false);
    process.env["FIRECRAWL_API_KEY"] = "conn-key";
    expect(firecrawlConfigured()).toBe(false);
    process.env["LOVABLE_API_KEY"] = "lov-key";
    expect(firecrawlConfigured()).toBe(true);
    delete process.env["FIRECRAWL_API_KEY"];
    expect(firecrawlConfigured()).toBe(false);
  });

  it("posts to the gateway with the Lovable key as bearer and the connection key beside it", async () => {
    connect();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await firecrawlRequest("/scrape", { url: "https://a.com" }, 5_000, fetchFn);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://connector-gateway.lovable.dev/firecrawl/v2/scrape");
    expect(String(url).startsWith(FIRECRAWL_GATEWAY_URL)).toBe(true);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer lov-key");
    expect(headers["X-Connection-Api-Key"]).toBe("conn-key");
    expect(JSON.parse(String(init?.body))).toEqual({ url: "https://a.com" });
  });

  it("never sends the connection key to Firecrawl directly", async () => {
    connect();
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    await firecrawlRequest("/search", { query: "q" }, 5_000, fetchFn);
    expect(String(fetchFn.mock.calls[0]![0])).not.toContain("api.firecrawl.dev");
  });

  it("refuses to call when it is not connected", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await expect(firecrawlRequest("/scrape", {}, 5_000, fetchFn)).rejects.toThrow(/not connected/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("searchWeb reads results (nested under data.web) from the gateway answer", async () => {
    connect();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { web: [{ url: "https://gym.example", title: "Gym", description: "A gym" }] },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const hits = await searchWeb("gyms near me", 5);
    expect(hits).toEqual([{ url: "https://gym.example", title: "Gym", description: "A gym" }]);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://connector-gateway.lovable.dev/firecrawl/v2/search",
    );
  });

  it("searchWeb says web search is off when it is not connected, without calling out", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchWeb("x")).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
