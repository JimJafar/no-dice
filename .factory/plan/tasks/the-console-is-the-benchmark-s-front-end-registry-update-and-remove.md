---
id: the-console-is-the-benchmark-s-front-end-registry-update-and-remove
title: The provider registry can be edited and emptied
milestone: 11-seats-providers-and-starting-runs
depends_on: []
type: code
---

`packages/runner/src/providers.ts` reads the registry and adds to it. `addProvider` is the only
writer, and the Providers & models view has to edit and remove as well. The rules that belong
here rather than in the console on top of it are that an entry is a whole `providerEntrySchema`
entry, that the name it is filed under is its identity, and that a reader never sees half a file.

Add two exports beside `addProvider`:

- `updateProvider(name, entry, path = PROVIDERS_FILE)` — replaces the entry the registry holds
  under `name` with a schema-valid one and answers with the registry re-read from disk, as
  `addProvider` does.
- `removeProvider(name, path = PROVIDERS_FILE)` — deletes that entry and answers the same way.

**The name is the identity, not a field.** A seat is `<provider>/<model-id>` and `providerOf`
splits it on the first slash, so an update never changes the name the entry is filed under and a
rename is a remove followed by an add. The entry itself carries no name — that is why `addProvider`
takes one — so `updateProvider` takes the name as its own argument and the module header says in
one clause why an edit is not a rename.

**A name the registry does not hold is refused by both.** An update to a name that is not there is
a typo that would otherwise add an entry nobody meant to add, and a remove of a name that is not
there is the same typo. `addProvider` stays the only route to a new entry.

**The entry goes through `providerEntrySchema` before anything is written**, so an update cannot
smuggle a key value in any more than an add can, and cannot leave behind an entry the loader would
refuse. A refusal writes nothing: the file is byte-identical, as `addProvider`'s refusal is. The
write is the same temp-file-and-rename step, so `loadProviders` never reads a partial file.

**An empty registry is a valid file.** Removing the last entry leaves `{}`, which `parseProviders`
reads. The view has to be able to empty the registry, so that is not an error.

Removing an entry does not reach a match already played: the log header carries its own provider,
context window and rates, and the kept `series/` baselines are never rewritten. Say that in the
header, because the view will be asked whether removing a provider damages the results.

## Acceptance

- `updateProvider` replaces one entry in place and leaves every other entry as it was; it refuses
  a name the registry does not name, with the file byte-identical.
- `removeProvider` deletes one entry, and removing the last leaves `{}` that `loadProviders` still
  reads.
- Both validate through `providerEntrySchema` and write through the same atomic step `addProvider`
  uses, and the runner's provider tests cover both.

## Verification

```bash
pnpm test -- packages/runner/src/providers
tmp=$(mktemp -d)
cat > "$tmp/providers.json" <<'JSON'
{
  "one": {
    "baseUrl": "https://a.example/v1",
    "api": "openai-completions",
    "apiKeyEnv": "ONE_KEY",
    "reasoning": false,
    "contextWindow": 1000,
    "maxTokens": 100,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
  },
  "two": {
    "baseUrl": "https://b.example/v1",
    "api": "anthropic-messages",
    "apiKeyEnv": null,
    "reasoning": true,
    "contextWindow": 2000,
    "maxTokens": 200,
    "cost": { "input": 1, "output": 2, "cacheRead": 0, "cacheWrite": 0 }
  }
}
JSON
node --input-type=module -e '
const fs = await import("node:fs");
const { updateProvider, removeProvider } = await import("./packages/runner/src/providers.ts");
if (typeof updateProvider !== "function" || typeof removeProvider !== "function") {
  throw new Error("the registry has no update or remove");
}
const file = process.argv[1];
const entry = {
  baseUrl: "https://c.example/v1", api: "openai-completions", apiKeyEnv: null,
  reasoning: true, contextWindow: 2048, maxTokens: 256,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
};
const updated = updateProvider("one", entry, file);
if (updated.one.baseUrl !== entry.baseUrl || updated.two.baseUrl !== "https://b.example/v1") {
  throw new Error(JSON.stringify(updated));
}
for (const bad of [
  () => updateProvider("three", entry, file),
  () => updateProvider("one", { ...entry, apiKey: "a key value" }, file),
  () => updateProvider("one", { ...entry, contextWindow: 0 }, file),
  () => removeProvider("three", file),
]) {
  try { bad(); throw new Error("a bad write was accepted"); } catch { /* refused */ }
}
if (JSON.parse(fs.readFileSync(file, "utf8")).two.baseUrl !== "https://b.example/v1") {
  throw new Error("a refusal moved the file");
}
if (Object.keys(removeProvider("one", file)).sort().join() !== "two") throw new Error("update failed");
if (Object.keys(removeProvider("two", file)).length !== 0) throw new Error("the registry did not empty");
if (Object.keys((await import("./packages/runner/src/providers.ts")).loadProviders(file)).length !== 0) {
  throw new Error("an empty registry does not load");
}
' "$tmp/providers.json"
test -z "$(find "$tmp" -name 'providers.json.tmp-*')"
git diff --quiet providers.json
```
