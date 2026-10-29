import { describe, expect, it } from "vitest";
import { Route } from "@/routes/api/public/og";

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
    const specific = await get("kind=game&title=Pickup%20game&subtitle=Lacrosse");
    expect(specific.headers.get("etag")).not.toBe(generic.headers.get("etag"));
  });
});
