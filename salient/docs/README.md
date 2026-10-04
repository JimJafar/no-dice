# Salient

Salient is a two-player, deterministic, turn-based territory game that LLMs play through MCP tools. It is meant to be watched, and to show which of two models is stronger at planning, prediction and tool use.

Salient is the first game in **No Dice**, the over-arching project: a competition for LLMs played through games with no luck in them. A salient is a bulge in a front line that can be cut off from behind, which is what this game's supply rule rewards.

**Status, 4 October 2026:** v0 is designed and the rules have been tested with a prototype and scripted bots. Nothing is built yet.

## Read in this order

1. [salient-build-brief.md](salient-build-brief.md): what to build, how the parts fit, how to run players through the Pi coding agent, tests and build order.
2. [salient-rules-v0.md](salient-rules-v0.md): the rules the engine must implement.
3. [salient-mockups.md](salient-mockups.md): the replay viewer mock-ups and what each element means.

## Everything in this folder

| Path | What it is |
| --- | --- |
| [salient-build-brief.md](salient-build-brief.md) | The brief for a software factory or coding agent |
| [salient-rules-v0.md](salient-rules-v0.md) | Ruleset v0 |
| [salient-mockups.md](salient-mockups.md) | Mock-ups with a guide to each element |
| `mockups/` | The two frames as PNG and as standalone HTML |
| `reference/` | Prototype engine and scripted bots in JavaScript, with a replay checker. Reference only; see [reference/README.md](reference/README.md) |
| `golden/` | Five match logs from the prototype. A new engine must replay them exactly |

## Decisions already made

| Decision | Choice |
| --- | --- |
| Turn model | Simultaneous: both players plan in private, the engine resolves together |
| Randomness | None in play. Seeded, symmetric maps only |
| Player interface | Seven MCP tools; no vision |
| Player harness | Pi coding agent 1.0 or later, one headless session per player per match |
| Context | One continuous conversation per match, so strategy can build and deep-context weaknesses show; a 2,000-character notes tool as well |
| Invalid orders | One resubmission per turn; after that, invalid orders are wasted |
| Fairness | Identical prompts and limits; every map played twice with seats swapped |
| Series length | Adaptive: stop early when the result is clear, play more when it is close |
| Scoring | Territory points, counted only for hexes connected to the Base |
| Knockout | Capturing the Base ends the match, recorded as 93 to 0 |
| Output | One JSON log per match; the viewer is a replay renderer over it |
| Workflow | Run many matches, then render the most exciting representative one |

## Where the living copies are

- The ruleset is also a Claude doc: [Salient: v0 ruleset](https://claude.ai/code/artifact/75ae51c1-4a1c-463e-bb43-608e16f04f7f). The file here matches its rules as of 4 October 2026.
- The mock-ups are also an editable design canvas: [Salient board mock-up](https://claude.ai/artifact/7tdTgiQn1gvozzkpBCUWs8).

Both links are private to Jim's Claude account.
