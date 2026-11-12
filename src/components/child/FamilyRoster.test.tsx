// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { RosterEntry } from "@/lib/family-roster";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import { FamilyRoster } from "./FamilyRoster";

function entry(id: string, name: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    child: {
      childUserId: id,
      displayName: name,
      username: null,
      avatarUrl: null,
      cohort: "child_under_13",
      ageReviewRequired: false,
      relationship: "parent",
      linkedAt: null,
      upcomingGames: 1,
      nextGame: { title: "Friday Run", at: "2026-11-14T18:00:00Z" },
      teamCount: 2,
      consent: null,
      controls: {} as RosterEntry["child"]["controls"],
      managed: true,
    },
    status: "not_required",
    statusLabel: "Managed by you",
    needsGuardian: false,
    ageReviewRequired: false,
    publicProfileReachable: false,
    managed: true,
    ...extra,
  };
}

afterEach(cleanup);

const needsAction = [entry("c1", "Ava T.", { status: "awaiting_approval", needsGuardian: true })];
const approved = [entry("c2", "Ben T."), entry("c3", "Cal T.")];

describe("FamilyRoster", () => {
  it("lists the children as buttons and marks the one whose settings show", () => {
    const onSelect = vi.fn();
    render(
      <FamilyRoster
        needsAction={needsAction}
        approved={approved}
        selected="c2"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole("region", { name: "Your linked children" })).toBeTruthy();
    const ben = screen.getByRole("button", { name: /Ben T\./ });
    expect(ben.getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Ava T\./ }).getAttribute("aria-current")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Cal T\./ }));
    expect(onSelect).toHaveBeenCalledWith("c3");
    // The stable hook E2E specs use to find a child's card.
    expect(ben.id).toBe("child-tab-c2");
  });

  it("uses no tab roles: a tablist may hold only tabs, and these cards hold details and links", () => {
    render(
      <FamilyRoster
        needsAction={needsAction}
        approved={approved}
        selected="c1"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("passes axe's structure and naming rules", async () => {
    const { container } = render(
      <main>
        <FamilyRoster
          needsAction={needsAction}
          approved={approved}
          selected="c1"
          onSelect={vi.fn()}
        />
      </main>,
    );
    const result = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      // jsdom has no layout or computed colours to measure.
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.map((v) => `${v.impact} ${v.id}`)).toEqual([]);
  });
});
