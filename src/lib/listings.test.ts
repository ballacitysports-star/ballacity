import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

import { FACILITY_NOT_FOUND_MESSAGE, FEATURED_LIMIT_MESSAGE } from "@/lib/featured-orgs";
import { adminListingErrorMessage, listingErrorMessage } from "@/lib/listings";

const GENERIC = "Something went wrong. Please try again.";

describe("listingErrorMessage", () => {
  it("passes on the featured-facility sentences setOrgFeatured throws", () => {
    expect(listingErrorMessage(new Error(FEATURED_LIMIT_MESSAGE))).toBe(FEATURED_LIMIT_MESSAGE);
    expect(listingErrorMessage(new Error(FACILITY_NOT_FOUND_MESSAGE))).toBe(
      FACILITY_NOT_FOUND_MESSAGE,
    );
    expect(FACILITY_NOT_FOUND_MESSAGE).toBe("This facility no longer exists. Refresh the list.");
  });

  it("reads a lost moderator role (Forbidden) as a permission failure", () => {
    expect(listingErrorMessage(new Error("Forbidden"))).toBe(
      "You don't have permission to do that.",
    );
  });

  it("falls back to the generic sentence for anything unknown, never raw text", () => {
    expect(listingErrorMessage(new Error("relation trainer_orgs does not exist"))).toBe(GENERIC);
    expect(listingErrorMessage(undefined)).toBe(GENERIC);
  });
});

describe("adminListingErrorMessage (staff listings panel)", () => {
  it("gives staff a short sentence with the code for a facility that is gone", () => {
    expect(adminListingErrorMessage(new Error(FACILITY_NOT_FOUND_MESSAGE))).toBe(
      "This facility no longer exists. Refresh the list. (FACILITY_NOT_FOUND)",
    );
  });

  it("gives staff a short sentence with the code for a missing moderator role", () => {
    for (const raw of ["Forbidden", "Forbidden."]) {
      const msg = adminListingErrorMessage(new Error(raw));
      expect(msg).toMatch(/moderator access/);
      expect(msg).toMatch(/\(FORBIDDEN\)$/);
    }
  });

  it("otherwise reads as listingErrorMessage does", () => {
    expect(adminListingErrorMessage(new Error(FEATURED_LIMIT_MESSAGE))).toBe(
      FEATURED_LIMIT_MESSAGE,
    );
    expect(adminListingErrorMessage(new Error("OWN_CLAIM"))).toBe(
      listingErrorMessage(new Error("OWN_CLAIM")),
    );
    expect(adminListingErrorMessage(new Error("socket: something internal"))).toBe(GENERIC);
  });
});
