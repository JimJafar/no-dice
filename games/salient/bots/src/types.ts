/**
 * What a bot is handed, and what it answers with.
 *
 * A bot sees exactly what a player sees: the answer `get_rules` gives and the
 * answer `get_state` gives, and nothing else. The two types below name the parts
 * of those answers a bot reads rather than importing the server's own view
 * types, so the bots stay a leaf package — the runner builds a bot, and the
 * server must not end up on the other side of that arrow. Anything the tools
 * answer that is not here is something no bot of ours needs: the rules text, the
 * score, last turn's report, the caps on calls and simulations.
 *
 * A real `RulesView` and `StateView` satisfy both, since they carry these fields
 * and more.
 */
import type { Terrain } from "@no-dice/salient-engine";

/** A hex named the way the tools and the log name it — `B6`, never the engine's `4,0`. */
export type HexName = string;

/** Who holds a hex, in the seat's own words: `you`, `enemy`, or no one. */
export type Holder = "you" | "enemy";

/** One move, as `submit_orders` takes it. */
export interface BotOrder {
  from: HexName;
  to: HexName;
  troops: number;
}

/** What a bot hands the harness to submit: the moves, and the two notes that go with them. */
export interface BotTurn {
  orders: BotOrder[];
  /** 1 to 280 characters, as brief §6.2 requires of `submit_orders`. */
  intent: string;
  /** 1 to 280 characters, and the bot's guess at what the enemy does next. */
  prediction: string;
}

/** The part of `get_rules` a bot reads: the constants it plans against, the two Bases, and the map. */
export interface BotRules {
  constants: {
    /** The troops standing on a Node no one has taken yet. */
    node_garrison: number;
    /** The bonus the hex's owner defends with. */
    home_bonus: number;
  };
  bases: { you: HexName; enemy: HexName };
  map: { id: HexName; terrain: Terrain; neighbours?: HexName[] }[];
}

/** The part of `get_state` a bot reads: the hexes it can see, and the action points it has left. */
export interface BotState {
  action_points_left: number;
  /** Only the hexes the seat knows. A hex missing from here is a hex it cannot see. */
  hexes: { id: HexName; owner: Holder | null; troops: number; garrison?: number }[];
}

/**
 * A bot: a pure decision over the two read-only tools' answers. It is not told
 * which seat it plays — the frame it ranks moves in comes out of which Base is
 * called `you` — and it is given no hidden state and no memory of earlier turns.
 */
export type Bot = (rules: BotRules, state: BotState) => BotTurn;
