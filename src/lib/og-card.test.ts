import { describe, expect, it } from "vitest";
import { Route } from "@/routes/api/public/og";
import { OG_GAME_CARD_VERSION, ogImageUrl } from "@/lib/seo";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const GET = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } }).options
  .server.handlers.GET;

const get = (qs: string, headers: Record<string, string> = {}) =>
  GET({ request: new Request(`https://ballacity.com/api/public/og?${qs}`, { headers }) });

describe("/api/public/og", () => {
  it("renders only the text it is given: it takes no game id and looks nothing up", async () => {
    const res = await get(
      "kind=game&title=Pickup%20game&subtitle=Pickup%20game%20on%20BallaCity&size=og",
    );
    const body = await res.text();
    expect(body).toContain("Pickup game");
    // A game id in the query is ignored, never resolved to a game.
    const withId = await (
      await get("kind=game&title=Pickup%20game&gameId=game-secret-1&id=game-secret-1")
    ).text();
    expect(withId).not.toContain("game-secret-1");
  });

  it("is a pure function of the url: the same generic url gives the same image and etag to every caller", async () => {
    const qs = "kind=game&title=Pickup%20game&subtitle=Pickup%20game%20on%20BallaCity&size=og";
    const a = await get(qs);
    const b = await get(qs, {
      cookie: "sb-access-token=signed-in-user",
      authorization: "Bearer x",
    });
    expect(await b.text()).toBe(await a.text());
    expect(b.headers.get("etag")).toBe(a.headers.get("etag"));
  });

  it("does not vary or set cookies, so a response cannot be cached for one audience and served to another", async () => {
    const res = await get("kind=game&title=Pickup%20game");
    expect(res.headers.get("vary")).toBe("Accept-Encoding");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("public");
  });

  it("keys the cache on the query, so a game-specific card is a different url from the generic one", async () => {
    const generic = await get(
      "kind=game&title=Pickup%20game&subtitle=Pickup%20game%20on%20BallaCity",
    );
    const specific = await get("kind=game&title=Pickup%20game&subtitle=Lacrosse&v=2");
    expect(specific.headers.get("etag")).not.toBe(generic.headers.get("etag"));
  });

  describe("legacy game cards", () => {
    const LEGACY =
      "kind=game&title=Zeppelin%20Heights%20Run&subtitle=Lacrosse%20%E2%80%A2%20Quillon%20Gym&meta=Oct%2012%7CQuillon%20Secret%20Gym%7C%2437.5&size=og";
    const LEAKS = ["Zeppelin", "Lacrosse", "Quillon", "Oct 12", "37.5"];

    it("a game url without the card version shows the generic card, not the details in the url", async () => {
      const res = await get(LEGACY);
      const body = await res.text();
      for (const leak of LEAKS) expect(body).not.toContain(leak);
      expect(body).toContain("Pickup game");
    });

    it("the generic card is the same for every legacy game url, so it says nothing about the game", async () => {
      const a = await get(LEGACY);
      const b = await get("kind=game&title=Other&subtitle=Soccer&meta=x&size=og&v=1");
      expect(await b.text()).toBe(await a.text());
      expect(b.headers.get("etag")).toBe(a.headers.get("etag"));
    });

    it("a versioned game url renders the text it was given", async () => {
      const body = await (await get(`${LEGACY}&v=${OG_GAME_CARD_VERSION}`)).text();
      expect(body).toContain("Zeppelin Heights Run");
    });

    it("other card kinds are unaffected by the game version", async () => {
      const body = await (await get("kind=team&title=Hoops%20Club&size=og")).text();
      expect(body).toContain("Hoops Club");
    });

    it("the etag version moved, so a revalidation of an old cached card no longer returns 304", async () => {
      const res = await get(LEGACY);
      expect(res.headers.get("etag")).toMatch(/^"v2-/);
      const again = await get(LEGACY, { "if-none-match": '"v1-0123456789abcdef"' });
      expect(again.status).toBe(200);
    });

    it("ogImageUrl puts the version in game card urls only", () => {
      expect(new URL(ogImageUrl({ kind: "game", title: "x" })).searchParams.get("v")).toBe(
        OG_GAME_CARD_VERSION,
      );
      expect(new URL(ogImageUrl({ kind: "team", title: "x" })).searchParams.get("v")).toBeNull();
    });
  });
});
