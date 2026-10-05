/**
 * Entry point for the Salient server.
 *
 * `MatchServer` is the admin surface the runner drives — create a match, open a
 * turn, resolve it, read the turn record — and `MatchSession` is the match
 * itself, holding the board, the seats' submissions and the per-turn counters.
 * `labels` is where the engine's `"q,r"` keys and the labels the players and the
 * log use are translated, and `view` is what each seat is allowed to see: the
 * answers `get_rules` and `get_state` give, with the other seat's name nowhere
 * in them.
 */
export const serverPackage = {
  name: "@no-dice/salient-server",
} as const;

export {
  MatchSession,
  TOOL_NAMES,
  type LastTurnReport,
  type SettledTurn,
  type Submission,
  type ToolName,
  type ToolOutcome,
  type TurnCounters,
  type TurnPlayerRecords,
} from "./session";
export { MatchServer, type CreatedMatch, type TokenOwner } from "./server";
export { SIMULATE_LIMIT, TOOL_CALL_LIMIT } from "./limits";
export {
  eventsToLog,
  keyToLabel,
  labelToCoord,
  labelToKey,
  ordersToEngine,
  wastedToLog,
} from "./labels";
export {
  matchConstants,
  PLAYER_SYSTEM_PROMPT,
  playerRulesText,
  rulesView,
  stateView,
  type LastTurnView,
  type MapHexView,
  type RulesView,
  type SeatView,
  type StateEventView,
  type StateHexView,
  type StateView,
} from "./view";
