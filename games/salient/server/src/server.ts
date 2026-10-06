/**
 * The admin surface brief §6.2 gives the runner: plain in-process functions, not
 * MCP tools. It holds every match in play, and it is what maps a seat's token to
 * the one match and the one seat that token may act for.
 *
 * One `MatchServer` can host several matches at once, which is how a match
 * runner keeps its own matches apart without starting a process each.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import type { Config, Seat } from "@no-dice/salient-engine";
import type { LogEvent, LogResult } from "@no-dice/log";

import { MatchSession, type ToolOutcome, type TurnPlayerRecords } from "./session.ts";

/**
 * A seat's token: random and opaque, so nothing about the match can be guessed
 * from it, and held only by the runner until it hands it to that seat.
 */
const newToken = (): string => randomBytes(18).toString("base64url");

/** What `createMatch` hands the runner: the match, and one token per seat. */
export interface CreatedMatch {
  matchId: string;
  tokens: Record<Seat, string>;
}

/** What a token is good for: exactly one seat of exactly one match. */
export interface TokenOwner {
  matchId: string;
  seat: Seat;
}

export class MatchServer {
  private readonly matches = new Map<string, MatchSession>();
  private readonly tokens = new Map<string, TokenOwner>();
  /**
   * The monotonic timer every match this server hosts measures its tool
   * calls with. It is optional so a caller that does not care keeps working; the
   * match runner passes the one its own turn timings come off, so a rerun on one
   * seed writes the same bytes.
   */
  private readonly timer?: () => number;

  constructor(timer?: () => number) {
    this.timer = timer;
  }

  /** Deal a new match from `seed`, and give each seat its own token. */
  createMatch(seed: number, config: Config = DEFAULT_CONFIG): CreatedMatch {
    const matchId = randomUUID();
    this.matches.set(matchId, new MatchSession(matchId, seed, config, this.timer));
    const tokens: Record<Seat, string> = { A: newToken(), B: newToken() };
    this.tokens.set(tokens.A, { matchId, seat: "A" });
    this.tokens.set(tokens.B, { matchId, seat: "B" });
    return { matchId, tokens };
  }

  /** The match and seat `token` belongs to, or `null` when it belongs to neither. */
  resolveToken(token: string): TokenOwner | null {
    return this.tokens.get(token) ?? null;
  }

  /**
   * Take `seat`'s token away and deal it a new one, which is what the runner
   * does to a seat whose turn ran out while it was still calling. The old token
   * reaches nothing from here on — `callAs` refuses it before anything is
   * counted — so a call the abandoned turn had already sent cannot be spent
   * against the turn that follows it. The runner hands the new token back to the
   * seat when it starts that seat again; a seat that keeps the old one is out of
   * the match.
   */
  rotateToken(matchId: string, seat: Seat): string {
    this.match(matchId);
    for (const [token, owner] of this.tokens) {
      if (owner.matchId === matchId && owner.seat === seat) this.tokens.delete(token);
    }
    const token = newToken();
    this.tokens.set(token, { matchId, seat });
    return token;
  }

  /** The match `matchId` holds, for the runner and the HTTP layer to work with. */
  match(matchId: string): MatchSession {
    const session = this.matches.get(matchId);
    if (session === undefined) throw new Error(`no match ${matchId} is being played here`);
    return session;
  }

  /** One player-facing tool call, for the seat the caller resolved from a token. */
  call(matchId: string, seat: Seat, tool: string, args: unknown): ToolOutcome {
    const session = this.matches.get(matchId);
    if (session === undefined) return { ok: false, result: { error: "unknown_match" }, error: "unknown_match", ms: 0 };
    return session.call(seat, tool, args);
  }

  /**
   * One player-facing tool call for whoever `token` belongs to. The seat is not
   * an argument the caller chooses: it comes from the token, which is good for
   * exactly one seat of exactly one match, so a token can only ever act for that
   * seat and can only ever reach the match it was dealt for. A token this server
   * never issued is refused before anything is counted.
   */
  callAs(token: string, tool: string, args: unknown): ToolOutcome {
    const owner = this.tokens.get(token);
    if (owner === undefined) {
      return { ok: false, result: { error: "unknown_token" }, error: "unknown_token", ms: 0 };
    }
    return this.call(owner.matchId, owner.seat, tool, args);
  }

  /** Reset the per-turn counters and start accepting calls for the turn just begun. */
  openTurn(matchId: string): void {
    this.match(matchId).openTurn();
  }

  /** Which seats have a submission in for this turn. */
  status(matchId: string): { submitted: Record<Seat, boolean> } {
    return this.match(matchId).status();
  }

  /** Resolve the open turn; a seat that never submitted passes. */
  resolveTurn(matchId: string): { events: LogEvent[]; result: LogResult | null } {
    return this.match(matchId).resolveTurn();
  }

  /** Everything the server saw of one seat's `turn`, in the log's per-player shape. */
  turnRecord(matchId: string, turn: number): TurnPlayerRecords {
    return this.match(matchId).turnRecord(turn);
  }
}
