# No Dice — Salient v0

## What this is

**No Dice** is a collection of games that measure LLMs: no luck in play, so a result says
something about the model. **Salient** is the first game — a two-player, deterministic,
turn-based territory game on a 91-hex board that models play through seven MCP tools.
It has to be watchable (a replay viewer) and a fair test (identical prompts, limits and
maps for both seats, every map played twice with seats swapped).

Users: Jim, who runs matches between models and publishes the results, and the agents
that build and extend the project. The authoritative documents are already in the repo:
`salient/docs/salient-build-brief.md` (architecture, schemas, tests, build order),
`salient/docs/salient-rules-v0.md` (the rules the engine implements),
`salient/docs/salient-mockups.md` (the viewer), and the throwaway prototype in
`salient/docs/reference/` plus five golden logs in `salient/docs/golden/`.

## Stack

TypeScript on Node 22+ (Node 24 is installed), pnpm workspaces (pnpm 9 installed), vitest
for tests, zod for schemas shared between server and runner, `@modelcontextprotocol/sdk`
with the Streamable HTTP transport for the MCP server, Vite for the static viewer.
Players run through the Pi coding agent (`@earendil-works/pi-coding-agent`) in RPC mode,
one session per seat per match.

Repository layout follows brief §5: `packages/{harness,runner,stats}` shared by future
games, `games/salient/{engine,server,bots,viewer,prompts,golden}`, `docs/` as-is.
Salient-specific code stays inside `games/salient`; no general game framework in v0.

## Done means (brief §1, unchanged)

1. `no-dice match --game salient --a <model> --b <model> --seed <n>` plays a full match
   through Pi and writes one JSON log.
2. `no-dice series --game salient --a <model> --b <model>` runs seat-swapped pairs until
   the result is clear or `--max-pairs`, resumes after a stop, and writes a series report.
3. The engine replays the five golden logs exactly, passes the symmetry test on 300 seeds,
   and passes the combat/invalid-order/supply/knockout vectors in brief §8.
4. The viewer loads a log and replays it; golden log 01 at turn 11 matches the spectator
   mock-up (scores 43 and 33, five cut-off hexes, the fight at F6).
5. Either seat can be a Random or Greedy bot instead of a model.

## Facts the builder needs

- The prototype in `salient/docs/reference/` is behaviour to port, not code to ship.
  `node salient/docs/reference/replay-check.js salient/docs/golden/*.json` passes today and
  is a gate: it pins the numbers the new engine must reproduce.
- The installed `pi` is **0.87.1, which has no MCP support**. `@earendil-works/pi-coding-agent`
  `1.0.2` is on the npm registry and was checked in this workspace, so milestone 03 pins it as
  a dependency of `packages/harness` and spawns `node <pkg>/dist/cli.js`, never `pi` from
  `PATH`. What
  1.0.2 confirmed: `pi mcp list --json` reads `mcp.json` from a relocated
  `PI_CODING_AGENT_DIR` and substitutes `${SALIENT_TOKEN}` from the child's environment; with
  `exposure: "direct"`, `--no-builtin-tools` and brief §6.3's `settings.json`, the tool list in
  the model request is exactly the seven `mcp__salient__*` names; `RpcClient` is exported from
  the package root and keeps stdin open (closing it shuts Pi down); and a `models.json`
  provider can point at a local OpenAI-compatible endpoint, so the harness is testable with no
  API key. Pi 1.0.2 emits `compaction_start` and `compaction_end` in the RPC event stream.
- The model milestone 03 measures against is Jim's **Marvin** server,
  `https://marvin.akita-betelgeuse.ts.net:8033/v1`, model `subagent`, **no API key** — an
  OpenAI-compatible llama-swap endpoint reachable from this box, listed as loaded, and verified
  to answer a tool call with `finish_reason: "tool_calls"`. It reports no context length, so the
  `contextWindow` in the seat's `models.json` is a decision rather than a lookup.
- Golden logs use an older, simpler shape (`orders` as `[from, to, troops]`, terrain under
  `t`); the shipped log format is `salient-log/1` in brief §7.
- The engine is built and keys hexes `"q,r"` (`generateMap`, `resolveTurn`, `validateOrders`,
  `score`, `visibleHexes`, `hexLabel`, `hexKey`, `rotateHalfTurn`). The tool surface and the
  log name hexes by label (`B6`), so the server does that translation at its edge.
- `@modelcontextprotocol/sdk` 1.32.0 is on the registry, with peer `zod ^3.25 || ^4.0`.
- The `salient-log/1` schema lives at the `@no-dice/runner/log` subpath and imports no
  `node:*` and no engine code, so the viewer and the stats package can use it too.
- The server reports absolute hex labels to both seats. A bot that ranks moves in board
  coordinates is seat-biased: identical bots in the prototype split 25% to 69% by seat from
  move ordering alone (rules, "Harness and fairness").

## Out of scope for v0 (brief §3)

Live streaming, video export, more than two players, leagues/ratings across many models, a
web UI for launching matches, own-orientation boards, a calibrated win-probability bar, and
any general-purpose game framework.

## Open dependencies on Jim (brief §11)

The model and provider for milestone 03's measured match are settled: Marvin's `subagent`, no
key. Still open from brief §11: the exact model IDs and providers for the milestone 06 series,
a cost ceiling for that series, the per-turn output-token budget (milestone 03 measures real
turns first, and on Marvin the money cost is zero, so the useful number is tokens per turn), and
the compaction decision. None of it blocks 01–05.
