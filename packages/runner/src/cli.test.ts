/**
 * The `no-dice match` command line, run for real.
 *
 * What these tests pin down is what a person at a terminal gets:
 *
 * - a match between two bots played from the flags brief §1 names, its log on
 *   disk validating against `salient-log/1`, and the run printing where the log
 *   is and how the match ended;
 * - the default log path — `matches/<seed>-<a>-<b>.json` under the current
 *   directory, with the directory made on the way;
 * - every way a command line can be wrong (an unknown flag, a flag with no
 *   value, a seed that is not a whole number, a game v0 does not have, a seat
 *   that names no bot) reported as one line naming the problem, with a non-zero
 *   exit and no log left behind;
 * - a seat given a model refused with the reason — the Pi harness of milestone
 *   03 — rather than crashing on it.
 *
 * Seed 135 is the map the other suites use.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runCli } from "./cli";
import type { CliIo } from "./cli";
import { matchLogSchema } from "./log";
import type { MatchLog } from "./log";

/** Where the logs land, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-cli-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** What one run returned: its exit code, and the lines it printed. */
interface Run {
  code: number;
  out: string[];
  err: string[];
}

/** Run one command line, with its output captured instead of printed. */
const run = async (argv: readonly string[], cwd?: string): Promise<Run> => {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (line): void => void out.push(line),
    stderr: (line): void => void err.push(line),
    ...(cwd === undefined ? {} : { cwd }),
  };
  return { code: await runCli(argv, io), out, err };
};

/** The flags that ask for a Greedy-versus-Random match on seed 135. */
const MATCH = ["match", "--game", "salient", "--a", "bot:greedy", "--b", "bot:random", "--seed", "135"];

/**
 * The one line a run prints for a log: its result type, its winner, and the
 * score it ended on. Built from the log rather than spelled out again, so what
 * the run says is checked against what was actually played.
 */
const resultLine = (log: Pick<MatchLog, "result">): RegExp =>
  new RegExp(
    `^${log.result.type}: (seat ${String(log.result.winner)} wins|draw), ` +
      `A ${String(log.result.score.A)} - B ${String(log.result.score.B)}$`,
  );

describe("no-dice match between two bots", () => {
  it("writes the log --out names and prints its path and the result", async () => {
    const out = join(dir, "135-greedy-random.json");

    const result = await run([...MATCH, "--out", out]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);

    // The log is on disk, on its own against the schema, and holds the match the
    // command line asked for.
    const log = matchLogSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(log.seed).toBe(135);
    expect(log.players).toEqual({
      A: { kind: "bot", bot: "greedy" },
      B: { kind: "bot", bot: "random" },
    });

    // The path first, then one line saying how the match ended: its type, its
    // winner, and the score it ended on.
    expect(result.out.length).toBe(2);
    expect(result.out[0]).toBe(out);
    expect(result.out[1]).toMatch(resultLine(log));
  }, 60_000);

  it("defaults --out to matches/<seed>-<a>-<b>.json, making the directory", async () => {
    // A current directory that does not exist yet, so nothing but the run can
    // put `matches/` anywhere.
    const cwd = join(dir, "cwd", "deeper");
    const expected = join(cwd, "matches", "135-greedy-random.json");

    const result = await run(MATCH, cwd);

    expect(result.code).toBe(0);
    expect(result.out[0]).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    // The log there is a match, and the run reported it the same way.
    const log = matchLogSchema.parse(JSON.parse(await readFile(expected, "utf8")) as unknown);
    expect(log.seed).toBe(135);
    expect(result.out[1]).toMatch(resultLine(log));
  }, 60_000);

  it("reports a match it cannot write instead of throwing", async () => {
    // The log's directory is a plain file, so it cannot be made.
    const blocker = join(dir, "blocker");
    const out = join(blocker, "log.json");
    await writeFile(blocker, "not a directory\n", "utf8");

    const result = await run([...MATCH, "--out", out]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toMatch(/^error: /);
    expect(existsSync(out)).toBe(false);
  }, 60_000);
});

describe("a command line that does not ask for a match it can play", () => {
  it("names an unknown flag", async () => {
    const result = await run([...MATCH, "--colour", "blue"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain('unknown flag "--colour"');
  });

  it("names a flag whose value is missing", async () => {
    const result = await run(["match", "--game", "salient", "--a", "bot:greedy", "--b"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--b needs a value");
  });

  it("names a missing --seed", async () => {
    const result = await run(["match", "--game", "salient", "--a", "bot:greedy", "--b", "bot:random"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--seed");
    expect(result.err[0]).toContain("required");
  });

  it("names a --seed that is not a whole number", async () => {
    for (const seed of ["13.5", "abc", "1e3", ""]) {
      const result = await run([...MATCH.slice(0, -1), seed]);

      expect(result.code).not.toBe(0);
      expect(result.err[0]).toContain("--seed takes a whole number");
      expect(result.err[0]).toContain(`"${seed}"`);
    }
  });

  it("names a --seed the engine cannot deal a map from", async () => {
    const result = await run([...MATCH.slice(0, -1), "2147483648"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--seed");
    expect(result.err[0]).toContain("2147483648");
  });

  it("names a game v0 does not have", async () => {
    const result = await run(["match", "--game", "chess", "--a", "bot:greedy", "--b", "bot:random", "--seed", "135"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain('--game accepts salient, not "chess"');
  });

  it("names a seat that is neither a bot nor a model", async () => {
    const result = await run(["match", "--game", "salient", "--a", "bot:slow", "--b", "bot:random", "--seed", "135"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain('--a names "bot:slow"');
  });

  it("names a flag given twice", async () => {
    const result = await run(["match", ...MATCH.slice(1), "--seed", "135"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--seed given twice");
  });

  it("names a command v0 does not have, and a command line with no command", async () => {
    const series = await run(["series", "--game", "salient"]);
    expect(series.code).not.toBe(0);
    expect(series.err[0]).toContain('unknown command "series"');

    const nothing = await run([]);
    expect(nothing.code).not.toBe(0);
    expect(nothing.err[0]).toContain("no command given");
  });

  it("names an argument that is not a flag", async () => {
    const result = await run(["match", "salient", "--game", "salient", "--a", "bot:greedy", "--b", "bot:random", "--seed", "135"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain('unexpected argument "salient"');
  });
});

describe("a seat given a model", () => {
  it("says the Pi harness lands in milestone 03, in both seats", async () => {
    for (const flag of ["--a", "--b"]) {
      const out = join(dir, `model-${flag}.json`);
      const argv = MATCH.map((each) => (each === (flag === "--a" ? "bot:greedy" : "bot:random") ? "anthropic/claude" : each));

      const result = await run([...argv, "--out", out]);

      expect(result.code).not.toBe(0);
      expect(result.err[0]).toContain(`error: ${flag} anthropic/claude`);
      expect(result.err[0]).toContain("milestone 03");
      // Nothing was played, so nothing was written.
      expect(existsSync(out)).toBe(false);
    }
  });
});
