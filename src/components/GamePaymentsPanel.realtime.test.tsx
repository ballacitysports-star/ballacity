// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

/**
 * WP 4.3: the Payments tab's realtime re-subscribe error. supabase-js hands back the existing channel when one with the
 * same topic is still in its list, and a removed channel stays in that list until the server acknowledges the leave.
 * Reopening the tab (or React's dev double mount) used the same topic, got the old subscribed channel back, and
 * `.on("postgres_changes", ...)` threw. The fake client below keeps those two realtime-js rules, so the tests fail on
 * the old code.
 */

type FakeChannel = {
  topic: string;
  subscribed: boolean;
  removed: boolean;
  handlers: number;
  on: (...args: unknown[]) => FakeChannel;
  subscribe: () => FakeChannel;
};

const rt = vi.hoisted(() => ({
  channels: [] as FakeChannel[],
  created: [] as FakeChannel[],
  removed: [] as FakeChannel[],
  uid: Promise.resolve("me" as string | null),
}));

vi.mock("@/integrations/supabase/client", () => {
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    return q;
  };
  return {
    supabase: {
      from: query,
      channel: (name: string) => {
        const topic = `realtime:${name}`;
        // realtime-js: an existing channel with this topic is returned instead of a new one.
        const existing = rt.channels.find((c) => c.topic === topic);
        if (existing) return existing;
        const ch: FakeChannel = {
          topic,
          subscribed: false,
          removed: false,
          handlers: 0,
          on() {
            if (ch.subscribed) {
              throw new Error(
                `cannot add \`postgres_changes\` callbacks for ${topic} after \`subscribe()\`.`,
              );
            }
            ch.handlers += 1;
            return ch;
          },
          subscribe() {
            if (ch.subscribed) throw new Error("tried to subscribe multiple times");
            ch.subscribed = true;
            return ch;
          },
        };
        rt.channels.push(ch);
        rt.created.push(ch);
        return ch;
      },
      // realtime-js: the channel leaves the list only once the server acks the leave, which never happens here.
      removeChannel: async (ch: FakeChannel) => {
        ch.removed = true;
        rt.removed.push(ch);
        return "ok";
      },
    },
  };
});
vi.mock("@/lib/current-user-id", () => ({ getCurrentUserId: () => rt.uid }));
vi.mock("@/lib/payments", () => ({
  listMySubmissionsForGame: async () => [],
  getSignedProofUrl: async () => null,
  listPaymentMethodsForHost: async () => [],
  paymentTypeMeta: () => ({ label: "", icon: null }),
  markRefundSent: vi.fn(),
  hostCancelPaymentSubmission: vi.fn(),
}));
vi.mock("@/lib/payments.functions", () => ({ reviewPaymentAction: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/child-safety", () => ({
  useMyChildStatus: () => ({ can: () => ({ allowed: true, reason: null }) }),
}));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => null }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { HostPaymentsPanel, PlayerPaymentsPanel } from "./GamePaymentsPanel";

const flush = () => act(async () => {});
const live = () => rt.created.filter((c) => !c.removed);

beforeEach(() => {
  rt.channels = [];
  rt.created = [];
  rt.removed = [];
  rt.uid = Promise.resolve("me");
});
afterEach(() => cleanup());

describe("HostPaymentsPanel realtime (WP 4.3)", () => {
  it("reopening the Payments tab subscribes a fresh channel instead of throwing on the old one", async () => {
    const first = render(<HostPaymentsPanel gameId="g1" gameTitle="Game" settings={null} />);
    await flush();
    expect(live()).toHaveLength(1);
    first.unmount();
    expect(live()).toHaveLength(0);

    // The old channel is still in the client's list (its leave is not acknowledged yet).
    expect(() =>
      render(<HostPaymentsPanel gameId="g1" gameTitle="Game" settings={null} />),
    ).not.toThrow();
    await flush();
    const [now] = live();
    expect(now).toBeDefined();
    expect(now!.topic).toMatch(/^realtime:host_payments:g1:/);
    expect(now!.handlers).toBe(1);
    expect(now!.subscribed).toBe(true);
    expect(new Set(rt.created.map((c) => c.topic)).size).toBe(rt.created.length);
  });

  it("survives React's StrictMode double mount with exactly one live channel", async () => {
    expect(() =>
      render(
        <StrictMode>
          <HostPaymentsPanel gameId="g2" gameTitle="Game" settings={null} />
        </StrictMode>,
      ),
    ).not.toThrow();
    await flush();
    expect(live()).toHaveLength(1);
  });
});

describe("PlayerPaymentsPanel realtime (WP 4.3)", () => {
  it("reopening the tab subscribes a fresh channel and removes it on close", async () => {
    const first = render(<PlayerPaymentsPanel gameId="g3" settings={null} />);
    await flush();
    expect(live()).toHaveLength(1);
    expect(live()[0]!.topic).toMatch(/^realtime:my_payments:g3:me:/);
    first.unmount();
    expect(live()).toHaveLength(0);

    const second = render(<PlayerPaymentsPanel gameId="g3" settings={null} />);
    await flush();
    expect(live()).toHaveLength(1);
    expect(live()[0]!.handlers).toBe(1);
    second.unmount();
    expect(live()).toHaveLength(0);
  });

  it("closing the tab before the user id arrives opens no channel at all", async () => {
    let resolveUid: (v: string | null) => void = () => {};
    rt.uid = new Promise((r) => {
      resolveUid = r;
    });
    const view = render(<PlayerPaymentsPanel gameId="g4" settings={null} />);
    view.unmount();
    await act(async () => resolveUid("me"));
    expect(rt.created).toHaveLength(0);
  });

  it("opens no channel when nobody is signed in", async () => {
    rt.uid = Promise.resolve(null);
    render(<PlayerPaymentsPanel gameId="g5" settings={null} />);
    await flush();
    expect(rt.created).toHaveLength(0);
  });
});
