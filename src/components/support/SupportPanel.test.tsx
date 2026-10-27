// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { askSupportAssistant, toast } = vi.hoisted(() => ({
  askSupportAssistant: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, onClick, className }: any) => (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/support/support.functions", () => ({ askSupportAssistant }));
vi.mock("sonner", () => ({ toast }));

import { SUPPORT_EMAIL } from "@/lib/trust";
import { SUPPORT_TOPICS } from "@/lib/support/knowledge";
import { getSupportState, resetSupportStore, setSupportOwner } from "@/lib/support/support-store";
import { SupportPanel } from "./SupportPanel";

function reply(over: Record<string, unknown> = {}) {
  return {
    answer: "Hosts approve most requests first.",
    links: [{ key: "find_games", label: "Find games", to: "/feed" }],
    escalation: null,
    source: "ai",
    ...over,
  };
}

const input = () => screen.getByLabelText(/ask ballacity help/i) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });
const send = () => fireEvent.click(screen.getByRole("button", { name: "Send" }));

beforeEach(() => {
  askSupportAssistant.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  resetSupportStore();
  setSupportOwner("u1");
});
afterEach(cleanup);

describe("signed out: written answers only", () => {
  it("offers a sign-in, no chat box, and the quick answers", () => {
    render(<SupportPanel signedIn={false} />);
    expect(screen.queryByLabelText(/ask ballacity help/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth");
    for (const t of SUPPORT_TOPICS)
      expect(screen.getByRole("button", { name: t.title })).toBeTruthy();
    expect(askSupportAssistant).not.toHaveBeenCalled();
  });

  it("shows a topic's full written answer without calling the AI", () => {
    render(<SupportPanel signedIn={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Paying for games" }));
    const card = screen.getByRole("region", { name: "Paying for games" });
    expect(within(card).getByText(/not a payment processor/i)).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Payment Policy" }).getAttribute("href")).toBe(
      "/payment-policy",
    );
    expect(askSupportAssistant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /all topics/i }));
    expect(screen.queryByRole("region", { name: "Paying for games" })).toBeNull();
  });

  it("always shows the emergency notice and the support address", () => {
    render(<SupportPanel signedIn={false} />);
    expect(screen.getByText(/not an emergency service/i)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: SUPPORT_EMAIL }).length).toBeGreaterThan(0);
  });
});

describe("signed in: the assistant", () => {
  it("is honest that it is an AI that cannot see accounts", () => {
    render(<SupportPanel signedIn />);
    expect(screen.getByText(/I'm an AI assistant/)).toBeTruthy();
    expect(
      screen.getByText(/can't see your account, payments or anyone else's profile/),
    ).toBeTruthy();
  });

  it("sends the question and shows the answer with its page links", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    render(<SupportPanel signedIn />);
    type("  how do I join a game?  ");
    send();
    await screen.findByText("Hosts approve most requests first.");
    expect(askSupportAssistant).toHaveBeenCalledWith({
      data: { message: "how do I join a game?", history: [] },
    });
    expect(screen.getByText("how do I join a game?")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find games" }).getAttribute("href")).toBe("/feed");
    expect(input().value).toBe("");
  });

  it("sends Enter but keeps Shift+Enter for a new line", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    render(<SupportPanel signedIn />);
    type("one");
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(askSupportAssistant).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    await screen.findByText("Hosts approve most requests first.");
    expect(askSupportAssistant).toHaveBeenCalledTimes(1);
  });

  it("will not send an empty message", () => {
    render(<SupportPanel signedIn />);
    type("   ");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(askSupportAssistant).not.toHaveBeenCalled();
  });

  it("limits the box to the server's message length", () => {
    render(<SupportPanel signedIn />);
    expect(input().maxLength).toBe(600);
  });

  it("sends the conversation so far, at most six turns", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    render(<SupportPanel signedIn />);
    for (let i = 1; i <= 5; i += 1) {
      type(`question ${i}`);
      send();
      await waitFor(() => expect(askSupportAssistant).toHaveBeenCalledTimes(i));
      await waitFor(() => expect(screen.getAllByText(/Hosts approve/).length).toBe(i));
    }
    const last = askSupportAssistant.mock.calls[4][0].data;
    expect(last.message).toBe("question 5");
    expect(last.history).toHaveLength(6);
    expect(last.history[0]).toEqual({ role: "user", content: "question 2" });
  });

  it("shows a thinking state and blocks a second send while waiting", async () => {
    let resolve!: (v: unknown) => void;
    askSupportAssistant.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<SupportPanel signedIn />);
    type("hello");
    send();
    expect(await screen.findByText("Thinking…")).toBeTruthy();
    type("another");
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(reply()));
    await screen.findByText("Hosts approve most requests first.");
    expect(askSupportAssistant).toHaveBeenCalledTimes(1);
  });

  it("explains a refusal and keeps the written answers within reach", async () => {
    askSupportAssistant.mockRejectedValue(
      new Error("A parent or guardian needs to allow AI features for this account first."),
    );
    render(<SupportPanel signedIn />);
    type("hello");
    send();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/parent or guardian needs to allow AI/);
    expect(within(alert).getByRole("link", { name: SUPPORT_EMAIL })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Paying for games" })).toBeTruthy();
  });

  it("falls back to a generic message when the error has none", async () => {
    askSupportAssistant.mockRejectedValue("nope");
    render(<SupportPanel signedIn />);
    type("hello");
    send();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Something went wrong/);
  });
});

describe("handing off to a person", () => {
  it("offers a drafted email built from the member's own words and account email", async () => {
    askSupportAssistant.mockResolvedValue(
      reply({ answer: "Refunds come from the host.", links: [], escalation: "payment_dispute" }),
    );
    render(<SupportPanel signedIn email="pat@example.com" />);
    type("The host kept my fee and never ran the game");
    send();
    const card = await screen.findByTestId("support-escalation");
    const mail = within(card)
      .getByRole("link", { name: /email support/i })
      .getAttribute("href")!;
    expect(mail.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
    const body = decodeURIComponent(mail);
    expect(body).toContain("pat@example.com");
    expect(body).toContain("The host kept my fee and never ran the game");
    expect(body).toMatch(/not included card numbers, passwords or one-time codes/);
  });

  it("copies the draft for pasting into any mail app", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    askSupportAssistant.mockResolvedValue(reply({ escalation: "other" }));
    render(<SupportPanel signedIn />);
    type("something odd");
    send();
    const card = await screen.findByTestId("support-escalation");
    fireEvent.click(within(card).getByRole("button", { name: /copy details/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain(`To: ${SUPPORT_EMAIL}`);
    expect(toast.success).toHaveBeenCalled();
  });

  it("shows no escalation card for an ordinary answer", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    render(<SupportPanel signedIn />);
    type("how do I join");
    send();
    await screen.findByText("Hosts approve most requests first.");
    expect(screen.queryByTestId("support-escalation")).toBeNull();
  });
});

describe("conversation lifecycle", () => {
  it("clears the chat on request", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    render(<SupportPanel signedIn />);
    type("hello");
    send();
    await screen.findByText("Hosts approve most requests first.");
    fireEvent.click(screen.getByRole("button", { name: /clear chat/i }));
    expect(getSupportState().messages).toEqual([]);
    expect(screen.queryByText("Hosts approve most requests first.")).toBeNull();
  });

  it("closes the drawer when a link is followed", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    const onNavigate = vi.fn();
    render(<SupportPanel signedIn onNavigate={onNavigate} />);
    type("hello");
    send();
    fireEvent.click(await screen.findByRole("link", { name: "Find games" }));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("drops one member's chat when another signs in on the same device", async () => {
    askSupportAssistant.mockResolvedValue(reply());
    const { unmount } = render(<SupportPanel signedIn />);
    type("my private question");
    send();
    await screen.findByText("Hosts approve most requests first.");
    unmount();
    act(() => setSupportOwner("u2"));
    render(<SupportPanel signedIn />);
    expect(screen.queryByText("my private question")).toBeNull();
    expect(screen.queryByText("Hosts approve most requests first.")).toBeNull();
  });
});
