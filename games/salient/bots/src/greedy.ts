/**
 * The Greedy bot: brief §6.6's second baseline, the `expander` style of
 * `salient/docs/reference/bots.js` ported to decide from what the two read-only
 * tools answer.
 *
 * It is a one-turn greedy planner, not a search. Each of its stacks looks at
 * what it touches and writes down the move that is worth most: take a Node no
 * one holds with garrison + 1 troops, claim an open hex, attack an enemy hex
 * with enough troops to beat what stands there and the home bonus it defends
 * with. A stack with nothing next to it to take walks toward the front instead.
 * Every candidate is then ranked by value, and the top ones are played until the
 * turn's action points run out — which is why the ranking has to happen in the
 * bot's own frame: two seats ranking the same position in absolute labels would
 * take different hexes, and the rules file records what that cost the prototype.
 *
 * Two duties are paid before any candidate is written down, so the bot does not
 * strip itself while it expands: it keeps a guard on its Base against an enemy
 * stack it can see close by, and it keeps enough on a Node of its own to hold it
 * against the enemy stacks standing next to it.
 */
import { botBoard, type BotBoard, type BotHex } from "./board";
import { withinNote } from "./limits";
import type { Bot, HexName } from "./types";

/** How much the bot likes each kind of move, in the prototype's `expander` style. */
interface Weights {
  /** The troops the Base always keeps, whatever the enemy can be seen doing. */
  guard: number;
  /** Extra troops asked for beyond what is needed to beat a defending stack. */
  margin: number;
  wNode: number;
  wPlain: number;
  wFoeNode: number;
  wFoePlain: number;
  wMarch: number;
  /** The size a stack has to reach before it is worth throwing at their Base. */
  strike: number;
  wStrike: number;
}

/** The `expander` weights from the prototype's `STYLES`. */
const EXPANDER: Weights = {
  guard: 0,
  margin: 0,
  wNode: 30,
  wPlain: 14,
  wFoeNode: 26,
  wFoePlain: 12,
  wMarch: 4,
  strike: 99,
  wStrike: 0,
};

/** What taking their Base is worth, which outranks every hex on the board. */
const BASE_VALUE = 1000;

type Kind = "node" | "claim" | "attack" | "strike" | "march";

/** A move the bot would like to make, and what it is worth to it. */
interface Candidate {
  from: HexName;
  to: HexName;
  /** The fewest troops that can be sent and still have the move work. */
  needs: number;
  /** Whether everything the hex can spare goes, rather than a fixed number. */
  all: boolean;
  value: number;
  kind: Kind;
}

/** A candidate the bot chose, with the troops it is going with. */
type Chosen = Candidate & { troops: number };

export function greedyBot(): Bot {
  return (rules, state) => {
    const board = botBoard(rules, state);
    const stacks = board.hexes.filter((hex) => hex.visible && hex.owner === "you" && hex.troops > 0);
    const threats = board.hexes.filter((hex) => hex.visible && hex.owner === "enemy" && hex.troops > 0);

    const guard = guardFor(board, threats);
    const spare = duties(board, stacks, guard);

    const candidates = candidatesFor(board, stacks, spare, rules.constants.home_bonus);
    // Value first, then the frame's own hex names, so two seats holding the same
    // position in mirror image rank it the same way.
    candidates.sort((a, b) => b.value - a.value || (a.from + a.to < b.from + b.to ? -1 : 1));

    const chosen: Chosen[] = [];
    const claimed = new Set<HexName>();
    const emptied = new Set<HexName>();
    let ap = state.action_points_left;
    for (const candidate of candidates) {
      if (ap <= 0) break;
      // One stack may not be emptied by two walks, and one open hex may not be
      // claimed twice.
      if ((candidate.kind === "claim" || candidate.kind === "node") && claimed.has(candidate.to)) continue;
      if ((candidate.kind === "march" || candidate.kind === "strike") && emptied.has(candidate.from)) continue;
      const available = spare.get(candidate.from) ?? 0;
      const troops = candidate.all ? available : candidate.needs;
      if (troops < 1 || troops > available) continue;

      chosen.push({ ...candidate, troops });
      spare.set(candidate.from, available - troops);
      claimed.add(candidate.to);
      if (candidate.all) emptied.add(candidate.from);
      ap -= 1;
    }

    return {
      orders: chosen.map((move) => ({
        from: board.at(move.from).label,
        to: board.at(move.to).label,
        troops: move.troops,
      })),
      intent: withinNote(intentOf(board, chosen, guard)),
      prediction: withinNote(predictionOf(board, threats)),
    };
  };
}

/**
 * What the bot keeps at its Base: everything the enemy stacks it can see within
 * two hexes of it add up to, plus one, and never less than `guard`.
 */
function guardFor(board: BotBoard, threats: readonly BotHex[]): number {
  let near = 0;
  for (const hex of threats) {
    if (board.distance(hex.id, board.myBase) <= 2) near += hex.troops;
  }
  return Math.max(EXPANDER.guard, near > 0 ? near + 1 : 0);
}

/**
 * What each stack may still send once its duties are paid: the guard at the
 * Base, and enough left on a Node of its own to beat the enemy stacks standing
 * next to it.
 */
function duties(board: BotBoard, stacks: readonly BotHex[], guard: number): Map<HexName, number> {
  const spare = new Map(stacks.map((hex) => [hex.id, hex.troops]));

  const atBase = spare.get(board.myBase);
  if (atBase !== undefined) spare.set(board.myBase, Math.max(0, atBase - guard));

  for (const hex of stacks) {
    if (hex.terrain !== "node") continue;
    let attackers = 0;
    for (const id of hex.neighbours) {
      const neighbour = board.at(id);
      if (neighbour.owner === "enemy") attackers += neighbour.troops;
    }
    if (attackers > 0) spare.set(hex.id, Math.max(0, hex.troops - Math.min(hex.troops, attackers + 1)));
  }
  return spare;
}

/** Every move the bot's stacks can see from where they stand. */
function candidatesFor(
  board: BotBoard,
  stacks: readonly BotHex[],
  spare: ReadonlyMap<HexName, number>,
  homeBonus: number,
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const stack of stacks) {
    const sending = spare.get(stack.id) ?? 0;
    if (sending < 1) continue;

    let frontier = false;
    for (const id of stack.neighbours) {
      const target = board.at(id);
      if (target.terrain === "blocked" || target.owner === "you") continue;
      frontier = true;
      if (target.owner === null) {
        candidates.push({
          from: stack.id,
          to: id,
          needs: target.garrison + 1,
          all: false,
          value: target.terrain === "node" ? EXPANDER.wNode : EXPANDER.wPlain,
          kind: target.terrain === "node" ? "node" : "claim",
        });
        continue;
      }
      candidates.push({
        from: stack.id,
        to: id,
        needs: target.troops + 1 + homeBonus + (target.troops > 0 ? EXPANDER.margin : 0),
        // A Base is taken with everything the stack can raise, not with the
        // minimum: nothing here is worth half-measures.
        all: target.terrain === "base",
        value:
          (target.terrain === "base" ? BASE_VALUE : target.terrain === "node" ? EXPANDER.wFoeNode : EXPANDER.wFoePlain) -
          target.troops,
        kind: "attack",
      });
    }

    if (sending >= EXPANDER.strike) {
      const path = bfsStep(board, stack.id, (id) => id === board.enemyBase);
      if (path !== null && board.at(path.step).owner === "you") {
        candidates.push({ from: stack.id, to: path.step, needs: 0, all: true, value: EXPANDER.wStrike, kind: "strike" });
      }
    }

    // Nothing to take next door, so walk toward something, and hope the front
    // comes to it.
    if (!frontier) {
      const path = bfsStep(board, stack.id, (id) => board.at(id).owner !== "you");
      if (path !== null) {
        candidates.push({
          from: stack.id,
          to: path.step,
          needs: 0,
          all: true,
          value: EXPANDER.wMarch + Math.min(sending, 9),
          kind: "march",
        });
      }
    }
  }
  return candidates;
}

/**
 * The first step of the shortest walk from `from` to a hex `isGoal` accepts, and
 * the hex that walk was making for — or `null` when nothing it accepts can be
 * reached. The walk only ever steps onto passable hexes, which is what the map's
 * neighbour lists already hold.
 */
function bfsStep(
  board: BotBoard,
  from: HexName,
  isGoal: (id: HexName) => boolean,
): { step: HexName; goal: HexName } | null {
  const previous = new Map<HexName, HexName>();
  const seen = new Set<HexName>([from]);
  const queue: HexName[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at !== from && isGoal(at)) {
      // Back down the path to the hex that was stepped onto from `from`.
      let step = at;
      for (;;) {
        const parent = previous.get(step);
        if (parent === undefined || parent === from) break;
        step = parent;
      }
      return { step, goal: at };
    }
    for (const id of board.at(at).neighbours) {
      if (seen.has(id)) continue;
      seen.add(id);
      previous.set(id, at);
      queue.push(id);
    }
  }
  return null;
}

/** What the bot is doing, in the orders it actually chose. */
function intentOf(board: BotBoard, chosen: readonly Chosen[], guard: number): string {
  const label = (id: HexName): HexName => board.at(id).label;
  const of = (kind: Kind): Chosen[] => chosen.filter((move) => move.kind === kind);
  const nodes = of("node");
  const attacks = of("attack");
  const claims = of("claim");
  const strikes = of("strike");
  const marches = of("march");

  const parts: string[] = [];
  for (const move of nodes) parts.push(`Take the node at ${label(move.to)} with ${move.troops}.`);
  for (const move of attacks) {
    const target = board.at(move.to);
    const why = target.terrain === "base" ? " to end it" : target.terrain === "node" ? " to take their node" : "";
    parts.push(`Attack ${label(move.to)} from ${label(move.from)} with ${move.troops}${why}.`);
  }
  for (const move of strikes) parts.push(`Push ${move.troops} from ${label(move.from)} toward their base.`);
  if (claims.length > 0) parts.push(`Claim ${claims.length} open hex${claims.length > 1 ? "es" : ""}.`);
  if (marches.length > 0) {
    parts.push(`Bring ${marches.reduce((sum, move) => sum + move.troops, 0)} troops up to the front.`);
  }
  if (guard > EXPANDER.guard) parts.push(`Hold ${guard} at base against the stack nearby.`);
  if (parts.length === 0) parts.push("Hold position.");
  return parts.slice(0, 3).join(" ");
}

/** The biggest stack the bot can see, and the hex it looks like it is pointed at. */
function predictionOf(board: BotBoard, threats: readonly BotHex[]): string {
  if (threats.length === 0) return "No contact yet. They are still expanding.";
  const [biggest] = [...threats].sort((a, b) => b.troops - a.troops || (a.id < b.id ? -1 : 1));

  let target: BotHex | null = null;
  let best = Number.NEGATIVE_INFINITY;
  for (const id of biggest.neighbours) {
    const hex = board.at(id);
    if (hex.owner !== "you") continue;
    const worth = hex.terrain === "base" ? 100 : hex.terrain === "node" ? 10 : 1;
    const score = worth - hex.troops / 100;
    if (score > best) {
      best = score;
      target = hex;
    }
  }
  return target === null
    ? `Their ${biggest.troops} at ${biggest.label} will keep advancing.`
    : `Their ${biggest.troops} at ${biggest.label} will hit ${target.label}.`;
}
