---
id: scaffold-workspace
title: The repo builds, typechecks and runs tests
milestone: 01-engine
depends_on: []
---

Create the pnpm workspace the brief describes in §5 so every later task has somewhere to
live and the project has real gates. Root `package.json` (private, `"type": "module"`,
workspaces `packages/*` and `games/salient/*`), a root `tsconfig.base.json` with
`strict: true`, a root vitest config that picks up `games/salient/**/*.test.ts`, and the
`games/salient/engine` package (`@no-dice/salient-engine`, no runtime dependencies yet,
zod only if a later task needs it). Add root scripts `typecheck` (`tsc -b` or
`tsc --noEmit` over the workspace) and `test` (`vitest run`), plus one placeholder test in
the engine package so both scripts have something to do. Add `.gitignore` for
`node_modules`, `dist` and `series/`. Do not create the other packages yet, and do not
touch `salient/docs/`. Once this lands, uncomment the `typecheck` and `tests` gates in
`.factory/project.yaml`.

## Acceptance
- [ ] `pnpm install` succeeds from the repo root with no workspace errors
- [ ] `pnpm typecheck` exits 0 on TypeScript with `strict: true`
- [ ] `pnpm test` runs the placeholder test and exits 0

## Verification
```bash
pnpm install && pnpm typecheck && pnpm test
```
