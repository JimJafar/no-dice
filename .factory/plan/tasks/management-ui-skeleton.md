---
id: management-ui-skeleton
title: The UI package serves a page and its own state on loopback
milestone: 07-ui-run-console
depends_on: []
---

Create `packages/ui` as `@no-dice/ui` — the console the `management-ui` epic is for. Two halves
in one package, no framework on either, the way the viewer did it: a bare-Node server under
`packages/ui/src` (Node 22+, file-named imports, no build step) and a Vite browser app under
`packages/ui/web`. `pnpm-workspace.yaml` (`packages/*`), the root `tsconfig.json`
(`packages/**/*.ts`) and `vitest.config.ts` (`packages/**/*.test.ts`) already cover a new package
there, so only the package itself is new.

**Its own bin, not a `no-dice ui` subcommand.** `runCli` lives in `@no-dice/runner`, and the UI
has to depend on the runner to start runs; a `ui` command inside `cli.ts` would make the runner
depend back on the UI, which is the kind of workspace cycle `pnpm-workspace.yaml`'s comment says
was removed once already. So `packages/ui/package.json` declares
`bin: { "no-dice-ui": "./src/server.ts" }` with a `#!/usr/bin/env node` shebang and a main guard
like `packages/runner/src/cli.ts` has, and the root `package.json` gains `@no-dice/ui` in
`devDependencies` (so `pnpm exec no-dice-ui` works from the repo root, as `no-dice` already does)
and a `"ui": "node packages/ui/src/server.ts"` script. Dependencies: `@no-dice/runner`,
`@no-dice/stats`, `@no-dice/log`, `zod`; devDependencies `vite ^8.3.2` and `happy-dom ^20.14.5`,
both already in `pnpm-lock.yaml` through vitest and the viewer, so nothing new is resolved.

`src/server.ts` exports `startServer(options): Promise<http.Server>` and runs it only when
executed, so a test can listen on port 0. Flags: `--port` (default 8765), `--series-root`
(default `series/`) and `--matches-root` (default `matches/`), both resolved against the process's
cwd, which is the repo root. **The host is not a flag**: it listens on `127.0.0.1`
and nothing else — one user, one machine, no auth, no HTTPS. First routes: `GET /api/state`
answering the seat options the form will need (`BOTS` from `@no-dice/runner/args` for
`bot:random`/`bot:greedy`, and the provider names from `providerRegistry()` in
`@no-dice/runner/providers` — names and their `apiKeyEnv` names only, never a key value), the two
roots, and `running: null`; and `GET /` serving `web/dist/index.html` when it has been built, or a
page saying to build it. Any static read has to refuse a path that resolves outside the directory
it serves.

Typecheck and gate wiring, in this task, because a gate for a package that does not exist yet
fails every earlier task: `packages/ui/tsconfig.json` extending `tsconfig.base.json` with
`include: ["src"]`; `packages/ui/web/tsconfig.json` extending the base with
`lib: ["ES2023", "DOM", "DOM.Iterable"]` exactly like `games/salient/viewer/tsconfig.json` (the
base has no DOM lib, so the web app needs its own project); the root `tsconfig.json` gaining
`packages/ui/web/**` to its `exclude` so node packages keep no DOM globals; the root `typecheck`
script becoming `tsc --noEmit && tsc --noEmit -p games/salient/viewer && tsc --noEmit -p packages/ui/web`;
and a `ui-build` gate added to `.factory/project.yaml` beside `viewer-build`, running
`pnpm --filter @no-dice/ui build` (the package's `build` script is `vite build web`, output
`web/dist`, which the existing unanchored `dist/` line in `.gitignore` already covers).

`web/index.html` and `web/src/main.ts` draw the frame — a start-a-run section, a progress section,
a results section, a providers section, a leaderboard section — all empty but for what
`/api/state` answers, and `web/src/api.ts` holds the `getJson`/`postJson` fetch helpers the later
tasks use.

## Acceptance
- [ ] `pnpm --filter @no-dice/ui build` writes `packages/ui/web/dist/`, and `pnpm typecheck`
      typechecks the web app with DOM types while the node packages still have no DOM globals
- [ ] `node packages/ui/src/server.ts --port <n>` answers `GET /api/state` on `127.0.0.1` with
      `bot:random`, `bot:greedy` and every provider name in `providers.json`, and the listening
      socket is bound to loopback only
- [ ] A request path that tries to escape the directory it serves (`/../`, an absolute path) is
      refused, and the four existing gates plus the new `ui-build` gate pass

## Verification
```bash
pnpm install
pnpm --filter @no-dice/ui build
pnpm typecheck
pnpm test -- ui
node packages/ui/src/server.ts --port 8795 --series-root /tmp/nd-ui/series &
pid=$!
sleep 1
curl -fsS http://127.0.0.1:8795/api/state | grep -q 'bot:greedy'
curl -fsS http://127.0.0.1:8795/api/state | grep -q 'marvin'
curl -s --path-as-is -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8795/../package.json' | grep -q '^4'
kill $pid
```
