import { describe, expect, it } from "vitest";
import {
  activeOverlay,
  cancelTransitionFx,
  effectiveTransition,
  exitLeadSeconds,
  OVERLAY_HOLD_SECONDS,
  parseOverlayTime,
  playTransitionFx,
  scheduleOverlays,
  transitionKeyframes,
} from "@/lib/reel-playback";

describe("parseOverlayTime", () => {
  it("reads clock and second timestamps", () => {
    expect(parseOverlayTime("0:04")).toBe(4);
    expect(parseOverlayTime("1:02.5")).toBe(62.5);
    expect(parseOverlayTime("4s")).toBe(4);
    expect(parseOverlayTime("4.5")).toBe(4.5);
    expect(parseOverlayTime("@0:07 the dunk")).toBe(7);
  });

  it("returns null for moment names", () => {
    expect(parseOverlayTime("the dunk")).toBeNull();
    expect(parseOverlayTime("")).toBeNull();
  });
});

describe("scheduleOverlays", () => {
  const timeline = [
    { t: 2, label: "Crossover at the top" },
    { t: 6, label: "Reverse layup" },
  ];

  it("places timestamped cards and holds each until the next", () => {
    const cards = scheduleOverlays(
      [
        { at: "0:01", text: "Watch this" },
        { at: "0:02", text: "Cross" },
        { at: "0:09", text: "Bucket" },
      ],
      timeline,
      20,
    );
    expect(cards).toEqual([
      { text: "Watch this", start: 1, end: 2.2 },
      // Pushed back so the first card gets a readable moment on screen.
      { text: "Cross", start: 2.2, end: 2.2 + OVERLAY_HOLD_SECONDS },
      { text: "Bucket", start: 9, end: 9 + OVERLAY_HOLD_SECONDS },
    ]);
  });

  it("anchors a card named after a moment to that play-by-play beat", () => {
    const [card] = scheduleOverlays([{ at: "the layup", text: "And one" }], timeline, 20);
    expect(card.start).toBe(6);
  });

  it("spreads cards with no usable time evenly across the clip", () => {
    const cards = scheduleOverlays(
      [
        { at: "", text: "One" },
        { at: "somewhere", text: "Two" },
      ],
      [],
      12,
    );
    expect(cards.map((c) => c.start)).toEqual([4, 8]);
  });

  it("drops cards past the end of the clip and empty text", () => {
    const cards = scheduleOverlays(
      [
        { at: "0:30", text: "Too late" },
        { at: "0:03", text: "  " },
        { at: "0:04", text: "Ok" },
      ],
      [],
      10,
    );
    expect(cards.map((c) => c.text)).toEqual(["Ok"]);
  });

  it("finds the card on screen", () => {
    const cards = scheduleOverlays([{ at: "0:04", text: "Now" }], [], 10);
    expect(activeOverlay(cards, 4.5)?.text).toBe("Now");
    expect(activeOverlay(cards, 3.9)).toBeNull();
    expect(activeOverlay(cards, 4 + OVERLAY_HOLD_SECONDS)).toBeNull();
  });

  it("handles no overlays", () => {
    expect(scheduleOverlays(null)).toEqual([]);
  });
});

describe("transitions", () => {
  it("falls back to a fade for movement effects under reduced motion", () => {
    expect(effectiveTransition("whip", true)).toBe("fade");
    expect(effectiveTransition("zoom", true)).toBe("fade");
    expect(effectiveTransition("flash", true)).toBe("flash");
    expect(effectiveTransition("whip", false)).toBe("whip");
  });

  it("starts the outgoing half earlier in media time on fast segments", () => {
    expect(exitLeadSeconds("fade", 1)).toBeCloseTo(0.3);
    expect(exitLeadSeconds("fade", 0.5)).toBeCloseTo(0.15);
    expect(exitLeadSeconds("cut", 1.5)).toBe(0);
  });

  it("has nothing to animate for a hard cut", () => {
    expect(transitionKeyframes("cut", "exit")).toEqual({ ms: 0 });
    expect(transitionKeyframes("cut", "enter")).toEqual({ ms: 0 });
  });

  it("washes the veil for flash and fade, and moves the frame for whip and zoom", () => {
    expect(transitionKeyframes("flash", "enter").veil?.[0]).toMatchObject({ opacity: 0.85 });
    expect(transitionKeyframes("fade", "exit").veil?.[1]).toMatchObject({ opacity: 1 });
    expect(transitionKeyframes("whip", "enter").frame).toHaveLength(2);
    expect(transitionKeyframes("zoom", "enter").frame?.[0]).toMatchObject({
      transform: "scale(1.15)",
    });
    expect(transitionKeyframes("zoom", "exit")).toEqual({ ms: 0 });
  });

  it("runs on the right element and holds only the outgoing half", () => {
    const calls: { el: string; options: KeyframeAnimationOptions }[] = [];
    const fake = (el: string) =>
      ({
        animate: (_k: Keyframe[], options: KeyframeAnimationOptions) => {
          calls.push({ el, options });
          return { cancel: () => calls.push({ el: `${el}:cancel`, options: {} }) };
        },
      }) as unknown as HTMLElement;

    const running = playTransitionFx("fade", "exit", { veil: fake("veil"), frame: fake("frame") });
    expect(calls).toEqual([{ el: "veil", options: expect.objectContaining({ fill: "forwards" }) }]);

    cancelTransitionFx(running);
    expect(running).toHaveLength(0);
    expect(calls.at(-1)?.el).toBe("veil:cancel");

    playTransitionFx("whip", "enter", { veil: fake("veil"), frame: fake("frame") });
    expect(calls.at(-1)).toEqual({
      el: "frame",
      options: expect.objectContaining({ fill: "none" }),
    });
  });

  it("is a no-op where the Web Animations API is missing", () => {
    const bare = {} as HTMLElement;
    expect(playTransitionFx("flash", "enter", { veil: bare, frame: bare })).toEqual([]);
    expect(playTransitionFx("flash", "enter", {})).toEqual([]);
  });
});
