/**
 * Hex names, in the one place both of them are spoken.
 *
 * The engine addresses a hex by its axial coordinates, keyed `"q,r"`. The tools
 * and the `salient-log/1` log name it by its board label — the letter of its
 * diagonal column and the number of its row, so `B6` and `F6` — which is
 * written out from the board's radius. Everything that crosses between the two
 * goes through here, so a label is also parsed in exactly one place.
 */
import { hexKey, hexLabel, isOnBoard, parseHexKey } from "@no-dice/salient-engine";
import type { HexCoord, HexKey, Order, TurnEvent, WastedOrder } from "@no-dice/salient-engine";
import type { HexLabel, LogEvent, LogOrder, WastedLogOrder } from "@no-dice/runner/log";

/** A board label: one letter for the column, one or two digits for the row. */
const LABEL = /^([A-Z])([0-9]{1,2})$/;

/**
 * The coordinate a well-formed label names, whether or not that hex is on the
 * board, or `null` when the string is not a label at all.
 */
export function labelToCoord(label: string, radius: number): HexCoord | null {
  if (!LABEL.test(label)) return null;
  // The inverse of the engine's `hexLabel`: `A` sits `radius` columns left of
  // the centre, and row 1 sits `radius + 1` above the centre row.
  return { q: label.charCodeAt(0) - 65 - radius, r: Number(label.slice(1)) - radius - 1 };
}

/** The key of the hex `label` names, or `null` if it is malformed or off the board. */
export function labelToKey(label: string, radius: number): HexKey | null {
  const at = labelToCoord(label, radius);
  return at !== null && isOnBoard(at.q, at.r, radius) ? hexKey(at.q, at.r) : null;
}

/** The label of the hex the engine keys `key`. */
export function keyToLabel(key: HexKey, radius: number): HexLabel {
  const at = parseHexKey(key);
  return hexLabel(at.q, at.r, radius);
}

/**
 * Submitted orders in the engine's currency. A label that names a hex off the
 * board still becomes that hex's key, so the engine is the one that refuses it,
 * as an unknown hex, rather than the server inventing its own reason.
 */
export function ordersToEngine(orders: readonly LogOrder[], radius: number): Order[] {
  return orders.map((order) => ({
    from: keyOrRawLabel(order.from, radius),
    to: keyOrRawLabel(order.to, radius),
    troops: order.troops,
  }));
}

/** The engine's dropped orders, back in the labels the log names hexes by. */
export function wastedToLog(wasted: readonly WastedOrder[], radius: number): WastedLogOrder[] {
  return wasted.map((waste) => ({
    order: {
      from: keyToLabel(waste.order.from, radius),
      to: keyToLabel(waste.order.to, radius),
      troops: waste.order.troops,
    },
    reason: waste.reason,
  }));
}

/** What the engine did in a turn, with every hex named the way the log names it. */
export function eventsToLog(events: readonly TurnEvent[], radius: number): LogEvent[] {
  return events.map((event): LogEvent => {
    switch (event.type) {
      case "clash":
        return {
          type: "clash",
          between: [keyToLabel(event.between[0], radius), keyToLabel(event.between[1], radius)],
          A: event.A,
          B: event.B,
        };
      case "battle":
        return {
          type: "battle",
          at: keyToLabel(event.at, radius),
          A: event.A,
          B: event.B,
          owner: event.owner,
        };
      case "repelled":
        return { type: "repelled", at: keyToLabel(event.at, radius), by: event.by, n: event.n };
      case "capture":
        return {
          type: "capture",
          at: keyToLabel(event.at, radius),
          by: event.by,
          from: event.from,
          terrain: event.terrain,
        };
    }
  });
}

/** The key a label names, or the label itself when it is no hex at all. */
function keyOrRawLabel(label: string, radius: number): HexKey {
  const at = labelToCoord(label, radius);
  return at === null ? label : hexKey(at.q, at.r);
}
