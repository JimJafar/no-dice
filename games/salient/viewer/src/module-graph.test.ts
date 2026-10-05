/**
 * The rule the replay viewer is built on: it reads the log and nothing else. No
 * engine, no other workspace package, no platform built-ins, no CommonJS
 * import — a viewer that reached the engine would be recomputing a match
 * instead of replaying one, which is the thing the milestone exists to prevent.
 *
 * It walks the viewer's modules the way `packages/log/src/log.test.ts` walks
 * the log module's, and then checks every file under `src` rather than only the
 * ones the entry happens to reach, so a module cannot be added outside the walk.
 */
import { describe, expect, it } from "vitest";

/** Every TypeScript file under `src`, as text, keyed relative to this file. */
const sources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** The app's entry, which `index.html` loads. */
const ENTRY = "./main.ts";

/** Resolve a relative import to the glob key of the file it names. */
function resolveModule(from: string, specifier: string): string {
  const parts = from.replace(/^\.\//, "").split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `./${parts.join("/")}`;
}

/** A module this file names, whether it names it with `from` or on its own. */
const SPECIFIER = /(?:from|import)\s+"([^"]+)"/g;

/** Every module the app reaches, following its relative imports from `entry`. */
function moduleGraph(entry: string, seen = new Set<string>()): string[] {
  const source = sources[entry];
  if (source === undefined) throw new Error(`${entry} is not under src`);
  if (seen.has(entry)) return [];
  seen.add(entry);
  for (const match of source.matchAll(SPECIFIER)) {
    if (match[1].startsWith(".")) moduleGraph(resolveModule(entry, match[1]), seen);
  }
  return [...seen];
}

/** The packages a file names, as opposed to the files next to it. */
function packageSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((match) => match[1]).filter((name) => !name.startsWith("."));
}

describe("the viewer reads only the log", () => {
  it("walks every module under src but the walker itself", () => {
    // A glob that matched nothing would make the checks below pass by accident.
    // Vite leaves the importing module out of its own glob, so this file is the
    // one module under src that cannot be seen from inside it; every other one
    // is here, whether the entry reaches it or not.
    expect(sources[ENTRY], `${ENTRY} is missing from the glob`).toBeTruthy();
    expect(sources["./load.ts"], `./load.ts is missing from the glob`).toBeTruthy();
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(3);
  });

  it("names no package but the log from inside its own module graph", () => {
    const graph = moduleGraph(ENTRY);
    expect(graph).toContain(ENTRY);
    expect(graph).toContain("./load.ts");

    for (const file of graph) {
      for (const specifier of packageSpecifiers(sources[file])) {
        expect(specifier, `${file} imports ${specifier}`).toBe("@no-dice/log");
      }
    }
  });

  it("holds no engine import, no other workspace package, no platform module and no CommonJS import anywhere under src", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, `${file} reaches the engine or another workspace package`).not.toMatch(/@no-dice\/(?!log\b)/);
      expect(source, `${file} reaches a platform module`).not.toMatch(/["']node:/);
      expect(source, `${file} uses a CommonJS import`).not.toMatch(/require\(/);
    }
  });
});
