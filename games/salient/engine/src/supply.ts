/**
 * What a seat sees and what it scores: the hexes it reveals by owning them, and
 * the supply flood fill from its Base that decides which of its hexes are worth
 * points. Both walk the board in one fixed order — row, then column — so neither
 * result can depend on the order the hexes happen to be keyed in.
 */
import type { Config } from "./config";
import { hexKey, neighbourKeys } from "./hex";
import type { Hex, HexKey, MatchState, Seat, Terrain } from "./types";

export interface ScoreResult {
  points: number;
  /**
   * The seat's hexes connected to its Base, which are the ones that scored. The
   * log and the viewer mark the seat's other hexes with this set.
   */
  supplied: Set<HexKey>;
}

/**
 * Every hex whose owner, troops and garrison the seat can see: its own hexes and
 * every hex next to them. The terrain of every hex is always known, so a Base or
 * a Node is never hidden — only its troops and garrison are.
 */
export function visibleHexes(state: MatchState, seat: Seat): Set<HexKey> {
  const board = boardKeys(state);
  const visible = new Set<HexKey>();
  for (const hex of boardOrder(state)) {
    if (hex.owner !== seat) continue;
    const key = hexKey(hex.q, hex.r);
    visible.add(key);
    for (const neighbour of neighbourKeys(key, board)) visible.add(neighbour);
  }
  return visible;
}

/**
 * The seat's points: a flood fill from its Base over hexes the seat owns, worth
 * `config.points` each. A region cut off from the Base scores nothing while it
 * stays cut off, and comes back into the score when it is reconnected. A seat
 * that no longer owns its Base scores nothing at all.
 *
 * With `config.supply` off, every owned hex counts and none of them is out of
 * supply, so `supplied` holds all of them.
 */
export function score(state: MatchState, seat: Seat, config: Config): ScoreResult {
  const baseKey = state.base[seat];
  const base = hexAt(state, baseKey);
  if (base === undefined || base.owner !== seat) return { points: 0, supplied: new Set<HexKey>() };

  const board = boardKeys(state);
  const supplied = new Set<HexKey>([baseKey]);
  const queue: HexKey[] = [baseKey];
  let points = 0;
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    points += pointsFor(config, state.hexes[at].terrain);
    for (const neighbour of neighbourKeys(at, board)) {
      if (supplied.has(neighbour) || state.hexes[neighbour].owner !== seat) continue;
      supplied.add(neighbour);
      queue.push(neighbour);
    }
  }
  if (config.supply) return { points, supplied };

  let all = 0;
  for (const hex of boardOrder(state)) {
    if (hex.owner !== seat) continue;
    all += pointsFor(config, hex.terrain);
    supplied.add(hexKey(hex.q, hex.r));
  }
  return { points: all, supplied };
}

/** Every hex on the board in one fixed order: row, then column. */
function boardOrder(state: MatchState): Hex[] {
  return Object.values(state.hexes).sort((a, b) => a.r - b.r || a.q - b.q);
}

/** The keys of every hex on the board, for looking up neighbours. */
function boardKeys(state: MatchState): Set<HexKey> {
  return new Set<HexKey>(Object.keys(state.hexes));
}

/** What a hex of `terrain` is worth; a blocked hex is never owned, so it is worth nothing. */
function pointsFor(config: Config, terrain: Terrain): number {
  return terrain === "blocked" ? 0 : config.points[terrain];
}

/** A hex only when the board itself holds the key, never an inherited property. */
function hexAt(state: MatchState, key: HexKey): Hex | undefined {
  return Object.hasOwn(state.hexes, key) ? state.hexes[key] : undefined;
}
