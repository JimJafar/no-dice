---
id: pi-pin-version
title: The repo pins the Pi version a match runs on
milestone: 03-pi-harness
depends_on: []
---

The `pi` on `PATH` is 0.87.1, which has no MCP support at all, so nothing in this milestone
may shell out to it. Add `@earendil-works/pi-coding-agent` at exactly `1.0.2` (no caret) as a
dependency of `packages/harness` — a dependency, not a devDependency, because `PiPlayer`
imports `RpcClient` from it at run time — since brief §6.3 requires the version be pinned and
recorded in every log header. Add `packages/harness/src/pi-cli.ts` exporting `piCli()`, which
resolves the installed package's `dist/cli.js` to an absolute path and returns
`{ path, version }`. Every later task spawns `node <path> …`, never `pi`. Checked on this
machine against 1.0.2: `node dist/cli.js --version` prints `1.0.2`; `pi mcp list --json` with
an empty config directory prints `{"servers":[],"errors":[]}` and exits 0, while 0.87.1 has no
`mcp` command, so that command is what proves the right build is in play; `RpcClient` comes
from the package root (`dist/index.js`); and the package declares `engines.node >=22.19`, which
this box (node 24) satisfies even though the workspace says `>=22`.

## Acceptance
- [ ] `pnpm ls @earendil-works/pi-coding-agent` reports exactly 1.0.2 and the lockfile pins it
- [ ] `piCli()` returns the absolute path of the installed `dist/cli.js` and the version `1.0.2`
- [ ] A test fails if the resolved CLI reports a 0.x version or has no `mcp` command

## Verification
```bash
pnpm install && pnpm test -- pi-cli
```
