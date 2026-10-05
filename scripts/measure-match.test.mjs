import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/runner/log";
import { runMatch } from "@no-dice/runner/match";

// The stub model lives in a workspace package the root does not depend on, so it
// is reached by path: this test is of a script that lives outside the workspace
// graph, and it is the harness's own stub that makes a 25-turn Pi match cheap.
import {
  StubModel,
  callsToolThenSubmits,
  stubModelsJson,
} from "../packages/harness/src/stub-model.ts";

import { modelsJsonFor, parseArgs, renderReport, PROVIDERS } from "./measure-match.mjs";

/**
 * `scripts/measure-match.mjs` is an operator script, so its one run against a
 * real provider is not something a test can repeat. What a test can prove is the
 * two things the report is for: that the command line reaches the runner as the
 * operator meant it to, and that the table it prints is the log's own numbers —
 * one row per turn, the totals underneath, the cache columns present.
 *
 * The log below comes from a stub-seeded match on the runner's default config:
 * 25 turns, the same shape a Marvin match writes, at the stub's cost.
 */

/** The command line the milestone's verification runs. */
const VERIFICATION = ["--model", "marvin/subagent", "--seed", "135", "--out", "reports/pi-cost.md"];

/** A row of the per-turn table: a turn number in the first cell. */
const TURN_ROW = /^\|\s*[0-9]+\s*\|/;

const dir = mkdtempSync(join(tmpdir(), "no-dice-measure-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stub = await StubModel.start(callsToolThenSubmits("get_state"), { contextWindow: 65_536 });
afterAll(() => stub.stop());

const { log } = await runMatch({
  out: join(dir, "match.json"),
  seed: 135,
  seats: {
    A: {
      kind: "pi",
      model: stub.modelRef,
      thinking: "off",
      modelsJson: stubModelsJson(stub.baseUrl, { contextWindow: 65_536 }),
      env: { PI_OFFLINE: "1" },
    },
    B: { kind: "bot", bot: "greedy" },
  },
  matchDir: join(dir, "match"),
});

const report = renderReport({
  log: matchLogSchema.parse(JSON.parse(readFileSync(join(dir, "match.json"), "utf8"))),
  logPath: join(dir, "match.json"),
  reportPath: join(dir, "pi-cost.md"),
  matchDir: join(dir, "match"),
  model: "marvin/subagent",
  thinking: "medium",
  provider: PROVIDERS.marvin,
  runWallMs: 12_345,
  guards: { maxTokens: 10_000_000, maxCost: 0, perTurnOutput: null },
});
const lines = report.split("\n");

describe("the operator's command line", () => {
  it("takes the model, the seed and the report path", () => {
    const parsed = parseArgs(VERIFICATION);
    expect(parsed.error).toBeUndefined();
    expect(parsed.command).toMatchObject({
      model: "marvin/subagent",
      seed: 135,
      out: "reports/pi-cost.md",
      thinking: "medium",
    });
  });

  it("refuses a model whose provider it has no entry for, rather than guessing an endpoint", () => {
    expect(parseArgs(["--model", "openrouter/deepseek-v4-pro", "--seed", "135"]).error).toContain(
      'provider "openrouter"',
    );
  });

  it("refuses a command line it could not play", () => {
    expect(parseArgs(["--model", "marvin/subagent", "--seed", "13.5"]).error).toContain("--seed");
    expect(parseArgs(["--model", "marvin/subagent", "--seed", "135", "--thinking", "sometimes"]).error).toContain(
      "--thinking",
    );
    expect(parseArgs(["--model", "marvin/subagent"]).error).toContain("--seed is required");
    expect(parseArgs(["--model", "marvin/subagent", "--seed", "135", "--max-cost", "free"]).error).toContain(
      "--max-cost",
    );
  });

  it("writes the seat's models.json with no key, zero rates and the decided window", () => {
    const entry = modelsJsonFor("marvin/subagent").providers.marvin;
    expect(entry.apiKey).toBe("none");
    expect(entry.models[0]).toMatchObject({
      id: "subagent",
      contextWindow: 131_072,
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });
});

describe("the report", () => {
  const rows = lines.filter((line) => TURN_ROW.test(line));

  it("prints one row per turn of the match", () => {
    expect(rows).toHaveLength(log.config.turns);
    expect(rows.map((line) => Number(line.split("|")[1].trim()))).toEqual(
      log.turns.map((turn) => turn.n),
    );
  });

  it("names every column the milestone asks for", () => {
    const header = lines.find((line) => line.startsWith("| Turn |"));
    for (const column of [
      "input",
      "output",
      "cache_read",
      "cache_write",
      "cost_usd",
      "context",
      "wall_s",
      "tool calls",
    ]) {
      expect(header).toContain(column);
    }
  });

  it("puts the totals under the table, and they are the log's own numbers", () => {
    const totals = lines.find((line) => line.startsWith("| **Total** |"));
    expect(totals).toBeDefined();
    const cells = totals
      .split("|")
      .slice(2, -1)
      .map((cell) => Number(cell.replace(/\*/g, "").trim()));
    const played = log.turns.map((turn) => turn.players.A);
    const sum = (pick) => played.reduce((total, record) => total + pick(record), 0);
    expect(cells[0]).toBe(sum((record) => record.usage.input));
    expect(cells[1]).toBe(sum((record) => record.usage.output));
    expect(cells[2]).toBe(sum((record) => record.usage.cache_read));
    expect(cells[3]).toBe(sum((record) => record.usage.cache_write));
    expect(cells[4]).toBeCloseTo(sum((record) => record.cost_usd), 6);
    expect(cells[7]).toBeCloseTo(sum((record) => record.wall_ms) / 1000, 1);
    expect(cells[8]).toBe(sum((record) => record.tool_calls.length));
  });

  it("says out loud that this provider's cost is zero, and why", () => {
    expect(report).toContain("`cost_usd` is 0 in every turn and in the totals");
    expect(report).toContain("Jim's own llama-swap server");
  });

  it("records the context window as the decision it is, and answers the checklist", () => {
    // The window the report prints is the one the log's header carries, which is
    // the stub entry's here and Marvin's 131,072 in a real run.
    expect(report).toContain("contextWindow: 65,536 tokens — a decision, not a lookup");
    expect(report).toContain("**Cache reads (`tokens.cacheRead`):**");
    expect(report).toContain("**The tool lock-down, as the session recorded it:**");
    expect(report).toContain("Exactly the seven");
    expect(report).toContain("**Context growth:**");
  });
});
