/**
 * The series plan: brief §6.5's whole list of matches a pairing will play,
 * worked out on disk before any of them is played.
 *
 * Three rules live here, and none of them plays a match:
 *
 * - **Pairs.** Every seed is played twice, once with model X in seat A and once
 *   with X in seat B, so the board cannot decide the result. A pair is never
 *   left half played: the series directory is read before anything is decided, a
 *   seed whose two logs are on disk is skipped, and a seed with one log plays
 *   only the match that is missing.
 * - **Seeds.** A fixed, recorded list. The first run draws it from `seedBase`
 *   and writes it to `<dir>/series.json`; every later run reads it back, so a
 *   series resumed an hour later — or started again next week — sits on the same
 *   maps instead of drawing new ones. Raising `maxPairs` appends to the recorded
 *   list rather than replacing it.
 * - **Layout.** `<dir>/matches/<seed>-<seat-map>.json`, with Pi's saved
 *   conversations under `<dir>/sessions/<seed>-<seat-map>/`. A pairing whose two
 *   seats fold to one slug — a bot against itself — has a seat map that reads the
 *   same in both seat orders, so its matches carry the seat the pairing's
 *   first seat plays as well: `<seed>-greedy-greedy-A.json` and `-B.json`, the
 *   same letter the record's `seat` field carries, and the name a mirrored pair
 *   resumes on. The sessions path is handed to `runMatch` as `matchDir`: left to
 *   itself it puts a seat's home and
 *   transcripts beside the log, inside `matches/`, where brief §6.5 says only
 *   logs belong.
 *
 * What comes back is paths and seat orders — no player, no server, no Pi — which
 * is what lets the series runner and its resume test be written against a
 * scripted `playMatch` instead of a model.
 */
import { access, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { mulberry32 } from "@no-dice/salient-engine";
import type { Seat } from "@no-dice/log";

import { seatSlug } from "./args.ts";
import type { SeatArg } from "./args.ts";

/** Brief §6.5's default pair limit: 75 pairs, which is 150 matches. */
export const DEFAULT_MAX_PAIRS = 75;

/**
 * What the seed list is drawn from when nothing is given. A fixed number rather
 * than a clock or a draw of its own, because the list has to be reproducible:
 * the same pairing asked for again next week has to sit on the same maps.
 */
export const DEFAULT_SEED_BASE = 0;

/** What `planSeries` takes. */
export interface SeriesPlanOptions {
  /** The series directory: `series/<name>`, or wherever `--dir` pointed it. */
  dir: string;
  /** Model X — the pairing's first seat, and the one the swap moves. */
  a: SeatArg;
  /** The opponent X is measured against. */
  b: SeatArg;
  /** How many pairs at most, brief §6.5's `--max-pairs`. */
  maxPairs?: number;
  /** What the seed list is drawn from, `--seed-base`. */
  seedBase?: number;
}

/**
 * One match of a pair: who plays each seat, and where the match lands. `out` is
 * what `runMatch` writes, and `matchDir` what it puts a Pi seat's home in.
 */
export interface PlannedMatch {
  /** The map it deals. */
  seed: number;
  /** The seat `a`'s model plays — the pair's other match has it in the other one. */
  seat: Seat;
  /** Who plays each seat, which is the pair seen from the board rather than from X. */
  seats: Record<Seat, SeatArg>;
  /** `<dir>/matches/<seed>-<seat-map>.json`, plus `-<seat>` for a mirrored pairing. */
  out: string;
  /** `<dir>/sessions/<seed>-<seat-map>/`, where a Pi seat's transcripts go. */
  matchDir: string;
  /** Whether its log is already on disk, which is brief §6.5's resume rule. */
  played: boolean;
}

/** One seed and its two seat orders, in the order a run plays them. */
export interface PlannedPair {
  seed: number;
  matches: [PlannedMatch, PlannedMatch];
}

/** What `planSeries` hands back. */
export interface SeriesPlan {
  dir: string;
  /** The seed base the list was drawn from — the recorded one, if there was one. */
  seedBase: number;
  /** The pair limit this plan was made for. */
  maxPairs: number;
  /** The seeds this plan covers: the recorded list, up to `maxPairs` of them. */
  seeds: number[];
  /** Every pair, including the ones already on disk. */
  pairs: PlannedPair[];
  /** The matches still to play, in the order a run should play them. */
  matches: PlannedMatch[];
}

/** The file a series' memory lives in, under its directory. */
export const seriesRecordPath = (dir: string): string => join(dir, "series.json");

/** The part of that file this module owns; anything else in it survives untouched. */
const recordShape = z.object({
  seed_base: z.number().int(),
  max_pairs: z.number().int().nonnegative(),
  seeds: z.array(z.number().int()),
});

/** What a series directory already says about itself, or `null` on its first run. */
interface RecordedSeries {
  /** The file as written, so a field this module does not know is not dropped. */
  raw: Record<string, unknown>;
  seedBase: number;
  maxPairs: number;
  seeds: number[];
}

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";

/**
 * Read a series' recorded seed list. A file that is there but does not record
 * one is an error rather than a fresh draw: silently redrawing would put a
 * resumed series on maps its existing logs were not played on.
 */
const readRecord = async (dir: string): Promise<RecordedSeries | null> => {
  const path = seriesRecordPath(dir);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not JSON, so the series has no seed list to resume from`);
  }
  const record = recordShape.safeParse(parsed);
  if (!record.success) {
    throw new Error(
      `${path} does not record a seed list: ${record.error.issues
        .map((issue) => `${issue.path.join(".") || "series"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return {
    raw: parsed as Record<string, unknown>,
    seedBase: record.data.seed_base,
    maxPairs: record.data.max_pairs,
    seeds: record.data.seeds,
  };
};

/**
 * Write the record in one step, the way `match.ts` writes a log: the bytes go to
 * `<path>.tmp` and are renamed into place, so the only file a later run can find
 * is a complete one. A half-written seed list would leave a resumed series
 * planning matches on maps that were never recorded. The series runner writes the
 * same file with its own state added, which is why this is the one atomic write
 * of it.
 */
export const writeSeriesRecord = async (
  dir: string,
  record: Record<string, unknown>,
): Promise<void> => {
  const path = seriesRecordPath(dir);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, path);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
};

/**
 * Draw `count` seeds the engine can deal a map from, skipping any already in
 * `taken`. `mulberry32` takes its seed as `n | 0`, and so does `generateMap`, so
 * the draw is kept inside that range by taking 31 of its 32 bits: a seed outside
 * it would deal a different map from the one the plan named, quietly.
 *
 * The draw is a stream from one base, so asking for more seeds later continues
 * it — the recorded list stays a prefix of what a longer series plays.
 */
const drawSeeds = (seedBase: number, count: number, taken: readonly number[]): number[] => {
  const rng = mulberry32(seedBase);
  const seen = new Set(taken);
  const drawn: number[] = [];
  // A 31-bit space makes a repeat unlikely enough that this bound is never
  // reached in practice; it is here so a broken draw fails loudly instead of
  // spinning inside a series that has already spent an hour drawing.
  const limit = (taken.length + count) * 64 + 1024;
  let attempts = 0;
  while (drawn.length < count) {
    attempts++;
    if (attempts > limit) {
      throw new Error(
        `drawing seeds from base ${String(seedBase)} made no progress in ${String(limit)} attempts`,
      );
    }
    const seed = rng() >>> 1;
    if (seen.has(seed)) continue;
    seen.add(seed);
    drawn.push(seed);
  }
  return drawn;
};

/** Whether a match's log is already on disk. */
const hasLog = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
};

/**
 * One match of a pair: the seats as the board sees them, and brief §6.5's two
 * paths named by its seat map — by the seat `a` plays as well, when the pairing
 * is mirrored and its seat map is one string whichever way the seats are read.
 */
const matchOf = (dir: string, a: SeatArg, b: SeatArg, seed: number, seat: Seat): PlannedMatch => {
  const seats: Record<Seat, SeatArg> = seat === "A" ? { A: a, B: b } : { A: b, B: a };
  const slugA = seatSlug(seats.A);
  const slugB = seatSlug(seats.B);
  const name = `${String(seed)}-${slugA}-${slugB}${slugA === slugB ? `-${seat}` : ""}`;
  return {
    seed,
    seat,
    seats,
    out: join(dir, "matches", `${name}.json`),
    matchDir: join(dir, "sessions", name),
    played: false,
  };
};

/**
 * Work out the whole list of matches a pairing will play.
 *
 * The series directory is read first: its `series.json` decides the seed list,
 * and the logs under `matches/` decide which matches are still missing. Nothing
 * is drawn again once a series has a list, and nothing is played again once its
 * log exists.
 */
export async function planSeries(options: SeriesPlanOptions): Promise<SeriesPlan> {
  const maxPairs = options.maxPairs ?? DEFAULT_MAX_PAIRS;
  if (!Number.isInteger(maxPairs) || maxPairs < 1) {
    throw new Error(`--max-pairs takes a whole number of pairs from 1 up, not ${String(maxPairs)}`);
  }

  const recorded = await readRecord(options.dir);
  const seedBase = recorded?.seedBase ?? options.seedBase ?? DEFAULT_SEED_BASE;
  // A later `--seed-base` is ignored: the recorded list is the series' memory,
  // and redrawing would put new matches on maps its existing logs are not on.
  if (!Number.isInteger(seedBase) || (seedBase | 0) !== seedBase) {
    throw new Error(
      "--seed-base takes a whole number the engine can mix, between -2147483648 and " +
        `2147483647, not ${String(seedBase)}`,
    );
  }

  const before = recorded?.seeds ?? [];
  const seeds = [...before, ...drawSeeds(seedBase, maxPairs - before.length, before)];
  if (recorded === null || recorded.seeds.length !== seeds.length) {
    await writeSeriesRecord(options.dir, {
      ...(recorded?.raw ?? {}),
      seed_base: seedBase,
      max_pairs: Math.max(maxPairs, before.length),
      seeds,
    });
  }

  // A lowered `--max-pairs` caps what is planned, but never shortens the list
  // that was recorded: the maps a series has drawn are part of its record.
  const planned = seeds.slice(0, maxPairs);

  const pairs: PlannedPair[] = [];
  for (const seed of planned) {
    const first = matchOf(options.dir, options.a, options.b, seed, "A");
    const second = matchOf(options.dir, options.a, options.b, seed, "B");
    first.played = await hasLog(first.out);
    second.played = await hasLog(second.out);
    pairs.push({ seed, matches: [first, second] });
  }

  return {
    dir: options.dir,
    seedBase,
    maxPairs,
    seeds: planned,
    pairs,
    matches: pairs.flatMap((pair) => pair.matches).filter((match) => !match.played),
  };
}
