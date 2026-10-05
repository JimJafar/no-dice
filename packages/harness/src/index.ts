/**
 * Entry point for the player harness.
 *
 * `Player` is the interface brief §6.4 puts between the match runner and a
 * seat, so a model driven through Pi and a bot driven through the same MCP
 * tools are played by the same loop. `BotPlayer` is the second of those: a
 * decision function driven through an ordinary MCP client, holding a seat's
 * bearer token and seeing nothing but what the tools answer. `piCli` is where
 * the first of those gets its build: the Pi this repo pins, as a path to spawn
 * and a version to record.
 */
export const harnessPackage = {
  name: "@no-dice/harness",
} as const;

export { BotPlayer } from "./bot-player.ts";
export { PI_PACKAGE, piCli } from "./pi-cli.ts";
export type { PiCli } from "./pi-cli.ts";
export type { BotPlayerOptions, BotTools, Decision, SubmitVerdict } from "./bot-player.ts";
export type { Player, PlayerContext, RejectedSubmission, ToolCallRecord, TurnOutcome } from "./player.ts";
