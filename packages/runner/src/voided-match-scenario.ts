/**
 * A match that is voided, run as a program: the fixture behind the runner's test
 * that a voided Pi match ends, and ends *exits*.
 *
 * `runMatch` rejects when a seat calls a tool outside the seven, and everything
 * the runner started has to be let go with it — above all the watcher that asks
 * the server whether a seat is in with its turn. A watcher left polling holds the
 * event loop open, and the person at the terminal reads the error and then waits
 * for a `no-dice` that never exits. That is a fact about a process rather than
 * about a promise, so this file is one: it plays the match, prints what came of
 * it, and the test is that the process finishes by itself.
 *
 * It is not a test, and vitest never collects it: the test starts it with `node`.
 */
import { StubModel, callsToolOutsideTheSeven, stubModelsJson } from "@no-dice/harness";

import { runMatch } from "./match.ts";

const [out = "", matchDir = ""] = process.argv.slice(2);

if (out === "" || matchDir === "") {
  console.error("usage: voided-match-scenario <out> <match-dir>");
  process.exitCode = 2;
} else {
  const stub = await StubModel.start(callsToolOutsideTheSeven());
  try {
    await runMatch({
      out,
      seed: 135,
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
    await stub.stop();
  }
}
