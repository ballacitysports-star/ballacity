import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A component declared inside another component's body is a brand-new
 * component type on every render, so React unmounts and remounts everything
 * under it each time the parent renders: local state resets and focus is lost.
 *
 * The trainers page did this with its whole list (`<TrainersView />`): every
 * filter change remounted the filter bar, which closed the filter sheet the
 * moment a venue was picked. This finds the pattern — a PascalCase function
 * declared inside another function and used as a JSX tag in the same file.
 *
 * The files listed below already did it before this check existed and have not
 * been audited yet (some may be harmless: no state, no inputs). The list may
 * only shrink: fix one and remove it here.
 */
const NOT_YET_AUDITED = new Set([
  "src/components/child/ChildTryoutsSection.tsx: Row",
  "src/components/games/GameDayActionSheet.tsx: Step",
  "src/components/superadmin/OpsTab.tsx: Row",
  "src/routes/games.$gameId.index.tsx: LiveSpots",
  "src/routes/teams.$teamId.events.tsx: Card",
]);

const ROOT = join(__dirname, "..", "..", "..");

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) tsxFiles(path, out);
    else if (path.endsWith(".tsx") && !path.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

function isFunctionLike(node: ts.Node): boolean {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** "file: Name" for each nested PascalCase function that the file renders as a JSX tag. */
function nestedComponents(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node, depth: number) => {
    let name: string | null = null;
    if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      name = node.name.text;
    }
    if (name && depth > 0 && /^[A-Z]/.test(name) && new RegExp(`<${name}[\\s/>]`).test(text)) {
      found.push(`${relative(ROOT, file).split("\\").join("/")}: ${name}`);
    }
    ts.forEachChild(node, (child) => visit(child, isFunctionLike(node) ? depth + 1 : depth));
  };
  visit(source, 0);
  return found;
}

describe("components declared inside other components", () => {
  const found = tsxFiles(join(ROOT, "src")).flatMap(nestedComponents);

  it("finds the pattern it is looking for", () => {
    // Guards the scanner itself: an always-empty result would pass vacuously.
    expect(found.length).toBeGreaterThan(0);
  });

  it("are not added anywhere new", () => {
    expect(found.filter((f) => !NOT_YET_AUDITED.has(f))).toEqual([]);
  });

  it("keeps the not-yet-audited list honest", () => {
    expect([...NOT_YET_AUDITED].filter((f) => !found.includes(f))).toEqual([]);
  });

  it("no longer remounts the trainers list on every render", () => {
    expect(found.some((f) => f.startsWith("src/routes/_tabs.trainers.tsx"))).toBe(false);
  });
});
