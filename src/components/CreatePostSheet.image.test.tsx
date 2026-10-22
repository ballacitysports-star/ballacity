// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sent = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: (input: unknown) => unknown) => fn,
}));
vi.mock("@/lib/team-posts.functions", () => ({
  createTeamPost: vi.fn(async (input: unknown) => {
    sent.calls.push(input);
    return { id: "p1", moderation_status: "approved" };
  }),
  suggestTeamPostDraft: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
vi.mock("@/components/LocationAutocomplete", () => ({ LocationAutocomplete: () => null }));
vi.mock("@/components/PrimaryCTA", () => ({
  PrimaryCTA: ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ImageUploader", () => ({
  ImageUploader: ({
    presets,
    onChange,
    bucket,
    pathPrefix,
  }: {
    presets?: string[];
    onChange: (url: string) => void;
    bucket: string;
    pathPrefix?: string;
  }) => (
    <div>
      <span data-testid="uploader">{`${bucket}/${pathPrefix}/${(presets ?? []).join(",")}`}</span>
      <button type="button" onClick={() => onChange("/assets/sport-basketball-abc123.jpg")}>
        Pick preset
      </button>
      <button
        type="button"
        onClick={() =>
          onChange("https://x.supabase.co/storage/v1/object/public/team-covers/u-1/a.jpg")
        }
      >
        Upload
      </button>
    </div>
  ),
}));

import { CreatePostSheet } from "./CreatePostSheet";

beforeEach(() => {
  sent.calls = [];
});
afterEach(cleanup);

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CreatePostSheet teamId="t-1" sports={["Baseball"]} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

const publish = () => {
  fireEvent.change(screen.getByPlaceholderText("What's the headline?"), {
    target: { value: "Season opener" },
  });
  fireEvent.click(screen.getByRole("button", { name: /publish post/i }));
};

describe("CreatePostSheet cover image", () => {
  it("offers the team's sports as presets, uploading to the poster's folder", () => {
    renderSheet();
    expect(screen.getByText("Cover image (optional)")).toBeTruthy();
    expect(screen.getByTestId("uploader").textContent).toBe("team-covers/u-1/Baseball");
  });

  it("sends a built-in cover by name", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Pick preset" }));
    publish();
    await waitFor(() => expect(sent.calls).toHaveLength(1));
    expect((sent.calls[0] as { data: { imageUrl: string } }).data.imageUrl).toBe(
      "preset:basketball",
    );
  });

  it("sends an upload as its storage URL", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    publish();
    await waitFor(() => expect(sent.calls).toHaveLength(1));
    expect((sent.calls[0] as { data: { imageUrl: string } }).data.imageUrl).toBe(
      "https://x.supabase.co/storage/v1/object/public/team-covers/u-1/a.jpg",
    );
  });

  it("sends no image when none was chosen", async () => {
    renderSheet();
    publish();
    await waitFor(() => expect(sent.calls).toHaveLength(1));
    expect((sent.calls[0] as { data: { imageUrl: null } }).data.imageUrl).toBeNull();
  });
});

describe("CreatePostSheet kinds", () => {
  it("does not offer Pickup, and points a pickup game to Host a game", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CreatePostSheet teamId="t1" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    for (const k of ["Announcement", "Tryout", "Clinic", "Recap"]) {
      expect(screen.getByRole("button", { name: new RegExp(k) })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: /Pickup/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Host a game" }).getAttribute("href")).toBe("/create");
  });
});
