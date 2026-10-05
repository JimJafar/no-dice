/**
 * The board a bot decides on, built out of the two read-only tools and nothing
 * else.
 *
 * The server answers both seats with absolute board labels, and a bot that ranks
 * its candidates in those labels plays one seat better than the other: the rules
 * file records two identical bots in the prototype splitting 25% to 69% by seat
 * from nothing but the order they considered moves in. So every hex is renamed
 * into the bot's own frame before anything is sorted — the half-turn rotation
 * `(q, r) -> (-q, -r)`, applied for the seat whose Base sits to the right of its
 * enemy's — and the bots walk, sort and compare in that frame alone. Orders, and
 * the text that explains them, come back out in the absolute labels the tools
 * use.
 *
 * A hex the seat cannot see is simply absent from `get_state`. A bot has no
 * memory of earlier turns and no way to look at hidden state, so such a hex is
 * held as neutral and empty, with a Node's garrison at the number the constants
 * start it at — the same guess the rules leave a player, since terrain is known
 * for every hex of every map and troops are not.
 */
import { HEX_DIRECTIONS, hexDistance } from "@no-dice/salient-engine";
import type { Terrain } from "@no-dice/salient-engine";

import type { BotRules, BotState, Holder, HexName } from "./types";

/** One hex of the bot's board: what the map says, plus what the seat can see on it. */
export interface BotHex {
  /** The hex's name in the bot's own frame — the only name a bot sorts or compares by. */
  id: HexName;
  /** The same hex's absolute label, which is what orders and notes have to use. */
  label: HexName;
  terrain: Terrain;
  /** Whether `get_state` reported it. An unseen hex reads as neutral and empty. */
  visible: boolean;
  owner: Holder | null;
  troops: number;
  /** What an attacker has to beat before the hex's own owner does: 0 unless it is an unowned Node. */
  garrison: number;
  /** The passable hexes it touches, named in the bot's frame, in the engine's direction order. */
  neighbours: HexName[];
}

/** The whole board, in the bot's frame. */
export interface BotBoard {
  /** Every hex of the map, in the frame's own order: frame row, then frame column. */
  readonly hexes: readonly BotHex[];
  /** The seat's Base and its enemy's, named in the frame. */
  readonly myBase: HexName;
  readonly enemyBase: HexName;
  /** The hex a frame name names. Every name a bot holds came off this board. */
  at(id: HexName): BotHex;
  /** Steps between two hexes, which turning the board leaves alone. */
  distance(a: HexName, b: HexName): number;
}

/**
 * A hex's place on the board by column and row, both zero-based, so `B6` is
 * `{ q: 1, r: 5 }` of a board eleven columns wide.
 *
 * Column and row differ from the engine's axial coordinates by a constant
 * offset, which is all the arithmetic here depends on: distances come from
 * differences, and the half-turn mirror is a flip about the board's middle. So
 * a bot never needs the board's radius, which neither tool answers.
 */
interface ColRow {
  q: number;
  r: number;
}

const colRow = (name: HexName): ColRow => ({
  q: name.charCodeAt(0) - 65,
  r: Number(name.slice(1)) - 1,
});

const nameOf = (at: ColRow): HexName => String.fromCharCode(65 + at.q) + (at.r + 1);

/** The board's width in hexes: `2 * radius + 1`, read off the labels the map uses. */
const boardWidth = (rules: BotRules): number =>
  rules.map.reduce((widest, hex) => Math.max(widest, colRow(hex.id).q), 0) + 1;

/**
 * The order the engine lists a hex's neighbours in: its six directions, taken in
 * the frame the bot is facing rather than in the board's. The tools answer in the
 * board's order, and turning the board half a turn sends every direction to the
 * one opposite it, so a bot that walked the list as answered would try a
 * different neighbour first in each seat.
 */
const inDirectionOrder = (neighbours: HexName[], from: HexName): HexName[] => {
  const at = colRow(from);
  const rank = (name: HexName): number => {
    const step = colRow(name);
    const direction = HEX_DIRECTIONS.findIndex(([dq, dr]) => step.q - at.q === dq && step.r - at.r === dr);
    // A neighbour no direction explains sorts last rather than confusing the order.
    return direction === -1 ? HEX_DIRECTIONS.length : direction;
  };
  return neighbours.sort((a, b) => rank(a) - rank(b));
};

/** What `get_state` said about one hex, by its absolute label. */
type SeenHex = Pick<BotHex, "owner" | "troops" | "garrison">;

/** What a seat believes about a hex it was not told about: unowned, and nothing on it. */
const unseen = (terrain: Terrain, nodeGarrison: number): SeenHex => ({
  owner: null,
  troops: 0,
  // An unseen Node is a Node nobody has taken yet, which is as much as the seat
  // knows about it.
  garrison: terrain === "node" ? nodeGarrison : 0,
});

/**
 * The board `seat` is playing, as its own frame: hexes renamed so its Base is
 * always on the same side, and listed in the frame's own order so the order a
 * bot walks the board in cannot depend on which seat it was dealt.
 */
export function botBoard(rules: BotRules, state: BotState): BotBoard {
  const width = boardWidth(rules);
  // The mirror is its own inverse, so one function serves both ways.
  const mirrored = colRow(rules.bases.you).q > colRow(rules.bases.enemy).q;
  const inFrame = (name: HexName): HexName => {
    if (!mirrored) return name;
    const at = colRow(name);
    return nameOf({ q: width - 1 - at.q, r: width - 1 - at.r });
  };

  const seen = new Map<HexName, SeenHex>();
  for (const hex of state.hexes) {
    seen.set(hex.id, { owner: hex.owner, troops: hex.troops, garrison: hex.garrison ?? 0 });
  }

  const hexes: BotHex[] = rules.map.map((hex) => {
    const reported = seen.get(hex.id);
    const known = reported ?? unseen(hex.terrain, rules.constants.node_garrison);
    const id = inFrame(hex.id);
    return {
      id,
      label: hex.id,
      terrain: hex.terrain,
      visible: reported !== undefined,
      owner: known.owner,
      troops: known.troops,
      garrison: known.garrison,
      neighbours: inDirectionOrder((hex.neighbours ?? []).map(inFrame), id),
    };
  });
  hexes.sort((a, b) => colRow(a.id).r - colRow(b.id).r || colRow(a.id).q - colRow(b.id).q);

  const byId = new Map<HexName, BotHex>(hexes.map((hex) => [hex.id, hex]));
  return {
    hexes,
    myBase: inFrame(rules.bases.you),
    enemyBase: inFrame(rules.bases.enemy),
    at: (id) => {
      const hex = byId.get(id);
      if (hex === undefined) throw new Error(`the bot reached for ${id}, which is not on its board`);
      return hex;
    },
    distance: (a, b) => hexDistance(colRow(a), colRow(b)),
  };
}
