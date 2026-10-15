import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_TYPES,
  LEGAL_PAGE_LIST,
  buildConsentStatus,
  effectiveVersion,
  livePublishedVersion,
  parseLegalContent,
  pendingRequiredTypes,
  sectionsToContent,
  type PublishedLegalDocument,
} from "@/lib/legal-documents";
import {
  MANAGED_LEGAL_META,
  MANAGED_LEGAL_TYPES,
  isManagedLegalType,
  legalTypeLabel,
} from "@/lib/legal-catalog";

const row = (over: Partial<PublishedLegalDocument> = {}): PublishedLegalDocument => ({
  id: "1",
  document_type: "terms",
  title: "Terms of Service",
  version: "2026-10-01",
  content: "## A\nfirst\n\nsecond\n\n## B\nthird",
  summary: "Updated payment wording.",
  requires_reacceptance: true,
  effective_date: "2026-10-01",
  published: true,
  published_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  ...over,
});

describe("parseLegalContent", () => {
  it("splits headings and paragraphs", () => {
    const sections = parseLegalContent("## A\nfirst\n\nsecond\n\n## B\nthird");
    expect(sections).toEqual([
      { heading: "A", body: ["first", "second"] },
      { heading: "B", body: ["third"] },
    ]);
  });

  it("keeps leading text without a heading", () => {
    expect(parseLegalContent("intro text")).toEqual([{ heading: "", body: ["intro text"] }]);
  });

  it("round-trips through sectionsToContent", () => {
    const sections = parseLegalContent("## A\none\n\ntwo");
    expect(parseLegalContent(sectionsToContent(sections))).toEqual(sections);
  });

  it("parses a bullet list into a ul block", () => {
    const sections = parseLegalContent("## A\n\n- one\n- two");
    expect(sections).toEqual([
      {
        heading: "A",
        body: [],
        blocks: [{ kind: "ul", items: ["one", "two"] }],
      },
    ]);
  });

  it("splits a lead-in line from the bullets that follow it", () => {
    const sections = parseLegalContent("## A\nWe collect:\n- name\n- email");
    expect(sections).toEqual([
      {
        heading: "A",
        body: ["We collect:"],
        blocks: [
          { kind: "p", text: "We collect:" },
          { kind: "ul", items: ["name", "email"] },
        ],
      },
    ]);
  });

  it("leaves prose-only sections in their original shape", () => {
    const sections = parseLegalContent("## A\njust prose");
    expect(sections[0]).not.toHaveProperty("blocks");
  });

  it("round-trips lists through sectionsToContent", () => {
    const sections = parseLegalContent("## A\nlead\n- one\n- two\n\ntrailing");
    expect(parseLegalContent(sectionsToContent(sections))).toEqual(sections);
  });
});

describe("effectiveVersion", () => {
  it("prefers the published database version", () => {
    const v = effectiveVersion("terms", [row()]);
    expect(v.version).toBe("2026-10-01");
    expect(v.sections[0].heading).toBe("A");
  });

  it("ignores archived versions and falls back to the bundled registry", () => {
    const v = effectiveVersion("terms", [row({ published: false, archived_at: "x" })]);
    expect(v.version).toBe("2026-09-01");
  });
});

describe("consent status against published versions", () => {
  it("flags a newly published material version for re-acceptance", () => {
    const records = [
      {
        document_type: "terms" as const,
        document_version: "2026-09-01",
        accepted_at: "2026-09-02",
      },
      {
        document_type: "privacy" as const,
        document_version: "2026-09-01",
        accepted_at: "2026-09-02",
      },
    ];
    const published = [row()];
    const statuses = buildConsentStatus(records, published);
    const terms = statuses.find((s) => s.type === "terms")!;
    expect(terms.currentVersion).toBe("2026-10-01");
    expect(terms.needsAcceptance).toBe(true);
    expect(pendingRequiredTypes(records, published)).toEqual(["terms"]);
  });

  it("does not require acceptance for non-material updates", () => {
    const records = [
      {
        document_type: "terms" as const,
        document_version: "2026-09-01",
        accepted_at: "2026-09-02",
      },
      {
        document_type: "privacy" as const,
        document_version: "2026-09-01",
        accepted_at: "2026-09-02",
      },
    ];
    const published = [row({ requires_reacceptance: false })];
    expect(pendingRequiredTypes(records, published)).toEqual([]);
  });
});

describe("managed legal catalog", () => {
  it("covers the eight supported document types", () => {
    expect(MANAGED_LEGAL_TYPES).toHaveLength(8);
    expect(isManagedLegalType("ai_disclosure")).toBe(true);
    expect(isManagedLegalType("nope")).toBe(false);
    expect(legalTypeLabel("youth_policy")).toBe("Youth / Minor Policy");
  });
});

describe("informational legal pages", () => {
  const informational = ["payment_policy", "ai_disclosure", "youth_policy"] as const;

  it("have a public page whose path matches the admin catalog", () => {
    for (const type of informational) {
      expect(LEGAL_PAGE_LIST).toContain(LEGAL_DOCUMENTS[type]);
      expect(MANAGED_LEGAL_META[type].path).toBe(LEGAL_DOCUMENTS[type].path);
    }
  });

  it("never gate signup or re-acceptance", () => {
    for (const type of informational) {
      expect(LEGAL_DOCUMENT_TYPES).not.toContain(type);
      expect(effectiveVersion(type).material).toBe(false);
    }
    expect(pendingRequiredTypes([], [row({ document_type: "youth_policy" })])).toEqual([
      "terms",
      "privacy",
    ]);
  });

  it("prefers a published row over the bundled fallback", () => {
    const v = effectiveVersion("ai_disclosure", [
      row({ document_type: "ai_disclosure", version: "2026-11-01", requires_reacceptance: false }),
    ]);
    expect(v.version).toBe("2026-11-01");
    expect(v.sections.map((s) => s.heading)).toEqual(["A", "B"]);
  });
});

describe("livePublishedVersion", () => {
  it("returns null until a version is live, so pages keep their own fallback", () => {
    expect(livePublishedVersion("community_guidelines", null)).toBeNull();
    expect(
      livePublishedVersion("community_guidelines", [
        row({ document_type: "community_guidelines", published: false }),
      ]),
    ).toBeNull();
  });

  it("parses the live row", () => {
    const v = livePublishedVersion("safety_guidelines", [
      row({ document_type: "safety_guidelines", version: "s-2" }),
    ]);
    expect(v?.version).toBe("s-2");
    expect(v?.sections.map((s) => s.heading)).toEqual(["A", "B"]);
  });
});
