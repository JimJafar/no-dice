/**
 * Entry point for the player harness.
 *
 * `Player` is the interface brief §6.4 puts between the match runner and a
 * seat, so a model driven through Pi and a bot driven through the same MCP
 * tools are played by the same loop. `PiPlayer` is the first of those: one
 * headless Pi session per seat per match, driven in RPC mode through the
 * `RpcClient` the pinned package exports, prompted once a turn and read back
 * into tool calls and per-turn usage. `BotPlayer` is the second: a decision
 * function driven through an ordinary MCP client, holding a seat's bearer token
 * and seeing nothing but what the tools answer. `piCli` is where the first of
 * those gets its build: the Pi this repo pins, as a path to spawn and a version
 * to record. `checkPiAuth` is asked, before a match is played, whether the model
 * a seat plays has a credential at all. `createSeatHome` is where it gets its
 * isolation: the config directory, empty working directory and session directory
 * that keep the developer's own `~/.pi/agent` out of a match. `StubModel` is the
 * model such a seat plays in the gate: a scripted OpenAI-compatible endpoint on
 * loopback, so the lock-down, the turn rules and a whole 25-turn match are
 * testable with no provider credential and no cost.
 */
export const harnessPackage = {
  name: "@no-dice/harness",
} as const;

export { BotPlayer } from "./bot-player.ts";
export { PiPlayer } from "./pi-player.ts";
export type { PiPlayerOptions, PiThinkingLevel } from "./pi-player.ts";
export { PI_PACKAGE, piCli } from "./pi-cli.ts";
export type { PiCli } from "./pi-cli.ts";
export { checkPiAuth, providerOfModel } from "./pi-auth.ts";
export type { PiAuth, PiAuthOptions } from "./pi-auth.ts";
export { createSeatHome } from "./pi-home.ts";
export type { SeatHome, SeatHomeOptions, SeatId } from "./pi-home.ts";
export {
  StubModel,
  MODELS_FILE,
  STUB_MODEL_ID,
  STUB_PROVIDER,
  callsToolThenSubmits,
  neverSubmits,
  providerError,
  salientToolName,
  sleepsPastDeadline,
  stubModelsJson,
  stubProviderEntry,
} from "./stub-model.ts";
export type {
  StubModelOptions,
  StubReply,
  StubRequest,
  StubScript,
  StubToolCall,
  StubUsage,
} from "./stub-model.ts";
export type { BotPlayerOptions, BotTools, Decision, SubmitVerdict } from "./bot-player.ts";
export type {
  Player,
  PlayerContext,
  PassReason,
  ProviderTurn,
  RejectedSubmission,
  ToolCallRecord,
  TurnOutcome,
  VoidReason,
} from "./player.ts";
export { MatchVoided } from "./player.ts";
