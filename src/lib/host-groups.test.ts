import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { groupNameError, type HostGroup } from "./host-groups";

const groups: HostGroup[] = [{ id: "g1", name: "Tuesday crew", memberIds: [] }];

describe("groupNameError", () => {
  it("accepts a new, trimmed name", () => {
    expect(groupNameError("  Sunday run  ", groups)).toBeNull();
  });

  it("refuses an empty, too long or duplicate name (case-insensitive)", () => {
    expect(groupNameError("   ", groups)).toMatch(/name/);
    expect(groupNameError("x".repeat(61), groups)).toMatch(/60/);
    expect(groupNameError("tuesday CREW", groups)).toMatch(/already/);
  });
});
