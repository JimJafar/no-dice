/**
 * Entry point for the Salient baseline bots.
 *
 * Brief §6.6's two baselines, each a pure decision over what the two read-only
 * tools answer: `randomBot(seed)` and `greedyBot()`. Neither scouts, neither is
 * given a hex the seat cannot see, and neither is told which seat it plays — the
 * frame it ranks its moves in comes out of which Base the tools call `you`, which
 * is what keeps a seat from being played better than the other.
 */
export const botsPackage = {
  name: "@no-dice/salient-bots",
} as const;

export { greedyBot } from "./greedy.ts";
export { randomBot } from "./random.ts";
export type { Bot, BotOrder, BotRules, BotState, BotTurn, Holder } from "./types.ts";
