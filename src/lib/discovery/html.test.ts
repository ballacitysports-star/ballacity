import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToPageText, isThinPage } from "./html";

const PAGE = `<!doctype html><html><head>
<title>Peach State Hoops &amp; Training</title>
<meta name="description" content="Youth &amp; adult basketball in Atlanta">
<script type="application/ld+json">{"@type":"SportsActivityLocation","name":"Peach State Hoops","address":{"streetAddress":"12 Court St","addressLocality":"Atlanta","addressRegion":"GA"}}</script>
<script>var secret = "do not read";</script>
<style>.x{color:red}</style>
</head><body>
<nav>Home</nav>
<h1>Welcome</h1><p>Indoor courts &mdash; open daily.</p>
<!-- hidden comment -->
<footer>12 Court St<br>Atlanta, GA 30303</footer>
</body></html>`;

describe("htmlToPageText", () => {
  it("keeps title, description, structured data and visible text, and drops script and style", () => {
    const p = htmlToPageText(PAGE);
    expect(p.title).toBe("Peach State Hoops & Training");
    expect(p.description).toBe("Youth & adult basketball in Atlanta");
    expect(p.jsonLd).toHaveLength(1);
    expect(p.jsonLd[0]).toContain("SportsActivityLocation");
    expect(p.text).toContain("Indoor courts — open daily.");
    expect(p.text).toContain("12 Court St\nAtlanta, GA 30303");
    expect(p.text).not.toContain("do not read");
    expect(p.text).not.toContain("color:red");
    expect(p.text).not.toContain("hidden comment");
  });

  it("keeps the start and the end of a long page, where footers carry addresses", () => {
    const long = `<body>START ${"filler ".repeat(5000)} 99 Footer Rd, Atlanta GA</body>`;
    const p = htmlToPageText(long, 2000);
    expect(p.text.length).toBeLessThan(2100);
    expect(p.text.startsWith("START")).toBe(true);
    expect(p.text.endsWith("99 Footer Rd, Atlanta GA")).toBe(true);
  });

  it("flags script-rendered pages that have almost no text", () => {
    expect(
      isThinPage(
        htmlToPageText('<body><div id="root"></div><script src="/app.js"></script></body>'),
      ),
    ).toBe(true);
    expect(isThinPage(htmlToPageText(PAGE))).toBe(true); // short pages are thin too
    expect(isThinPage(htmlToPageText(`<body>${"real content ".repeat(60)}</body>`))).toBe(false);
  });

  it("decodes named and numeric entities and ignores out-of-range ones", () => {
    expect(decodeEntities("a&nbsp;b &#65; &#x42; &bogus; &#1114112;")).toBe("a b A B &bogus;  ");
  });
});
