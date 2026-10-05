/**
 * The lead by turn: one bar per turn of the match's axis, A's above the line
 * and B's below, the frame's own turn marked with its margin over it.
 *
 * Every margin is `score.A - score.B` from `turns[n].after.score`, and from
 * nowhere else. The result's own `margin` is deliberately not read: it says how
 * the match ended, which is one number, while the chart is about the shape of
 * the match — the turns it was level, the turn it turned, and how far ahead it
 * ever got. A knockout whose result says `93` still draws the 1-point lead it
 * opened on.
 *
 * The axis is `config.turns` long rather than as long as the match got, which is
 * what the mock-up draws: golden-03 was knocked out at turn 19 of 25 and still
 * shows 25 slots, the last six of them blank. Turns after the frame are blank
 * too, played or not — the chart replays with the frame, so turn 11 has no bar
 * while the viewer is at turn 4.
 *
 * The geometry is the mock-up's (`salient/docs/mockups/spectator-view.html`): a
 * 112 px box with the zero line at its middle, 44 px per turn, a 24 px bar inset
 * 10 px in each slot, and 4 px per point of margin. That last number is a cap
 * rather than a rule — a match decided by 74 points would need 296 px of a
 * 56 px half — so the scale shrinks to whatever fits the match's widest lead,
 * and does so over the whole match rather than per frame, which keeps the bars
 * from resizing under the scrubber.
 *
 * A slot also carries the marks of its turn — a submission refused, a pass, a
 * context compacted — which brief §6.8 asks the strip to show as well as the
 * panel. They come from `marks.ts`, so the strip and the panel mark the same
 * turns for the same reasons, and a turn the log does not mark is not marked
 * here either.
 *
 * What a slot means — which class it gets, what is written over it — is the
 * renderer's decision, and lives in `render-chart.ts`.
 */
import type { MatchLog, Seat, TurnRecord } from "@no-dice/log";

import { marksOfTurn, type SeatMarks } from "./marks.ts";

/** The mock-up's chart box, and the zero line at its middle. */
export const CHART_HEIGHT = 112;
export const ZERO_LINE = CHART_HEIGHT / 2;

/** One turn of the axis; the bar inside it is 24 px wide, inset 10 px. */
export const SLOT_WIDTH = 44;

/** The mock-up's 4 px per point: the largest a bar is ever drawn at. */
export const PIXELS_PER_POINT = 4;

/** The least a played turn with a lead is drawn at, so a 1-point lead is seen. */
export const MIN_BAR_HEIGHT = 1;

/** One turn of the chart: what the log says the lead was, and how it is drawn. */
export interface LeadSlot {
  /** The turn this slot stands for, counting from 1. */
  readonly turn: number;
  /** Whether the match had reached this turn as of the frame. */
  readonly played: boolean;
  /** `score.A - score.B` after the turn; 0 for a turn the frame has not reached. */
  readonly margin: number;
  /** Who the bar belongs to: `A` above the line, `B` below, `null` when level. */
  readonly leader: Seat | null;
  /** The frame's own turn, which is drawn marked with its margin over it. */
  readonly marked: boolean;
  /**
   * The seats whose turn here was marked, in seat order and empty when neither
   * was: a refused submission, a pass, or a compaction. A turn the frame has not
   * reached has no marks to show, played log or not.
   */
  readonly marks: readonly SeatMarks[];
  /** The bar's height in pixels: 0 for a level turn or an unplayed one. */
  readonly height: number;
}

/** The whole chart: the axis it is drawn on, and one slot per turn of it. */
export interface ChartView {
  /** The frame being shown: 0 for the start position, then the turn's number. */
  readonly frame: number;
  /** How many turns the axis holds: `config.turns`, reached or not. */
  readonly axis: number;
  /** Pixels per point of margin, the mock-up's 4 shrunk to fit the match. */
  readonly scale: number;
  /** One slot per turn of the axis, in turn order. */
  readonly slots: readonly LeadSlot[];
}

/** The margin one turn leaves: what the chart is a view of. */
function marginAfter(record: TurnRecord): number {
  return record.after.score.A - record.after.score.B;
}

/**
 * Pixels per point of margin: the mock-up's 4 px, unless the match's widest
 * lead would not fit the half of the box it is drawn in, in which case the
 * whole match is drawn at the largest scale that does. Measured over every turn
 * the log holds, not only the ones the frame has reached, so scrubbing moves the
 * mark without resizing the bars.
 */
function scaleFor(log: MatchLog): number {
  const widest = Math.max(0, ...log.turns.map((record) => Math.abs(marginAfter(record))));
  if (widest === 0) return PIXELS_PER_POINT;
  return Math.min(PIXELS_PER_POINT, ZERO_LINE / widest);
}

/**
 * The chart for one frame of a log: a slot for every turn of `config.turns`,
 * filled in for the turns the match had reached by `frame`, and with `frame`
 * itself marked. Frame 0 is the start position, which has no turn to mark and
 * no lead of its own — the match has not diverged yet.
 */
export function chartView(log: MatchLog, frame: number): ChartView {
  const scale = scaleFor(log);
  const slots: LeadSlot[] = [];

  for (let turn = 1; turn <= log.config.turns; turn += 1) {
    // A turn the log holds but the frame has not reached is not played yet.
    const record = turn <= frame ? log.turns.find((candidate) => candidate.n === turn) : undefined;
    const margin = record === undefined ? 0 : marginAfter(record);
    slots.push({
      turn,
      played: record !== undefined,
      margin,
      leader: margin > 0 ? "A" : margin < 0 ? "B" : null,
      marked: turn === frame,
      // The marks belong to the turn as played, so a turn the frame has not
      // reached shows none even when the log already holds it.
      marks: record === undefined ? [] : marksOfTurn(record),
      // A level turn has no side to be drawn on, and an unplayed turn has no
      // margin at all, so both come back with no bar.
      height: margin !== 0 ? Math.max(MIN_BAR_HEIGHT, Math.round(Math.abs(margin) * scale)) : 0,
    });
  }

  return { frame, axis: log.config.turns, scale, slots };
}
