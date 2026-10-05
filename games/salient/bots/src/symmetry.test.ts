/**
 * Brief §8's symmetry test: the milestone's fairness gate.
 *
 * Two copies of the Greedy bot, each seeing the board in its own frame, have to
 * draw every match with equal scores. The rules file records identical bots in
 * the prototype splitting 25% to 69% by seat, and the only cause was the order
 * in which they considered moves. The server answers both seats with absolute
 * hex labels, so a seat imbalance here can only mean the bot is ranking
 * candidates in board coordinates rather than in its own frame.
 *
 * The match is driven in-process — the server's `call` and the bots' decision
 * functions, with no socket and no harness between them — so 300 matches of up
 * to 25 turns fit inside the test timeout. Seeds 1 to 300, in chunks, so a bad
 * seed names itself instead of taking the whole run down with it.
 *
 * Both the mirror position and the scores are checked after every turn rather
 * than only at the end: a match that drifts out of mirror image can still finish
 * level by luck, and only the turn by turn check says the game was fair the way
 * it was played.
 */
import { DEFAULT_CONFIG, hexKey, rotateHalfTurn, score } from "@no-dice/salient-engine";
import type { Config, MatchState, Seat } from "@no-dice/salient-engine";
import { MatchServer } from "@no-dice/salient-server";
import type { RulesView, StateView } from "@no-dice/salient-server";
import { describe, expect, it } from "vitest";

import { greedyBot } from "./greedy";
import type { Bot, BotRules, BotState } from "./types";

/** The seeds the gate runs on: brief §8's 300. */
const SEEDS = Array.from({ length: 300 }, (_, index) => index + 1);

/**
 * How many seeds one `it` plays. A whole 300-match run takes about twelve
 * seconds, and vitest's default timeout is five a test, so the seeds are split
 * into chunks that each finish in a second or two rather than one test that has
 * to be given a longer timeout to survive a slower machine.
 */
const SEEDS_PER_TEST = 25;

/** How many problems one test reports: a broken bot breaks every turn of every seed. */
const REPORTED_PROBLEMS = 8;

const SEATS: readonly Seat[] = ["A", "B"];

/** What one seat's two read-only tools answer. */
function viewOf(
  server: MatchServer,
  matchId: string,
  seat: Seat,
): { rules: BotRules; state: BotState } {
  const answer = (tool: string): unknown => {
    const outcome = server.call(matchId, seat, tool, {});
    if (!outcome.ok) throw new Error(`${tool} answered ${outcome.error} for seat ${seat}`);
    return outcome.result;
  };
  return { rules: answer("get_rules") as RulesView, state: answer("get_state") as StateView };
}

/** How a holder reads in a sentence: `A`, `B`, or nobody. */
const holderName = (seat: Seat | null): string => (seat === null ? "no one" : seat);

/**
 * Why the board is not its own half-turn rotation with the owners swapped, or
 * `null` when it is. Both seats play on this one board, so "seat A's board
 * turned by `(q, r) -> (-q, -r)` is seat B's" is exactly this: every hex's twin
 * across the centre holds the same terrain, the same troops and garrison, and
 * the other seat's ownership.
 */
function mirrorMismatch(state: MatchState): string | null {
  for (const hex of Object.values(state.hexes)) {
    const turned = rotateHalfTurn({ q: hex.q, r: hex.r });
    const twin = state.hexes[hexKey(turned.q, turned.r)];
    if (twin === undefined) return `${hex.id} has no hex across the centre of the board`;
    if (twin.terrain !== hex.terrain) {
      return `${hex.id} is ${hex.terrain} while ${twin.id} is ${twin.terrain}`;
    }
    const opposite: Seat | null = hex.owner === null ? null : hex.owner === "A" ? "B" : "A";
    if (twin.owner !== opposite) {
      return `${hex.id} is held by ${holderName(hex.owner)} while ${twin.id} is held by ${holderName(twin.owner)}`;
    }
    if (twin.troops !== hex.troops) {
      return `${hex.id} holds ${String(hex.troops)} troops while ${twin.id} holds ${String(twin.troops)}`;
    }
    if (twin.garrison !== hex.garrison) {
      return `${hex.id} garrisons ${String(hex.garrison)} while ${twin.id} garrisons ${String(twin.garrison)}`;
    }
  }
  return null;
}

/**
 * Play one Greedy-versus-Greedy match out to its result, naming everything that
 * broke the symmetry along the way: a seat that played out of mirror image, a
 * turn whose scores came apart, a match that ended with a winner.
 */
function playMatch(seed: number, config: Config): string[] {
  const server = new MatchServer();
  const { matchId } = server.createMatch(seed, config);
  const session = server.match(matchId);
  const bots: Record<Seat, Bot> = { A: greedyBot(), B: greedyBot() };
  const problems: string[] = [];

  for (let turn = 1; turn <= config.turns && !session.state.over; turn++) {
    const at = `seed ${String(seed)} turn ${String(turn)}`;
    server.openTurn(matchId);
    for (const seat of SEATS) {
      const { rules, state } = viewOf(server, matchId, seat);
      const decided = bots[seat](rules, state);
      const submitted = server.call(matchId, seat, "submit_orders", decided);
      const where = `${at} seat ${seat}`;
      if (!submitted.ok) {
        problems.push(`${where}: submit_orders answered ${submitted.error}`);
        continue;
      }
      const accepted = (submitted.result as { accepted?: boolean; wasted?: unknown }) ?? {};
      if (accepted.accepted !== true) {
        problems.push(`${where}: orders refused as ${JSON.stringify(accepted.wasted)}`);
      }
    }
    server.resolveTurn(matchId);

    const mismatch = mirrorMismatch(session.state);
    if (mismatch !== null) problems.push(`${at}: ${mismatch}`);
    const points = { A: score(session.state, "A", config).points, B: score(session.state, "B", config).points };
    if (points.A !== points.B) {
      problems.push(`${at}: A scores ${String(points.A)} and B scores ${String(points.B)}`);
    }
  }

  const result = session.state.result;
  if (result === null) {
    problems.push(`seed ${String(seed)}: no result after ${String(session.state.turn)} turns`);
  } else if (result.winner !== null || result.score.A !== result.score.B) {
    problems.push(
      `seed ${String(seed)}: ${result.type} on turn ${String(result.turn)} was won by ${holderName(result.winner)} ` +
        `with ${String(result.score.A)} to A and ${String(result.score.B)} to B`,
    );
  }
  return problems;
}

describe("Greedy against Greedy", () => {
  for (let at = 0; at < SEEDS.length; at += SEEDS_PER_TEST) {
    const seeds = SEEDS.slice(at, at + SEEDS_PER_TEST);
    const range = `seeds ${String(seeds[0])} to ${String(seeds[seeds.length - 1])}`;

    it(`draws every match of ${range} with equal scores and mirrored boards`, () => {
      const problems = seeds.flatMap((seed) => playMatch(seed, DEFAULT_CONFIG));
      const shown = problems.slice(0, REPORTED_PROBLEMS);
      const more = problems.length - shown.length;
      expect(
        problems,
        `${range}: ${shown.join("; ")}${more > 0 ? `; and ${String(more)} more` : ""}`,
      ).toEqual([]);
    });
  }
});
