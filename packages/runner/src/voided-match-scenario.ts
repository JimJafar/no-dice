/**
 * A match that is voided, run as a program: the fixture behind the runner's test
 * that a voided Pi match ends, and ends *exits*.
 *
 * `runMatch` rejects when a seat's Pi process dies mid-match, and everything
 * the runner started has to be let go with it — above all the watcher that asks
 * the server whether a seat is in with its turn. A watcher left polling holds the
 * event loop open, and the person at the terminal reads the error and then waits
 * for a `no-dice` that never exits. That is a fact about a process rather than
 * about a promise, so this file is one: it plays the match, prints what came of
 * it, and the test is that the process finishes by itself.
 *
 * It is not a test, and vitest never collects it: the test starts it with `node`.
 */
import { readFileSync, readdirSync } from "node:fs";

import { StubModel, sleepsPastDeadline, stubModelsJson } from "@no-dice/harness";

import { runMatch } from "./match.ts";

const [out = "", matchDir = ""] = process.argv.slice(2);

/** The seat's Pi: this process's only child (Pi renames itself, so its arguments are gone). */
const piChild = (): number | null => {
  for (const entry of readdirSync("/proc").filter((e) => /^\d+$/.test(e))) {
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf-8");
      if (Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]) === process.pid) return Number(entry);
    } catch {
      // The process went away between the listing and the read.
    }
  }
  return null;
};

if (out === "" || matchDir === "") {
  console.error("usage: voided-match-scenario <out> <match-dir>");
  process.exitCode = 2;
} else {
  // The seat sits on its first turn; the Pi under it is killed, and the turn's
  // timeout finds it gone.
  const stub = await StubModel.start(sleepsPastDeadline(20_000));
  let seen = 0;
  const killer = setInterval(() => {
    const pid = piChild();
    // Seen for two seconds: started, and into its turn.
    if (pid !== null && ++seen > 4) {
      process.kill(pid, "SIGKILL");
      clearInterval(killer);
    }
  }, 500);
  try {
    await runMatch({
      out,
      seed: 135,
      turnTimeoutMs: 5_000,
      seats: {
        A: {
          kind: "pi",
          model: stub.modelRef,
          thinking: "off",
          modelsJson: stubModelsJson(stub.baseUrl),
          env: { PI_OFFLINE: "1" },
        },
        B: { kind: "bot", bot: "greedy" },
      },
      matchDir,
    });
    console.log("played: the match should have been voided");
    process.exitCode = 1;
  } catch (error) {
    console.log(`rejected: ${(error as Error).message}`);
    process.exitCode = 0;
  } finally {
    clearInterval(killer);
    await stub.stop();
  }
}
