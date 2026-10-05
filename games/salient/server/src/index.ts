/**
 * Entry point for the Salient server.
 *
 * `MatchServer` is the admin surface the runner drives — create a match, open a
 * turn, resolve it, read the turn record — and `MatchSession` is the match
 * itself, holding the board, the seats' submissions and the per-turn counters.
 * `labels` is where the engine's `"q,r"` keys and the labels the players and the
 * log use are translated, `view` is what each seat is allowed to see — the
 * answers `get_rules` and `get_state` give and the hexes `scout` reveals, with
 * the other seat's name nowhere in them — and `simulate` is the projection
 * `simulate` answers, run on a board of nothing but what the caller knows.
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
export {
  NOTES_CHAR_LIMIT,
  SIMULATE_LIMIT,
  SUBMISSION_NOTE_CHARS,
  TOOL_CALL_LIMIT,
} from "./limits";
export {
  eventsToLog,
  keyToLabel,
  labelToCoord,
  labelToKey,
  ordersToEngine,
  ordersToLog,
  wastedToLog,
} from "./labels";
export {
  simulateTurn,
  type SimulatedHexView,
  type SimulateInput,
  type SimulateOutcome,
  type SimulateView,
} from "./simulate";
export {
  knownHexes,
  matchConstants,
  PLAYER_SYSTEM_PROMPT,
  playerRulesText,
  rulesView,
  scoutView,
  stateView,
  type LastTurnView,
  type MapHexView,
  type RulesView,
  type ScoutView,
  type SeatView,
  type StateEventView,
  type StateHexView,
  type StateView,
} from "./view";
