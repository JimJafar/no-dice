---
id: log-package
title: The log format has a package of its own
milestone: 04-series-runner-and-stats
depends_on: []
---

Move `salient-log/1` out of the runner into `packages/log` as `@no-dice/log`, and change every
import to it. This is the first task of the milestone because the rest of it needs the
dependency to be honest: the series runner (in `@no-dice/runner`) has to call the stats
package for its stopping test, and the stats package reads logs — with the schema still at
`@no-dice/runner/log` that is a second package-level cycle. `pnpm-workspace.yaml` already
documents the first one (`runner` plays matches through `@no-dice/salient-server`, which
answers with `@no-dice/runner/log`) and says the fix is exactly this: "giving `salient-log/1`
a package of its own, which is also what a stats package that reads logs without the runner
would want." What `pnpm install` warns about today is the cycle `bots → server → runner →
harness → bots`; the `server → runner` edge is the one that closes it, and it goes when the
server imports `@no-dice/log` instead. Update that comment to say the cycle is gone rather
than tolerated.

Move `packages/runner/src/log.ts` to `packages/log/src/log.ts` and its test file with it,
add `packages/log/package.json` (`name: "@no-dice/log"`, `"type": "module"`, `main`/`types`
and `exports` pointing at `./src/log.ts`, dependency `zod ^4.1.11`) and
`packages/log/tsconfig.json` copied from `packages/runner/tsconfig.json`. The workspace globs
(`packages/*` in `pnpm-workspace.yaml`, `packages/**/*.ts` in the root `tsconfig.json` and in
`vitest.config.ts`) already cover a new package, so nothing there changes; run `pnpm install`
so the new workspace link exists. Then drop `"./log"` from `packages/runner/package.json`
`exports` and repoint the 18 import sites — `games/salient/server/src/{server,session,view,
simulate,labels,limits,http}.ts` and their four test files, plus `packages/runner/src/`
itself; `packages/harness/src/player.ts` only names the old path in comments. The
browser-safety test in `log.test.ts` (the one that walks the module graph and forbids
`node:*`, `require(` and any `@no-dice/` import) moves with the file and must keep passing
from its new location — it is what makes the package usable from the viewer.

## Acceptance
- [ ] `@no-dice/log` exports the schemas and `cellsFor`, and no `.ts` file under `packages/`
      or `games/` imports `@no-dice/runner/log` any more
- [ ] The browser-safety test passes from `packages/log`, and `pnpm install` reports no
      cyclic workspace dependency
- [ ] Every gate still passes with no test lost or skipped

## Verification
```bash
test -z "$(grep -rn '@no-dice/runner/log' packages games --include='*.ts')"
pnpm install 2>&1 | grep -i cyclic && exit 1 || true
pnpm test -- log
pnpm typecheck
```
