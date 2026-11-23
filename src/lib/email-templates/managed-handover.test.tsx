import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { template } from "./managed-handover";

describe("managed-handover email", () => {
  it("has a fixed subject: no name a guardian can influence reaches the subject line", () => {
    // A plain string, not a function of the data: there is nothing a guardian can type that reaches it.
    expect(template.subject).toBe("Take over your BallaCity account");
  });

  it("puts only plain names in the body", () => {
    const Component = template.component;
    const html = renderToStaticMarkup(
      <Component
        guardianName="Win $500 http://evil.example"
        accountName="Jake 555-0100"
        handoverUrl="https://ballacity.com/handover/abc"
        expiresDays={7}
      />,
    );
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("0100");
    expect(html).not.toContain("$500");
    expect(html).toContain("https://ballacity.com/handover/abc");
  });

  it("makes no claim about the law and says nothing changes unless the link is opened", () => {
    const Component = template.component;
    const html = renderToStaticMarkup(
      <Component guardianName="Alex" handoverUrl="https://x.test" />,
    );
    expect(html).not.toMatch(/\blaw|legal|consent|custody/i);
    expect(html).toMatch(/nothing changes unless you open the link/i);
  });
});
