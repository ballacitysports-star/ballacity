// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const messages = [
  {
    id: "m1",
    senderId: "me",
    senderName: "Me",
    body: "mine",
    status: "approved",
    hidden: false,
    createdAt: "2026-11-09T10:00:00Z",
  },
  {
    id: "m2",
    senderId: "u2",
    senderName: "Coach Sam",
    body: "theirs",
    status: "approved",
    hidden: false,
    createdAt: "2026-11-09T10:01:00Z",
  },
  {
    id: "m3",
    senderId: "me",
    senderName: "Me",
    body: "checking",
    status: "pending",
    hidden: false,
    createdAt: "2026-11-09T10:02:00Z",
  },
];
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/team-chat.functions", () => ({ sendTeamChatMessage: vi.fn() }));
vi.mock("@/lib/team-chat", async (orig) => ({
  ...(await orig<typeof import("@/lib/team-chat")>()),
  listTeamChat: () => Promise.resolve(messages),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

const { TeamChatPanel } = await import("./TeamChatPanel");
const wrap = (node: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

afterEach(cleanup);

describe("TeamChatPanel (P2-3)", () => {
  it("lets members report others' approved messages, never their own, and marks pending ones", async () => {
    wrap(<TeamChatPanel teamId="hawks" viewerId="me" isStaff={false} />);
    expect(await screen.findByText("theirs")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Report message/ })).toHaveLength(1);
    expect(screen.getByText("Checking…")).toBeTruthy();
    expect(screen.queryByText("Hide")).toBeNull();
  });

  it("gives staff Hide on approved messages", async () => {
    wrap(<TeamChatPanel teamId="hawks" viewerId="me" isStaff />);
    await screen.findByText("theirs");
    expect(screen.getAllByText("Hide")).toHaveLength(2);
  });
});
