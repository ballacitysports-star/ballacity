// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const counts = {
  newReports: 2,
  birthdayCorrections: 0,
  guardianRequests: 1,
  ageReviews: 0,
  pendingClaims: 0,
  legalDrafts: 0,
  stuckReels: 0,
};

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/superadmin-attention.functions", () => ({
  superadminAttention: async () => counts,
}));

import { AttentionStrip } from "./AttentionStrip";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderStrip(onNavigate = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AttentionStrip onNavigate={onNavigate} />
    </QueryClientProvider>,
  );
  return onNavigate;
}

describe("AttentionStrip", () => {
  it("links New reports to the moderation queue, not the Content tab", async () => {
    renderStrip();
    const link = await screen.findByRole("link", { name: "New reports: 2" });
    expect(link.getAttribute("href")).toBe("/admin/moderation");
    expect(screen.queryByRole("button", { name: /New reports/ })).toBeNull();
  });

  it("switches tabs for the other queues", async () => {
    const onNavigate = renderStrip();
    fireEvent.click(await screen.findByRole("button", { name: "Guardian requests: 1" }));
    expect(onNavigate).toHaveBeenCalledWith("youth");
  });
});
