import { cpus } from "node:os";

import { defineConfig } from "vitest/config";

// Every game's tests live next to the code they test; add a pattern here when a
// new top-level area appears.
//
// The suite is capped at two fifths of the machine's cpus, and that is a
// measurement rather than a preference. Vitest's default is one worker per cpu,
// and this suite is the heaviest thing the machine runs: 85 files, many of which
// start a `node` process of their own — the runner CLI, the pinned Pi CLI, a
// stub model server — so 16 workers on 16 cpus oversubscribes the box before
// anything else on it is counted. The tests that then fail are the ones whose
// cost is a process or a cpu rather than logic: the abort in
// `packages/harness/src/pi-turn.test.ts` takes long enough to tear down a
// starved Pi child that the turn outlives the bound that says it was aborted,
// and a Pi seat that was still starting when the runner aborted it does not
// answer for that turn inside the runner's grace, which is what
// `packages/runner/src/model-seat.test.ts` holds. The chunks of
// `games/salient/bots/src/symmetry.test.ts` play 25 seeded matches each and were
// the other name on that list — 1.0–2.9 s on an idle machine and 5.5–11 s when
// starved — but they now carry a timeout of their own, so the cap is there for
// the process-spawning files, not for them. Measured on this
// 16-cpu box with an 8-cpu neighbour load running: 16 workers fail 7 of 1064
// tests, 6 workers pass all 1064 — and in about the same wall clock (89 s
// against 81 s), because workers that are not thrashing do not spend their time
// being scheduled. The cap is mitigation rather than a cure: on top of it, the
// process-spawning files carry budgets of their own measured on a starved box,
// and `pi-turn.test.ts` bounds the seconds an aborted turn may take to come back
// after measuring 24.5–25.1 s of teardown at load average ~24–35, against the
// 15 s it used to carry. With those budgets in place, re-measured at 1119 tests
// on 6 workers: six runs of the whole suite pass with 16 cpu hogs on the box
// (load average ~21–24); before that bound, 16 hogs failed three of seven runs
// in that one file. Past that — 32 cpu hogs, load ~38 — the same file still
// fails, and on an assertion rather than a budget: the aborted turn comes back
// only after the stub's held reply lands, which says a Pi starved that far
// settles an aborted turn when the provider request settles rather than when the
// abort lands. Nothing here changes what any test asserts; it changes how many
// of them are asking for a cpu at once.
const MAX_WORKERS = Math.max(2, Math.floor(cpus().length * 0.4));

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "games/salient/**/*.test.ts", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    maxWorkers: MAX_WORKERS,
  },
});
