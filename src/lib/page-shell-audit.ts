/**
 * Finds page containers that are still hand-rolled instead of using a shell.
 *
 * The app is mid-migration onto the `page-shell*` scale. This exists so that
 * migration has a net: a test can assert the set of files still hand-rolling a
 * container only ever shrinks, which both stops new ad-hoc containers being
 * added and gives the remaining work a number.
 *
 * Kept as a pure function over file contents so it can run in a unit test with
 * no filesystem assumptions beyond the caller's.
 */

/** A container written out by hand rather than via a page shell. */
export type AdHocContainer = {
  file: string;
  classes: string;
  /** The max-w utilities found, in source order. */
  widths: string[];
  /** True when every width is unconditional — same column on a phone and a monitor. */
  fixed: boolean;
  /** True when the container sets no horizontal padding of its own. */
  unpadded: boolean;
};

const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const WIDTH_TOKEN = /(?:[a-z0-9]+:)?max-w-[a-z0-9-]+/g;
// Any utility that sets horizontal padding, at any breakpoint: p-, px-, pl-, pr-.
const PADDING_X = /(?:^|\s)(?:[a-z0-9]+:)?p[xlr]?-\d/;

/**
 * A container counts as hand-rolled when it centres itself with `mx-auto` and
 * caps its own width. Using a `page-shell*` utility is the migrated form, so
 * those are not reported even though they also centre and cap.
 */
export function findAdHocContainers(file: string, source: string): AdHocContainer[] {
  const found: AdHocContainer[] = [];
  for (const match of source.matchAll(CLASS_ATTR)) {
    const classes = match[1] ?? match[2] ?? "";
    if (/\bpage-shell(-[a-z]+)?\b/.test(classes)) continue;
    if (!classes.includes("mx-auto")) continue;
    const widths = classes.match(WIDTH_TOKEN) ?? [];
    if (widths.length === 0) continue;
    found.push({
      file,
      classes,
      widths,
      fixed: widths.every((w) => !w.includes(":")),
      unpadded: !PADDING_X.test(classes),
    });
  }
  return found;
}

/** Files still carrying at least one hand-rolled container. */
export function filesWithAdHocContainers(sources: Record<string, string>): string[] {
  return Object.entries(sources)
    .filter(([file, source]) => findAdHocContainers(file, source).length > 0)
    .map(([file]) => file)
    .sort();
}
