// @vitest-environment jsdom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { SignedOutPreview } from "./SignedOutPreview";
import { PREVIEW_CONFIGS, PREVIEW_VISIBLE_ROWS, type PreviewTab } from "@/lib/preview-samples";
import { SIGNED_OUT_PREVIEW_TABS } from "@/lib/public-paths";

afterEach(cleanup);

const TABS = Object.keys(PREVIEW_CONFIGS) as PreviewTab[];

/** Text inside blurred regions, and whether any of those regions is reachable. */
function blurredRegions(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"][inert]'));
}

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

  it.each(TABS)("%s: blurred areas are unreachable and hidden from assistive tech", (tab) => {
    const { container } = render(<SignedOutPreview tab={tab} next={`/${tab}`} />);
    for (const region of blurredRegions(container)) {
      expect(region.className).toMatch(/blur/);
      expect(region.className).toMatch(/pointer-events-none/);
      expect(region.className).toMatch(/select-none/);
      expect(region.querySelector("a, button, input, textarea, select")).toBeNull();
    }
  });

  it("blurs every person's name and every action button, even in the rows left clear", () => {
    const { container } = render(<SignedOutPreview tab="players" next="/players" />);
    const config = PREVIEW_CONFIGS.players;
    const blurredText = blurredRegions(container)
      .map((r) => r.textContent)
      .join("|");
    for (const row of config.rows!.slice(0, PREVIEW_VISIBLE_ROWS)) {
      expect(blurredText).toContain(row.person!);
      expect(blurredText).toContain(row.title);
    }
    expect(blurredText).toContain(config.rowAction!);
    // Outside any blurred region, neither appears.
    const clear = blurredRegions(container).reduce(
      (html, r) => html.replace(r.outerHTML, ""),
      container.innerHTML,
    );
    expect(clear).not.toContain(config.rowAction!);
    for (const row of config.rows!.slice(0, PREVIEW_VISIBLE_ROWS)) {
      expect(clear).not.toContain(row.person!);
      expect(clear).not.toContain(row.title);
    }
  });

  it("shows only the first few rows clearly and blurs the rest", () => {
    const { container } = render(<SignedOutPreview tab="feed" next="/feed" />);
    const rows = PREVIEW_CONFIGS.feed.rows!;
    const items = within(container).getAllByRole("listitem", { hidden: true });
    expect(items).toHaveLength(rows.length);
    const hiddenItems = items.filter((li) => li.closest('[aria-hidden="true"]'));
    expect(hiddenItems).toHaveLength(rows.length - PREVIEW_VISIBLE_ROWS);
  });

  it("blurs rosters, chat and messages", () => {
    for (const tab of ["teams", "profile"] as const) {
      const { container, unmount } = render(<SignedOutPreview tab={tab} next={`/${tab}`} />);
      const line = PREVIEW_CONFIGS[tab].locked!.lines[0]!;
      const holder = within(container).getByText(line);
      expect(holder.closest('[aria-hidden="true"][inert]')).not.toBeNull();
      unmount();
    }
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
