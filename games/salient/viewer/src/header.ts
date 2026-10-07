/**
 * The header row of the mock-up: both seats' names and scores, the turn counter,
 * the score bar and the line under it — as numbers and sentences, with no DOM.
 *
 * Nothing here is a constant. The scores are `start.score` at frame 0 and
 * `turns[n].after.score` at frame `n`; a seat's name comes from `players`, a `pi`
 * seat named by the model it was played with and a `bot` seat by its bot; the
 * counter counts the frame against `config.turns`, which is why a match knocked
 * out at turn 19 still reads `OF 25`.
 *
 * The one number a log does not carry is what the whole board is worth. It is
 * the map's playable hexes valued by `config.points` — plain, Base and Node each
 * at their own price, a blocked hex worth nothing because nobody can hold it —
 * which for golden-01's 79 playable hexes and 7 Nodes is the 93 the mock-up
 * draws, and which a smaller or differently seeded map changes. The points
 * nobody is scoring are that total minus both scores, and that is what supply
 * costs a player: a hex its owner is out of supply on is still on the board and
 * still scores nothing.
 *
 * The series line the mock-up shows is not in a log either, and it is not built
 * here: a log holds one match, and the series comes from the
 * `salient-showcase/1` sidecar `series.ts` reads and turns into that line. The
 * header row is drawn with it when one was loaded and with a sentence saying
 * there is none when one was not — `render-header.ts` owns which of the two.
 */
import type { LogConfig, LogScore, MapHex, MatchLog, PlayerHeader, Seat } from "@no-dice/log";

/** What one seat is called: a model's name for a `pi` seat, a bot's for a `bot` seat. */
export function seatName(player: PlayerHeader): string {
  return player.kind === "pi" ? player.model : player.bot;
}

/** What one hex of the map is worth under the points the match was played for. */
function hexPoints(hex: MapHex, points: LogConfig["points"]): number {
  switch (hex.terrain) {
    case "plain":
      return points.plain;
    case "base":
      return points.base;
    case "node":
      return points.node;
    case "blocked":
      // Impassable, so nobody's, so worth nothing to anybody.
      return 0;
  }
}

/** The points the whole board is worth: what the score bar is drawn against. */
export function boardTotal(log: MatchLog): number {
  return log.map.reduce((sum, hex) => sum + hexPoints(hex, log.config.points), 0);
}

/** The score a frame shows: the start score at frame 0, the logged one after that. */
export function scoreAt(log: MatchLog, frame: number): LogScore {
  if (frame === 0) return log.start.score;
  const record = log.turns.find((turn) => turn.n === frame);
  if (record === undefined) throw new Error(`the log holds no turn ${frame}`);
  return record.after.score;
}

/** One frame of the header: what the two seats are called, and every number. */
export interface HeaderView {
  /** The frame being shown: 0 for the start position, then the turn's number. */
  readonly frame: number;
  /** `TURN 11 OF 25`, the match's length coming from `config.turns`. */
  readonly counter: string;
  readonly names: Readonly<Record<Seat, string>>;
  readonly score: LogScore;
  /** What the whole board is worth, from `map` and `config.points`. */
  readonly total: number;
  /** The points of the total nobody is scoring: the bar's middle segment. */
  readonly unscoring: number;
  /** The line under the bar: the lead, and how much of the total is not scoring. */
  readonly summary: string;
}

/** Who is ahead, in the words the mock-up's line uses. */
function leadText(score: LogScore): string {
  const margin = score.A - score.B;
  if (margin > 0) return `A leads by ${margin}`;
  if (margin < 0) return `B leads by ${-margin}`;
  return "The scores are level";
}

/**
 * The header for one frame of a log. A seat's score can never pass the total —
 * a hex belongs to at most one seat, and `score` only counts hexes its owner is
 * in supply on — so the middle segment is never negative.
 */
export function headerView(log: MatchLog, frame: number): HeaderView {
  const score = scoreAt(log, frame);
  const total = boardTotal(log);
  const unscoring = total - score.A - score.B;
  return {
    frame,
    counter: `TURN ${frame} OF ${log.config.turns}`,
    names: { A: seatName(log.players.A), B: seatName(log.players.B) },
    score,
    total,
    unscoring,
    summary: `${leadText(score)}. ${unscoring} of the ${total} points are not scoring.`,
  };
}
