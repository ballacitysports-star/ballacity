import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * P3-5: white text on --destructive is 4.0:1, under WCAG AA's 4.5:1 (axe: color-contrast, found on
 * the Parent Center's "Delete …'s profile" button). Solid red behind white or destructive-foreground
 * text uses `bg-destructive-strong` (4.8:1). Red text keeps --destructive, which reads 5.1:1 on black.
 * Same pattern as coral-strong (coral-contrast.test.ts).
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

const SOLID_DESTRUCTIVE = /(?<![\w:/-])bg-destructive(?![\w/-])/;
const LIGHT_TEXT = /(?<![\w:-])text-(white|destructive-foreground)(?![\w/-])/;

describe("white text on destructive red (P3-5)", () => {
  it("uses bg-destructive-strong, never plain bg-destructive, behind light text", () => {
    const offenders: string[] = [];
    for (const f of files("src")) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
        const cls = m[0];
        if (LIGHT_TEXT.test(cls) && SOLID_DESTRUCTIVE.test(cls)) {
          offenders.push(`${f}: ${cls.slice(0, 120)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("defines destructive-strong and exposes it to Tailwind", () => {
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toContain("--color-destructive-strong: var(--destructive-strong);");
    expect(css).toMatch(/--destructive-strong: oklch\(0\.57 0\.24 25\);/);
  });
});

/* ---- Computed contrast (WP 4.3) ----------------------------------------------------------------
 * The ratios above were measured once with axe. These recompute them from the tokens in styles.css
 * (OKLCH -> sRGB -> WCAG relative luminance), so a palette change that drops a pair under 4.5:1
 * fails here rather than in the next audit.
 */

type Rgb = [number, number, number];

function oklchToSrgb(L: number, C: number, h: number): Rgb {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `bg`, as Tailwind's `bg-x/10` or `opacity-50` paints it. */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;
}

/** Tokens for one theme: the dark :root palette, or html.light layered over it. */
function theme(which: "dark" | "light"): (name: string) => Rgb {
  const css = readFileSync("src/styles.css", "utf8");
  const block = (selector: RegExp) => css.match(selector)?.[1] ?? "";
  const tokens = new Map<string, Rgb>();
  const read = (src: string) => {
    for (const m of src.matchAll(/--([\w-]+):\s*oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/g)) {
      tokens.set(m[1], oklchToSrgb(Number(m[2]), Number(m[3]), Number(m[4])));
    }
  };
  read(block(/\n:root \{([^}]*)\}/));
  if (which === "light") read(block(/\nhtml\.light \{([^}]*)\}/));
  return (name) => {
    const t = tokens.get(name);
    if (!t) throw new Error(`--${name} not found in the ${which} theme`);
    return t;
  };
}

const AA = 4.5;

describe.each(["dark", "light"] as const)("computed contrast, %s theme (WP 4.3)", (which) => {
  const t = theme(which);

  it("white text on destructive-strong passes AA (the Delete game button)", () => {
    expect(contrast(t("destructive-foreground"), t("destructive-strong"))).toBeGreaterThanOrEqual(
      AA,
    );
  });

  it("muted text on the card and the page passes AA at full opacity (distance-slider labels)", () => {
    expect(contrast(t("muted-foreground"), t("card"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(t("muted-foreground"), t("background"))).toBeGreaterThanOrEqual(AA);
  });
});

describe("why those two controls changed (WP 4.3)", () => {
  const t = theme("dark");

  it("coral text on a 10% coral tint over the card was under AA (the old Delete game style)", () => {
    const tint = over(t("coral"), t("card"), 0.1);
    expect(contrast(t("coral"), tint)).toBeLessThan(AA);
  });

  it("muted text faded to 50% (the old disabled distance slider) was far under AA", () => {
    const faded = over(t("muted-foreground"), t("card"), 0.5);
    expect(contrast(faded, t("card"))).toBeLessThan(3);
  });
});

describe("the Delete game button (WP 4.3)", () => {
  it("is solid destructive-strong with light text, not coral text on a coral tint", () => {
    const src = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
    const at = src.indexOf("> Delete game");
    expect(at).toBeGreaterThan(-1);
    const button = src.slice(src.lastIndexOf("<button", at), at);
    const cls = button.match(/^\s*className="([^"]*)"/m)?.[1] ?? "";
    expect(cls).toMatch(/(?<![\w:/-])bg-destructive-strong(?![\w/-])/);
    expect(cls).toMatch(/(?<![\w:-])text-destructive-foreground(?![\w/-])/);
    expect(cls).not.toMatch(/text-coral|bg-coral\//);
  });
});

describe("the distance slider (WP 4.3)", () => {
  it("never fades its text: only the track gets opacity when disabled", () => {
    const src = readFileSync("src/components/DistanceSlider.tsx", "utf8");
    const wrapper = src.match(/return \(\s*<div className=\{([^}]*)\}/)?.[1] ?? "";
    expect(wrapper).not.toBe("");
    expect(wrapper).not.toMatch(/opacity/);
  });
});
