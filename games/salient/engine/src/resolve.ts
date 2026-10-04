/**
 * Turn resolution: both players' orders applied together in the one fixed
 * sequence the rules give — validate, depart, clash on the edge, arrive, fight
 * in the hex, take neutral Nodes, set ownership, check for knockout, produce.
 * The behaviour is ported from `resolve` in `salient/docs/reference/engine.js`.
 *
 * The state handed in is never touched: the troops a hex may send are the
 * troops standing there when the turn started, so a new board is built and
 * returned instead. That is what lets `simulate` run the real resolution as
 * many times as a player likes.
 *
 * Whole numbers only, no clock, and no dependence on the order the hexes happen
 * to be keyed in: the board is walked in one fixed order, row then column.
 */
import { DEFAULT_CONFIG, type Config } from "./config";
import { parseHexKey } from "./hex";
import { score } from "./supply";
import type { Hex, HexKey, MatchState, Order, Seat, TurnEvent, WastedOrder } from "./types";
import { validateOrders } from "./validate-orders";

const SEATS: readonly Seat[] = ["A", "B"];

export interface TurnOutcome {
  /** The board as it stands for the next turn, with the match result if it ended. */
  state: MatchState;
  /** Clashes, fights, repelled attacks and captures, in the order they happened. */
  events: TurnEvent[];
  /** Each seat's dropped orders, with the reason each was dropped. */
  wasted: Record<Seat, WastedOrder[]>;
}

/** A move as one map key. Hex keys hold digits, `-` and `,`, never `>`. */
const edgeKey = (from: HexKey, to: HexKey): string => `${from}>${to}`;

/**
 * Resolve one turn. `apSpentOnScouts` is the action points each seat already
 * used on scouting, which is what is left of `config.actionPoints` for its
 * orders; a seat that submits more orders than that has the extra ones wasted.
 * A seat with no orders in `orders` simply passes.
 */
export function resolveTurn(
  state: MatchState,
  orders: Readonly<Partial<Record<Seat, readonly Order[]>>>,
  apSpentOnScouts: Readonly<Partial<Record<Seat, number>>> = {},
  config: Config = DEFAULT_CONFIG,
): TurnOutcome {
  const events: TurnEvent[] = [];
  const wasted: Record<Seat, WastedOrder[]> = { A: [], B: [] };
  const hexes = copyBoard(state);

  // 1. Validate, and 2. depart. Validation reads the board as it stood at the
  // start of the turn, so a hex cannot send troops that arrive this turn, and
  // the moves out of one hex share the troops standing there.
  const leaving: Record<Seat, Map<HexKey, number>> = { A: new Map(), B: new Map() };
  const moving: Record<Seat, Map<string, number>> = { A: new Map(), B: new Map() };
  for (const seat of SEATS) {
    const apForOrders = config.actionPoints - (apSpentOnScouts[seat] ?? 0);
    const checked = validateOrders(state, seat, orders[seat] ?? [], apForOrders);
    wasted[seat] = checked.wasted;
    for (const order of checked.accepted) {
      const edge = edgeKey(order.from, order.to);
      moving[seat].set(edge, (moving[seat].get(edge) ?? 0) + order.troops);
      leaving[seat].set(order.from, (leaving[seat].get(order.from) ?? 0) + order.troops);
    }
  }

  // 3. Clash on the edge. Two forces crossing the same edge in opposite
  // directions destroy the smaller and lose the same number themselves.
  for (const [edge, a] of moving.A) {
    const [from, to] = edge.split(">");
    const back = edgeKey(to, from);
    const b = moving.B.get(back) ?? 0;
    if (a <= 0 || b <= 0) continue;
    const both = Math.min(a, b);
    moving.A.set(edge, a - both);
    moving.B.set(back, b - both);
    events.push({ type: "clash", between: [from, to], A: a, B: b });
  }

  // 4. Arrive.
  const arriving: Record<Seat, Map<HexKey, number>> = { A: new Map(), B: new Map() };
  for (const seat of SEATS) {
    for (const [edge, troops] of moving[seat]) {
      const to = edge.split(">")[1];
      arriving[seat].set(to, (arriving[seat].get(to) ?? 0) + troops);
    }
  }

  for (const key of boardOrder(state)) {
    const hex = hexes[key];
    if (hex.terrain === "blocked") continue;
    const owner = hex.owner;

    // 5. Fight in the hex. The owner adds the home bonus, which absorbs its
    // first loss; the larger strength wins and loses troops equal to the
    // smaller strength; on a tie the attackers die and the hex holds.
    const homeA = owner === "A" ? config.homeBonus : 0;
    const homeB = owner === "B" ? config.homeBonus : 0;
    let a = (owner === "A" ? hex.troops - (leaving.A.get(key) ?? 0) : 0) + (arriving.A.get(key) ?? 0);
    let b = (owner === "B" ? hex.troops - (leaving.B.get(key) ?? 0) : 0) + (arriving.B.get(key) ?? 0);
    if ((a > 0 && b > 0) || (owner === "A" && b > 0) || (owner === "B" && a > 0)) {
      const strengthA = a + homeA;
      const strengthB = b + homeB;
      const smaller = Math.min(strengthA, strengthB);
      if (a > 0 && b > 0) {
        events.push({ type: "battle", at: key, A: a, B: b, owner });
      } else if (strengthA === strengthB || (owner === "A" ? strengthA > strengthB : strengthB > strengthA)) {
        // Only one side brought troops: its attack was turned back.
        events.push({ type: "repelled", at: key, by: owner === "A" ? "B" : "A", n: a + b });
      }
      a = strengthA > strengthB ? a - Math.max(0, smaller - homeA) : 0;
      b = strengthB > strengthA ? b - Math.max(0, smaller - homeB) : 0;
    }

    let side: Seat | null = a > 0 ? "A" : b > 0 ? "B" : null;
    let troops = a + b;

    // 6. Take neutral Nodes. The force entering has to exceed the garrison and
    // loses that many troops; a smaller force is destroyed and wears the
    // garrison down by its own size.
    if (side !== null && owner === null && hex.garrison > 0) {
      if (troops > hex.garrison) {
        troops -= hex.garrison;
        hex.garrison = 0;
      } else {
        events.push({ type: "repelled", at: key, by: side, n: troops });
        hex.garrison -= troops;
        troops = 0;
        side = null;
      }
    }

    // 7. Set ownership. Surviving troops own the hex; a hex left with none keeps
    // its owner, so emptying a hex never loses it.
    if (side !== null && troops > 0) {
      if (hex.owner !== side) {
        events.push({ type: "capture", at: key, by: side, from: hex.owner, terrain: hex.terrain });
      }
      hex.owner = side;
      hex.troops = troops;
    } else if (hex.owner !== null) {
      hex.troops = 0;
    }
  }

  const next: MatchState = {
    turn: state.turn + 1,
    seed: state.seed,
    hexes,
    base: { A: state.base.A, B: state.base.B },
    over: state.over,
    result: state.result,
  };

  // 8. Check for knockout. The board keeps the true position; only the result
  // is scored as every point on the board to the seat that is still standing.
  const baseFell: Record<Seat, boolean> = {
    A: hexes[state.base.A].owner !== "A",
    B: hexes[state.base.B].owner !== "B",
  };
  if (baseFell.A || baseFell.B) {
    const winner: Seat | null = baseFell.A && baseFell.B ? null : baseFell.A ? "B" : "A";
    const board = pointsOnBoard(hexes, config);
    next.over = true;
    next.result = {
      type: "knockout",
      winner,
      turn: state.turn,
      score: { A: winner === "A" ? board : 0, B: winner === "B" ? board : 0 },
    };
  } else {
    // 9. Produce, and only while the match continues. A Base gains 2 and each
    // owned Node gains 1, whether or not that Node is cut off from its Base.
    for (const key of boardOrder(state)) {
      const hex = hexes[key];
      if (hex.owner === null) continue;
      if (hex.terrain === "base") hex.troops += config.baseProduction;
      else if (hex.terrain === "node") hex.troops += config.nodeProduction;
    }
  }

  if (!next.over) {
    const scores: Record<Seat, number> = {
      A: score(next, "A", config).points,
      B: score(next, "B", config).points,
    };
    if (state.turn >= config.turns) {
      next.over = true;
      next.result = {
        type: "time",
        winner: scores.A > scores.B ? "A" : scores.B > scores.A ? "B" : null,
        turn: state.turn,
        score: scores,
      };
    }
  }

  return { state: next, events, wasted };
}

/** A copy of the board, so the state that came in is left exactly as it was. */
function copyBoard(state: MatchState): Record<HexKey, Hex> {
  const copy: Record<HexKey, Hex> = {};
  for (const key of Object.keys(state.hexes)) copy[key] = { ...state.hexes[key] };
  return copy;
}

/** Every hex key in one fixed order — row, then column — never key order. */
function boardOrder(state: MatchState): HexKey[] {
  return Object.keys(state.hexes)
    .map((key) => ({ key, at: parseHexKey(key) }))
    .sort((left, right) => left.at.r - right.at.r || left.at.q - right.at.q)
    .map((cell) => cell.key);
}

/** Every point on the board: what a knockout is recorded as, 93 on a full map. */
function pointsOnBoard(hexes: Readonly<Record<HexKey, Hex>>, config: Config): number {
  let total = 0;
  for (const key of Object.keys(hexes)) {
    const terrain = hexes[key].terrain;
    if (terrain !== "blocked") total += config.points[terrain];
  }
  return total;
}
