/**
 * No workspace package depends back on another in a loop.
 *
 * `pnpm-workspace.yaml` records the cycle pnpm used to warn about — `bots` →
 * `server` → `runner` → `harness` → `bots` — and says it went with the
 * `server` → `runner` edge, once `@no-dice/log` existed as a package of its own:
 * the server answers with the log shapes of `@no-dice/log` and stats reads them
 * from the same place, so neither of them has to reach back into the runner.
 * That is a sentence in a YAML comment, and the shape that puts the edge back is
 * a plausible one — a series runner calling stats for its stopping test while
 * stats reads the logs the runner writes — so this walks the graph instead of
 * trusting the comment.
 *
 * The graph is built from the two globs `pnpm-workspace.yaml` lists, and from the
 * three dependency fields of each package it finds, so a new package or a new
 * edge is in the graph the moment it is in a `package.json`. A cycle is reported
 * as the cycle itself, and the graph that was walked is printed underneath it.
 *
 * The root `package.json` is in neither side of the graph: its devDependencies
 * are the workspace root reaching into the packages, not a package reaching at a
 * package, and a node there would let a root-only dependency read as
 * a package edge.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The three places a package can name another package. */
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "peerDependencies"];

/** The scope every workspace package is published under. */
const SCOPE = "@no-dice/";

/** The workspace globs, read from `pnpm-workspace.yaml`'s `packages:` list. */
function workspaceGlobs() {
  const lines = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((line) => line.trim() === "packages:");
  if (start === -1) throw new Error("pnpm-workspace.yaml has no packages: list");
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const entry = /^\s+-\s+"?([^"\s]+)"?$/.exec(line);
    if (entry === null) break; // the list has ended; the next line is another key
    globs.push(entry[1]);
  }
  return globs;
}

/** The files under the repo root a workspace glob names; `*` matches one segment. */
function expand(glob) {
  const walk = (dir, rest) => {
    if (rest.length === 0) return [dir];
    const [head, ...tail] = rest;
    if (head === "*") {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => walk(join(dir, entry.name), tail));
    }
    const next = join(dir, head);
    return existsSync(next) ? walk(next, tail) : [];
  };
  return walk(ROOT, glob.split("/"));
}

/** The `@no-dice/*` packages a manifest depends on. */
const workspaceDepsOf = (manifest) =>
  DEPENDENCY_FIELDS.flatMap((field) => Object.keys(manifest[field] ?? {})).filter((name) =>
    name.startsWith(SCOPE),
  );

/**
 * The graph: every package both globs name, and an edge for every `@no-dice/*`
 * dependency it declares. A dependency no package satisfies is kept as a name
 * with no edges of its own, so it still shows in the failure.
 */
function readGraph() {
  // The workspace globs name directories, so the manifest is looked for inside
  // each: a directory with no `package.json` — `games/salient/golden`, the five
  // golden logs — is not a package and drops out.
  const manifests = workspaceGlobs().flatMap((glob) => expand(`${glob}/package.json`));
  const graph = new Map();
  for (const path of manifests) {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    if (typeof manifest.name !== "string") {
      throw new Error(`${path.slice(ROOT.length)} has no name, so it is not a workspace package`);
    }
    graph.set(manifest.name, { path: path.slice(ROOT.length), edges: workspaceDepsOf(manifest) });
  }
  return { manifests: manifests.map((path) => path.slice(ROOT.length)), graph };
}

/** The cycle a depth-first walk finds, as the names that close the loop. */
function findCycle(graph) {
  const done = new Set();
  const stack = [];
  const onStack = new Set();
  const walk = (name) => {
    if (onStack.has(name)) return [...stack.slice(stack.indexOf(name)), name];
    if (done.has(name)) return null;
    stack.push(name);
    onStack.add(name);
    for (const dep of graph.get(name)?.edges ?? []) {
      const cycle = walk(dep);
      if (cycle !== null) return cycle;
    }
    stack.pop();
    onStack.delete(name);
    done.add(name);
    return null;
  };
  for (const name of [...graph.keys()].sort()) {
    const cycle = walk(name);
    if (cycle !== null) return cycle;
  }
  return null;
}

/** The graph as lines, so a failure shows what was walked. */
const renderGraph = (graph) =>
  [...graph.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, pkg]) =>
        `  ${name} (${pkg.path}) → ${pkg.edges.length === 0 ? "nothing" : pkg.edges.join(", ")}`,
    )
    .join("\n");

const { manifests, graph } = readGraph();

/** The edges of one package, as the graph has them. */
const edgesOf = (name) => graph.get(name)?.edges ?? [];

const allEdges = [...graph.values()].flatMap((pkg) => pkg.edges);

describe("the workspace dependency graph", () => {
  it("is the packages the two workspace globs name, and no others", () => {
    // A glob list read as empty, a glob that matched nothing, and an empty graph
    // with no cycles in it would each let this test pass by checking nothing.
    expect(workspaceGlobs(), "pnpm-workspace.yaml lists no workspace globs").not.toHaveLength(0);
    expect(manifests, "no package.json matched the workspace globs").not.toHaveLength(0);
    expect(allEdges, `the graph has no @no-dice/* edge at all:\n${renderGraph(graph)}`).not.toHaveLength(0);
    // The two globs spelled out, so a manifest from anywhere else — the root's,
    // or `salient/package.json`, which only marks the prototype as CommonJS — is
    // a failure rather than a node in the graph.
    for (const path of manifests) {
      expect(path, `${path} is outside the workspace globs`).toMatch(
        /^(packages|games\/salient)\/[^/]+\/package\.json$/,
      );
    }
  });

  it("leaves the root package.json out of the graph", () => {
    const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    // The root does reach into the packages, which is why it is excluded: those
    // devDependencies are a root install, not a package depending on a package.
    expect(workspaceDepsOf(root).length).toBeGreaterThan(0);
    expect(graph.has(root.name), `the root ${root.name} is a node in the graph`).toBe(false);
    expect(manifests).not.toContain("package.json");
  });

  it("keeps the edge the old cycle went with out of the graph", () => {
    // pnpm-workspace.yaml: the `bots` → `server` → `runner` → `harness` → `bots`
    // cycle went with `server` → `runner`, once `@no-dice/log` took the log
    // shapes out of the runner.
    expect(edgesOf("@no-dice/salient-server")).not.toContain("@no-dice/runner");
    // And the shape that would put it back: the series runner does reach stats,
    // and stats reads the logs the runner writes.
    expect(edgesOf("@no-dice/runner")).toContain("@no-dice/stats");
    expect(edgesOf("@no-dice/stats")).toContain("@no-dice/log");
  });

  it("has no cycle among the @no-dice/* edges", () => {
    const cycle = findCycle(graph);
    if (cycle !== null) {
      // Thrown rather than asserted, so the failure message is the cycle itself
      // and the graph it was walked over, with no diff underneath it.
      throw new Error(
        `the workspace has a dependency cycle:\n  ${cycle.join(" → ")}` +
          `\n\nthe graph it walked:\n${renderGraph(graph)}`,
      );
    }
  });
});
