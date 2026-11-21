// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WP 4.1: "Complete my profile" -> Done (or Back) returns to posting. The edit screen leaves through `returnTo` with
 * `nav({ href })`, which keeps the `?compose=quick` the availability page opens the quick sheet from; without
 * `returnTo` both go to the profile as before. Rendered, not read from source: Done after a successful save, Back
 * (with and without the unsaved-changes confirm), and a failed save that stays put.
 */
const env = vi.hoisted(() => ({
  search: {} as { returnTo?: string },
  navigate: vi.fn(),
  flush: vi.fn(async () => true),
  saveStatus: "saved" as string,
  // Stable across renders, as the real hooks' values are (a new object each render would loop the screen's effects).
  user: { id: "me" },
  profile: { name: "Sam", username: "sam", avatar: "S", city: "", bio: "", sports: [], links: [] },
  prefs: { preferredSports: [], maxDistanceMi: 25 },
  orgs: [],
  profiles: { active: { kind: "player" }, loading: false },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
    useSearch: () => env.search,
  }),
  useNavigate: () => env.navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: env.user, loading: false }),
  getCurrentUser: async () => env.user,
}));
vi.mock("@/lib/user-prefs-store", () => ({
  useMyProfile: () => env.profile,
  useFeedPrefs: () => env.prefs,
  setProfileOverrides: vi.fn(),
  setFeedPrefs: vi.fn(),
  DEFAULT_PREFS: { preferredSports: [] },
}));
vi.mock("@/lib/org-store", () => ({ useMyOrgs: () => env.orgs }));
vi.mock("@/lib/trainer-orgs.functions", () => ({ listTrainerOrgs: async () => [] }));
vi.mock("@/lib/account-profiles", () => ({
  useMyProfiles: () => env.profiles,
}));
vi.mock("@/lib/birthday-lock", () => ({ useMyBirthdayLock: () => ({ data: null }) }));
vi.mock("@/lib/auth-return", () => ({ useAuthSearchHere: () => ({}) }));
vi.mock("@/hooks/use-autosave", () => ({
  useAutosave: () => ({ status: env.saveStatus, flush: env.flush }),
}));
vi.mock("@/components/SaveStatus", () => ({ SaveStatus: () => null }));
vi.mock("@/components/OrgCard", () => ({ OrgCard: () => null }));
vi.mock("@/components/profile/ProfileBasicsFields", () => ({ ProfileBasicsFields: () => null }));
vi.mock("@/components/profile/ProfileSportsFields", () => ({ ProfileSportsFields: () => null }));
vi.mock("@/components/profile/ProfileLocationFields", () => ({
  ProfileLocationFields: () => null,
}));
vi.mock("@/components/sports/SportPicker", () => ({ SportPicker: () => null }));
vi.mock("@/components/profile/ProfileLinksFields", () => ({
  ProfileLinksFields: () => null,
  cleanProfileLinks: (l: unknown) => l,
  validateProfileUrl: () => null,
}));
vi.mock("@/components/profile/ProfileFormPrimitives", () => ({
  Section: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Field: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Input: () => null,
  Toggle: () => null,
  validateBirthday: () => null,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { Route } from "@/routes/profile.edit";
import { AVAILABILITY_POST_RETURN } from "@/lib/profile-return";

const EditProfile = (Route as unknown as { options: { component: () => ReactNode } }).options
  .component;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EditProfile />
    </QueryClientProvider>,
  );
}

const doneButton = () => screen.getAllByRole("button", { name: /Done/ })[0];

beforeEach(() => {
  env.search = {};
  env.flush.mockResolvedValue(true);
  env.saveStatus = "saved";
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("profile edit: leaving", () => {
  it("Done, after the save, goes back to posting with the quick sheet flag", async () => {
    env.search = { returnTo: AVAILABILITY_POST_RETURN };
    show();
    fireEvent.click(doneButton());
    await waitFor(() =>
      expect(env.navigate).toHaveBeenCalledWith({ href: "/availability?compose=quick" }),
    );
    expect(env.flush).toHaveBeenCalled();
    expect(env.navigate).not.toHaveBeenCalledWith({ to: "/profile" });
  });

  it("Back goes back to posting too", () => {
    env.search = { returnTo: AVAILABILITY_POST_RETURN };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(env.navigate).toHaveBeenCalledWith({ href: "/availability?compose=quick" });
  });

  it("Back with unsaved changes asks first, then goes back to posting", () => {
    env.search = { returnTo: AVAILABILITY_POST_RETURN };
    env.saveStatus = "error";
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(confirm).toHaveBeenCalled();
    expect(env.navigate).toHaveBeenCalledWith({ href: "/availability?compose=quick" });
  });

  it("Back with unsaved changes, answered No, stays", () => {
    env.search = { returnTo: AVAILABILITY_POST_RETURN };
    env.saveStatus = "error";
    vi.spyOn(window, "confirm").mockReturnValue(false);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("Done with a failed save stays on the screen", async () => {
    env.search = { returnTo: AVAILABILITY_POST_RETURN };
    env.flush.mockResolvedValue(false);
    show();
    fireEvent.click(doneButton());
    await waitFor(() => expect(env.flush).toHaveBeenCalled());
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("without returnTo, Done and Back go to the profile as before", async () => {
    show();
    fireEvent.click(doneButton());
    await waitFor(() => expect(env.navigate).toHaveBeenCalledWith({ to: "/profile" }));
    env.navigate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Back to profile" }));
    expect(env.navigate).toHaveBeenCalledWith({ to: "/profile" });
  });
});
