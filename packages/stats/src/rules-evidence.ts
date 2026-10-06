/**
 * What the rules' open questions ask about, counted out of the match logs.
 *
 * `salient/docs/salient-rules-v0.md` states its open questions as numbers
 * measured on bot matches — "about 6.5 hexes a turn late on", "the lead changed
 * 3.2 times a match", "the centre Node changed hands on alternate turns" — and
 * `series-report.ts` produces none of them, so a rules review of a real series
 * has nothing to put beside the bot figures. This module counts them from the
 * log alone: no engine, no server, no replay. Every figure comes off the two
 * boards the log already carries, `start.cells` and `turns[].after.cells`, and
 * the score logged beside them.
 *
 * **Boards, not events.** The engine logs a `capture` event for every hex that
 * changes owner, and it sets ownership at most once per hex per turn
 * (`resolveTurn` step 7 in `games/salient/engine/src/resolve.ts`), so the delta
 * between one turn's board and the next is the same count seen from the board
 * rather than from the event list. The board is used because it is what the log
 * is obliged to get right — the viewer replays from it — and because a hex that
 * moved without an event logged would otherwise count as never having moved.
 *
 * **A tie is not a lead.** The lead is the side ahead, so a level board leaves
 * the previous leader in place rather than clearing it: A ahead, level, B ahead
 * is *one* change, on the turn B went ahead, not two. Counting the tie as a
 * change would report a match that went back and forth through level scores as
 * one that changed the lead twice as often as it did, and the rules' 3.2 is
 * counted the way it is counted here.
 *
 * **Ping-pong, made exact.** The rules say the centre Node "changed hands on
 * alternate turns", which is a claim about one hex, not about the match. A Node
 * is flagged when it changed owner on three or more turns and at least two of
 * those turns were consecutive: two changes is a capture and a recapture, which
 * any match has, and three turns with two of them back to back is the
 * back-and-forth the question is about.
 *
 * **Re-scouts.** A scout counts as a re-scout when that same seat scouted that
 * same hex label earlier in the match — including earlier in the same turn,
 * which the server allows and charges an action point for. That is the
 * last-seen-memory question: a seat that re-scouts the hexes over and over is
 * paying for memory the engine could hand it for nothing.
 *
 * Compaction turns and context size are `match-metrics.ts`'s and are not worked
 * out twice here. The series half of this file reuses `series-report.ts`'s
 * reader, so "the matches that count" means the same matches in both reports.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { matchLogSchema } from "@no-dice/log";
import type { HexLabel, LogScore, MatchLog, Seat, TurnRecord } from "@no-dice/log";

import { DEPTH_BANDS, bandOf } from "./match-metrics.ts";
import type { BandName } from "./match-metrics.ts";
import {
  logPathsOf,
  missingOf,
  playerLabel,
  readLogOf,
  readSeriesRecord,
  reasonOfFailure,
  seatLabel,
  seriesMatchRecords,
  voidReasonOf,
} from "./series-report.ts";
import type { MatchRecord, MissingMatch, MissingMatches } from "./series-report.ts";

/** One turn's count of something, for the turns it is non-zero on. */
export interface TurnCount {
  turn: number;
  count: number;
}

/** One depth band's count, and the mean over the turns of it the match played. */
export interface BandCount {
  /** Turns of the match that fall in this band. */
  turns: number;
  total: number;
  /**
   * `total / turns`, or `null` when the band holds no turns. A match knocked out
   * on turn 7 has no "late on", and a nought there would read as a measurement.
   */
  mean: number | null;
}

/** The brief's three depth bands, each with its count. */
export type BandCounts = Record<BandName, BandCount>;

/** The band counts, at nought, so a report prints the bands that happened nothing. */
const blankBandCounts = (): BandCounts => {
  const counts = {} as BandCounts;
  for (const band of DEPTH_BANDS) counts[band.name] = { turns: 0, total: 0, mean: null };
  return counts;
};

/**
 * The counts over each band the turns fall in.
 *
 * `turns` is every turn in scope, whether or not it is in `perTurn`: the mean is
 * over the turns played, not over the turns the thing happened on, which is what
 * "6.5 hexes a turn" means.
 */
const bandCountsOf = (turns: readonly number[], perTurn: readonly TurnCount[]): BandCounts => {
  const counts = blankBandCounts();
  for (const turn of turns) counts[bandOf(turn).name].turns += 1;
  for (const { turn, count } of perTurn) counts[bandOf(turn).name].total += count;
  for (const band of DEPTH_BANDS) {
    const each = counts[band.name];
    each.mean = each.turns === 0 ? null : each.total / each.turns;
  }
  return counts;
};

/** The side ahead in a score, or `null` when it is level. */
const sideAhead = (score: LogScore): Seat | null =>
  score.A === score.B ? null : score.A > score.B ? "A" : "B";

/** `score.A - score.B`: the figure a swing is measured in. */
const differentialOf = (score: LogScore): number => score.A - score.B;

/** The lead, the swings, and when the lead last changed. */
export interface LeadEvidence {
  /** Turns the side ahead changed. */
  changes: number;
  /** The turns they changed on, in order. */
  changeTurns: number[];
  /** The turn of the final change, or 0 when the lead never changed. */
  finalChangeTurn: number;
  /** Every turn's swing: how much `score.A - score.B` moved, in points. */
  swings: TurnCount[];
  /** The largest single-turn swing, and the earliest turn it happened on; null for a match with no turns. */
  largestSwing: { points: number; turn: number } | null;
}

/**
 * The lead walked through `start.score` and every `turns[].after.score`.
 *
 * The three figures brief §6.7's excitement score is built from are all here:
 * `changes`, `largestSwing` and `finalChangeTurn`. The per-turn swings are kept
 * as well because the final-turn lunge question is exactly about their shape —
 * whether the last turn's stands out from the one before it.
 */
const leadEvidenceOf = (start: LogScore, turns: readonly TurnRecord[]): LeadEvidence => {
  const changeTurns: number[] = [];
  const swings: TurnCount[] = [];
  let ahead = sideAhead(start);
  let differential = differentialOf(start);

  for (const turn of turns) {
    const next = differentialOf(turn.after.score);
    swings.push({ turn: turn.n, count: Math.abs(next - differential) });
    differential = next;
    const now = sideAhead(turn.after.score);
    if (now !== null) {
      // A level board leaves the side ahead where it was, so a match that goes A,
      // level, B changed the lead once.
      if (ahead !== null && now !== ahead) changeTurns.push(turn.n);
      ahead = now;
    }
  }

  let largestSwing: { points: number; turn: number } | null = null;
  for (const swing of swings) {
    if (largestSwing === null || swing.count > largestSwing.points) {
      largestSwing = { points: swing.count, turn: swing.turn };
    }
  }
  return {
    changes: changeTurns.length,
    changeTurns,
    finalChangeTurn: changeTurns.length === 0 ? 0 : changeTurns.at(-1)!,
    swings,
    largestSwing,
  };
};

/** Hex ownership flips, with the mean over the deepest band. */
export interface FlipEvidence {
  /** Turns flips happened on, and how many hexes flipped on each. */
  perTurn: TurnCount[];
  total: number;
  /** Over every turn the match played; null when it played none. */
  mean: number | null;
  byBand: BandCounts;
  /**
   * The mean over turns 18-25, which is the figure the rules' "about 6.5 hexes a
   * turn late on" is compared with. Null for a match that never got that late.
   */
  lateMean: number | null;
}

/** Nodes, and whether any of them ping-ponged. */
export interface NodeEvidence {
  /** Node-hex owner changes over the match, whatever the new owner was. */
  handChanges: number;
  perTurn: TurnCount[];
  byBand: BandCounts;
  /** Each Node that changed owner, with the turns it did it on, in order. */
  hexes: { hex: HexLabel; turns: number[] }[];
  /** Whether any Node ping-ponged: three or more turns, two of them consecutive. */
  pingPong: boolean;
  /** The Nodes that ping-ponged. */
  pingPongHexes: HexLabel[];
}

/** What one seat scouted, and how much of it it had already seen. */
export interface ScoutEvidence {
  /** Scout calls the seat made, counting repeats. */
  scouts: number;
  /** The scouts of a hex that seat had already scouted in this match. */
  reScouts: number;
  /** Hex labels scouted at least once. */
  distinct: number;
}

/** Everything the rules' open questions ask about, for one match. */
export interface MatchEvidence {
  /** The turns the match played, in the order the log has them. */
  turns: number[];
  lead: LeadEvidence;
  flips: FlipEvidence;
  nodes: NodeEvidence;
  /** Captures of hexes that were neutral beforehand: the "single troops trading empty hexes". */
  neutralCaptures: { perTurn: TurnCount[]; total: number; byBand: BandCounts };
  scouts: Record<Seat, ScoutEvidence>;
}

/**
 * Whether one Node's owner changes are the ping-pong the rules ask about: three
 * or more turns, at least two of them consecutive.
 */
const isPingPong = (turns: readonly number[]): boolean =>
  turns.length >= 3 && turns.some((turn, i) => i > 0 && turn === turns[i - 1]! + 1);

/** The owner changes between each turn's board and the one before it. */
const boardEvidenceOf = (log: MatchLog): {
  flips: TurnCount[];
  neutralCaptures: TurnCount[];
  nodeChanges: TurnCount[];
  nodes: { hex: HexLabel; turns: number[] }[];
} => {
  const flips: TurnCount[] = [];
  const neutralCaptures: TurnCount[] = [];
  const nodeChanges: TurnCount[] = [];
  const nodeTurns = new Map<HexLabel, number[]>();

  // `cells[i]` describes `map[i]`, which `matchLogSchema` insists on, so the
  // board and the map are walked side by side and the terrain of a cell is known.
  let previous = log.start.cells;
  for (const turn of log.turns) {
    let flipped = 0;
    let captured = 0;
    let node = 0;
    for (let i = 0; i < turn.after.cells.length; i++) {
      const before = previous[i]![0];
      const after = turn.after.cells[i]![0];
      if (before === after) continue;
      flipped += 1;
      // Owner 0 is neutral: a hex that starts the turn with no owner and ends it
      // with one was taken from nobody.
      if (before === 0) captured += 1;
      const hex = log.map[i]!;
      if (hex.terrain === "node") {
        node += 1;
        const seen = nodeTurns.get(hex.id) ?? [];
        seen.push(turn.n);
        nodeTurns.set(hex.id, seen);
      }
    }
    if (flipped > 0) flips.push({ turn: turn.n, count: flipped });
    if (captured > 0) neutralCaptures.push({ turn: turn.n, count: captured });
    if (node > 0) nodeChanges.push({ turn: turn.n, count: node });
    previous = turn.after.cells;
  }

  const nodes = [...nodeTurns.entries()].map(([hex, turns]) => ({ hex, turns }));
  return { flips, neutralCaptures, nodeChanges, nodes };
};

/** What one seat scouted over the match, and how much of it it had already seen. */
const scoutEvidenceOf = (log: MatchLog, seat: Seat): ScoutEvidence => {
  const seen = new Set<HexLabel>();
  let scouts = 0;
  let reScouts = 0;
  for (const turn of log.turns) {
    for (const hex of turn.players[seat].scouts) {
      scouts += 1;
      if (seen.has(hex)) reScouts += 1;
      else seen.add(hex);
    }
  }
  return { scouts, reScouts, distinct: seen.size };
};

/** The counts for an already-parsed log. */
export const evidenceOfLog = (log: MatchLog): MatchEvidence => {
  const turns = log.turns.map((turn) => turn.n);
  const board = boardEvidenceOf(log);
  const flips = bandCountsOf(turns, board.flips);
  const captures = bandCountsOf(turns, board.neutralCaptures);
  const nodes = bandCountsOf(turns, board.nodeChanges);
  const total = (perTurn: readonly TurnCount[]): number =>
    perTurn.reduce((sum, each) => sum + each.count, 0);

  return {
    turns,
    lead: leadEvidenceOf(log.start.score, log.turns),
    flips: {
      perTurn: board.flips,
      total: total(board.flips),
      mean: turns.length === 0 ? null : total(board.flips) / turns.length,
      byBand: flips,
      lateMean: flips["18-25"].mean,
    },
    nodes: {
      handChanges: total(board.nodeChanges),
      perTurn: board.nodeChanges,
      byBand: nodes,
      hexes: board.nodes,
      pingPong: board.nodes.some(({ turns: hexTurns }) => isPingPong(hexTurns)),
      pingPongHexes: board.nodes
        .filter(({ turns: hexTurns }) => isPingPong(hexTurns))
        .map(({ hex }) => hex),
    },
    neutralCaptures: {
      perTurn: board.neutralCaptures,
      total: total(board.neutralCaptures),
      byBand: captures,
    },
    scouts: { A: scoutEvidenceOf(log, "A"), B: scoutEvidenceOf(log, "B") },
  };
};

/**
 * The counts for one match log. The source is the parsed JSON of the file and is
 * checked against `salient-log/1` here, as `matchMetrics` does: a log that does
 * not validate throws rather than counting noughts out of an object the format
 * does not describe.
 */
export const matchEvidence = (source: unknown): MatchEvidence =>
  evidenceOfLog(matchLogSchema.parse(source));

/**
 * The same figures over a series.
 *
 * "The matches that count" is `series-report.ts`'s answer, reused rather than
 * re-derived: the record is read with its reader's schema, a log is looked for at
 * every path the record could mean, and a match that failed, went missing or was
 * voided is reported as missing instead of averaging a nought into every figure.
 * A series that lost two of ten matches and counted them as ten would tell the
 * rules review that the models traded fewer hexes a turn than they did.
 *
 * Totals and means are both given, because the rules quote both kinds: "6.5 hexes
 * a turn late on" is a mean over the turns of the deepest band, and "the lead
 * changed 3.2 times a match" is a mean over matches.
 */

/** One counted match, with its figures and where they came from. */
export interface MatchEvidenceRow {
  seed: number;
  /** The seat model X played in this match of the pair, as the record says. */
  seat: Seat;
  /** The log these figures were read out of. */
  path: string;
  /** How each seat's header names its player. */
  players: Record<Seat, string>;
  evidence: MatchEvidence;
}

/** Every counted match added together. */
export interface EvidenceTotals {
  leadChanges: number;
  flips: number;
  nodeHandChanges: number;
  neutralCaptures: number;
  scouts: number;
  reScouts: number;
  /** Counted matches whose lead changed at least once. */
  matchesWithLeadChange: number;
  /** Counted matches with a Node that ping-ponged. */
  pingPongMatches: number;
}

/** The same figures as means, in the two units the rules use. */
export interface EvidenceMeans {
  perMatch: {
    leadChanges: number;
    flips: number;
    nodeHandChanges: number;
    neutralCaptures: number;
    reScouts: number;
    /** The mean of each match's largest single-turn swing; null when no match played a turn. */
    largestSwing: number | null;
    /** The largest single-turn swing any one match saw. */
    maxLargestSwing: number | null;
    /** Over the matches whose lead changed at all; null when none did. */
    finalChangeTurn: number | null;
  };
  /** Over every turn every counted match played. */
  perTurn: { flips: number; neutralCaptures: number; nodeHandChanges: number };
}

/** What one player scouted over the matches it played. */
export interface ScoutRow {
  /** The player, as the match log's header names it. */
  label: string;
  matches: number;
  scouts: number;
  reScouts: number;
  /** Distinct hex labels, summed over the matches: the same hex in two matches counts twice. */
  distinct: number;
  reScoutsPerMatch: number;
}

/** What `seriesEvidence` returns. */
export interface SeriesEvidence {
  dir: string;
  recordPath: string;
  /** Where `renderSeriesEvidence` writes the markdown: `<dir>/evidence.md`. */
  evidencePath: string;
  xLabel: string;
  opponentLabel: string;
  pairs: number;
  /** Matches the record names, counted and missing alike. */
  matches: number;
  counted: number;
  missing: MissingMatches;
  rows: MatchEvidenceRow[];
  /** Turns every counted match played: the denominator of the per-turn means. */
  turnCount: number;
  totals: EvidenceTotals;
  means: EvidenceMeans;
  /** The band totals over every counted match, so "late on" spans the series. */
  byBand: { flips: BandCounts; neutralCaptures: BandCounts; nodeHandChanges: BandCounts };
  /** The ping-pong flag over the series: how many matches had it, and which Nodes. */
  pingPong: { matches: number; nodes: { seed: number; hex: HexLabel; turns: number[] }[] };
  scouts: ScoutRow[];
}

/** The band counts of several matches added, with the means taken again. */
const mergeBands = (parts: readonly BandCounts[]): BandCounts => {
  const merged = blankBandCounts();
  for (const part of parts) {
    for (const band of DEPTH_BANDS) {
      merged[band.name].turns += part[band.name].turns;
      merged[band.name].total += part[band.name].total;
    }
  }
  for (const band of DEPTH_BANDS) {
    const each = merged[band.name];
    each.mean = each.turns === 0 ? null : each.total / each.turns;
  }
  return merged;
};

/** Every counted match's log read, and the ones that did not count listed as missing. */
async function readEvidenceRows(
  dir: string,
  records: readonly { seed: number; match: MatchRecord }[],
): Promise<{ counted: MatchEvidenceRow[]; missing: MissingMatch[] }> {
  const counted: MatchEvidenceRow[] = [];
  const missing: MissingMatch[] = [];
  for (const { seed, match } of records) {
    // The path the log should have been at, as `series-report` reports it.
    const path = logPathsOf(dir, match.path).at(-1)!;
    if (match.status === "failed") {
      missing.push({ seed, seat: match.seat, path, kind: "failed", reason: reasonOfFailure(match.error) });
      continue;
    }
    const { log, why } = await readLogOf(dir, match.path);
    if (log === null) {
      missing.push({
        seed,
        seat: match.seat,
        path,
        kind: why === "" ? "missing_log" : "unreadable_log",
        reason: why === "" ? "the record names a log that is not on disk" : why,
      });
      continue;
    }
    const voided = voidReasonOf(log);
    if (voided !== null) {
      missing.push({ seed, seat: match.seat, path, kind: "voided", reason: voided });
      continue;
    }
    counted.push({
      seed,
      seat: match.seat,
      path,
      players: { A: playerLabel(log.players.A), B: playerLabel(log.players.B) },
      evidence: evidenceOfLog(log),
    });
  }
  return { counted, missing };
}

/** One player's scouts, gathered from every seat of every match it played. */
const scoutRowsOf = (rows: readonly MatchEvidenceRow[]): ScoutRow[] => {
  const byLabel = new Map<string, ScoutRow>();
  for (const { players, evidence } of rows) {
    for (const seat of ["A", "B"] as const) {
      const label = players[seat];
      const row = byLabel.get(label) ?? { label, matches: 0, scouts: 0, reScouts: 0, distinct: 0, reScoutsPerMatch: 0 };
      row.matches += 1;
      row.scouts += evidence.scouts[seat].scouts;
      row.reScouts += evidence.scouts[seat].reScouts;
      row.distinct += evidence.scouts[seat].distinct;
      byLabel.set(label, row);
    }
  }
  for (const row of byLabel.values()) {
    row.reScoutsPerMatch = row.matches === 0 ? 0 : row.reScouts / row.matches;
  }
  return [...byLabel.values()].sort((left, right) => left.label.localeCompare(right.label));
};

/** Read a series directory and total these figures over the matches that count. */
export async function seriesEvidence(dir: string): Promise<SeriesEvidence> {
  const record = await readSeriesRecord(dir);
  const records = seriesMatchRecords(record);
  const { counted, missing } = await readEvidenceRows(dir, records);

  const sum = (pick: (row: MatchEvidenceRow) => number): number =>
    counted.reduce((total, row) => total + pick(row), 0);
  const turnCount = sum((row) => row.evidence.turns.length);
  const swings = counted
    .map((row) => row.evidence.lead.largestSwing)
    .filter((swing): swing is { points: number; turn: number } => swing !== null);
  const finalChanges = counted
    .map((row) => row.evidence.lead.finalChangeTurn)
    .filter((turn) => turn > 0);
  const mean = (total: number, over: number): number => (over === 0 ? 0 : total / over);

  const pingPongNodes = counted.flatMap((row) =>
    row.evidence.nodes.hexes
      .filter(({ hex }) => row.evidence.nodes.pingPongHexes.includes(hex))
      .map(({ hex, turns }) => ({ seed: row.seed, hex, turns })),
  );

  return {
    dir,
    recordPath: join(dir, "series.json"),
    evidencePath: join(dir, "evidence.md"),
    xLabel: seatLabel(record.pairing.a),
    opponentLabel: seatLabel(record.pairing.b),
    pairs: record.pairs.length,
    matches: records.length,
    counted: counted.length,
    missing: missingOf(missing),
    rows: counted,
    turnCount,
    totals: {
      leadChanges: sum((row) => row.evidence.lead.changes),
      flips: sum((row) => row.evidence.flips.total),
      nodeHandChanges: sum((row) => row.evidence.nodes.handChanges),
      neutralCaptures: sum((row) => row.evidence.neutralCaptures.total),
      scouts: sum((row) => row.evidence.scouts.A.scouts + row.evidence.scouts.B.scouts),
      reScouts: sum((row) => row.evidence.scouts.A.reScouts + row.evidence.scouts.B.reScouts),
      matchesWithLeadChange: counted.filter((row) => row.evidence.lead.changes > 0).length,
      pingPongMatches: counted.filter((row) => row.evidence.nodes.pingPong).length,
    },
    means: {
      perMatch: {
        leadChanges: mean(sum((row) => row.evidence.lead.changes), counted.length),
        flips: mean(sum((row) => row.evidence.flips.total), counted.length),
        nodeHandChanges: mean(sum((row) => row.evidence.nodes.handChanges), counted.length),
        neutralCaptures: mean(sum((row) => row.evidence.neutralCaptures.total), counted.length),
        reScouts: mean(sum((row) => row.evidence.scouts.A.reScouts + row.evidence.scouts.B.reScouts), counted.length),
        largestSwing:
          swings.length === 0 ? null : swings.reduce((total, each) => total + each.points, 0) / swings.length,
        maxLargestSwing: swings.length === 0 ? null : Math.max(...swings.map((each) => each.points)),
        finalChangeTurn:
          finalChanges.length === 0 ? null : finalChanges.reduce((total, each) => total + each, 0) / finalChanges.length,
      },
      perTurn: {
        flips: mean(sum((row) => row.evidence.flips.total), turnCount),
        neutralCaptures: mean(sum((row) => row.evidence.neutralCaptures.total), turnCount),
        nodeHandChanges: mean(sum((row) => row.evidence.nodes.handChanges), turnCount),
      },
    },
    byBand: {
      flips: mergeBands(counted.map((row) => row.evidence.flips.byBand)),
      neutralCaptures: mergeBands(counted.map((row) => row.evidence.neutralCaptures.byBand)),
      nodeHandChanges: mergeBands(counted.map((row) => row.evidence.nodes.byBand)),
    },
    pingPong: { matches: counted.filter((row) => row.evidence.nodes.pingPong).length, nodes: pingPongNodes },
    scouts: scoutRowsOf(counted),
  };
}

/**
 * The bot figures `salient/docs/salient-rules-v0.md` quotes in "Open questions",
 * in the rules' own words: "Without it, bot matches flipped about 6.5 hexes a
 * turn late on and the lead changed 3.2 times a match… With it, 1 to 2.4 hexes
 * flip and the lead changes 1.4 times." They are printed beside the measured
 * figures so that the rules review has the comparison in front of it; they are
 * quoted, not measured here, and they are not a target.
 */
export const RULES_BOT_FIGURES = {
  flipsLateOn: { withoutHomeBonus: "6.5", withHomeBonus: "1 to 2.4" },
  leadChanges: { withoutHomeBonus: "3.2", withHomeBonus: "1.4" },
} as const;

/** The evidence as markdown: the rules' questions, answered for one series. */
export const renderSeriesEvidenceMarkdown = (evidence: SeriesEvidence): string => {
  const num = (n: number, dp = 1): string => n.toFixed(dp);
  const maybe = (n: number | null, dp = 1): string => (n === null ? "—" : num(n, dp));
  const row = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
  const out: string[] = [];

  out.push(`# Rules evidence: ${evidence.xLabel} vs ${evidence.opponentLabel}`, "");
  out.push(`Series directory \`${evidence.dir}\`.`, "");
  out.push(
    "Every figure here is counted out of the match logs alone — no engine, no replay — and is " +
      "what `docs/rules-review.md` writes from. Compaction turns and context size are not " +
      "repeated: they are in `report.md` beside this file.",
    "",
  );
  out.push(
    `${String(evidence.pairs)} pairs recorded, ${String(evidence.matches)} matches: ` +
      `**${String(evidence.counted)} counted**, **${String(evidence.missing.total)} missing**.`,
    "",
  );

  out.push("## Per match", "");
  out.push(
    "The lead changes, largest swing and final lead change columns are brief §6.7's " +
      "excitement score, which is also how the showcase match is ranked.",
    "",
  );
  out.push(
    row([
      "seed",
      "X's seat",
      "turns",
      "lead changes",
      "largest swing",
      "final lead change",
      "hex flips",
      "flips/turn 18-25",
      "Node hand changes",
      "Node ping-pong",
      "neutral captures",
    ]),
  );
  out.push(row(["---:", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---", "---:"]));
  for (const each of evidence.rows) {
    const { lead, flips, nodes, neutralCaptures } = each.evidence;
    out.push(
      row([
        String(each.seed),
        each.seat,
        String(each.evidence.turns.length),
        String(lead.changes),
        lead.largestSwing === null ? "—" : `${String(lead.largestSwing.points)} (turn ${String(lead.largestSwing.turn)})`,
        lead.finalChangeTurn === 0 ? "none" : String(lead.finalChangeTurn),
        String(flips.total),
        maybe(flips.lateMean, 2),
        String(nodes.handChanges),
        nodes.pingPongHexes.length === 0 ? "—" : nodes.pingPongHexes.join(", "),
        String(neutralCaptures.total),
      ]),
    );
  }
  out.push("");

  out.push("## Over the series", "");
  out.push(row(["", "series", "turns 1-8", "turns 9-17", "turns 18-25"]));
  out.push(row(["---", "---:", "---:", "---:", "---:"]));
  const across = (
    label: string,
    series: string,
    counts: BandCounts,
    pick: (each: BandCount) => string,
  ): string => row([label, series, pick(counts["1-8"]), pick(counts["9-17"]), pick(counts["18-25"])]);
  const totalOf = (counts: BandCounts): number =>
    counts["1-8"].total + counts["9-17"].total + counts["18-25"].total;
  out.push(
    across("turns", String(evidence.turnCount), evidence.byBand.flips, (each) => String(each.turns)),
  );
  for (const [label, counts, perTurn] of [
    ["hex flips", evidence.byBand.flips, evidence.means.perTurn.flips],
    [
      "captures of neutral hexes",
      evidence.byBand.neutralCaptures,
      evidence.means.perTurn.neutralCaptures,
    ],
    ["Node hand changes", evidence.byBand.nodeHandChanges, evidence.means.perTurn.nodeHandChanges],
  ] as const) {
    out.push(across(label, String(totalOf(counts)), counts, (each) => String(each.total)));
    out.push(across(`${label} per turn`, num(perTurn, 2), counts, (each) => maybe(each.mean, 2)));
  }
  out.push("");

  out.push("## Per match, on average", "");
  out.push(
    row([
      "matches",
      "lead changes",
      "matches that changed the lead",
      "hex flips",
      "Node hand changes",
      "neutral captures",
      "re-scouts, both seats",
    ]),
  );
  out.push(row(["---:", "---:", "---:", "---:", "---:", "---:", "---:"]));
  out.push(
    row([
      String(evidence.counted),
      num(evidence.means.perMatch.leadChanges, 2),
      `${String(evidence.totals.matchesWithLeadChange)} of ${String(evidence.counted)}`,
      num(evidence.means.perMatch.flips, 2),
      num(evidence.means.perMatch.nodeHandChanges, 2),
      num(evidence.means.perMatch.neutralCaptures, 2),
      num(evidence.means.perMatch.reScouts, 2),
    ]),
    "",
  );
  out.push(
    row([
      "largest single-turn swing, mean",
      "largest single-turn swing, highest match",
      "turn of the final lead change",
      "hex flips per turn",
      "neutral captures per turn",
      "Node hand changes per turn",
    ]),
  );
  out.push(row(["---:", "---:", "---:", "---:", "---:", "---:"]));
  out.push(
    row([
      maybe(evidence.means.perMatch.largestSwing, 2),
      maybe(evidence.means.perMatch.maxLargestSwing, 0),
      maybe(evidence.means.perMatch.finalChangeTurn, 1),
      num(evidence.means.perTurn.flips, 2),
      num(evidence.means.perTurn.neutralCaptures, 2),
      num(evidence.means.perTurn.nodeHandChanges, 2),
    ]),
    "",
  );
  out.push(
    "The turn of the final lead change is averaged over the matches whose lead changed " +
      "at all; a match that never changed it contributes nothing rather than a nought.",
    "",
  );

  out.push("## Against the rules' bot figures", "");
  out.push(
    row(["question", "bots without the home bonus", "bots with it", "this series"]),
  );
  out.push(row(["---", "---", "---", "---:"]));
  out.push(
    row([
      "hexes flipped a turn late on (turns 18-25)",
      RULES_BOT_FIGURES.flipsLateOn.withoutHomeBonus,
      RULES_BOT_FIGURES.flipsLateOn.withHomeBonus,
      maybe(evidence.byBand.flips["18-25"].mean, 2),
    ]),
  );
  out.push(
    row([
      "lead changes a match",
      RULES_BOT_FIGURES.leadChanges.withoutHomeBonus,
      RULES_BOT_FIGURES.leadChanges.withHomeBonus,
      num(evidence.means.perMatch.leadChanges, 2),
    ]),
    "",
  );
  out.push(
    "The rules' figures are bot matches; this series' are whatever its pairing played. " +
      "The comparison is the point of the row, not a pass or a fail.",
    "",
  );

  out.push("## Node ping-pong", "");
  if (evidence.pingPong.matches === 0) {
    out.push(
      "No counted match had a Node change owner on three or more turns with at least " +
        "two of them consecutive.",
      "",
    );
  } else {
    out.push(
      `**${String(evidence.pingPong.matches)} of ${String(evidence.counted)} counted matches** had a ` +
        "Node change owner on three or more turns with at least two of them consecutive.",
      "",
    );
    for (const each of evidence.pingPong.nodes) {
      out.push(
        `- seed \`${String(each.seed)}\`, hex \`${each.hex}\`, turns ` +
          each.turns.map((turn) => String(turn)).join(", "),
      );
    }
    out.push("");
  }

  out.push("## Re-scouts", "");
  out.push(
    "A scout of a hex that seat had already scouted in the match. A seat that re-scouts " +
      "the same hexes over and over is paying action points for memory the engine could hand it.",
    "",
  );
  out.push(row(["player", "matches", "scouts", "re-scouts", "distinct hexes", "re-scouts per match"]));
  out.push(row(["---", "---:", "---:", "---:", "---:", "---:"]));
  for (const each of evidence.scouts) {
    out.push(
      row([
        each.label,
        String(each.matches),
        String(each.scouts),
        String(each.reScouts),
        String(each.distinct),
        num(each.reScoutsPerMatch, 2),
      ]),
    );
  }
  out.push("");

  out.push("## Missing matches", "");
  if (evidence.missing.total === 0) {
    out.push("No match failed or was voided: every match the series recorded is counted above.", "");
  } else {
    out.push(
      `**${String(evidence.missing.total)} of the series' ${String(evidence.matches)} matches are not in ` +
        "the figures above.**",
      "",
    );
    out.push(row(["reason", "how", "matches"]));
    out.push(row(["---", "---", "---:"]));
    for (const group of evidence.missing.byReason) {
      out.push(row([group.reason, group.kinds.join(", "), String(group.count)]));
    }
    out.push("");
  }

  // One trailing newline: the CLI prints the same text with the trailing blank
  // lines stripped, and a file that ends in a blank line prints differently.
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
};

/**
 * The evidence as markdown, written to `<dir>/evidence.md` beside the
 * `series.json` it was read from.
 */
export async function renderSeriesEvidence(
  dir: string,
): Promise<{ evidence: SeriesEvidence; markdown: string; path: string }> {
  const evidence = await seriesEvidence(dir);
  const markdown = renderSeriesEvidenceMarkdown(evidence);
  await writeFile(evidence.evidencePath, markdown, "utf8");
  return { evidence, markdown, path: evidence.evidencePath };
}
