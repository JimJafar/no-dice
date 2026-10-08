---
id: the-console-is-the-benchmark-s-front-end-pi-model-catalog
title: The harness can ask Pi which of its own models have a key
milestone: 11-seats-providers-and-starting-runs
depends_on: []
type: code
---

A seat on a provider the console registered needs a `models.json` entry, because Pi has never heard
of that provider. A seat on a provider Pi knows natively needs nothing but the key in the
environment — `--a deepseek/deepseek-flash` has always worked at the terminal. The view cannot list
those models without asking Pi, and asking Pi wrongly lists the operator's own models as well.

Add `packages/harness/src/pi-models.ts` exporting `listPiModels(options?: { env?: Record<string,
string> }): Promise<PiModel[]>`, re-exported from `src/index.ts` beside `checkPiAuth`.

**It runs the pinned build's own answer.** `node <piCli().path> --list-models`, through `piCli()` —
the same door `pi auth check` and a seat's `--models-json` go through, so the list is the pinned Pi's
list and not some Pi on the path.

**It always points `PI_CODING_AGENT_DIR` at a fresh empty directory** made with `mkdtempSync` and
removed in a `finally`, exactly as `askWithModelsJson` does, and it never takes a directory from the
caller. That is the whole point of the call and worth the measurement: on this repo's pinned build,
pointing the variable at a directory holding a `models.json` makes `--list-models` list that
file's models too — a directory with one entry named `ghost` answers a row for `evil/ghost` — and no
seat could ever play that model, because `createSeatHome` relocates the same variable to an empty
directory for every seat. The empty directory is what makes the answer be the models a seat can
reach.

**`options.env` is the environment the child gets, defaulting to `process.env`.** It replaces rather
than merges, which differs deliberately from `checkPiAuth`: the question here is *which keys are
set*, and a test that wants an environment with nothing in it has to be able to say so. The console
passes nothing and inherits its own, which is the honest environment — the seats it starts get
exactly that one, which is why `scripts/console-daemon.sh` pulls the key variables in before it
execs the server.

**The table is parsed, not guessed.** Measured on the pinned build, the call takes about 0.7 s and
answers:

```text
provider  model            context  max-out  thinking  images
deepseek  deepseek-flash   1M       384K     yes       yes
deepseek  deepseek-v4-pro  1M       384K     yes       no
```

The columns are padded and joined by two spaces, so each row splits on a run of two or more spaces.
`No models available. Use /login …` means the answer is an empty list. A first line that is neither
that header nor that sentence is a Pi that changed its output: throw with the line rather than
answering an empty list, which would tell the operator that no key is set when the truth is that the
question could not be read. There is no JSON mode for `--list-models`.

Each row answers `{ provider, id, reference, context, maxOut, thinking, images }`, where `reference`
is `<provider>/<id>` — the string a seat is seated with — and the last four are what Pi printed, kept
as strings. Pi's `1M` and `384K` are rounded figures for a person to read; a seat needs no numbers
for them, because Pi knows that model's real window natively, and inventing a number here would be a
figure the console then has to defend. A 30 s timeout like `askWithModelsJson`, and a non-zero exit
is an error carrying stderr.

## Acceptance

- With `DEEPSEEK_API_KEY` set to any value the list contains `deepseek/deepseek-flash` and
  `deepseek/deepseek-v4-pro`; with an environment holding no key at all it is empty.
- The call always points `PI_CODING_AGENT_DIR` at a fresh empty directory and removes it afterwards,
  and a test shows that a directory holding a `models.json` would list a model no seat can reach.
- `listPiModels` is exported from `@no-dice/harness`, and a table whose first line is neither the
  header nor the empty sentence is an error rather than an empty list.

## Verification

```bash
pnpm test -- packages/harness/src/pi-models
node --input-type=module -e '
const { listPiModels } = await import("./packages/harness/src/pi-models.ts");
const withKey = await listPiModels({ env: { DEEPSEEK_API_KEY: "dummy" } });
const seen = withKey.map((m) => m.reference).sort().join(" ");
if (!seen.includes("deepseek/deepseek-flash") || !seen.includes("deepseek/deepseek-v4-pro")) {
  throw new Error(seen || "the list is empty with a key set");
}
if (!withKey.some((m) => m.context && m.maxOut)) throw new Error(JSON.stringify(withKey));
const none = await listPiModels({ env: {} });
if (none.length !== 0) throw new Error(JSON.stringify(none));
console.log(seen);
'
node --input-type=module -e '
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const { piCli } = await import("./packages/harness/src/pi-cli.ts");
const home = fs.mkdtempSync("/tmp/pi-catalog-");
fs.writeFileSync(
  `${home}/models.json`,
  JSON.stringify({ providers: { evil: { baseUrl: "https://x.invalid/v1", api: "openai-completions",
    apiKey: "none", models: [{ id: "ghost", name: "ghost", input: ["text"], contextWindow: 1000,
    maxTokens: 100, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }),
);
const out = execFileSync(process.execPath, [piCli().path, "--list-models"], {
  env: { PI_CODING_AGENT_DIR: home }, encoding: "utf8",
});
if (!out.includes("ghost")) throw new Error(`a non-empty directory did not leak:\n${out}`);
'
```
