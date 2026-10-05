---
id: the-no-dice-bin-runs-from-a-shell
title: "The `no-dice` bin runs from a shell"
milestone: 02-mcp-server-and-bots
depends_on: []
---
`packages/runner/package.json` now declares `bin: { "no-dice": "./src/cli.ts" }`, and `src/cli.ts` has a `#!/usr/bin/env node` shebang plus a main guard, so `runCli` is complete and tested. What does not work yet is starting it from a shell: the workspace imports each other without extensions (`./args`, `./match`, `./log`) and `packages/runner/src/match.ts` imports `@no-dice/salient-engine/package.json` without an import attribute, so a bare Node ESM loader (Node 24 here) fails with ERR_MODULE_NOT_FOUND before any code runs. Everything currently runs through vitest, which resolves those specifiers. Fixing it means either a build step that emits `dist/` and points the bin there, or repo-wide explicit `.ts`/`.json` specifiers plus `allowImportingTsExtensions` in `tsconfig.base.json` (the JSON import also needs `with { type: "json" }`). This was left out of match-cli-bots because both fixes touch every package. Note the limitation is documented in the header comment of `packages/runner/src/cli.ts`.

## Acceptance
- [ ] `node packages/runner/src/cli.ts match --game salient --a bot:greedy --b bot:random --seed 135 --out <path>` exits 0 and writes a log that validates against salient-log/1
- [ ] `no-dice match ...` from the workspace root (pnpm's bin shim) runs the same command
- [ ] `pnpm typecheck` and `pnpm test` still pass with the new import style or build step

## Verification
```bash
node packages/runner/src/cli.ts match --game salient --a bot:greedy --b bot:random --seed 135 --out /tmp/no-dice-bin/m.json
```
