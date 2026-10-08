/**
 * The one line above the board: what happened this turn, in a sentence.
 *
 * The sentence is built from `turns[n].events` and the board the turn leaves,
 * in the shape the mock-up's turn 11 line has
 * (`salient/docs/mockups/spectator-view.html`): "A takes the centre Node, 5
 * against 3, and cuts off five of B's hexes". The clauses it can join, in the
 * order the engine saw the events that made them:
 *
 * - a `capture`, as "<seat> takes the <hex>", with "<A> against <B>" after it
 *   when a `battle` at the same hex came first in the turn — the fight that
 *   took the hex. A battle that led to no capture is left out: a fight that
 *   changed nothing is not the turn's news.
 * - a `clash`, as the two seats meeting on the edge between the two hexes they
 *   crossed, with the troops each sent.
 * - a `repelled`, as the seat whose attack was turned back and the size of the
 *   force that was turned back.
 * - the supply the turn leaves: the `cut_off` cells of each seat, which is what
 *   makes the mock-up's frame legible at all — five hatched hexes with no
 *   sentence to say why they are hatched are just five hexes.
 *
 * A hex is named by its terrain when it is a Base or a Node, since those are
 * the hexes worth caring about by kind, and by its board label otherwise, which
 * is the name the orders and the intent text use. A Base is named for the seat
 * whose Base it is, because that is the only way to tell the two apart without
 * a hex code.
 *
 * A turn with no events says what the seats did instead — that a seat passed,
 * with the reason the log gives — or that no hex changed hands, because an
 * empty line above the board reads as a broken viewer rather than a quiet turn.
 */
import type { Cells, LogEvent, MatchLog, PassReason, Seat, Terrain, TurnRecord } from "@no-dice/log";

/** The seats, in the order a headline names them. */
const SEATS: readonly Seat[] = ["A", "B"];

/** The seat on the other side of the board. */
function other(seat: Seat): Seat {
  return seat === "A" ? "B" : "A";
}

/**
 * Small counts as words, the way the mock-up writes "five of B's hexes"; a
 * bigger count stays a numeral, because "seventeen" is harder to read at a
 * glance than the number.
 */
const COUNT_WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function count(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

/** A `battle` event, which the log package types only as part of the union. */
type BattleEvent = Extract<LogEvent, { type: "battle" }>;

/**
 * How the headline names a hex. `terrain` is what the map says about it, or
 * `null` when the log names a hex the map does not hold, which leaves the label
 * as the only name there is.
 */
function hexName(log: MatchLog, label: string, terrain: Terrain | null): string {
  switch (terrain) {
    case "base":
      for (const seat of SEATS) {
        if (log.bases[seat] === label) return `${seat}'s Base`;
      }
      return "the Base";
    case "node":
      return "the Node";
    default:
      return label;
  }
}

/** What the map says about a hex the log names by label. */
function terrainAt(log: MatchLog, label: string): Terrain | null {
  return log.map.find((hex) => hex.id === label)?.terrain ?? null;
}

/** One fragment of the sentence, and the seat it is about. */
interface Clause {
  readonly text: string;
  /**
   * The seat doing it, or `null` when the fragment has no single subject. The
   * next fragment about the same seat drops the seat's name, which is what
   * makes the mock-up's "…takes the centre Node, 5 against 3, and cuts off…"
   * one clause continuing into the next rather than two sentences.
   */
  readonly seat: Seat | null;
}

/** How many hexes of each seat the turn leaves out of supply. */
function cutOffBySeat(cells: Cells): Record<Seat, number> {
  const cut: Record<Seat, number> = { A: 0, B: 0 };
  for (const cell of cells) {
    if (cell[3] !== 1) continue;
    if (cell[0] === 1) cut.A += 1;
    else if (cell[0] === 2) cut.B += 1;
  }
  return cut;
}

/**
 * The clauses of one turn's sentence, in the order the engine saw the events.
 * A hex cut off from its own Base is cut off by the other seat's advance, so
 * the supply clause names the seat that did the cutting and the hexes of the
 * seat that lost them.
 */
function clausesFor(log: MatchLog, record: TurnRecord): Clause[] {
  const clauses: Clause[] = [];
  const fought = new Map<string, BattleEvent>();

  for (const event of record.events) {
    switch (event.type) {
      case "battle":
        fought.set(event.at, event);
        break;
      case "capture": {
        const took = `${event.by} takes ${hexName(log, event.at, event.terrain)}`;
        const battle = fought.get(event.at);
        clauses.push({
          text: battle === undefined ? took : `${took}, ${battle.A} against ${battle.B}`,
          seat: event.by,
        });
        break;
      }
      case "clash":
        clauses.push({
          text:
            `A and B clash on the edge between ${event.between[0]} and ${event.between[1]}, ` +
            `${event.A} against ${event.B}`,
          seat: null,
        });
        break;
      case "repelled":
        clauses.push({
          text:
            `${event.by} is repelled at ${hexName(log, event.at, terrainAt(log, event.at))}, ` +
            `${count(event.n)} ${event.n === 1 ? "troop" : "troops"} turned back`,
          seat: null,
        });
        break;
    }
  }

  const cutOff = cutOffBySeat(record.after.cells);
  for (const victim of SEATS) {
    const n = cutOff[victim];
    if (n === 0) continue;
    const actor = other(victim);
    const text = `cuts off ${count(n)} of ${victim}'s hexes`;
    const last = clauses.at(-1);
    clauses.push({ text: last !== undefined && last.seat === actor ? text : `${actor} ${text}`, seat: actor });
  }

  return clauses;
}

/** What a seat that played no orders this turn is said to have done. */
const PASS_TEXT: Record<PassReason, string> = {
  no_submission: "sent no orders",
  timeout: "ran out of time",
  prompt_timeout: "never took the prompt",
  token_budget: "ran out of output tokens",
  provider_error: "hit a provider error",
  harness_crash: "crashed its harness",
  tool_surface: "hit a fault in its tool surface",
};

/**
 * The sentence for a turn whose events give the headline nothing to say: what
 * the seats did instead. No clauses means no hex changed hands, whatever troops
 * the seats moved between hexes they already held.
 */
function quietTurn(record: TurnRecord): string {
  const passed: string[] = [];
  for (const seat of SEATS) {
    const reason = record.players[seat].passed;
    if (reason !== null) passed.push(`${seat} ${PASS_TEXT[reason]}`);
  }
  return join([...passed, "no hex changed hands"]);
}

/** The clauses as one sentence: commas between them, and an "and" before the last. */
function join(clauses: readonly string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
}

/** The first letter of the sentence, which the clauses leave lower case. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The one line above the board for one turn of a log: the turn's events joined
 * into a sentence, with the supply the turn leaves at the end. Frame 0 is the
 * start position, which has no events of its own but still gets a line, for the
 * same reason a quiet turn does.
 */
export function headline(log: MatchLog, turn: number): string {
  if (turn === 0) {
    return sentence(
      `the match opens with A holding its Base at ${log.bases.A} and B holding its Base at ${log.bases.B}`,
    );
  }
  const record = log.turns.find((t) => t.n === turn);
  if (record === undefined) throw new Error(`the log holds no turn ${turn}`);

  const clauses = clausesFor(log, record);
  // A turn whose events say nothing — none logged, or only fights that changed
  // no hex — still gets a line, because an empty one reads as a broken viewer.
  return sentence(clauses.length === 0 ? quietTurn(record) : join(clauses.map((clause) => clause.text)));
}
