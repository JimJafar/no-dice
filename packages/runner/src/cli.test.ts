/**
 * The `no-dice` command line, run for real: `match`, `series`, `stats` and
 * `evidence`.
 *
 * What these tests pin down is what a person at a terminal gets:
 *
 * - a match between two bots played from the flags brief §1 names, its log on
 *   disk validating against `salient-log/1`, and the run printing where the log
 *   is and how the match ended;
 * - the `no-dice` bin started by a shell rather than by vitest: bare `node` on
 *   the file the package declares, and the same file reached through a symlinked
 *   directory, which is the shape of a package manager's bin shim;
 * - the default log path — `matches/<seed>-<a>-<b>.json` under the current
 *   directory, with the directory made on the way;
 * - every way a command line can be wrong (an unknown flag, a flag with no
 *   value, a seed that is not a whole number, a game v0 does not have, a seat
 *   that names no bot) reported as one line naming the problem, with a non-zero
 *   exit and no log left behind;
 * - a seat given a model played through the Pi harness, and a provider with no
 *   credential reported as one line before a turn is played;
 * - a mirrored pairing — one bot in both seats — played as two logs named by the
 *   seat the pairing's first seat plays, counted by `stats` and `evidence`, and
 *   resumed without replaying what is already on disk.
 *
 * The series tests run real bot matches, which is what the acceptance brief
 * asks for and what proves the CLI drives the real `runMatch` rather than a
 * seam: `--max-pairs 2` is four matches, and a bot match is about a second
 * (`docs/pi-harness-notes.md` §7). The long series stays with the runner's own
 * tests, which script `playMatch` instead.
 *
 * Seed 135 is the map the other suites use. `no-dice stats`, `no-dice evidence`
 * and `no-dice showcase` are tested against a directory a real run left behind,
 * which is the only shape any of them reads.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { matchLogSchema } from "@no-dice/log";
import type { MatchLog } from "@no-dice/log";

import runnerManifest from "../package.json" with { type: "json" };
import { runCli } from "./cli.ts";
import type { CliIo } from "./cli.ts";
import type { SeriesRecord } from "./series.ts";
import { withoutAnthropicCredentials } from "./test-credentials.ts";

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
 * The file this package declares as its `no-dice` bin, as an absolute path, so
 * the shell-level tests below run what a shell would run rather than a copy of
 * the path that could drift away from the declaration.
 */
const BIN = fileURLToPath(new URL(runnerManifest.bin["no-dice"], new URL("../package.json", import.meta.url)));

/** The lines a process printed, without the trailing newline. */
const lines = (output: string): string[] => output.split("\n").filter((line) => line !== "");

/**
 * Run one command line in a separate `node` process, as a shell does, and hand
 * back its exit code and what it printed. A failure to start the process counts
 * as a non-zero run, so the assertions below say what went wrong.
 */
const runInShell = (file: string, argv: readonly string[], cwd: string): Promise<Run> =>
  new Promise((settled) => {
    execFile(process.execPath, [file, ...argv], { cwd }, (error, stdout, stderr) => {
      settled({
        code: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
        out: lines(stdout),
        err: lines(stderr),
      });
    });
  });

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

describe("the no-dice bin started by a shell", () => {
  it("plays a match under bare node, with no loader or build step involved", async () => {
    const out = join(dir, "bin", "135-greedy-random.json");

    const result = await runInShell(BIN, [...MATCH, "--out", out], dir);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    // The log is there, and it is a match: the imports the workspace makes —
    // `./match.ts`, the engine's `package.json` — are ones a bare Node ESM
    // loader resolves, which is what a shell needs and vitest hides.
    const log = matchLogSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(log.seed).toBe(135);
    expect(result.out[0]).toBe(out);
    expect(result.out[1]).toMatch(resultLine(log));
  }, 60_000);

  it("still runs itself when the path to it goes through a symlinked directory", async () => {
    // A package manager's bin shim reaches the file through a symlinked package
    // directory, so `process.argv[1]` and the module Node loaded name one file by
    // different routes. The main guard has to notice, or a run from a shell does
    // nothing at all and leaves the terminal wondering.
    const linked = join(dir, "pkg");
    await symlink(dirname(BIN), linked, "dir");

    const result = await runInShell(join(linked, "cli.ts"), [], dir);

    // The command line was empty, so the guard ran the command and the command
    // said what was missing — rather than the process exiting 0 in silence.
    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("no command given");
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
    const replay = await run(["replay", "--game", "salient"]);
    expect(replay.code).not.toBe(0);
    expect(replay.err[0]).toContain('unknown command "replay"');

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
  it("plays through the Pi harness, and reports a provider with no credential in one line", async () => {
    // A seat's Pi home is empty, so an exported key is the only credential this
    // run could find. Take it away, or the run would be a real one against
    // Anthropic.
    const restore = withoutAnthropicCredentials();
    try {
      for (const flag of ["--a", "--b"]) {
        const out = join(dir, `model-${flag}.json`);
        const argv = MATCH.map((each) => (each === (flag === "--a" ? "bot:greedy" : "bot:random") ? "anthropic/claude" : each));

        const result = await run([...argv, "--out", out]);

        expect(result.code).not.toBe(0);
        // One line, naming the seat and the provider, and saying what would fix
        // it — not a stack, and not 25 turns of provider errors.
        expect(result.err).toHaveLength(1);
        expect(result.err[0]).toContain(
          `seat ${flag === "--a" ? "A" : "B"}: provider "anthropic" has no credential for model anthropic/claude`,
        );
        // Nothing was played, so nothing was written.
        expect(existsSync(out)).toBe(false);
      }
    } finally {
      restore();
    }
  }, 60_000);
});

/**
 * `no-dice series`, run for real: the CLI drives `runMatch`, not a seam, so the
 * logs it reports are matches the engine actually played. `--max-pairs 2` is
 * four bot matches and about two seconds, which is small enough to run here and
 * large enough to prove the pair, the seat swap and the resume rule reach the
 * terminal.
 */
const SERIES = [
  "series",
  "--game",
  "salient",
  "--a",
  "bot:greedy",
  "--b",
  "bot:random",
  "--max-pairs",
  "2",
];

/** `series.json` as written, typed as the record the runner defines. */
const readSeriesRecord = async (seriesDir: string): Promise<SeriesRecord> =>
  JSON.parse(await readFile(join(seriesDir, "series.json"), "utf8")) as SeriesRecord;

/** Every match log in a series directory, by name, as the bytes on disk. */
const readLogs = async (seriesDir: string): Promise<Record<string, string>> => {
  const names = await readdir(join(seriesDir, "matches"));
  const logs: Record<string, string> = {};
  for (const name of names) logs[name] = await readFile(join(seriesDir, "matches", name), "utf8");
  return logs;
};

describe("no-dice series between two bots", () => {
  it("plays both seat orders of every pair, prints each pair, and writes the record and the report", async () => {
    const seriesDir = join(dir, "series", "greedy-vs-random");

    const result = await run([...SERIES, "--dir", seriesDir]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);

    // Brief §6.5's layout: one log per match, under the series directory, two
    // of each seat order.
    const logs = await readLogs(seriesDir);
    const names = Object.keys(logs).sort();
    expect(names).toHaveLength(4);
    expect(names.filter((name) => /^\d+-greedy-random\.json$/.test(name))).toHaveLength(2);
    expect(names.filter((name) => /^\d+-random-greedy\.json$/.test(name))).toHaveLength(2);
    // Each one is a match the engine played, with the seats the swap asked for.
    for (const text of Object.values(logs)) {
      const log = matchLogSchema.parse(JSON.parse(text) as unknown);
      expect([log.players.A, log.players.B].map((player) => (player.kind === "bot" ? player.bot : player.model)).sort())
        .toEqual(["greedy", "random"]);
    }

    // The record says the series ran its length.
    const record = await readSeriesRecord(seriesDir);
    expect(record.pairs).toHaveLength(2);
    // Every pair is one seed played twice, model X in each seat once.
    for (const pair of record.pairs) {
      expect(pair.matches.map((match) => match.seat)).toEqual(["A", "B"]);
    }
    expect(record.state.pairs_played).toBe(2);
    expect(record.state.matches_played).toBe(4);
    expect(record.state.stop_reason).toBe("max_pairs");
    expect(record.pairing).toEqual({
      a: { kind: "bot", bot: "greedy" },
      b: { kind: "bot", bot: "random" },
    });

    // One line per pair as it went: seed, both seat orders, both results, and
    // the win rate and 95% interval so far — then the stop reason, the final
    // figures, and the two paths.
    expect(result.out[0]).toBe(`series: ${seriesDir}`);
    expect(result.out[1]).toMatch(
      /^seed \d+: bot:greedy in A, bot:random in B — .+ \| bot:random in A, bot:greedy in B — .+ \| bot:greedy win rate \d+\.\d+% \(95% .+ – .+\) over 2 matches$/,
    );
    expect(result.out[2]).toMatch(/^seed \d+: .+ over 4 matches$/);
    expect(result.out[3]).toContain("stopped on max_pairs — its full length");
    expect(result.out[4]).toMatch(/^bot:greedy win rate \d+\.\d+% \(95% .+ – .+\) over 4 matches/);
    expect(result.out[5]).toBe(`series.json: ${join(seriesDir, "series.json")}`);
    expect(result.out[6]).toBe(`report.md: ${join(seriesDir, "report.md")}`);
    expect(result.out).toHaveLength(7);

    // The report the paths name is on disk, and it is the report `stats` prints.
    const markdown = await readFile(join(seriesDir, "report.md"), "utf8");
    expect(markdown).toContain("# Series report: bot:greedy vs bot:random");
    expect(markdown).toContain("**4 counted**, **0 missing**");
  }, 120_000);

  it("plays nothing already on disk when it is run again, and still exits 0", async () => {
    const seriesDir = join(dir, "series", "resumed");
    const first = await run([...SERIES, "--dir", seriesDir]);
    expect(first.code).toBe(0);
    const before = await readLogs(seriesDir);

    const again = await run([...SERIES, "--dir", seriesDir]);

    expect(again.code).toBe(0);
    expect(again.err).toEqual([]);
    expect(again.out.join("\n")).toContain("this run played 0, skipped 4, failed 0");
    // Byte for byte the same logs: a replay would have written a new `created`
    // and, for a match that had been voided, a different result.
    expect(await readLogs(seriesDir)).toEqual(before);
    expect((await readSeriesRecord(seriesDir)).state.matches_played).toBe(4);
  }, 120_000);

  it("defaults its directory to series/<a-slug>-vs-<b-slug> under the current directory", async () => {
    const cwd = join(dir, "series-cwd");

    const result = await run(
      ["series", "--game", "salient", "--a", "bot:greedy", "--b", "bot:random", "--max-pairs", "1"],
      cwd,
    );

    expect(result.code).toBe(0);
    const expected = join(cwd, "series", "greedy-vs-random");
    expect(result.out[0]).toBe(`series: ${expected}`);
    expect(existsSync(join(expected, "series.json"))).toBe(true);
    expect(existsSync(join(expected, "report.md"))).toBe(true);
  }, 120_000);

  it("puts a --name under series/", async () => {
    const cwd = join(dir, "series-named");

    const result = await run(
      [
        "series",
        "--game",
        "salient",
        "--a",
        "bot:greedy",
        "--b",
        "bot:random",
        "--max-pairs",
        "1",
        "--name",
        "quick",
      ],
      cwd,
    );

    expect(result.code).toBe(0);
    expect(result.out[0]).toBe(`series: ${join(cwd, "series", "quick")}`);
    expect(existsSync(join(cwd, "series", "quick", "series.json"))).toBe(true);
  }, 120_000);
});

/**
 * A mirrored pairing: one bot in both seats. Brief §6.5's seat map is the same
 * string in both seat orders, so the pair's two matches are named by the seat the
 * pairing's first seat plays — `<seed>-greedy-greedy-A.json` and `-B.json`, the
 * letter the record's `seat` field carries — and both are played, counted and
 * resumed like any other pair's.
 */
const MIRROR = [
  "series",
  "--game",
  "salient",
  "--a",
  "bot:greedy",
  "--b",
  "bot:greedy",
  "--max-pairs",
  "1",
];

describe("no-dice series with one bot in both seats", () => {
  it("plays both seat orders of its pair to two logs, and reports the series over both", async () => {
    const seriesDir = join(dir, "series", "mirror-greedy");

    const result = await run([...MIRROR, "--dir", seriesDir]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);

    // Two logs, not one written over itself, and each named by the seat X plays.
    const logs = await readLogs(seriesDir);
    const names = Object.keys(logs).sort();
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/^\d+-greedy-greedy-A\.json$/);
    expect(names[1]).toMatch(/^\d+-greedy-greedy-B\.json$/);
    // One seed played twice, which is what a pair is.
    const seedOf = (name: string): string => /^(-?\d+)-/.exec(name)![1]!;
    expect(seedOf(names[0]!)).toBe(seedOf(names[1]!));
    for (const text of Object.values(logs)) {
      const log = matchLogSchema.parse(JSON.parse(text) as unknown);
      expect([log.players.A, log.players.B].map((player) =>
        player.kind === "bot" ? player.bot : player.model,
      )).toEqual(["greedy", "greedy"]);
    }

    // The record holds both matches, each under its own path.
    const record = await readSeriesRecord(seriesDir);
    expect(record.pairing).toEqual({
      a: { kind: "bot", bot: "greedy" },
      b: { kind: "bot", bot: "greedy" },
    });
    expect(record.pairs).toHaveLength(1);
    expect(record.pairs[0]!.matches.map((match) => match.seat)).toEqual(["A", "B"]);
    expect(record.pairs[0]!.matches.map((match) => match.path)).toEqual(
      names.map((name) => join(seriesDir, "matches", name)),
    );
    expect(record.state.pairs_played).toBe(1);
    expect(record.state.matches_played).toBe(2);

    // The pair line still tells its two matches apart, even though both seat
    // orders name the same two players: the seat X plays is said, which is the
    // letter the log name ends in.
    expect(result.out[1]).toMatch(
      new RegExp(
        "^seed -?\\d+: bot:greedy in A, bot:greedy in B \\(bot:greedy in seat A\\) — .+ \\| " +
          "bot:greedy in A, bot:greedy in B \\(bot:greedy in seat B\\) — .+ " +
          "bot:greedy win rate .+ over 2 matches$",
      ),
    );

    // Both matches are counted, by the report and by the rules evidence.
    const stats = await run(["stats", "--series", seriesDir]);
    expect(stats.code).toBe(0);
    expect(stats.out.join("\n")).toContain("**2 counted**, **0 missing**");
    const evidence = await run(["evidence", "--series", seriesDir]);
    expect(evidence.code).toBe(0);
    expect(evidence.out.join("\n")).toContain("2 matches: **2 counted**, **0 missing**");
  }, 120_000);

  it("plays nothing already on disk when it is run again", async () => {
    const seriesDir = join(dir, "series", "mirror-resumed");
    const first = await run([...MIRROR, "--dir", seriesDir]);
    expect(first.code).toBe(0);
    const before = await readLogs(seriesDir);

    const again = await run([...MIRROR, "--dir", seriesDir]);

    expect(again.code).toBe(0);
    expect(again.out.join("\n")).toContain("this run played 0, skipped 2, failed 0");
    // The same two logs, byte for byte: the resume rule reads a mirrored pair's
    // logs by their seat-letter names rather than replaying over them.
    expect(await readLogs(seriesDir)).toEqual(before);
    expect((await readSeriesRecord(seriesDir)).state.matches_played).toBe(2);
  }, 120_000);
});

describe("a series command line that does not ask for a series it can run", () => {
  it("names an unknown flag", async () => {
    const result = await run([...SERIES, "--colour", "blue"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain('unknown flag "--colour"');
  });

  it("names a --max-pairs that is not a whole number of pairs", async () => {
    for (const bad of ["2.5", "abc", "0", "-1"]) {
      const result = await run([...SERIES.slice(0, -1), bad]);

      expect(result.code).not.toBe(0);
      expect(result.err[0]).toContain("--max-pairs takes a whole number");
      expect(result.err[0]).toContain(`"${bad}"`);
    }
  });

  it("names a missing --b", async () => {
    const result = await run(["series", "--game", "salient", "--a", "bot:greedy", "--max-pairs", "2"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--b is required");
  });

  it("names a --concurrency and a ceiling that are not numbers the run can honour", async () => {
    for (const argv of [
      [...SERIES, "--concurrency", "0"],
      [...SERIES, "--concurrency", "1.5"],
      [...SERIES, "--max-cost", "-5"],
      [...SERIES, "--max-tokens", "-1"],
      [...SERIES, "--seed-base", "2147483648"],
      [...SERIES, "--name", "a/b"],
      [...SERIES, "--name", "a", "--dir", "b"],
    ]) {
      const result = await run(argv);
      expect(result.code).not.toBe(0);
      expect(result.err[0]).toMatch(/^error: --/);
    }
  });

  it("names a flag whose value is missing", async () => {
    const result = await run([...SERIES, "--concurrency"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--concurrency needs a value");
  });
});

describe("a series seat given a model with no credential", () => {
  it("reports it in one line before a turn is played, and writes no series", async () => {
    // As `match` reports it, and asked before the first match rather than after
    // it: a series is up to 150 matches, and every one of them would fail this
    // way and be recorded as a failed match instead of a run that never started.
    const restore = withoutAnthropicCredentials();
    try {
      const seriesDir = join(dir, "series", "no-credential");

      const result = await run([
        "series",
        "--game",
        "salient",
        "--a",
        "anthropic/claude",
        "--b",
        "bot:random",
        "--max-pairs",
        "1",
        "--dir",
        seriesDir,
      ]);

      expect(result.code).not.toBe(0);
      expect(result.err).toHaveLength(1);
      expect(result.err[0]).toContain(
        'seat A: provider "anthropic" has no credential for model anthropic/claude',
      );
      expect(existsSync(seriesDir)).toBe(false);
    } finally {
      restore();
    }
  }, 120_000);
});

describe("no-dice stats", () => {
  it("prints the report for a series directory", async () => {
    const seriesDir = join(dir, "series", "reported");
    const played = await run([...SERIES, "--dir", seriesDir]);
    expect(played.code).toBe(0);

    const result = await run(["stats", "--series", seriesDir]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out[0]).toBe(`report: ${join(seriesDir, "report.md")}`);
    const printed = result.out.join("\n");
    expect(printed).toContain("# Series report: bot:greedy vs bot:random");
    expect(printed).toContain("**4 counted**, **0 missing**");
    expect(printed).toContain("## Seat effect");
  }, 120_000);

  it("names a directory that holds no series", async () => {
    const result = await run(["stats", "--series", join(dir, "series", "nothing")]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("is not there, so there is no series to report");
  });

  it("names a missing --series", async () => {
    const result = await run(["stats"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--series is required");
  });
});

describe("no-dice evidence", () => {
  it("counts the rules' open questions for a series directory, and writes them beside it", async () => {
    const seriesDir = join(dir, "series", "evidenced");
    const played = await run([...SERIES, "--dir", seriesDir]);
    expect(played.code).toBe(0);

    const result = await run(["evidence", "--series", seriesDir]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out[0]).toBe(`evidence: ${join(seriesDir, "evidence.md")}`);
    const printed = result.out.join("\n");
    expect(printed).toContain("# Rules evidence: bot:greedy vs bot:random");
    expect(printed).toContain("**4 counted**, **0 missing**");
    expect(printed).toContain("## Against the rules' bot figures");
    expect(printed).toContain("## Node ping-pong");

    // The file on disk is the report that was printed, as with `stats`: the
    // first line names the file rather than belonging to the report.
    const written = await readFile(join(seriesDir, "evidence.md"), "utf8");
    expect(written).toBe(`${result.out.slice(1).join("\n")}\n`);
  }, 120_000);

  it("counts the same matches `stats` reported", async () => {
    const seriesDir = join(dir, "series", "evidenced-pairing");
    const played = await run([...SERIES, "--dir", seriesDir]);
    expect(played.code).toBe(0);

    const stats = await run(["stats", "--series", seriesDir]);
    const evidence = await run(["evidence", "--series", seriesDir]);

    expect(stats.code).toBe(0);
    expect(evidence.code).toBe(0);
    // Both say how many matches the series recorded and how many counted, and
    // they cannot answer differently.
    const countedOf = (lines: string[]): string =>
      lines.find((line) => /\*\*\d+ counted\*\*/.test(line)) ?? "";
    expect(countedOf(evidence.out)).toBe(countedOf(stats.out));
  }, 120_000);

  it("names a directory that holds no series", async () => {
    const result = await run(["evidence", "--series", join(dir, "series", "nothing")]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("is not there, so there is no series to report");
  });

  it("names a missing --series, and a flag it does not take", async () => {
    const missing = await run(["evidence"]);
    expect(missing.code).not.toBe(0);
    expect(missing.err[0]).toContain("--series is required");

    const extra = await run(["evidence", "--series", dir, "--seed", "135"]);
    expect(extra.code).not.toBe(0);
    expect(extra.err[0]).toContain('unknown flag "--seed"');
    expect(extra.err[0]).toContain('"evidence" takes --series');
  });
});

describe("no-dice showcase", () => {
  it("names the one match worth rendering, and writes it beside the series", async () => {
    const seriesDir = join(dir, "series", "shown");
    const played = await run([...SERIES, "--dir", seriesDir]);
    expect(played.code).toBe(0);

    const result = await run(["showcase", "--series", seriesDir]);

    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out[0]).toBe(`showcase: ${join(seriesDir, "showcase.json")}`);

    const written = await readFile(join(seriesDir, "showcase.json"), "utf8");
    const parsed = JSON.parse(written) as Record<string, any>;
    expect(parsed.format).toBe("salient-showcase/1");

    // The one-line series result the viewer's header shows: model X against its
    // opponent, the win rate with its 95% interval, the pairs played, and why the
    // run stopped. Printed as well as written, so the header can be read off the
    // terminal without opening the file.
    expect(parsed.series.line).toContain("bot:greedy vs bot:random");
    expect(parsed.series.line).toContain(`${String(parsed.series.pairs)} pairs`);
    expect(parsed.series.line).toContain("stopped on max_pairs");
    expect(result.out[1]).toBe(parsed.series.line);

    // The match is the series' own log rather than a copy of it, and the path is
    // one that is really there.
    const chosen = parsed.match;
    expect(chosen).not.toBeNull();
    expect(chosen.path.startsWith(`${join(seriesDir, "matches")}${sep}`)).toBe(true);
    await expect(readFile(chosen.path, "utf8")).resolves.toBeTypeOf("string");

    // The score is the sum of the three components written beside it, and the
    // choice is the best of the matches the margin filter kept out of a ranking
    // that is in the order the choice came out of.
    expect(chosen.excitement.score).toBe(
      chosen.excitement.lead_changes + chosen.excitement.largest_swing + chosen.excitement.final_change_turn,
    );
    const kept = parsed.ranked.filter((each: Record<string, any>) => each.kept === true);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0]!.path).toBe(chosen.path);
    const scores = parsed.ranked.map((each: Record<string, any>) => each.excitement.score as number);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));

    // A series with a winner has its match chosen from that winner's wins; a
    // series whose interval covers 50% says it has no winner instead.
    if (parsed.selection.winner !== null) {
      const wonByWinner =
        parsed.selection.winner.side === "x"
          ? chosen.result.winner === chosen.x_seat
          : chosen.result.winner !== chosen.x_seat;
      expect(wonByWinner).toBe(true);
      expect(parsed.series.winner).toBe(parsed.selection.winner.label);
    } else {
      expect(parsed.series.winner).toBeNull();
      expect(parsed.selection.note).toContain("no series winner");
    }

    // What was printed is what was written: the line, the reason the pool was the
    // pool, and the choice with its three components.
    const printed = result.out.join("\n");
    expect(printed).toContain(parsed.selection.note);
    expect(printed).toContain(`chosen: ${chosen.path}`);
    expect(printed).toContain(`excitement ${String(chosen.excitement.score)}`);
    expect(result.out).toHaveLength(5);
  }, 120_000);

  it("writes the same bytes when it is run again over an unchanged series", async () => {
    const seriesDir = join(dir, "series", "shown-twice");
    const played = await run([...SERIES, "--dir", seriesDir]);
    expect(played.code).toBe(0);

    const first = await run(["showcase", "--series", seriesDir]);
    expect(first.code).toBe(0);
    const written = await readFile(join(seriesDir, "showcase.json"), "utf8");

    const second = await run(["showcase", "--series", seriesDir]);
    expect(second.code).toBe(0);
    expect(await readFile(join(seriesDir, "showcase.json"), "utf8")).toBe(written);
    // The same choice, printed in the same order: nothing here reads a clock.
    expect(second.out).toEqual(first.out);
  }, 120_000);

  it("names a directory that holds no series", async () => {
    const result = await run(["showcase", "--series", join(dir, "series", "nothing")]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("is not there, so there is no series to report");
  });

  it("names a missing --series", async () => {
    const result = await run(["showcase"]);

    expect(result.code).not.toBe(0);
    expect(result.err[0]).toContain("--series is required");
  });
});
