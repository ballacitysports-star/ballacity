// @vitest-environment jsdom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { SignedOutPreview } from "./SignedOutPreview";
import { PREVIEW_CONFIGS, type PreviewTab } from "@/lib/preview-samples";
import { SIGNED_OUT_PREVIEW_TABS } from "@/lib/public-paths";

afterEach(cleanup);

const TABS = Object.keys(PREVIEW_CONFIGS) as PreviewTab[];

describe("SignedOutPreview", () => {
  it("has a preview for every tab the router opens to signed-out visitors", () => {
    const routed = SIGNED_OUT_PREVIEW_TABS.map((p) => p.slice(1)).sort();
    expect(TABS.sort()).toEqual(routed);
  });

  it.each(TABS)("%s: says it is a sample and offers sign-up", (tab) => {
    render(<SignedOutPreview tab={tab} next={`/${tab}`} />);
    expect(screen.getByRole("note").textContent).toMatch(/sample preview/i);
    expect(screen.getAllByText("Create account").length).toBeGreaterThan(0);
  });

  it.each(TABS)("%s: shows every sample row and nothing is blurred", (tab) => {
    const { container } = render(<SignedOutPreview tab={tab} next={`/${tab}`} />);
    const config = PREVIEW_CONFIGS[tab];
    for (const row of config.rows ?? []) {
      expect(screen.getByText(row.title)).toBeTruthy();
    }
    expect(container.querySelector('[class*="blur"]')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("draws action buttons the visitor cannot click", () => {
    const { container } = render(<SignedOutPreview tab="feed" next="/feed" />);
    const action = PREVIEW_CONFIGS.feed.rowAction!;
    const buttons = screen.getAllByText(action);
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.hasAttribute("inert")).toBe(true);
      expect(b.closest("a, button")).toBeNull();
    }
    // The only controls are the sign-up and sign-in links.
    expect(container.querySelectorAll("button, input, select, textarea")).toHaveLength(0);
  });
});

describe("preview content is static", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

  it.each(["../../lib/preview-samples.ts", "./SignedOutPreview.tsx"])(
    "%s imports no database client, server function or member store",
    (file) => {
      const imports = [...read(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec).not.toMatch(
          /supabase|\.functions|\.server|react-query|user-prefs|account-profiles/,
        );
      }
    },
  );
});
