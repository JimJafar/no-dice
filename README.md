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

## Running a series, and reporting one

```sh
pnpm exec no-dice series --game salient --a bot:greedy --b bot:random --max-pairs 2
pnpm exec no-dice stats --series series/greedy-vs-random
```

A series plays each seed twice, once with the two seats swapped, in batches of 5
pairs, and stops when the 99% Wilson interval for `--a`'s win rate excludes 50%
or `--max-pairs` (default 75) is reached. It prints one line per pair as it goes
and writes `series/<name>/matches/<seed>-<seat-map>.json` for every match,
`series.json` for its record and `report.md` for the report. Running the same
command again plays nothing whose log is already on disk. `--max-cost <usd>` and
`--max-tokens <n>` bound what a run may spend, `--concurrency <n>` how many pairs
are in flight at once (default 1), `--seed-base <n>` what the seed list is drawn
from, and `--name <name>` or `--dir <path>` where the series goes.
