/**
 * What a seat is allowed to see: the two read-only tools, `get_rules` and
 * `get_state`.
 *
 * `get_rules` answers the half of the match that never changes — the rules text,
 * the constants, the two Bases and the whole map — so a player calls it once, on
 * turn 1, and is never told any of it again. `get_state` answers the half that
 * changes, and holds to the rules' "Visibility and scouting": a seat sees the
 * hexes it owns, the hexes next to them, and whatever it scouted this turn, and
 * nothing else. Terrain is known for every hex of every map, so `get_state`
 * sends none of it, and a hex the seat cannot see is left out rather than
 * reported empty — an empty hex would tell the seat the hex exists and is
 * unowned, which is exactly what hiding it is for.
 *
 * Both answers are written in the seat's own words — `you`, `enemy`,
 * `your_orders` — so no field of either one names the other seat. The only
 * difference between the two seats' `get_rules` is which Base is called `you`.
 */
import { readFileSync } from "node:fs";

import { boardCells, hexKey, neighbourKeys, score, visibleHexes } from "@no-dice/salient-engine";
import type { Config, HexKey, MatchState, Seat, Terrain } from "@no-dice/salient-engine";
import type { HexLabel, LogConfig, LogEvent, LogOrder, WastedLogOrder } from "@no-dice/runner/log";

import { keyToLabel, labelToKey } from "./labels";
import { SIMULATE_LIMIT, TOOL_CALL_LIMIT } from "./limits";
import type { SettledTurn, TurnCounters } from "./session";

/** A seat as the player looking at it knows itself and its opponent. */
export type SeatView = "you" | "enemy";

/**
 * The player-facing rules, held as the one file brief §6.3 hands Pi as the
 * system prompt: the rules document's sections from "Board and map" through
 * "Scoring and match end", then the instructions the brief gives. A player reads
 * the same bytes in `get_rules` that it is prompted with, and both seats read the
 * same ones.
 */
export const PLAYER_SYSTEM_PROMPT = new URL("../../prompts/player-system.md", import.meta.url);

/** Read once per process, so the rules text is off disk before the first call. */
let rulesText: string | null = null;

/** The player-facing rules text, byte-identical for both seats. */
export function playerRulesText(): string {
  if (rulesText === null) rulesText = readFileSync(PLAYER_SYSTEM_PROMPT, "utf8");
  return rulesText;
}

/** The seat `seat` is playing against. */
const opponent = (seat: Seat): Seat => (seat === "A" ? "B" : "A");

/** `seat`, seen from `viewer`'s side of the board. */
const asView = (seat: Seat, viewer: Seat): SeatView => (seat === viewer ? "you" : "enemy");

/** An owner, seen from `viewer`'s side, with a neutral hex staying neutral. */
const ownerAsView = (owner: Seat | null, viewer: Seat): SeatView | null =>
  owner === null ? null : asView(owner, viewer);

/** Every hex a move can stand on: the board without its blocked hexes. */
const passableKeys = (state: MatchState): Set<HexKey> =>
  new Set<HexKey>(Object.keys(state.hexes).filter((key) => state.hexes[key].terrain !== "blocked"));

/** The hexes touching `key`, as labels, in the engine's fixed direction order. */
const neighboursOf = (key: HexKey, passable: ReadonlySet<HexKey>, radius: number): HexLabel[] =>
  neighbourKeys(key, passable).map((at) => keyToLabel(at, radius));

/** The constants the match is played under, in the log's spelling of brief §6.2. */
export function matchConstants(config: Config): LogConfig {
  return {
    turns: config.turns,
    action_points: config.actionPoints,
    start_troops: config.startingTroops,
    base_production: config.baseProduction,
    node_production: config.nodeProduction,
    node_garrison: config.nodeGarrison,
    home_bonus: config.homeBonus,
    points: {
      plain: config.points.plain,
      base: config.points.base,
      node: config.points.node,
    },
  };
}

/** One hex of the static map. */
export interface MapHexView {
  id: HexLabel;
  terrain: Terrain;
  /**
   * The passable hexes it touches. A blocked hex has no `neighbours`, and being
   * impassable it never appears in another hex's list either.
   */
  neighbours?: HexLabel[];
}

/** What `get_rules` answers. */
export interface RulesView {
  rules: string;
  constants: LogConfig;
  bases: { you: HexLabel; enemy: HexLabel };
  /** All 91 hexes, in the board's fixed order: row, then column. */
  map: MapHexView[];
}

/**
 * The static half of the match for `seat`: the rules, the constants, its Base
 * and its enemy's, and every hex with its terrain and neighbours. The map is the
 * same for both seats; only `bases` says which end is which.
 */
export function rulesView(state: MatchState, seat: Seat, config: Config): RulesView {
  const passable = passableKeys(state);
  const map: MapHexView[] = [];
  for (const cell of boardCells(config.radius)) {
    const key = hexKey(cell.q, cell.r);
    const hex = state.hexes[key];
    const entry: MapHexView = { id: hex.id, terrain: hex.terrain };
    if (hex.terrain !== "blocked") entry.neighbours = neighboursOf(key, passable, config.radius);
    map.push(entry);
  }
  return {
    rules: playerRulesText(),
    constants: matchConstants(config),
    bases: {
      you: keyToLabel(state.base[seat], config.radius),
      enemy: keyToLabel(state.base[opponent(seat)], config.radius),
    },
    map,
  };
}

/** One hex the seat can see. Its terrain is not repeated: it is in the map. */
export interface StateHexView {
  id: HexLabel;
  owner: SeatView | null;
  troops: number;
  /** Only on a hex the seat owns and has troops on: the hexes it can order from. */
  neighbours?: HexLabel[];
  /** Only on a Node no one owns, where it is what an attacker has to beat. */
  garrison?: number;
}

/** A turn event in the seat's words: the forces are `you` and `enemy`, not `A` and `B`. */
export type StateEventView =
  | { type: "clash"; between: [HexLabel, HexLabel]; you: number; enemy: number }
  | { type: "battle"; at: HexLabel; you: number; enemy: number; owner: SeatView | null }
  | { type: "repelled"; at: HexLabel; by: SeatView; n: number }
  | { type: "capture"; at: HexLabel; by: SeatView; from: SeatView | null; terrain: Terrain };

/** What the seat was told about the turn before this one. */
export interface LastTurnView {
  your_orders: LogOrder[];
  wasted: WastedLogOrder[];
  events: StateEventView[];
}

/** What `get_state` answers. */
export interface StateView {
  turn: number;
  turns_total: number;
  scores: { you: number; enemy: number };
  action_points_left: number;
  limits: { tool_calls_left: number; simulations_left: number };
  /** Only the hexes the seat knows, in the board's fixed order: row, then column. */
  hexes: StateHexView[];
  last_turn: LastTurnView | null;
}

/** Everything `get_state` needs to answer for one seat. */
export interface StateViewInput {
  state: MatchState;
  seat: Seat;
  config: Config;
  /** What the seat has used since the turn opened, including what it scouted. */
  used: TurnCounters;
  /** The turn before this one, and what each seat could see when it began. */
  previous: SettledTurn | null;
}

/**
 * The moving half of the match for `seat`: the score, what it has left to spend,
 * the hexes it knows, and last turn's report. Hexes are listed in one fixed
 * order for both seats, so the same position reads the same from either end of
 * the board.
 */
export function stateView(input: StateViewInput): StateView {
  const { state, seat, config, used, previous } = input;
  const passable = passableKeys(state);
  const known = knownHexes(state, seat, config, used.scouted);

  const hexes: StateHexView[] = [];
  for (const cell of boardCells(config.radius)) {
    const key = hexKey(cell.q, cell.r);
    const hex = state.hexes[key];
    // Unknown hexes are left out, and so are blocked ones, which have nothing to
    // report and whose terrain the seat already has from `get_rules`.
    if (!known.has(key) || hex.terrain === "blocked") continue;
    const entry: StateHexView = {
      id: hex.id,
      owner: ownerAsView(hex.owner, seat),
      troops: hex.troops,
    };
    if (hex.owner === seat && hex.troops > 0) {
      entry.neighbours = neighboursOf(key, passable, config.radius);
    }
    if (hex.terrain === "node" && hex.owner === null) entry.garrison = hex.garrison;
    hexes.push(entry);
  }

  return {
    turn: state.turn,
    turns_total: config.turns,
    scores: {
      you: score(state, seat, config).points,
      enemy: score(state, opponent(seat), config).points,
    },
    action_points_left: Math.max(0, config.actionPoints - used.apSpentOnScouts),
    limits: {
      tool_calls_left: Math.max(0, TOOL_CALL_LIMIT - used.toolCalls),
      simulations_left: Math.max(0, SIMULATE_LIMIT - used.simulations),
    },
    hexes,
    last_turn: previous === null ? null : lastTurnView(previous, seat, config),
  };
}

/** Last turn as `seat` is allowed to hear it. */
function lastTurnView(previous: SettledTurn, seat: Seat, config: Config): LastTurnView {
  return {
    your_orders: previous.report.orders[seat].slice(),
    wasted: previous.report.wasted[seat].slice(),
    // The rules report a player the fights on hexes it could see, so an event
    // anywhere else stays out of the answer — it would describe hexes the seat
    // was never shown.
    events: previous.report.events
      .filter((event) => seenFrom(event, previous.visible[seat], config.radius))
      .map((event) => eventAsView(event, seat)),
  };
}

/** The hexes the seat knows this turn: what owning reveals, plus what it scouted. */
function knownHexes(
  state: MatchState,
  seat: Seat,
  config: Config,
  scouted: readonly HexLabel[],
): Set<HexKey> {
  const known = visibleHexes(state, seat);
  for (const label of scouted) {
    const key = labelToKey(label, config.radius);
    if (key !== null) known.add(key);
  }
  return known;
}

/** The hexes an event happened on: the two ends of a clash, one hex otherwise. */
const eventHexes = (event: LogEvent): readonly HexLabel[] =>
  event.type === "clash" ? event.between : [event.at];

/** Whether `visible` — the seat's view when that turn began — covers the event. */
const seenFrom = (event: LogEvent, visible: ReadonlySet<HexKey>, radius: number): boolean =>
  eventHexes(event).some((label) => {
    const key = labelToKey(label, radius);
    return key !== null && visible.has(key);
  });

/** An event retold from `seat`'s side, with no seat letter anywhere in it. */
function eventAsView(event: LogEvent, seat: Seat): StateEventView {
  switch (event.type) {
    case "clash":
      return {
        type: "clash",
        between: event.between,
        you: event[seat],
        enemy: event[opponent(seat)],
      };
    case "battle":
      return {
        type: "battle",
        at: event.at,
        you: event[seat],
        enemy: event[opponent(seat)],
        owner: ownerAsView(event.owner, seat),
      };
    case "repelled":
      return { type: "repelled", at: event.at, by: asView(event.by, seat), n: event.n };
    case "capture":
      return {
        type: "capture",
        at: event.at,
        by: asView(event.by, seat),
        from: ownerAsView(event.from, seat),
        terrain: event.terrain,
      };
  }
}
