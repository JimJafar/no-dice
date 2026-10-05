/**
 * What `simulate` answers: what the caller's orders would do, worked out on a
 * board made only of what the caller knows.
 *
 * The run is the engine's real `resolveTurn`, on a copy of the board in which
 * every hex the caller does not know is neutral with nothing on it and no
 * garrison — the two Bases keeping their owners, since their positions are in
 * `get_rules` and an unowned Base would read as a knockout that never happened.
 * That copy is what keeps the tool honest: a hidden stack cannot change the
 * projection, and no hidden number can come back out of it. The price is that a
 * move into or out of an unknown hex is modelled as a move into or out of an
 * empty one, which is why the answer is a projection and not a promise.
 *
 * Nothing is spent here beyond the call itself: the caller's orders are checked
 * against the action points its scouts have left, but the counters move in
 * `session`, which counts one simulation and no action point for a call that
 * ran. Assumed enemy orders are checked the same way, and the whole call is
 * refused unless each starts from a hex the caller can see the enemy holding —
 * an assumption about a hex the caller has not seen is a way of asking who
 * stands there.
 */
import {
  boardCells,
  hexKey,
  resolveTurn as engineResolveTurn,
  score,
  validateOrders,
} from "@no-dice/salient-engine";
import type { Config, Hex, HexKey, MatchState, Seat } from "@no-dice/salient-engine";
import { orderSchema } from "@no-dice/runner/log";
import type { HexLabel, LogOrder, WastedLogOrder } from "@no-dice/runner/log";

import { keyToLabel, ordersToEngine, ordersToLog, wastedToLog } from "./labels.ts";
import type { TurnCounters } from "./session.ts";
import { knownHexes, opponent, ownerAsView, type SeatView } from "./view.ts";

/** One hex the projection moved, in the seat's own words. */
export interface SimulatedHexView {
  id: HexLabel;
  owner: SeatView | null;
  troops: number;
}

/** What `simulate` answers. */
export interface SimulateView {
  /** The caller's orders the engine would carry out. */
  accepted: LogOrder[];
  /** The caller's orders it would drop, each with the engine's reason. */
  wasted: WastedLogOrder[];
  /** Only the hexes whose owner or troop count the projection moved. */
  changed_hexes: SimulatedHexView[];
  /**
   * The caller's own score after the projection. The enemy's is not answered:
   * it depends on hexes the caller has never seen, and a number for it would
   * say what is on them.
   */
  your_score_after: number;
}

export type SimulateOutcome = { ok: true; view: SimulateView } | { ok: false; error: string };

/** Everything `simulate` needs to answer for one seat. */
export interface SimulateInput {
  state: MatchState;
  seat: Seat;
  config: Config;
  /** What the seat has used since the turn opened: its scouts took action points. */
  used: TurnCounters;
  /** The two arrays the call carried, as the player sent them. */
  orders: unknown;
  assumed_enemy_orders?: unknown;
}

/** A call refused: nothing ran, and nothing was learned. */
const refused = (error: string): SimulateOutcome => ({ ok: false, error });

/**
 * Project one turn for `seat`: validate what it asked for, run the real
 * resolution over what it knows, and answer with the part of the outcome that
 * its own knowledge could have produced.
 */
export function simulateTurn(input: SimulateInput): SimulateOutcome {
  const { state, seat, config, used } = input;
  const radius = config.radius;
  const enemy = opponent(seat);

  const mine = parseOrders(input.orders);
  // The assumed enemy orders are optional; anything else has to be orders.
  const assumed =
    input.assumed_enemy_orders === undefined || input.assumed_enemy_orders === null
      ? []
      : parseOrders(input.assumed_enemy_orders);
  if (mine === null || assumed === null) return refused("invalid_orders");

  const known = knownHexes(state, seat, config, used.scouted);
  const shadow = shadowBoard(state, known);

  const assumedEngine = ordersToEngine(assumed, radius);
  for (const order of assumedEngine) {
    // The hex has to be one the caller knows the enemy holds. The known set
    // comes first because the shadow board leaves the enemy owning its Base even
    // where the caller has never looked, and an order out of that hex would be a
    // way of asking what stands on it.
    if (!known.has(order.from) || shadow.hexes[order.from]?.owner !== enemy) {
      return refused("unknown_enemy_hex");
    }
  }

  // The caller's orders get the action points its scouts have left, and the
  // enemy is assumed to have all six, since what it spent on scouting is hidden.
  const mineChecked = validateOrders(
    shadow,
    seat,
    ordersToEngine(mine, radius),
    config.actionPoints - used.apSpentOnScouts,
  );
  const theirsChecked = validateOrders(shadow, enemy, assumedEngine, config.actionPoints);

  const outcome = engineResolveTurn(
    shadow,
    { [seat]: mineChecked.accepted, [enemy]: theirsChecked.accepted },
    // The engine validates again against the same budget, so the accepted
    // orders it was handed are the orders it carries out.
    { [seat]: used.apSpentOnScouts, [enemy]: 0 },
    config,
  );

  return {
    ok: true,
    view: {
      accepted: ordersToLog(mineChecked.accepted, radius),
      wasted: wastedToLog(mineChecked.wasted, radius),
      changed_hexes: changedHexes(shadow, outcome.state, seat, radius, known),
      your_score_after: score(outcome.state, seat, config).points,
    },
  };
}

/** The orders a call carried, in the log's shape, or `null` if any is not one. */
function parseOrders(value: unknown): LogOrder[] | null {
  if (!Array.isArray(value)) return null;
  const orders: LogOrder[] = [];
  for (const order of value) {
    const parsed = orderSchema.safeParse(order);
    if (!parsed.success) return null;
    orders.push(parsed.data);
  }
  return orders;
}

/**
 * The board as the caller knows it: every hex it does not know is neutral, empty
 * and ungarrisoned. Terrain, coordinates and the two Bases stay as they are —
 * the caller has the whole map and both Base positions from `get_rules`, and a
 * Base that is not its seat's has already ended the match, so blanking one would
 * hand the engine a knockout that never happened and a turn with no production.
 * The troops on the enemy Base are still hidden, so they go to nothing.
 */
function shadowBoard(state: MatchState, known: ReadonlySet<HexKey>): MatchState {
  const hexes: Record<HexKey, Hex> = {};
  for (const [key, hex] of Object.entries(state.hexes)) {
    if (known.has(key)) {
      hexes[key] = { ...hex };
      continue;
    }
    const base = state.base.A === key ? "A" : state.base.B === key ? "B" : null;
    hexes[key] = { ...hex, owner: base, troops: 0, garrison: 0 };
  }
  return { ...state, hexes, base: { A: state.base.A, B: state.base.B } };
}

/**
 * The hexes the projection moved, in the board's one order and the seat's words.
 * Only hexes the caller knows are answered: a hex it cannot see has no visible
 * state to report, which is what keeps the stand-in the shadow board puts on the
 * enemy Base — empty, so the engine does not read the turn as a knockout — out
 * of the answer.
 */
function changedHexes(
  before: MatchState,
  after: MatchState,
  seat: Seat,
  radius: number,
  known: ReadonlySet<HexKey>,
): SimulatedHexView[] {
  const changed: SimulatedHexView[] = [];
  for (const cell of boardCells(radius)) {
    const key = hexKey(cell.q, cell.r);
    if (!known.has(key)) continue;
    const was = before.hexes[key];
    const now = after.hexes[key];
    if (was.owner === now.owner && was.troops === now.troops) continue;
    changed.push({
      id: keyToLabel(key, radius),
      owner: ownerAsView(now.owner, seat),
      troops: now.troops,
    });
  }
  return changed;
}
