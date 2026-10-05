/**
 * Order validation: the first step of resolution, and what the server calls for
 * `simulate` and for checking a submission. It reads the board as it stands at
 * the start of the turn and changes nothing, and it only ever looks at one
 * seat, so it can be called for either player in any order.
 */
import { neighbourKeys } from "./hex.ts";
import type { Hex, HexKey, MatchState, Order, Seat, WasteReason, WastedOrder } from "./types.ts";

export interface ValidationResult {
  accepted: Order[];
  wasted: WastedOrder[];
}

/**
 * Split `orders` into the orders that will be carried out and the ones that are
 * dropped, each with its reason.
 *
 * Every order that gets as far as being checked costs one of the `apAvailable`
 * action points, valid or not, because in a final submission a wasted order
 * still spends its point. An order that never gets checked — one beyond the
 * action-point limit — costs nothing.
 *
 * The troops a hex may send are the troops standing there when the turn
 * started, shared by all of the seat's orders: several moves may leave one hex
 * as long as they total no more than that.
 */
export function validateOrders(
  state: MatchState,
  seat: Seat,
  orders: readonly Order[],
  apAvailable: number,
): ValidationResult {
  const board = new Set<HexKey>(Object.keys(state.hexes));
  const accepted: Order[] = [];
  const wasted: WastedOrder[] = [];
  const committed = new Map<HexKey, number>();
  let apLeft = apAvailable;

  for (const order of orders) {
    if (apLeft <= 0) {
      wasted.push({ order, reason: "no action points left" });
      continue;
    }
    apLeft -= 1;
    const reason = rejectReason(state, board, seat, order, committed);
    if (reason !== null) {
      wasted.push({ order, reason });
      continue;
    }
    const from = order.from;
    committed.set(from, (committed.get(from) ?? 0) + order.troops);
    accepted.push(order);
  }
  return { accepted, wasted };
}

/** The reason `order` is refused, or `null` when it is a legal move. */
function rejectReason(
  state: MatchState,
  board: ReadonlySet<HexKey>,
  seat: Seat,
  order: Order,
  committed: ReadonlyMap<HexKey, number>,
): WasteReason | null {
  const source = hexAt(state, order.from);
  const destination = hexAt(state, order.to);
  if (source === undefined || destination === undefined) return "unknown hex";
  if (source.owner !== seat) return "source hex not owned";
  if (destination.terrain === "blocked") return "destination is blocked";
  if (!neighbourKeys(order.from, board).includes(order.to)) return "hexes are not adjacent";
  if (!Number.isInteger(order.troops) || order.troops < 1) return "troop count must be a positive integer";
  if ((committed.get(order.from) ?? 0) + order.troops > source.troops) return "not enough troops in source hex";
  return null;
}

/** A hex only when the board itself holds the key, never an inherited property. */
function hexAt(state: MatchState, key: HexKey): Hex | undefined {
  return Object.hasOwn(state.hexes, key) ? state.hexes[key] : undefined;
}
