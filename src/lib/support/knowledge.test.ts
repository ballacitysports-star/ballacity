import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARENTAL_CONSENT_MAX_AGE } from "@/lib/age-policy";
import { quoteFees } from "@/lib/monetization/fees";
import { PAYMENT_DISCLAIMER } from "@/lib/payment-states";
import { EMERGENCY_NOTICE } from "@/lib/safety";
import { SUPPORT_EMAIL } from "@/lib/trust";
import {
  SUPPORT_LINKS,
  SUPPORT_LINK_KEYS,
  SUPPORT_TOPICS,
  getSupportTopic,
  isSupportLinkKey,
  resolveSupportLinks,
  supportLibraryText,
} from "./knowledge";

/**
 * The help library is what members, and the assistant, are told is true. These
 * tests tie it to the code and the published policy pages it describes, so a
 * change in the product that the library doesn't follow shows up here.
 */

const text = (id: string) => {
  const t = getSupportTopic(id)!;
  return [t.title, t.summary, ...t.points].join("\n");
};

describe("links", () => {
  const routeTree = readFileSync("src/routeTree.gen.ts", "utf8");

  it.each(SUPPORT_LINK_KEYS)("%s points at a page that exists", (key) => {
    const { to } = SUPPORT_LINKS[key];
    expect(routeTree).toContain(`path: '${to}'`);
  });

  it("recognises only its own keys", () => {
    expect(isSupportLinkKey("contact")).toBe(true);
    expect(isSupportLinkKey("constructor")).toBe(false);
    expect(isSupportLinkKey("__proto__")).toBe(false);
    expect(isSupportLinkKey(7)).toBe(false);
  });

  it("resolves a list into unique, known, capped links", () => {
    const links = resolveSupportLinks(["teams", "nope", "teams", "contact", "players", "terms"], 3);
    expect(links.map((l) => l.key)).toEqual(["teams", "contact", "players"]);
    expect(links[0]).toEqual({ key: "teams", label: "Teams", to: "/teams" });
  });
});

describe("structure", () => {
  it("has unique topics, each with an answer and valid links", () => {
    const ids = SUPPORT_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of SUPPORT_TOPICS) {
      expect(t.title.length).toBeGreaterThan(2);
      expect(t.summary.length).toBeGreaterThan(10);
      expect(t.points.length).toBeGreaterThan(0);
      expect(t.links.length).toBeGreaterThan(0);
      expect(t.links.every(isSupportLinkKey)).toBe(true);
    }
  });

  it("covers every area the help is meant for", () => {
    for (const id of [
      "payments",
      "kids-and-parents",
      "joining-games",
      "teams-tryouts",
      "safety-and-reporting",
      "decisions-and-appeals",
      "contact-support",
    ])
      expect(getSupportTopic(id)).toBeDefined();
  });

  it("stays small enough to send with every question", () => {
    expect(supportLibraryText().length).toBeLessThan(9000);
  });
});

describe("payments: matches how the product really handles money", () => {
  const t = text("payments");

  it("names the payment apps hosts really use, and cash", () => {
    for (const app of ["Venmo", "Zelle", "Cash App", "PayPal", "cash"]) expect(t).toContain(app);
  });

  it("says BallaCity is not a processor, and the code agrees it takes nothing", () => {
    expect(t).toMatch(/not a payment processor/);
    expect(t).toMatch(/does not take a cut of game fees/);
    expect(PAYMENT_DISCLAIMER).toMatch(/not a payment processor/);
    const quote = quoteFees({ amountCents: 2500, mode: "direct_host" });
    expect(quote.platformFeeCents).toBe(0);
    expect(quote.processingFeeCents).toBe(0);
    expect(quote.totalCents).toBe(2500);
    expect(quote.hostReceivesCents).toBe(2500);
  });

  it("says BallaCity cannot refund, which is what the Payment Policy says", () => {
    expect(t).toMatch(/cannot reverse a payment or issue a refund/);
    const legal = readFileSync("src/lib/legal-documents.ts", "utf8");
    expect(legal).toContain("BallaCity cannot reverse a transfer or issue a refund");
  });

  it("never asks for card or login details", () => {
    expect(t).toMatch(/Never share card numbers, bank logins or one-time codes/);
  });
});

describe("children and parents: no claims the product can't back", () => {
  const t = text("kids-and-parents");

  it("uses the app's own consent age", () => {
    expect(t).toContain(`Members under ${PARENTAL_CONSENT_MAX_AGE + 1} need`);
  });

  it("describes adding a child without a login, as the Parent Center does", () => {
    expect(t).toMatch(/Add your child/);
    expect(t).toMatch(/doesn't need their own email or password/);
    const parent = readFileSync("src/routes/parent.index.tsx", "utf8");
    expect(parent).toContain("Add a child");
    expect(parent).toContain("They don&rsquo;t need an");
  });

  it("makes no legal or compliance claim anywhere in the library", () => {
    const all = supportLibraryText();
    expect(all).not.toMatch(/compliant|compliance|COPPA|GDPR|certified|guarantee/i);
  });

  it("doesn't mention device pairing, which has no screens in the app yet", () => {
    expect(supportLibraryText()).not.toMatch(/pairing|pair code|pairing code/i);
    const files = readFileSync("src/routes/parent.index.tsx", "utf8");
    expect(files).not.toMatch(/pairing/i);
  });
});

describe("safety and support", () => {
  it("includes the canonical emergency notice", () => {
    expect(text("safety-and-reporting")).toContain(EMERGENCY_NOTICE);
  });

  it("gives the real support address and never asks for secrets by email", () => {
    const t = text("contact-support");
    expect(t).toContain(SUPPORT_EMAIL);
    expect(t).toMatch(/Never put card numbers, passwords or one-time codes in an email/);
  });

  it("is clear that a person, not the assistant, decides appeals", () => {
    expect(text("decisions-and-appeals")).toMatch(
      /cannot look up, explain, change or reverse a decision/,
    );
  });

  it("promises nothing about response times or outcomes", () => {
    expect(supportLibraryText()).not.toMatch(
      /\bwithin \d+ (hours?|days?)\b|\bguaranteed\b|\balways resolved\b|\binstantly\b/i,
    );
  });
});
