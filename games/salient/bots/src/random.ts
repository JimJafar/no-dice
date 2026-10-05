/**
 * The Random bot: brief §6.6's first baseline, and the one that decides nothing.
 *
 * It spends the turn's action points on moves picked out of a seeded
 * `mulberry32`, from hexes it owns that have troops on them to a passable hex
 * next to one — which includes attacking, so a Random bot does stumble into
 * fights and lose troops, exactly as the prototype's did. The seed is what makes
 * a match repeatable: the same seed against the same view plays the same turn,
 * and the generator belongs to the bot rather than the turn, so a whole match is
 * one draw after another from a single seed.
 *
 * The hexes it picks from come in its own frame, so the seat it was dealt cannot
 * change which of its stacks it happens to pick first.
 */
import { mulberry32 } from "@no-dice/salient-engine";

import { botBoard } from "./board.ts";
import type { Bot, BotOrder } from "./types.ts";

export function randomBot(seed: number): Bot {
  const random = mulberry32(seed);
  /** A whole number in `[0, n)`, drawn the way the prototype drew them. */
  const below = (n: number): number => random() % n;

  return (rules, state) => {
    const board = botBoard(rules, state);
    const stacks = board.hexes.filter((hex) => hex.visible && hex.owner === "you" && hex.troops > 0);
    // What each stack has left to send, since several moves may leave one hex.
    const spare = new Map(stacks.map((hex) => [hex.id, hex.troops]));

    const orders: BotOrder[] = [];
    for (let spent = 0; spent < state.action_points_left && stacks.length > 0; spent++) {
      const from = stacks[below(stacks.length)];
      const available = spare.get(from.id) ?? 0;
      if (available < 1) continue;
      const targets = from.neighbours;
      if (targets.length === 0) continue;
      const troops = 1 + below(available);
      spare.set(from.id, available - troops);
      orders.push({
        from: from.label,
        to: board.at(targets[below(targets.length)]).label,
        troops,
      });
    }

    return { orders, intent: "Random legal moves.", prediction: "None." };
  };
}
