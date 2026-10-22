import { describe, expect, it } from "vitest";
import { describePending, familyPending } from "./family-pending";

describe("familyPending", () => {
  it("adds invites, game requests and children waiting on the parent", () => {
    const p = familyPending({ invites: [1], requests: [1, 2], waitingChildren: 1 });
    expect(p).toEqual({ invites: 1, requests: 2, waitingChildren: 1, total: 4 });
  });

  it("is zero when nothing waits, and never negative", () => {
    expect(familyPending({ invites: [], requests: [], waitingChildren: 0 }).total).toBe(0);
    expect(familyPending({ invites: [], requests: [], waitingChildren: -2 }).total).toBe(0);
  });
});

describe("describePending", () => {
  it("says what waits, in a parent's words", () => {
    expect(
      describePending(familyPending({ invites: [1], requests: [1, 2], waitingChildren: 1 })),
    ).toBe("1 child needs your approval · 2 game requests · 1 team invite");
    expect(
      describePending(familyPending({ invites: [1, 2], requests: [1], waitingChildren: 2 })),
    ).toBe("2 children need your approval · 1 game request · 2 team invites");
  });

  it("says nothing when nothing waits", () => {
    expect(describePending(familyPending({ invites: [], requests: [], waitingChildren: 0 }))).toBe(
      "",
    );
  });
});
