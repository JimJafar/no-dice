/**
 * The frame index, and what one frame of it shows.
 *
 * The log hands the viewer its frames directly: frame 0 is the start position —
 * `start.cells` and `start.score` — and frames 1 to `turns.length` are the
 * logged turns in order. The last frame is the last turn the log holds, which
 * for a knockout is the knockout turn and not `config.turns`: golden-02 stops at
 * turn 23 of a 25-turn match, so there is no frame 24 to show.
 *
 * The settled frame is the contract. A frame the viewer steps to, scrubs to or
 * pauses on shows exactly what the log says at that turn — the board
 * `turns[n].after`, that turn's orders as arrows, and the hexes its fights were
 * on — which is what lets a test read the mock-up's numbers off a scrubbed
 * frame.
 *
 * The animation is presentation on top of that contract, and runs in four steps
 * per turn, in the order brief §6.8 asks for:
 *
 * - `before` — the board as it stood after the previous turn, with nothing on
 *   it, which is where the last frame left the viewer;
 * - `orders` — that turn's submitted orders appear as arrows, A's then B's,
 *   each in the order its seat's record lists it;
 * - `fight` — the hexes that turn's `battle` and `clash` events were on flash an
 *   outline, the arrows still up;
 * - `settled` — the board settles to `turns[n].after` with the arrows and the
 *   outline still drawn, which is the frame the mock-up shows at turn 11.
 *
 * The steps are moved by `tick()`, which the page drives from a timer of its
 * own. Nothing here reads a clock — no `setTimeout`, no `Date.now()` — so a test
 * can step one turn at a time and see the arrows arrive before the fight.
 *
 * A frame is only ever mid-animation while autoplay is running: stepping,
 * scrubbing and pausing all land on `settled`, so a frame the viewer left alone
 * is the logged one and never a half-drawn turn.
 */
import type { MatchLog, Seat, TurnRecord } from "@no-dice/log";

import { hexCentre } from "./board.ts";

/** The mock-ups' order arrow: 20 × 12 px, rotated to point where the troops go. */
export const ARROW_WIDTH = 20;
export const ARROW_HEIGHT = 12;

/** The mock-ups' fight outline: the hex's own shape, 10 px wider and taller than a hex. */
export const OUTLINE_WIDTH = 70;
export const OUTLINE_HEIGHT = 81;

/** The four steps of one turn, in the order they appear. */
export const PHASES = ["before", "orders", "fight", "settled"] as const;
export type FramePhase = (typeof PHASES)[number];

/** The seats, in the order a frame draws their arrows. */
const SEATS: readonly Seat[] = ["A", "B"];

/** The last frame the log can show: its last logged turn, knockout or not. */
export function lastFrame(log: MatchLog): number {
  return log.turns.length;
}

/**
 * A frame index inside what the log holds: never below the start position, never
 * past the last logged turn, and never between two of them. The scrub slider
 * gives whole numbers, but a hand-written call may not.
 */
export function clampFrame(log: MatchLog, frame: number): number {
  const whole = Math.trunc(Number.isFinite(frame) ? frame : 0);
  return Math.min(Math.max(whole, 0), lastFrame(log));
}

/** The turn record a frame shows, or the error saying the log has no such turn. */
function recordAt(log: MatchLog, frame: number): TurnRecord {
  const record = log.turns.find((turn) => turn.n === frame);
  if (record === undefined) throw new Error(`the log holds no turn ${frame}`);
  return record;
}

/** A hex's centre as the log's `map` places it, or `null` for a hex the map lacks. */
function centreOf(log: MatchLog, label: string): { x: number; y: number } | null {
  const hex = log.map.find((map) => map.id === label);
  return hex === undefined ? null : hexCentre(hex.q, hex.r);
}

/** One submitted order, as an arrow: what moved, and where it is drawn. */
export interface ArrowView {
  readonly seat: Seat;
  readonly from: string;
  readonly to: string;
  readonly troops: number;
  /** The arrow's centre, measured from the centre of the board as a hex's is. */
  readonly x: number;
  readonly y: number;
  /** Which way it points, in whole degrees: the mock-up's `transform: rotate()`. */
  readonly angle: number;
}

/** One hex a fight happened on this turn, as the outline that flashes behind it. */
export interface OutlineView {
  readonly label: string;
  readonly x: number;
  readonly y: number;
}

/** One frame: which turn, which step of it, and what the board area draws. */
export interface TurnFrame {
  /** The frame's turn: 0 for the start position. */
  readonly frame: number;
  readonly phase: FramePhase;
  /**
   * Which board the frame draws: the previous turn's while the turn animates —
   * the start position for turn 1 — and this turn's once it settles.
   */
  readonly board: number;
  readonly arrows: readonly ArrowView[];
  readonly outlines: readonly OutlineView[];
}

/**
 * The arrows one turn's submitted orders make: A's in the order its record
 * lists them, then B's. A seat that passed played no orders, so it draws no
 * arrows whatever its record holds. An order naming a hex the map does not hold
 * cannot be placed and is left out — the panel already lists it, and the board
 * draws the board the log describes.
 */
export function arrowsFor(log: MatchLog, record: TurnRecord): ArrowView[] {
  const arrows: ArrowView[] = [];
  for (const seat of SEATS) {
    const player = record.players[seat];
    if (player.passed !== null) continue;
    for (const order of player.orders) {
      const from = centreOf(log, order.from);
      const to = centreOf(log, order.to);
      if (from === null || to === null) continue;
      arrows.push({
        seat,
        from: order.from,
        to: order.to,
        troops: order.troops,
        // The arrow stands on the edge the troops cross: the midpoint of the two
        // hex centres, which is what the mock-up's arrows sit on.
        x: (from.x + to.x) / 2,
        y: (from.y + to.y) / 2,
        angle: Math.round((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI),
      });
    }
  }
  return arrows;
}

/**
 * The hexes that turn's fights were on, in the order the log saw the events. A
 * `battle` names one hex; a `clash` names an edge, so both hexes it crosses are
 * outlined — the fight happened on the edge, which is on both of them. A hex
 * that fought and was then captured is outlined once.
 */
export function outlinesFor(log: MatchLog, record: TurnRecord): OutlineView[] {
  const labels: string[] = [];
  for (const event of record.events) {
    if (event.type === "battle") labels.push(event.at);
    else if (event.type === "clash") labels.push(event.between[0], event.between[1]);
  }

  const outlines: OutlineView[] = [];
  for (const label of new Set(labels)) {
    const at = centreOf(log, label);
    if (at !== null) outlines.push({ label, ...at });
  }
  return outlines;
}

/**
 * What one frame shows at one step of its turn. The default step is `settled`,
 * which is what a stepped or scrubbed frame is: the logged board, with the
 * turn's arrows and fight outlines over it.
 */
export function frameView(log: MatchLog, frame: number, phase: FramePhase = "settled"): TurnFrame {
  const index = clampFrame(log, frame);
  // The start position has no turn to animate: no orders, no fights, and the
  // board the match opened on.
  if (index === 0) return { frame: 0, phase: "settled", board: 0, arrows: [], outlines: [] };

  const record = recordAt(log, index);
  return {
    frame: index,
    phase,
    // The board as the previous turn left it, until this one settles.
    board: phase === "settled" ? index : index - 1,
    arrows: phase === "before" ? [] : arrowsFor(log, record),
    outlines: phase === "before" || phase === "orders" ? [] : outlinesFor(log, record),
  };
}

/** What the frame controls need to know to say what is showing. */
export interface FrameState {
  readonly frame: number;
  readonly last: number;
  readonly playing: boolean;
}

/**
 * The page's hold on the frame index: where the frame is, which step of it is
 * on screen, and what the viewer asks for — a step back, a step forward, a scrub,
 * autoplay, a pause. Every request lands on a settled frame except `play()`, and
 * `tick()` is the only thing that moves an animation forward, so the page's
 * timer is what the animation is and nothing else.
 */
export interface TurnFrames {
  /** The frame showing: 0 for the start position, else a turn's number. */
  frame(): number;
  /** The last frame the log holds. */
  last(): number;
  /** Whether autoplay is running. */
  playing(): boolean;
  /** Everything the controls need about the frame, in one object. */
  state(): FrameState;
  /** What to draw: the frame at its current step. */
  view(): TurnFrame;
  /** One step back, and stop. Clamped at the start position. */
  stepBack(): void;
  /** One step forward, and stop. Clamped at the last logged turn. */
  stepForward(): void;
  /** Straight to a frame, clamped into what the log holds, and stop. */
  scrub(frame: number): void;
  /** Autoplay from here: each `tick()` finishes this turn and moves to the next. */
  play(): void;
  /** Stop, on the settled frame rather than a half-drawn one. */
  pause(): void;
  /**
   * Advance one step of the animation. A settled frame starts the next turn; a
   * turn at its last step settles; and autoplay stops when it reaches the last
   * logged turn, rather than holding a frame the log does not have.
   */
  tick(): void;
}

/**
 * The frame index for one log, opening on the last turn it holds — the frame
 * the page showed before it had any controls, and the one that says what the
 * match ended up as.
 */
export function turnFrames(log: MatchLog): TurnFrames {
  const last = lastFrame(log);
  let frame = last;
  let phase: FramePhase = "settled";
  let playing = false;

  /** A frame the viewer asked for by hand is the logged one, and nothing runs. */
  const settle = (next: number): void => {
    frame = clampFrame(log, next);
    phase = "settled";
    playing = false;
  };

  return {
    frame: () => frame,
    last: () => last,
    playing: () => playing,
    state: () => ({ frame, last, playing }),
    view: () => frameView(log, frame, phase),
    stepBack: () => settle(frame - 1),
    stepForward: () => settle(frame + 1),
    scrub: (next) => settle(next),
    play: () => {
      playing = true;
    },
    pause: () => {
      playing = false;
      phase = "settled";
    },
    tick: () => {
      if (phase !== "settled") {
        phase = PHASES[PHASES.indexOf(phase) + 1];
        return;
      }
      if (!playing) return;
      if (frame >= last) {
        playing = false;
        return;
      }
      frame += 1;
      phase = "before";
    },
  };
}
