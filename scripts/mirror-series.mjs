#!/usr/bin/env node
/**
 * A series whose two seats are the same bot — the pairing `no-dice series` used
 * to refuse.
 *
 * Brief §6.5 names a match by its seat map — `<seed>-<seatA>-<seatB>.json` — and
 * both seat orders of a mirrored pairing fold to one file name, so `planSeries`
 * once threw rather than write one match's log over the other's
 * (`packages/runner/src/series-plan.ts`). The refusal is right for a model
 * against itself, whose two seats are different players. It still blocked the
 * measurement a mirrored pairing is worth taking: one bot playing the same map
 * from both sides, which is how `docs/rules-review.md`'s Centre Node ping-pong
 * section got a bot-only ping-pong rate.
 *
 * `no-dice series` plays that pairing now, naming a mirrored pair's two matches
 * by the seat the pairing's first seat plays — the naming this script worked out
 * first — so a series started by either is resumed by the other. This script is
 * kept because the Greedy-vs-Greedy series `docs/series-notes.md` §7 and
 * `docs/rules-review.md` quote was played by it.
 *
 * It draws the seed list through `planSeries` itself, pointed at a
 * stand-in opponent: the draw is a stream off `--seed-base`
 * and takes no seat, so planning the pairing's first seat against a
 * stand-in at the same pair limit draws exactly the seeds a real series of that
 * size would play. It then plays both seat orders of every seed through the
 * runner's own `runMatch`, naming the two logs `<seed>-<slug>-A.json` and
 * `<seed>-<slug>-B.json` after the seat the pairing's first seat plays, and
 * writes the record with `writeSeriesRecord` in the shape `runSeries` writes —
 * so `no-dice stats`, `no-dice evidence` and `no-dice showcase` read the series
 * like any other, and a log already on disk is read rather than replayed.
 *
 * **A mirrored pairing is a true mirror, and its sample is half what it counts.**
 * Both seats play the same bot on the same map, so the two matches of a pair come
 * out the same — the same score, and the same play seen from each side — and
 * every match is a draw. Twenty matches of a mirrored series are ten
 * positions played twice, and every document that quotes one of these series
 * says so (`docs/series-notes.md` §7).
 *
 * usage — the same command line `no-dice series` takes:
 *
 *   node scripts/mirror-series.mjs series --game salient --a bot:greedy \
 *     --b bot:greedy --name greedy-vs-greedy --max-pairs 10
 *
 * and then, as after any series:
 *
 *   no-dice evidence --series series/greedy-vs-greedy
 */
import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { parseArgs, seatSlug } from "@no-dice/runner/args";
import { runMatch, seatSpec } from "@no-dice/runner/match";
import {
  DEFAULT_MAX_PAIRS,
  DEFAULT_SEED_BASE,
  planSeries,
  writeSeriesRecord,
} from "@no-dice/runner/series-plan";

/** What a run prints when its command line did not parse. */
const USAGE =
  'usage: node scripts/mirror-series.mjs series --game salient --a <seat> --b <seat> ' +
  "--name <name> [--max-pairs <n>] [--seed-base <n>] [--dir <dir>]";

const fail = (message) => {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
};

const parsed = parseArgs(process.argv.slice(2));
if (!parsed.ok) fail(parsed.error);
const command = parsed.command;
if (command.name !== "series") fail("`mirror-series.mjs` takes a `series` command, not a match one");

const slugA = seatSlug(command.a);
const slugB = seatSlug(command.b);
if (slugA !== slugB) {
  fail(`"${slugA}" against "${slugB}" is not a mirrored pairing — use \`no-dice series\` for it`);
}

const maxPairs = command.maxPairs ?? DEFAULT_MAX_PAIRS;
const seedBase = command.seedBase ?? DEFAULT_SEED_BASE;
const dir = resolve(command.dir);

/**
 * The seeds, drawn by the planner that draws every series' list. The
 * stand-in opponent is never played: `drawSeeds` mixes `--seed-base` and takes no
 * seat, so this is the list a real series of `--max-pairs` pairs would sit on.
 */
const draw = await planSeries({
  dir,
  a: command.a,
  b: { kind: "bot", bot: "random" },
  maxPairs,
  seedBase,
});

/** The per-turn usage totals, summed the way `runSeries` sums them into the record. */
const totalsOf = (log) => {
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let cost = 0;
  for (const turn of log.turns) {
    for (const seat of ["A", "B"]) {
      const played = turn.players[seat];
      tokens.input += played.usage.input;
      tokens.output += played.usage.output;
      tokens.cache_read += played.usage.cache_read;
      tokens.cache_write += played.usage.cache_write;
      cost += played.cost_usd;
    }
  }
  return {
    cost_usd: cost,
    tokens: { ...tokens, total: tokens.input + tokens.output + tokens.cache_read + tokens.cache_write },
  };
};

const readLog = async (path) => JSON.parse(await readFile(path, "utf8"));
const hasLog = async (path) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return false;
  }
};

const recordOf = (seat, path, log) => ({
  seat,
  path,
  status: "played",
  result: { type: log.result.type, winner: log.result.winner, margin: log.result.margin },
  ...totalsOf(log),
});

let played = 0;
let skipped = 0;
let failed = 0;
const pairs = [];

for (const seed of draw.seeds) {
  const matches = [];
  for (const seat of ["A", "B"]) {
    // The pair's two seat orders. For a mirrored pairing the swap
    // changes nothing about who plays, which is why the two logs come out alike;
    // the seat map is written out in full anyway, and the letter after it is the
    // one thing that tells the two matches apart — the seat the pairing's first
    // seat plays.
    const out = join(dir, "matches", `${String(seed)}-${slugA}-${slugB}-${seat}.json`);
    const seats = { A: seatSpec(command.a), B: seatSpec(command.b) };
    if (await hasLog(out)) {
      skipped++;
      matches.push(recordOf(seat, out, await readLog(out)));
      continue;
    }
    try {
      const { log } = await runMatch({ out, seed, seats });
      played++;
      matches.push(recordOf(seat, out, log));
      console.log(
        `${String(seed)} seat ${seat}: ${log.result.type}` +
          `${log.result.winner === null ? " draw" : ` win for ${log.result.winner}`}` +
          ` ${String(log.result.margin)} — ${out}`,
      );
    } catch (error) {
      // Brief §6.5's resume rule is a log on disk: a match that threw left none,
      // so the next run plays it again rather than recording a result for it.
      failed++;
      matches.push({
        seat,
        path: out,
        status: "failed",
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
      console.error(`${String(seed)} seat ${seat} failed: ${String(error)}`);
    }
  }
  pairs.push({ seed, matches: [matches[0], matches[1]] });
}

await writeSeriesRecord(dir, {
  seed_base: draw.seedBase,
  max_pairs: maxPairs,
  seeds: draw.seeds,
  pairing: { a: command.a, b: command.b },
  pairs,
  state: {
    pairs_played: pairs.filter((pair) => pair.matches.every((m) => m.status === "played")).length,
    matches_played: played + skipped,
    matches_failed: failed,
    stop_reason: "max_pairs",
    stopped_early: false,
  },
});

console.log(
  `\n${String(draw.seeds.length)} pairs, ${String(played + skipped)} matches on disk ` +
    `(${String(played)} played now, ${String(skipped)} already there, ${String(failed)} failed) ` +
    `in ${dir}`,
);
console.log(`then: no-dice evidence --series ${dir}`);
