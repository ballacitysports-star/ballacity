import { describe, expect, it } from "vitest";
import { buildAnnotation, type Annotation } from "./annotations";
import {
  DRAG_THRESHOLD,
  emptyDraw,
  pointerDown,
  pointerMove,
  pointerUp,
  previewAnnotation,
  previewPoints,
  type DrawState,
} from "./draw-input";
import {
  labelSizeFor,
  paintAnnotation,
  paintAnnotations,
  strokeWidthFor,
  type Ctx2D,
} from "./paint";

const P = (x: number, y: number) => ({ x, y });
const meta = { color: "lime" as const, time: 1, persist: false };

/** Plays a gesture through the state machine and returns whatever drawing it finished. */
function run(start: DrawState, steps: Array<["down" | "move" | "up", { x: number; y: number }]>) {
  let s = start;
  const done: Array<ReturnType<typeof P>[]> = [];
  for (const [kind, p] of steps) {
    if (kind === "move") s = pointerMove(s, p);
    else {
      const r = kind === "down" ? pointerDown(s, p) : pointerUp(s, p);
      s = r.state;
      if (r.done) done.push(r.done);
    }
  }
  return { s, done };
}

describe("drawing a line", () => {
  it("works by dragging from one end to the other", () => {
    const { done, s } = run(emptyDraw("line"), [
      ["down", P(0.1, 0.1)],
      ["move", P(0.3, 0.2)],
      ["up", P(0.5, 0.4)],
    ]);
    expect(done).toEqual([[P(0.1, 0.1), P(0.5, 0.4)]]);
    expect(s.pts).toEqual([]);
  });

  it("works by tapping each end in turn", () => {
    const { done } = run(emptyDraw("line"), [
      ["down", P(0.1, 0.1)],
      ["up", P(0.1, 0.1)],
      ["move", P(0.4, 0.4)],
      ["down", P(0.5, 0.5)],
      ["up", P(0.5, 0.5)],
    ]);
    expect(done).toEqual([[P(0.1, 0.1), P(0.5, 0.5)]]);
  });

  it("treats a tiny wobble as a tap, not a drag", () => {
    const wobble = DRAG_THRESHOLD / 2;
    const { done, s } = run(emptyDraw("line"), [
      ["down", P(0.5, 0.5)],
      ["up", P(0.5 + wobble, 0.5)],
    ]);
    expect(done).toEqual([]);
    expect(s.pts).toHaveLength(1);
    expect(s.pressed).toBe(false);
  });

  it("can draw another straight after finishing one", () => {
    const { done } = run(emptyDraw("line"), [
      ["down", P(0.1, 0.1)],
      ["up", P(0.6, 0.6)],
      ["down", P(0.2, 0.8)],
      ["up", P(0.9, 0.2)],
    ]);
    expect(done).toHaveLength(2);
  });

  it("ignores a release it never saw the press for", () => {
    const r = pointerUp(emptyDraw("line"), P(0.5, 0.5));
    expect(r.done).toBeNull();
    expect(r.state.pts).toEqual([]);
  });
});

describe("drawing an angle", () => {
  it("takes a drag for the first arm and a tap for the third point", () => {
    const { done } = run(emptyDraw("angle"), [
      ["down", P(0.2, 0.2)],
      ["up", P(0.5, 0.5)],
      ["down", P(0.8, 0.2)],
      ["up", P(0.8, 0.2)],
    ]);
    expect(done).toEqual([[P(0.2, 0.2), P(0.5, 0.5), P(0.8, 0.2)]]);
  });

  it("takes three taps", () => {
    const { done } = run(emptyDraw("angle"), [
      ["down", P(0.2, 0.2)],
      ["up", P(0.2, 0.2)],
      ["down", P(0.5, 0.5)],
      ["up", P(0.5, 0.5)],
      ["down", P(0.8, 0.2)],
      ["up", P(0.8, 0.2)],
    ]);
    expect(done).toEqual([[P(0.2, 0.2), P(0.5, 0.5), P(0.8, 0.2)]]);
  });

  it("is not finished by two points", () => {
    const { done, s } = run(emptyDraw("angle"), [
      ["down", P(0.2, 0.2)],
      ["up", P(0.5, 0.5)],
    ]);
    expect(done).toEqual([]);
    expect(s.pts).toHaveLength(2);
  });
});

describe("drawing freehand", () => {
  it("records a stroke while the pointer is down", () => {
    const { done } = run(emptyDraw("pen"), [
      ["down", P(0.1, 0.1)],
      ["move", P(0.2, 0.2)],
      ["move", P(0.3, 0.25)],
      ["move", P(0.4, 0.2)],
      ["up", P(0.4, 0.2)],
    ]);
    expect(done).toHaveLength(1);
    expect(done[0].length).toBeGreaterThanOrEqual(4);
  });

  it("skips points that barely moved", () => {
    let s = pointerDown(emptyDraw("pen"), P(0.5, 0.5)).state;
    s = pointerMove(s, P(0.5001, 0.5));
    s = pointerMove(s, P(0.5002, 0.5));
    expect(s.pts).toHaveLength(1);
  });

  it("does not record while the pointer is just hovering", () => {
    const s = pointerMove(emptyDraw("pen"), P(0.5, 0.5));
    expect(s.pts).toEqual([]);
    expect(s.cursor).toEqual(P(0.5, 0.5));
  });

  it("drops a dot with no stroke", () => {
    const { done } = run(emptyDraw("pen"), [
      ["down", P(0.5, 0.5)],
      ["up", P(0.5, 0.5)],
    ]);
    expect(done).toEqual([]);
  });
});

describe("live preview", () => {
  it("shows the points so far plus the pointer", () => {
    const s = run(emptyDraw("angle"), [
      ["down", P(0.2, 0.2)],
      ["up", P(0.5, 0.5)],
      ["move", P(0.8, 0.3)],
    ]).s;
    expect(previewPoints(s)).toEqual([P(0.2, 0.2), P(0.5, 0.5), P(0.8, 0.3)]);
  });

  it("shows nothing before the first point, and the stroke itself for the pen", () => {
    expect(previewPoints(pointerMove(emptyDraw("line"), P(0.5, 0.5)))).toEqual([]);
    const pen = run(emptyDraw("pen"), [
      ["down", P(0.1, 0.1)],
      ["move", P(0.3, 0.3)],
    ]).s;
    expect(previewPoints(pen)).toEqual([P(0.1, 0.1), P(0.3, 0.3)]);
  });
});

// --- painting ---

type Call = [string, ...unknown[]];

function recorder() {
  const calls: Call[] = [];
  const log =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = {
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    font: "",
    textBaseline: "alphabetic",
    textAlign: "start",
    beginPath: log("beginPath"),
    moveTo: log("moveTo"),
    lineTo: log("lineTo"),
    stroke: log("stroke"),
    arc: log("arc"),
    fill: log("fill"),
    fillRect: log("fillRect"),
    fillText: log("fillText"),
    save: log("save"),
    restore: log("restore"),
    measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics,
  } as unknown as Ctx2D;
  return { ctx, calls, texts: () => calls.filter((c) => c[0] === "fillText").map((c) => c[1]) };
}

const rect = { x: 0, y: 0, w: 800, h: 450 };
const size = { w: 1920, h: 1080 };

describe("painting", () => {
  it("labels a line with its tilt from horizontal", () => {
    const { ctx, texts } = recorder();
    const line = buildAnnotation("line", [P(0.1, 0.9), P(0.9, 0.1)], meta)!;
    paintAnnotation(ctx, line, rect, size);
    // 0.8 of the width (1536px) across, 0.8 of the height (864px) up: atan(864/1536) = 29.4°
    expect(texts()).toEqual(["29.4°"]);
  });

  it("labels an angle with its size, measured in the video's real shape", () => {
    const { ctx, texts } = recorder();
    const right = buildAnnotation(
      "angle",
      [P(0.5, 0.2), P(0.5, 0.5), P(0.5 + 0.3 * (1080 / 1920), 0.5)],
      meta,
    )!;
    paintAnnotation(ctx, right, rect, size);
    expect(texts()).toEqual(["90.0°"]);
  });

  it("draws a pen stroke as one connected path", () => {
    const { ctx, calls } = recorder();
    const pen = buildAnnotation("pen", [P(0.1, 0.1), P(0.2, 0.2), P(0.3, 0.1), P(0.4, 0.2)], meta)!;
    paintAnnotation(ctx, pen, rect, size);
    expect(calls.filter((c) => c[0] === "moveTo")).toHaveLength(1);
    expect(calls.filter((c) => c[0] === "lineTo")).toHaveLength(3);
    expect(calls.filter((c) => c[0] === "fillText")).toHaveLength(0);
  });

  it("puts points where the video is, not where the canvas starts", () => {
    const { ctx, calls } = recorder();
    const line = buildAnnotation("line", [P(0, 0), P(1, 1)], meta)!;
    paintAnnotation(ctx, line, { x: 100, y: 50, w: 400, h: 300 }, size);
    expect(calls.find((c) => c[0] === "moveTo")).toEqual(["moveTo", 100, 50]);
    expect(calls.find((c) => c[0] === "lineTo")).toEqual(["lineTo", 500, 350]);
  });

  it("uses the drawing's own colour and restores the canvas afterwards", () => {
    const { ctx, calls } = recorder();
    paintAnnotation(
      ctx,
      buildAnnotation("line", [P(0, 0), P(1, 1)], { ...meta, color: "coral" })!,
      rect,
      size,
    );
    expect(ctx.strokeStyle).toBe("#fb7185");
    expect(calls[0][0]).toBe("save");
    expect(calls[calls.length - 1][0]).toBe("restore");
  });

  it("paints every drawing it is given, and does nothing with no room", () => {
    const { ctx, calls } = recorder();
    const list: Annotation[] = [
      buildAnnotation("line", [P(0, 0), P(1, 1)], meta)!,
      buildAnnotation("line", [P(0, 1), P(1, 0)], meta)!,
    ];
    paintAnnotations(ctx, list, rect, size);
    expect(calls.filter((c) => c[0] === "stroke")).toHaveLength(2);
    const empty = recorder();
    paintAnnotations(empty.ctx, list, { x: 0, y: 0, w: 0, h: 0 }, size);
    expect(empty.calls).toEqual([]);
  });

  it("never paints a non-finite coordinate", () => {
    const { ctx, calls } = recorder();
    const angle = buildAnnotation("angle", [P(0.5, 0.5), P(0.5, 0.5), P(0.5, 0.5)], meta)!;
    paintAnnotation(ctx, angle, rect, size);
    for (const c of calls)
      for (const v of c.slice(1)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
  });

  it("scales strokes and labels with the picture, with a floor for small screens", () => {
    expect(strokeWidthFor(120)).toBe(2);
    expect(strokeWidthFor(1920)).toBe(8);
    expect(labelSizeFor(100)).toBe(12);
    expect(labelSizeFor(1920)).toBeCloseTo(56.47, 1);
  });
});

describe("preview while drawing", () => {
  const m = { color: "sky" as const, time: 2 };

  it("shows a line from the first point to the pointer, for a line and for half an angle", () => {
    expect(previewAnnotation("line", [P(0.1, 0.1), P(0.4, 0.4)], m)).toMatchObject({
      kind: "line",
    });
    expect(previewAnnotation("angle", [P(0.1, 0.1), P(0.4, 0.4)], m)).toMatchObject({
      kind: "line",
    });
  });

  it("shows the angle once it has all three points", () => {
    expect(previewAnnotation("angle", [P(0.1, 0.1), P(0.4, 0.4), P(0.7, 0.1)], m)).toMatchObject({
      kind: "angle",
    });
  });

  it("shows a stroke as soon as the pen has moved, and nothing before", () => {
    expect(previewAnnotation("pen", [P(0.1, 0.1)], m)).toBeNull();
    expect(previewAnnotation("pen", [P(0.1, 0.1), P(0.2, 0.2)], m)).toMatchObject({ kind: "pen" });
    expect(previewAnnotation("line", [P(0.1, 0.1)], m)).toBeNull();
  });

  it("is never kept: a preview is not persistent", () => {
    expect(previewAnnotation("line", [P(0.1, 0.1), P(0.4, 0.4)], m)?.persist).toBe(false);
  });
});
