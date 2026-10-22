// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: unknown;
    className?: string;
  }) => (
    <a href={to} data-search={JSON.stringify(search ?? null)} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/Logo", () => ({ Logo: () => <span>BallaCity</span> }));
const getPublicTrainer = vi.fn();
vi.mock("@/lib/city-pages.functions", () => ({
  getPublicTrainer: (args: unknown) => getPublicTrainer(args),
}));

import { PublicTrainerPreview } from "./PublicTrainerPreview";
import type { PublicTrainer } from "@/lib/city-seo";

afterEach(() => {
  cleanup();
  getPublicTrainer.mockReset();
});

const trainer = (over: Partial<PublicTrainer> = {}): PublicTrainer => ({
  id: "t1",
  name: "Coach Dana",
  handle: "@coachdana",
  city: "New York, NY",
  sports: ["Basketball"],
  tagline: "Shooting and ball handling",
  bio: "Small-group sessions.",
  verified: false,
  ...over,
});

const NEXT = "/trainers/t1";
const renderIt = () =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PublicTrainerPreview trainerId="t1" next={NEXT} />
    </QueryClientProvider>,
  );

describe("PublicTrainerPreview", () => {
  it("shows a trainer's public description", async () => {
    getPublicTrainer.mockResolvedValue(trainer());
    renderIt();
    expect(await screen.findByRole("heading", { name: "Coach Dana" })).toBeTruthy();
    expect(screen.getByText("Basketball")).toBeTruthy();
    expect(screen.getByText("Small-group sessions.")).toBeTruthy();
    expect(getPublicTrainer).toHaveBeenCalledWith({ data: { id: "t1" } });
  });

  it("shows Verified only for a verified trainer", async () => {
    getPublicTrainer.mockResolvedValue(trainer({ verified: false }));
    const first = renderIt();
    await screen.findByRole("heading", { name: "Coach Dana" });
    expect(screen.queryByText("Verified")).toBeNull();
    first.unmount();
    getPublicTrainer.mockResolvedValue(trainer({ verified: true }));
    renderIt();
    expect(await screen.findByText("Verified")).toBeTruthy();
  });

  it("sends sign-up back to the same trainer", async () => {
    getPublicTrainer.mockResolvedValue(trainer());
    renderIt();
    const signup = await screen.findByRole("link", { name: "Create a free account to book" });
    expect(JSON.parse(signup.getAttribute("data-search")!)).toEqual({ next: NEXT, mode: "signup" });
  });

  it("shows one generic prompt when the trainer is not public or not found", async () => {
    getPublicTrainer.mockResolvedValue(null);
    renderIt();
    expect(
      await screen.findByRole("heading", { name: "This trainer is for BallaCity members" }),
    ).toBeTruthy();
    expect(screen.queryByText("Coach Dana")).toBeNull();
  });

  it("falls back to the same prompt when the read fails", async () => {
    getPublicTrainer.mockRejectedValue(new Error("boom"));
    renderIt();
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "This trainer is for BallaCity members" }),
      ).toBeTruthy(),
    );
  });
});
