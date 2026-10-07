---
id: management-ui-provider-registry-write
title: The provider registry can be added to and re-read
milestone: 08-ui-providers-and-leaderboard
depends_on: []
---

`packages/runner/src/providers.ts` owns `providers.json`, but it can only ever be read.
The console has to add an entry to it and then seat a run on that entry in the same
process, so the package grows the three things the milestone names — and nothing about how a
page asks for them.

- **The schema stops being module-private.** `costSchema`, `entrySchema` and `registrySchema`
  are exported as `providerCostSchema`, `providerEntrySchema` and `providerRegistrySchema`, and
  `parseProviders` keeps using them, so there is still exactly one list of fields. The entry
  schema stays `strict()`: that is what refuses an entry carrying `apiKey` or `key`, which is
  the "no key value anywhere" rule enforced at the write rather than hoped for.
- **`addProvider(name, entry, path = PROVIDERS_FILE)`** reads the current file with
  `loadProviders`, refuses a `name` that is not one path segment (empty, `.`, `..`, or
  containing `/` — a name with a slash breaks the `<provider>/<id>` split in `providerOf`),
  refuses a name the registry already has (a silent overwrite of the entry a run is seated on
  is a change of terms said out loud or not at all), validates the entry with
  `providerEntrySchema`, merges, and writes **atomically**: the new text goes to a
  `providers.json.tmp-*` in the same directory and `renameSync` moves it over the target — the
  same single-rename discipline `series.ts` and `match.ts` use for logs, because a registry cut
  in half by a crash seats the next match on nothing. Written as 2-space JSON with a trailing
  newline, so the file stays a `git diff` a person can read. Returns the registry as it now
  stands on disk, re-read through `loadProviders`, so what the caller is told is what the file
  says.
- **`reloadProviders(path = PROVIDERS_FILE)`** re-reads and replaces the module cache, and
  returns it. `providerRegistry()` keeps reading once per process otherwise: a series seats a
  match at a time, and a file edited mid-run must not put one pair's two matches on two
  different context windows. The reload is the one deliberate exception, and it is what lets a
  provider added through the page be seated on without restarting the console.

No caller of `seatModelsJson`, `providerEntry` or `loadProviders` changes behaviour: a
registry that does not name a provider is still left to Pi's own lookup.

## Acceptance
- [ ] `addProvider` leaves a schema-valid entry in the file it was given, with no temp file
      left beside it, and an entry carrying a key value (`apiKey`) is refused with the field
      named and the file byte-identical
- [ ] `providerEntrySchema` and `providerRegistrySchema` are exported and are what
      `parseProviders` parses with — one field list, not two
- [ ] After `reloadProviders(path)`, `providerEntry` and `seatModelsJson` in the same process
      answer for the new entry, and `providerRegistry()` still reads the file once per process
      when nothing asked for a reload

## Verification
```bash
pnpm test -- providers
node --input-type=module -e '
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const m = await import("./packages/runner/src/providers.ts");
const dir = mkdtempSync(join(tmpdir(), "nd-prov-"));
const file = join(dir, "providers.json");
writeFileSync(file, JSON.stringify({ marvin: { baseUrl: "https://marvin.example/v1", api: "openai-completions", apiKeyEnv: null, reasoning: true, contextWindow: 131072, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }, null, 2) + "\n", "utf8");
const entry = { baseUrl: "https://acme.example.com/v1", api: "openai-completions", apiKeyEnv: "ACME_API_KEY", reasoning: false, contextWindow: 200000, maxTokens: 4096, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
const saved = m.addProvider("acme", entry, file);
if (!saved.acme || saved.acme.baseUrl !== entry.baseUrl) throw new Error("the new entry did not come back");
if (readdirSync(dir).join() !== "providers.json") throw new Error("a temp file was left behind: " + readdirSync(dir).join());
if (!readFileSync(file, "utf8").includes("ACME_API_KEY")) throw new Error("the key variable name is not in the file");
const before = readFileSync(file, "utf8");
let refused = "";
try { m.addProvider("evil", { ...entry, apiKey: "sk-not-a-secret" }, file); } catch (error) { refused = String(error); }
if (refused === "") throw new Error("an entry carrying a key value was accepted");
if (readFileSync(file, "utf8") !== before) throw new Error("a refused write changed the file");
let twice = "";
try { m.addProvider("acme", entry, file); } catch (error) { twice = String(error); }
if (twice === "") throw new Error("an existing provider was overwritten silently");
m.reloadProviders(file);
if (!m.seatModelsJson("acme/m1")) throw new Error("the reloaded registry did not reach the seat");
'
git diff --exit-code providers.json
```
