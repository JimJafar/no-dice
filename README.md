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
`--max-tokens <n>` bound what a run may spend, `--concurrency <n>` how many matches
are played at once (default 1, so a pair's two matches play one after the other), `--seed-base <n>` what the seed list is drawn
from, and `--name <name>` or `--dir <path>` where the series goes.

`stats` prints the win-rate report and rewrites `report.md`. `evidence` counts the
numbers `salient/docs/salient-rules-v0.md` leaves open — lead changes, largest
single-turn swing, hex flips per turn band, captures of neutral hexes, Node hand
changes and ping-pong, and how much each seat re-scouts — over the same
`series.json` and the same counted matches, and writes them to
`series/<name>/evidence.md`. That file is inside the gitignored series directory,
so the copy that survives the run is `reports/series/<name>-evidence.md`, kept
verbatim beside the kept `reports/series/<name>.md` copy of `report.md`; §7 of
[`docs/series-notes.md`](docs/series-notes.md) gives both copy steps, and
`reports/series/greedy-vs-random-evidence.md` is a kept copy of a finished
five-pair bot series. Without that copy the counters are computed into a
directory that is deleted with the workspace.

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

The management console (`packages/ui`) reads that file too, and is how an
operator adds an entry from the page instead of by hand: `GET /api/providers`
lists every entry with its endpoint and its key variable's *name* (never a
value), `POST /api/providers` adds one through the same schema the file is read
back with, and
`POST /api/providers/check` asks Pi what it would say about seating a model
before anyone tries. The console writes the file its `--providers <file>` flag
names, which defaults to this one, and re-reads it at startup and after every
entry it adds — so the runs a console starts seat on the registry it writes, and
an entry typed at the page is seatable by the next run without a restart. It
refuses to write while a run of its own is in flight, because a series seats each
match as that match starts: an entry added halfway through a series would seat
its later matches on different windows and rates while its record said one game.

The console is the `no-dice-ui` bin, and the Providers section of its page lists
that same file — every entry with its endpoint, its api, the *name* of the
variable its key is read from, whether it streams reasoning, its context
window, its output cap and its four rates — and adds entries to it. No key
value is ever in that file, or on that page: the form asks for a variable's
name, and the page never learns what is in it.
