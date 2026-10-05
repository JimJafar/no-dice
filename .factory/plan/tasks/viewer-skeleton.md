---
id: viewer-skeleton
title: The viewer loads a match log in a browser
milestone: 05-replay-viewer
depends_on: []
---

Create `games/salient/viewer` as `@no-dice/salient-viewer`: a static Vite app in plain
TypeScript, no framework. The two standalone files in `salient/docs/mockups/`
(`spectator-view.html`, `fog-of-war-view.html`) hold the exact CSS and markup for hexes,
arrows and symbols and are the starting point, which is why the viewer is DOM and CSS rather
than components. `pnpm-workspace.yaml` (`games/salient/*`), the root `tsconfig.json`
(`games/salient/**/*.ts`) and `vitest.config.ts` already cover a new package there, so only
the package itself is new: `package.json` (`"type": "module"`, `main`/`types`/`exports` at
`./src/main.ts`, scripts `dev`/`build`/`preview` = `vite`/`vite build`/`vite preview`,
dependency `@no-dice/log` `workspace:*`, devDependency `vite ^8.3.2` — 8.3.2 is already in
`pnpm-lock.yaml` through vitest, so nothing new is resolved), `index.html`, `src/main.ts`.

Typecheck wiring first, because the gate has to keep covering the app: the root
`tsconfig.json` compiles `games/salient/**/*.ts` under `tsconfig.base.json`, whose `lib` is
`["ES2023"]` with no DOM. Give the viewer its own `tsconfig.json` extending the base with
`lib: ["ES2023", "DOM", "DOM.Iterable"]` and `include: ["src"]`, exclude
`games/salient/viewer/**` from the root project so node packages keep no DOM globals, and
make the root `typecheck` script `tsc --noEmit && tsc --noEmit -p games/salient/viewer`. Add
a `viewer-build` gate to `.factory/project.yaml` running
`pnpm --filter @no-dice/salient-viewer build` — this task adds it, because a gate for a
package that does not exist yet fails every earlier task.

Loading: `src/load.ts` exports `parseLog(text: string): MatchLog` (`JSON.parse`, then
`matchLogSchema.parse` from `@no-dice/log`, with the zod issues turned into one readable
message) and `pickLogSource(search, files)` deciding between `?log=<url>`, a picked or
dropped `File`, and "no log yet". `index.html` and `src/main.ts` wire a file input, a
drag-and-drop target over the whole frame, and a `fetch` for `?log=`. A log that is not a
`salient-log/1` log says why on the page and renders nothing else. Nothing else renders yet.

Keep the "reads only the log" rule enforced from the start: a test that walks the viewer's
module graph the way `packages/log/src/log.test.ts` ("the log module stays browser-safe")
walks its own, and forbids `@no-dice/salient-engine`, any other `@no-dice/` package except
`@no-dice/log`, `node:*` and `require(`.

## Acceptance
- [ ] `pnpm --filter @no-dice/salient-viewer build` writes a `dist/`, and `pnpm typecheck`
      typechecks the viewer with DOM types while node packages still have no DOM globals
- [ ] The same `salient-log/1` file reaches the app by file picker, drag-and-drop and `?log=`
      and yields the same parsed log each way; a file that is not a log shows the reason
- [ ] The module-graph test reports no engine import, no `node:*` and no `require(` anywhere
      under `games/salient/viewer/src`, and every gate still passes

## Verification
```bash
pnpm install
pnpm --filter @no-dice/salient-viewer build
pnpm test -- viewer
pnpm typecheck
```
