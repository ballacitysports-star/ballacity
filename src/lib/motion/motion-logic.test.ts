import { describe, expect, it } from "vitest";
import {
  ANNOTATION_COLORS,
  COLOR_ORDER,
  buildAnnotation,
  clearFrame,
  newAnnotationId,
  pointsNeeded,
  undoLast,
  visibleAnnotations,
  type Annotation,
} from "./annotations";
import {
  COMMON_FPS,
  formatClock,
  frameIndexAt,
  frameNumber,
  lastFrameIndex,
  normalizeLoop,
  snapFps,
  stepTime,
  timeForFrame,
} from "./frames";
import {
  angleAtVertex,
  containRect,
  distance,
  fromNormalized,
  lineAngleFromHorizontal,
  toNormalized,
} from "./geometry";
import { kinogramCell, kinogramLayout, kinogramTimes } from "./kinogram";

describe("frame rates", () => {
  it("snaps measured rates to the ones cameras really use", () => {
    expect(snapFps(29.97)).toBe(30);
    expect(snapFps(59.94)).toBe(60);
    expect(snapFps(119.88)).toBe(120);
    expect(snapFps(239.76)).toBe(240);
    expect(snapFps(24.0)).toBe(24);
  });

  it("does not invent a rate for numbers between common ones or out of range", () => {
    expect(snapFps(75)).toBeNull();
    expect(snapFps(2)).toBeNull();
    expect(snapFps(1000)).toBeNull();
    expect(snapFps(NaN)).toBeNull();
    expect(snapFps(Infinity)).toBeNull();
  });

  it("picks the closer rate when two are in range", () => {
    expect(snapFps(49)).toBe(50);
    expect(COMMON_FPS).toContain(240);
  });
});

describe("frame stepping", () => {
  it("counts frames from zero and lands in the middle of one", () => {
    expect(frameIndexAt(0, 30)).toBe(0);
    expect(frameIndexAt(0.1, 30)).toBe(3); // float error must not drop this to frame 2
    expect(frameIndexAt(1, 30)).toBe(30);
    expect(timeForFrame(3, 30)).toBeCloseTo(3.5 / 30, 10);
    expect(frameIndexAt(timeForFrame(3, 30), 30)).toBe(3);
  });

  it("round-trips every frame of a long high-speed clip", () => {
    for (const fps of [24, 30, 60, 120, 240]) {
      for (let i = 0; i < 2000; i += 37) {
        expect(frameIndexAt(timeForFrame(i, fps), fps)).toBe(i);
      }
    }
  });

  it("steps exactly one frame, forward and back", () => {
    let t = timeForFrame(10, 60);
    t = stepTime(t, 1, 60, 5);
    expect(frameIndexAt(t, 60)).toBe(11);
    t = stepTime(t, -1, 60, 5);
    expect(frameIndexAt(t, 60)).toBe(10);
    expect(frameIndexAt(stepTime(t, 10, 60, 5), 60)).toBe(20);
  });

  it("stops at the first and last frame", () => {
    expect(frameIndexAt(stepTime(0.01, -5, 30, 2), 30)).toBe(0);
    const last = lastFrameIndex(2, 30);
    expect(last).toBe(59);
    expect(frameIndexAt(stepTime(1.9, 99, 30, 2), 30)).toBe(59);
    expect(stepTime(0, 0, 30, 0)).toBeCloseTo(0.5 / 30, 10);
  });

  it("works at 240 fps where a frame is about 4 ms", () => {
    const t = stepTime(timeForFrame(100, 240), 1, 240, 10);
    expect(frameIndexAt(t, 240)).toBe(101);
    expect(t - timeForFrame(100, 240)).toBeCloseTo(1 / 240, 10);
  });

  it("ignores fractional steps and bad input", () => {
    expect(frameIndexAt(stepTime(timeForFrame(5, 30), 1.9, 30, 5), 30)).toBe(6);
    expect(frameIndexAt(-3, 30)).toBe(0);
    expect(frameIndexAt(NaN, 30)).toBe(0);
    expect(lastFrameIndex(NaN, 30)).toBe(0);
  });

  it("formats the readout", () => {
    expect(formatClock(0)).toBe("0:00.00");
    expect(formatClock(3.456)).toBe("0:03.46");
    expect(formatClock(75.5)).toBe("1:15.50");
    expect(formatClock(-1)).toBe("0:00.00");
    expect(frameNumber(timeForFrame(0, 30), 30)).toBe(1);
    expect(frameNumber(timeForFrame(41, 30), 30)).toBe(42);
  });
});

describe("loop range", () => {
  it("orders the ends and keeps them inside the clip", () => {
    expect(normalizeLoop(2, 1, 10, 30)).toEqual({ start: 1, end: 2 });
    expect(normalizeLoop(-1, 20, 10, 30)).toEqual({ start: 0, end: 10 });
  });

  it("needs two ends and at least one frame between them", () => {
    expect(normalizeLoop(null, 2, 10, 30)).toBeNull();
    expect(normalizeLoop(1, 1, 10, 30)).toBeNull();
    expect(normalizeLoop(1, 1 + 0.5 / 30, 10, 30)).toBeNull();
    expect(normalizeLoop(1, 1 + 1.2 / 30, 10, 30)).not.toBeNull();
    expect(normalizeLoop(1, 2, 0, 30)).toBeNull();
  });
});

describe("geometry", () => {
  const hd = { w: 1920, h: 1080 };

  it("fits a video inside a box without stretching it", () => {
    const square = containRect({ w: 1000, h: 1000 }, hd);
    expect(square.x).toBeCloseTo(0, 6);
    expect(square.y).toBeCloseTo(218.75, 6);
    expect(square.w).toBeCloseTo(1000, 6);
    expect(square.h).toBeCloseTo(562.5, 6);
    const portrait = containRect({ w: 400, h: 800 }, { w: 1080, h: 1920 });
    expect(portrait.w / portrait.h).toBeCloseTo(1080 / 1920, 10);
    expect(containRect({ w: 0, h: 0 }, hd)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(containRect({ w: 300, h: 200 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0, w: 300, h: 200 });
  });

  it("converts between screen and video positions and back", () => {
    const rect = containRect({ w: 800, h: 600 }, hd);
    const p = { x: 0.25, y: 0.75 };
    const back = toNormalized(fromNormalized(p, rect), rect);
    expect(back.x).toBeCloseTo(p.x, 10);
    expect(back.y).toBeCloseTo(p.y, 10);
  });

  it("keeps a tap on the black bars inside the picture", () => {
    const rect = containRect({ w: 800, h: 800 }, hd);
    expect(toNormalized({ x: 400, y: 5 }, rect)).toEqual({ x: 0.5, y: 0 });
    expect(toNormalized({ x: -50, y: 900 }, rect)).toEqual({ x: 0, y: 1 });
    expect(toNormalized({ x: 1, y: 1 }, { x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("measures a right angle as 90 whatever shape the video is", () => {
    // Points are 0..1 of the frame; on a 16:9 frame equal fractions are not equal pixels.
    const a = { x: 0.5, y: 0.2 };
    const v = { x: 0.5, y: 0.5 };
    const wide = { x: 0.5 + 0.3 * (1080 / 1920), y: 0.5 }; // same pixel length as 0.3 of the height
    expect(angleAtVertex(a, v, wide, hd)).toBeCloseTo(90, 6);
    // On a square frame the same fractions are also 90.
    expect(
      angleAtVertex({ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }, { w: 500, h: 500 }),
    ).toBeCloseTo(90, 6);
  });

  it("measures straight, folded and degenerate angles", () => {
    const sq = { w: 100, h: 100 };
    expect(
      angleAtVertex({ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }, sq),
    ).toBeCloseTo(180, 6);
    expect(
      angleAtVertex({ x: 0.8, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, sq),
    ).toBeCloseTo(0, 6);
    expect(angleAtVertex({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 }, sq)).toBe(0);
    expect(
      angleAtVertex({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.2 }, sq),
    ).toBeCloseTo(90, 6);
  });

  it("reads a line's tilt the way it looks on screen", () => {
    const sq = { w: 100, h: 100 };
    expect(lineAngleFromHorizontal({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, sq)).toBeCloseTo(0, 6);
    expect(lineAngleFromHorizontal({ x: 0.1, y: 0.9 }, { x: 0.9, y: 0.1 }, sq)).toBeCloseTo(45, 6); // rises right
    expect(lineAngleFromHorizontal({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }, sq)).toBeCloseTo(-45, 6); // falls right
    expect(lineAngleFromHorizontal({ x: 0.9, y: 0.9 }, { x: 0.1, y: 0.1 }, sq)).toBeCloseTo(-45, 6); // same line, drawn the other way
    expect(lineAngleFromHorizontal({ x: 0.9, y: 0.1 }, { x: 0.1, y: 0.9 }, sq)).toBeCloseTo(45, 6); // top-right to bottom-left still rises to the right
    expect(lineAngleFromHorizontal({ x: 0.5, y: 0.9 }, { x: 0.5, y: 0.1 }, sq)).toBeCloseTo(90, 6);
    expect(lineAngleFromHorizontal({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, sq)).toBe(0);
  });

  it("measures distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("drawings", () => {
  const meta = { color: "lime" as const, time: 1, persist: false };
  const A = { x: 0.1, y: 0.1 };
  const B = { x: 0.5, y: 0.5 };
  const C = { x: 0.9, y: 0.1 };

  it("needs the right number of points for each tool", () => {
    expect(pointsNeeded("line")).toBe(2);
    expect(pointsNeeded("angle")).toBe(3);
    expect(buildAnnotation("line", [A], meta)).toBeNull();
    expect(buildAnnotation("angle", [A, B], meta)).toBeNull();
    expect(buildAnnotation("pen", [A, B], meta)).toBeNull();
    expect(buildAnnotation("line", [A, B], meta)?.kind).toBe("line");
    expect(buildAnnotation("angle", [A, B, C], meta)?.kind).toBe("angle");
    expect(buildAnnotation("pen", [A, B, C], meta)?.kind).toBe("pen");
  });

  it("gives each drawing its own id", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newAnnotationId()));
    expect(ids.size).toBe(100);
  });

  it("shows a drawing only on its own frame, and persistent ones everywhere", () => {
    const here = buildAnnotation("line", [A, B], { ...meta, time: timeForFrame(10, 30) })!;
    const grid = buildAnnotation("line", [A, C], {
      ...meta,
      time: timeForFrame(0, 30),
      persist: true,
    })!;
    const list: Annotation[] = [here, grid];
    const at = (frame: number) =>
      visibleAnnotations(list, timeForFrame(frame, 30), 30).map((a) => a.id);
    expect(at(10)).toEqual([here.id, grid.id]);
    expect(at(9)).toEqual([grid.id]);
    expect(at(11)).toEqual([grid.id]);
    expect(at(500)).toEqual([grid.id]);
  });

  it("undoes the last drawing and clears one frame without touching the rest", () => {
    const f1 = buildAnnotation("line", [A, B], { ...meta, time: timeForFrame(1, 30) })!;
    const f2 = buildAnnotation("line", [A, C], { ...meta, time: timeForFrame(2, 30) })!;
    const keep = buildAnnotation("line", [B, C], {
      ...meta,
      time: timeForFrame(2, 30),
      persist: true,
    })!;
    expect(undoLast([f1, f2])).toEqual([f1]);
    expect(undoLast([])).toEqual([]);
    expect(clearFrame([f1, f2, keep], timeForFrame(2, 30), 30)).toEqual([f1, keep]);
  });

  it("offers colors that all exist", () => {
    for (const c of COLOR_ORDER) expect(ANNOTATION_COLORS[c]).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("kinogram", () => {
  it("spreads moments evenly from the first to the last, each on its own frame", () => {
    const times = kinogramTimes(1, 2, 5, 30, 10);
    expect(times).toHaveLength(5);
    expect(frameIndexAt(times[0], 30)).toBe(30);
    expect(frameIndexAt(times[4], 30)).toBe(60);
    const idx = times.map((t) => frameIndexAt(t, 30));
    expect(new Set(idx).size).toBe(5);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it("copes with a range shorter than the number of stills", () => {
    const times = kinogramTimes(1, 1.05, 8, 30, 10);
    expect(times).toHaveLength(8);
    expect(times.every((t) => t >= 0 && t <= 10)).toBe(true);
  });

  it("stays inside the clip and handles one still", () => {
    expect(kinogramTimes(-5, 50, 4, 30, 2).every((t) => t >= 0 && t <= 2)).toBe(true);
    expect(kinogramTimes(3, 4, 1, 30, 10)).toHaveLength(1);
    expect(kinogramTimes(0, 1, 0, 30, 10)).toHaveLength(1);
  });

  it("lays stills out in a grid that fits them all", () => {
    const hd = { w: 1920, h: 1080 };
    for (const n of [4, 6, 8, 10]) {
      const l = kinogramLayout(n, hd);
      expect(l.cols * l.rows).toBeGreaterThanOrEqual(n);
      expect(l.cols * l.rows - n).toBeLessThan(l.cols); // no row is left empty
      expect(l.rows).toBeLessThanOrEqual(2);
      expect(l.cellH).toBe(Math.round(l.cellW * (1080 / 1920)));
      const last = kinogramCell(l, n - 1);
      expect(last.x + l.cellW).toBeLessThanOrEqual(l.width);
      expect(last.y + l.cellH).toBeLessThanOrEqual(l.height);
    }
    expect(kinogramLayout(4, hd)).toMatchObject({ cols: 2, rows: 2 });
    expect(kinogramLayout(6, hd)).toMatchObject({ cols: 3, rows: 2 });
    expect(kinogramLayout(8, hd)).toMatchObject({ cols: 4, rows: 2 });
    expect(kinogramLayout(10, hd)).toMatchObject({ cols: 5, rows: 2 });
    expect(kinogramLayout(1, hd)).toMatchObject({ cols: 1, rows: 1 });
  });

  it("never lets two cells overlap", () => {
    const l = kinogramLayout(10, { w: 1080, h: 1920 });
    const cells = Array.from({ length: 10 }, (_, i) => kinogramCell(l, i));
    for (let i = 0; i < cells.length; i += 1) {
      for (let j = i + 1; j < cells.length; j += 1) {
        const apart =
          cells[i].x + l.cellW <= cells[j].x ||
          cells[j].x + l.cellW <= cells[i].x ||
          cells[i].y + l.cellH <= cells[j].y ||
          cells[j].y + l.cellH <= cells[i].y;
        expect(apart).toBe(true);
      }
    }
  });

  it("falls back to a sensible shape when the video size is unknown", () => {
    expect(kinogramLayout(4, { w: 0, h: 0 }).cellH).toBe(Math.round(480 * (9 / 16)));
  });
});
