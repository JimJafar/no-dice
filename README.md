# no-dice
A collection of games for evaluating LLMs

## Running a match

```sh
pnpm install
pnpm exec no-dice match --game salient --a bot:greedy --b bot:random --seed 135 --out matches/135-greedy-random.json
```

The root package depends on `@no-dice/runner` so that pnpm puts its `no-dice` bin
in `node_modules/.bin`. There is no build step: the sources run under bare Node
(22.18 or later, which strips the types), so
`node packages/runner/src/cli.ts match ...` is the same command. Every import in
the workspace names its file (`./match.ts`, a `package.json` read with
`with { type: "json" }`), which is what a bare Node ESM loader needs and what
`allowImportingTsExtensions` in `tsconfig.base.json` lets TypeScript accept.
