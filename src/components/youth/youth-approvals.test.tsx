// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HostingApproval } from "@/lib/youth-hosting-approvals";

const h = vi.hoisted(() => ({
  approvals: [] as unknown[],
  approvalsError: null as unknown,
  children: [] as unknown[],
  grantGuardian: vi.fn(),
  grantOrg: vi.fn(),
  revoke: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => h.toastError(m),
    success: (m: string) => h.toastSuccess(m),
    message: vi.fn(),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: () => Promise.resolve({ data: h.children, error: null }) },
}));
vi.mock("@/lib/youth-hosting-approvals", async (orig) => {
  const real = await orig<typeof import("@/lib/youth-hosting-approvals")>();
  return {
    ...real,
    fetchHostingApprovals: () =>
      h.approvalsError
        ? Promise.reject(h.approvalsError)
        : Promise.resolve(h.approvals as HostingApproval[]),
    grantGuardianApproval: (i: unknown) => h.grantGuardian(i),
    grantOrgApproval: (i: unknown) => h.grantOrg(i),
    revokeHostingApproval: (i: unknown) => h.revoke(i),
  };
});

import { GuardianHostingApprovals } from "./GuardianHostingApprovals";
import { OrgYouthHostingApprovals } from "./OrgYouthHostingApprovals";
import { YouthHostApprovalPicker } from "./YouthHostApprovalPicker";

const future = new Date(Date.now() + 2 * 86400000).toISOString();
const approval = (over: Partial<HostingApproval> = {}): HostingApproval => ({
  id: "a1",
  kind: "guardian",
  minor_id: "teen",
  approver_id: "guardian",
  org_id: null,
  status: "active",
  game_id: null,
  expires_at: future,
  created_at: new Date().toISOString(),
  used_at: null,
  revoked_at: null,
  payment_manager_id: null,
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  h.approvals = [];
  h.approvalsError = null;
  h.children = [];
  for (const f of [h.grantGuardian, h.grantOrg, h.revoke, h.toastError, h.toastSuccess])
    f.mockReset();
  h.grantGuardian.mockResolvedValue("new");
  h.grantOrg.mockResolvedValue("new");
  h.revoke.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("guardian approvals", () => {
  it("shows nothing to a guardian with no 16-17 year old (under-16 rules are unchanged)", async () => {
    h.children = [
      { child_user_id: "k13", display_name: "Kid 13", age_cohort: "teen_13_15" },
      { child_user_id: "k9", display_name: "Kid 9", age_cohort: "child_under_13" },
    ];
    const { container } = wrap(<GuardianHostingApprovals viewerId="guardian" />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("lets the guardian of a 16-17 year old approve one game, with the chosen length and payment responsibility", async () => {
    h.children = [{ child_user_id: "teen", display_name: "Taylor", age_cohort: "teen_16_17" }];
    wrap(<GuardianHostingApprovals viewerId="guardian" />);
    await screen.findByText("Taylor");
    fireEvent.click(screen.getByLabelText(/I will manage payments/i));
    fireEvent.change(screen.getByLabelText(/How long the approval is valid/i), {
      target: { value: "72" },
    });
    fireEvent.click(screen.getByText("Approve one game"));
    await waitFor(() =>
      expect(h.grantGuardian).toHaveBeenCalledWith({
        minorId: "teen",
        validHours: 72,
        managePayments: true,
      }),
    );
    expect(screen.getByText(/never allows an 18\+ game/)).toBeTruthy();
  });

  it("shows approvals with their state and lets the guardian withdraw one", async () => {
    h.children = [{ child_user_id: "teen", display_name: "Taylor", age_cohort: "teen_16_17" }];
    h.approvals = [approval(), approval({ id: "a2", status: "revoked" })];
    wrap(<GuardianHostingApprovals viewerId="guardian" />);
    await screen.findByText("Ready to use");
    expect(screen.getByText("Withdrawn")).toBeTruthy();
    fireEvent.click(screen.getByText("Withdraw"));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith("a1"));
  });

  it("explains a failed load and offers to retry", async () => {
    h.children = [{ child_user_id: "teen", display_name: "T", age_cohort: "teen_16_17" }];
    h.approvalsError = new Error("offline");
    wrap(<GuardianHostingApprovals viewerId="guardian" />);
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load");
    expect(screen.getByText("Try again")).toBeTruthy();
  });
});

describe("organization administrator approvals", () => {
  const members = [
    { user_id: "admin", name: "Coach Dana" },
    { user_id: "m1", name: "Member One" },
  ];

  it("lists members without any age information and never offers to approve oneself", async () => {
    wrap(<OrgYouthHostingApprovals orgId="org" members={members} viewerId="admin" />);
    await screen.findByText("Choose a member…");
    expect(screen.queryByRole("option", { name: "Coach Dana" })).toBeNull();
    expect(screen.getByRole("option", { name: "Member One" })).toBeTruthy();
    const memberSelect = screen.getByRole("combobox", { name: /Member/ });
    expect(Array.from(memberSelect.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
      "Choose a member…",
      "Member One",
    ]);
  });

  it("approves for the chosen member under this organization", async () => {
    wrap(<OrgYouthHostingApprovals orgId="org" members={members} viewerId="admin" />);
    await screen.findByText("Choose a member…");
    fireEvent.change(screen.getByRole("combobox", { name: /Member/ }), { target: { value: "m1" } });
    fireEvent.click(screen.getByText("Approve one game"));
    await waitFor(() =>
      expect(h.grantOrg).toHaveBeenCalledWith({
        minorId: "m1",
        orgId: "org",
        validHours: 168,
        managePayments: false,
      }),
    );
  });

  it("shows the server's neutral refusal and nothing about why", async () => {
    h.grantOrg.mockRejectedValue(new Error("This player can't be approved for hosting."));
    wrap(<OrgYouthHostingApprovals orgId="org" members={members} viewerId="admin" />);
    await screen.findByText("Choose a member…");
    fireEvent.change(screen.getByRole("combobox", { name: /Member/ }), { target: { value: "m1" } });
    fireEvent.click(screen.getByText("Approve one game"));
    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("This player can't be approved for hosting."),
    );
  });

  it("shows only this admin's approvals for this organization", async () => {
    h.approvals = [
      approval({
        id: "o1",
        kind: "organization",
        org_id: "org",
        approver_id: "admin",
        minor_id: "m1",
      }),
      approval({
        id: "o2",
        kind: "organization",
        org_id: "other",
        approver_id: "admin",
        minor_id: "m1",
      }),
      approval({
        id: "o3",
        kind: "organization",
        org_id: "org",
        approver_id: "someone",
        minor_id: "m1",
      }),
    ];
    wrap(<OrgYouthHostingApprovals orgId="org" members={members} viewerId="admin" />);
    await waitFor(() => expect(screen.getAllByText("Withdraw")).toHaveLength(1));
  });
});

describe("the teen's picker", () => {
  it("tells a teen with no approval to ask, and says an 18+ game is never possible", async () => {
    const onChange = vi.fn();
    wrap(
      <YouthHostApprovalPicker minorId="teen" value={null} onChange={onChange} problem={null} />,
    );
    expect(
      (await screen.findByText(/guardian or an administrator of your club/)).textContent,
    ).toContain("can't be hosted by anyone under 18");
  });

  it("selects the soonest-expiring usable approval and ignores used, revoked and other people's", async () => {
    const onChange = vi.fn();
    h.approvals = [
      approval({ id: "later", expires_at: new Date(Date.now() + 5 * 86400000).toISOString() }),
      approval({ id: "soon" }),
      approval({ id: "used", status: "used" }),
      approval({ id: "revoked", status: "revoked" }),
      approval({ id: "theirs", minor_id: "other-teen" }),
    ];
    wrap(
      <YouthHostApprovalPicker minorId="teen" value={null} onChange={onChange} problem={null} />,
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0].id).toBe("soon");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("shows why the chosen approval cannot cover the game", async () => {
    h.approvals = [approval()];
    wrap(
      <YouthHostApprovalPicker
        minorId="teen"
        value={approval()}
        onChange={() => {}}
        problem="Paid games need a guardian or club administrator to manage payment."
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("manage payment");
  });

  it("offers a retry when approvals cannot be loaded", async () => {
    h.approvalsError = new Error("offline");
    wrap(
      <YouthHostApprovalPicker minorId="teen" value={null} onChange={() => {}} problem={null} />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't check");
  });
});
