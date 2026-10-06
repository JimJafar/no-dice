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
pnpm exec no-dice evidence --series series/greedy-vs-random
pnpm exec no-dice showcase --series series/greedy-vs-random
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

`stats` prints the win-rate report and rewrites `report.md`. `evidence` counts the
numbers `salient/docs/salient-rules-v0.md` leaves open — lead changes, largest
single-turn swing, hex flips per turn band, captures of neutral hexes, Node hand
changes and ping-pong, and how much each seat re-scouts — over the same
`series.json` and the same counted matches, and writes them to
`series/<name>/evidence.md`.

`showcase` picks the one match of a finished series worth rendering, and writes
`series/<name>/showcase.json`: the path of the match log, its excitement score and
the three figures it is made of, and the one-line series result — `X` versus its
opponent, the win rate with its 95% interval, the pairs played and the stop reason
— the viewer's header shows beside it. The winner is the side whose interval
excludes 50%, and its match is the most exciting of the wins whose margin falls
between the quartiles of that winner's own margins; a series whose interval covers
50% has no winner and ranks every counted match instead. Either exception is said
in the file. Nothing in the choice reads a clock, so running it twice over an
unchanged series writes the same bytes.

## The providers a model seat can be seated on

A model seat names a provider (`--a marvin/subagent`), and the provider has to be
known to the seat. Pi knows a handful natively and takes their credentials from
the environment; anything else has to be named in a `models.json` written into
that seat's own Pi home, or the run stops at the credential check before a turn
is played. The committed `providers.json` at the repo root is that list, read by
`match`, by `series` and by `scripts/measure-match.mjs` alike:

```json
{
  "marvin": {
    "baseUrl": "https://marvin.akita-betelgeuse.ts.net:8033/v1",
    "api": "openai-completions",
    "apiKeyEnv": null,
    "reasoning": true,
    "contextWindow": 131072,
    "maxTokens": 8192,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  }
}
```

**No key is ever in this file.** `apiKeyEnv` names the environment variable a key
is read from, and the seat's `models.json` interpolates it as `${NAME}` from the
seat's own environment; `null` means the endpoint checks no key, which becomes
Pi's documented `"apiKey": "none"`. `contextWindow`, `maxTokens` and the four
token rates are committed because an OpenAI-compatible endpoint advertises none
of them: they are decisions, they are what the log header, `--max-cost` and the
cost column are read against, and a rerun under different ones is a different
match. A provider the file does not list is left to Pi's built-in lookup, exactly
as before. `packages/runner/src/providers.ts` says what each field decides.
