import { cpus } from "node:os";

import { defineConfig } from "vitest/config";

// Every game's tests live next to the code they test; add a pattern here when a
// new top-level area appears.
//
// The suite is capped at two fifths of the machine's cpus, and that is a
// measurement rather than a preference. Vitest's default is one worker per cpu,
// and this suite is the heaviest thing the machine runs: 80 files, many of which
// start a `node` process of their own — the runner CLI, the pinned Pi CLI, a
// stub model server — so 16 workers on 16 cpus oversubscribes the box before
// anything else on it is counted. The tests that then fail are the ones whose
// cost is cpu rather than logic: the chunks of
// `games/salient/bots/src/symmetry.test.ts` play 25 seeded matches each and take
// 1.0–2.9 s on an idle machine and 5.5–11 s when starved, so they cross vitest's
// 5 s default timeout; and the abort in `packages/harness/src/pi-turn.test.ts`
// takes long enough to tear down a starved Pi child that the turn outlives the
// bound that says it was aborted. Measured on this 16-cpu box with an 8-cpu
// neighbour load running: 16 workers fail 7 of 1064 tests, 6 workers pass all
// 1064 — and in about the same wall clock (89 s against 81 s), because workers
// that are not thrashing do not spend their time being scheduled. Nothing here
// changes what any test asserts; it changes how many of them are asking for a cpu
// at once.
const MAX_WORKERS = Math.max(2, Math.floor(cpus().length * 0.4));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "games/salient/**/*.test.ts", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    maxWorkers: MAX_WORKERS,
  },
});
