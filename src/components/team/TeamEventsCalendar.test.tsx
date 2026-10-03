// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dateKeyInZone } from "@/lib/datetime";
import { TeamEventsCalendar, EventWaiverStatus, groupCalendarEvents } from "./TeamEventsCalendar";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const events = [
  { id: "one", title: "Open tryout", kind: "tryout" as const, event_date: "2026-10-15T16:00:00Z", spots_taken: 3 },
  { id: "two", title: "Skills camp", kind: "clinic" as const, event_date: "2026-10-15T18:00:00Z", spots_taken: 2 },
  { id: "tba", title: "Undated camp", kind: "clinic" as const, event_date: null, spots_taken: 0 },
];

describe("Team event calendar", () => {
  it("groups multiple events using the viewer date and retains undated events", () => {
    const grouped = groupCalendarEvents(events);
    expect(grouped.get(dateKeyInZone(events[0].event_date ?? ""))).toHaveLength(2);
    expect(grouped.get("")?.[0].id).toBe("tba");
    const boundary = { ...events[0], event_date: "2026-10-01T00:30:00Z" };
    expect(groupCalendarEvents([boundary]).has(dateKeyInZone(boundary.event_date))).toBe(true);
  });

  it("selects event days, summarizes current waivers, changes months and returns to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    render(<TeamEventsCalendar events={events} summaries={new Map([["one", { going: 3, signed: 2 }], ["two", { going: 2, signed: 2 }]])}
      waiverRequired summaryLoading={false} summaryError={false} renderEvent={(e) => <li key={e.id}>{e.title}</li>} />);
    expect(screen.getByText("5 RSVPs")).toBeTruthy();
    expect(screen.getByText("4/5 waivers signed · 1 missing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2026-10-15, 2 events, 5 RSVPs, 1 missing waivers" }));
    expect(screen.getByText("Skills camp")).toBeTruthy();
    expect(screen.getByText("Undated camp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(screen.getByText("No events scheduled this month.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByText("October 2026")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: /2026-10-03, 0 events/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("never presents a failed or pending waiver read as signed", () => {
    const { rerender } = render(<EventWaiverStatus required loading={false} error summary={{ going: 5, signed: 5 }} />);
    expect(screen.getByText("Waiver status unavailable")).toBeTruthy();
    rerender(<EventWaiverStatus required loading error={false} />);
    expect(screen.getByText("Loading waivers…")).toBeTruthy();
    rerender(<EventWaiverStatus required={false} loading={false} error={false} />);
    expect(screen.getByText("No waiver published")).toBeTruthy();
  });
});