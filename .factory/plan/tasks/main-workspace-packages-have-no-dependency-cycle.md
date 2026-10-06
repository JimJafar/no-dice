---
id: main-workspace-packages-have-no-dependency-cycle
title: No workspace package depends back on another in a loop
milestone: 06-first-real-series
depends_on: []
---

`pnpm-workspace.yaml` carries a comment about the cycle it used to have — `bots → server → runner
→ harness → bots` — and says the `log` package and the removal of the `server → runner` edge is
what fixed it. Nothing checks that it stays fixed. The series runner has to call stats for
its stopping test while stats reads logs, which is exactly the shape that put the edge back,
and the only thing between that and a repeat is a sentence in a YAML comment.

Add `scripts/workspace-graph.test.mjs` (vitest already picks up `scripts/**/*.test.mjs`) that:

- reads every workspace package's `package.json` — the globs `packages/*/package.json` and
  `games/salient/*/package.json`, the two entries in `pnpm-workspace.yaml` — and no others, the
  root `package.json` included in neither side of the graph, since its devDependencies are
  the workspace root reaching in, not a package reaching at a package;
- takes each package's `dependencies`, `devDependencies` and `peerDependencies` and keeps the
  `@no-dice/*` ones as edges;
- asserts the graph is not empty (so a broken glob cannot make the test pass by finding nothing),
  and that it has no cycle: a depth-first walk over the edges reporting the cycle it found as the
  failure message, `bots → server → runner → harness → bots` for instance, so a regression names
  itself;
- prints the graph it checked in the failure path too, so the next reader can see what was walked.

Follow the style of the other `scripts/*.test.mjs`: `node:fs` reads, `describe`/`it`, and a header
comment saying why the check exists and where the old cycle is written down.

The graph as it stands is acyclic — `runner` reaches `harness`, `log`, `salient-bots`,
`salient-engine`, `salient-server` and `stats`; `stats` and `salient-server` reach `log` and
`salient-engine`; `salient-viewer` reaches `log` alone — so this test passes when written. That is
the point: it is a fence, not a bug report. If it does *not* pass, stop and report the cycle rather
than editing a package.json to make it green; a real cycle is a design decision for Jim.

## Acceptance
- [ ] `scripts/workspace-graph.test.mjs` walks both workspace globs and reads every package's
      dependency fields, failing if it finds no packages or no edges at all
- [ ] It fails with the cycle spelled out if any `@no-dice/*` edge closes a loop, and
      passes on the graph as it stands
- [ ] The root `package.json` is not treated as a package in the graph

## Verification
```bash
pnpm test -- workspace-graph
```
