// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// A small stand-in for the database: who follows team t1.
const db = vi.hoisted(() => ({ followers: new Set<string>(["a", "b"]), calls: [] as string[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args: { _id?: string; _ids?: string[] }) => {
      db.calls.push(fn);
      if (fn === "follow_entity") db.followers.add("me");
      if (fn === "unfollow_entity") db.followers.delete("me");
      if (fn === "entity_follow_state") {
        return Promise.resolve({
          data: [{ following: db.followers.has("me"), followers: db.followers.size }],
          error: null,
        });
      }
      if (fn === "entity_follow_counts") {
        return Promise.resolve({
          data: (args._ids ?? []).map((id) => ({
            id,
            followers: db.followers.size,
            following: db.followers.has("me"),
          })),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useEntityFollow, useEntityFollowCounts } from "./entity-follows";

/** A Discover card in miniature: the list's count, and the card's own Follow button. */
function Card() {
  const counts = useEntityFollowCounts("team", ["t1"]);
  const follow = useEntityFollow("team", "t1");
  return (
    <div>
      <span data-testid="count">{counts?.get("t1")?.followers ?? "none"}</span>
      <button type="button" disabled={follow.loading || follow.pending} onClick={follow.toggle}>
        {follow.following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  db.followers = new Set(["a", "b"]);
  db.calls.length = 0;
});

describe("a card's follower count after Follow (P1-1)", () => {
  it("goes up when the viewer follows from the card, and back down when they unfollow", async () => {
    wrap(<Card />);
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    await waitFor(() =>
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("3"));
    await screen.findByRole("button", { name: "Following" });

    fireEvent.click(screen.getByRole("button", { name: "Following" }));
    await waitFor(() => expect(screen.getByTestId("count").textContent).toBe("2"));
    expect(db.calls.filter((c) => c === "entity_follow_counts").length).toBe(3);
  });
});
