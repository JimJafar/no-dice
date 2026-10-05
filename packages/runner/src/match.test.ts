/**
 * The match runner: brief §6.4's loop, end to end, with two bots and no model.
 *
 * What these tests pin down is that a match played through the real MCP surface
 * comes out as one log, and that the log is worth believing:
 *
 * - the file validates against `salient-log/1`, and its header records the
 *   harness the match was played under;
 * - the engine, given the logged orders from the logged start position,
 *   reproduces every logged board, event, dropped order, score and result, so
 *   the log records a match that really was played rather than a plausible one;
 * - the same seed and the same bots play the same match twice, and a match over
 *   a socket writes the same log as one over a linked transport with no socket
 *   between the seats and the tools, so the transport is not what is measured;
 * - a seat that hands in nothing passes, with the reason brief §6.3 gives, and
 *   stays in the match to be asked again next turn.
 *
 * Seed 135 is the map the other suites use.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { boardCells, DEFAULT_CONFIG, generateMap, hexKey, resolveTurn, score } from "@no-dice/salient-engine";
import type { Config, Hex, HexKey, MatchState, Order } from "@no-dice/salient-engine";
import { eventsToLog, playerToolServer, wastedToLog } from "@no-dice/salient-server";
import type { MatchServer } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cellsFor, matchLogSchema } from "./log";
import type { BoardAfter, LogOrder, MatchLog, Seat } from "./log";
import { runMatch, salientVerdict } from "./match";
import type { SeatSpec } from "./match";

/** The timestamp every run here is given, so two runs can be compared. */
const CREATED = "2026-10-04T22:00:00.000Z";
const clock = (): Date => new Date(CREATED);

/** The pairing every match here plays: Greedy in seat A, Random in seat B. */
const SEATS: Record<Seat, SeatSpec> = {
  A: { kind: "bot", bot: "greedy" },
  B: { kind: "bot", bot: "random" },
};

/** Where the logs land, in a directory that is gone when the suite is done. */
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "no-dice-match-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * The only fields a rerun cannot reproduce are the ones that were measured: the
 * milliseconds the server saw each tool call take, and the wall time the runner
 * saw each turn take. Everything else in two logs of one match is byte for byte
 * the same, which is what this shows by blanking exactly those.
 */
const withoutTimings = (text: string): string => text.replace(/"(ms|wall_ms)": [0-9]+/g, '"$1": 0');

describe("a Greedy-versus-Random match over Streamable HTTP", () => {
  it("writes one log that validates against salient-log/1", async () => {
    // A directory that is not there yet, which the run has to make.
    const out = join(dir, "135", "greedy-versus-random.json");

    const { path, log } = await runMatch({ out, seed: 135, seats: SEATS, clock });

    expect(path).toBe(out);
    // The file on disk is the log, and it stands on its own against the schema.
    const onDisk = matchLogSchema.parse(JSON.parse(await readFile(out, "utf8")) as unknown);
    expect(onDisk).toEqual(log);
    // The atomic write left nothing else behind for a resume to mistake for a match.
    expect(existsSync(`${out}.tmp`)).toBe(false);

    expect(onDisk.format).toBe("salient-log/1");
    expect(onDisk.ruleset).toBe("v0");
    expect(onDisk.engine_version).toBe("0.1.0");
    expect(onDisk.created).toBe(CREATED);
    expect(onDisk.seed).toBe(135);
    expect(onDisk.harness).toEqual({
      pi_version: null,
      context: "continuous",
      compaction: true,
      tool_call_cap: 12,
      simulate_cap: 3,
      resubmissions: 1,
      turn_timeout_s: 300,
      output_token_budget: null,
    });
    expect(onDisk.players).toEqual({
      A: { kind: "bot", bot: "greedy" },
      B: { kind: "bot", bot: "random" },
    });
    expect(onDisk.bases).toEqual({ A: "B6", B: "J6" });
    expect(onDisk.config).toEqual({
      turns: 25,
      action_points: 6,
      start_troops: 5,
      base_production: 2,
      node_production: 1,
      node_garrison: 3,
      home_bonus: 1,
      points: { plain: 1, base: 1, node: 3 },
    });

    // The map is the one the seed deals, in the order the cells of every logged
    // board line up with, and the match opened on the board that map generates.
    const generated = generateMap(135, DEFAULT_CONFIG);
    expect(onDisk.map).toEqual(
      boardCells(DEFAULT_CONFIG.radius).map((cell) => {
        const hex = generated.hexes[hexKey(cell.q, cell.r)];
        return { id: hex.id, q: hex.q, r: hex.r, terrain: hex.terrain };
      }),
    );
    expect(onDisk.start.cells.length).toBe(onDisk.map.length);
    expect(onDisk.start.score).toEqual({ A: 1, B: 1 });

    // Both bots played every turn of the twenty-five, through the same three
    // tools a model is given, and neither of them scouted or simulated.
    expect(onDisk.turns.map((turn) => turn.n)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    for (const turn of onDisk.turns) {
      for (const seat of ["A", "B"] as const) {
        const played = turn.players[seat];
        expect(played.passed).toBeNull();
        expect(played.scouts).toEqual([]);
        expect(played.usage).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
        expect(played.cost_usd).toBe(0);
        expect(played.context_tokens).toBe(0);
        expect(played.compacted).toBe(false);
        expect(played.wall_ms).toBeGreaterThanOrEqual(0);
        expect(played.tool_calls.map((call) => call.tool)).toEqual(
          turn.n === 1
            ? ["get_rules", "get_state", "submit_orders"]
            : ["get_state", "submit_orders"],
        );
      }
    }

    expect(onDisk.result.type).toBe("time");
    expect(onDisk.result.turn).toBe(25);
    expect(onDisk.result.margin).toBe(Math.abs(onDisk.result.score.A - onDisk.result.score.B));
  }, 60_000);

  it("leaves no half log when the log cannot be put in its place", async () => {
    // The name the log wants is held by a directory, so the rename into place
    // fails. Brief §6.5 reads a log that exists as a match that has been played,
    // so the half file has to go with the attempt that failed.
    const out = join(dir, "held-by-a-directory.json");
    await mkdir(out, { recursive: true });

    await expect(
      runMatch({
        out,
        seed: 135,
        config: { ...DEFAULT_CONFIG, turns: 2 },
        seats: SEATS,
        clock,
      }),
    ).rejects.toThrow();
    expect(existsSync(`${out}.tmp`)).toBe(false);
  }, 60_000);

  it("seeds each bot from the match seed and its own seat", async () => {
    const out = join(dir, "random-versus-random.json");

    const { log } = await runMatch({
      out,
      seed: 135,
      config: { ...DEFAULT_CONFIG, turns: 1 },
      seats: { A: { kind: "bot", bot: "random" }, B: { kind: "bot", bot: "random" } },
      clock,
    });

    // Every map is half-turn symmetric, so two Random bots drawing from one seed
    // would play the mirror of each other exactly. Seating each bot from the
    // seed and its seat is what stops a Random-versus-Random match being one
    // game played twice.
    const first = log.turns[0];
    expect(first.players.A.orders.length).toBeGreaterThan(0);
    expect(first.players.B.orders).not.toEqual(
      first.players.A.orders.map((order) => ({
        from: mirrored(order.from),
        to: mirrored(order.to),
        troops: order.troops,
      })),
    );
  }, 60_000);

  it("replays through the engine to every logged board, score and result", async () => {
    const out = join(dir, "replay-135.json");

    const { log } = await runMatch({ out, seed: 135, seats: SEATS, clock });

    replay(log);
  }, 60_000);

  it("plays the same match twice for the same seed and the same bots", async () => {
    const first = join(dir, "twice-a.json");
    const second = join(dir, "twice-b.json");
    const otherSeed = join(dir, "twice-other-seed.json");

    await runMatch({ out: first, seed: 135, seats: SEATS, clock });
    await runMatch({ out: second, seed: 135, seats: SEATS, clock });
    await runMatch({ out: otherSeed, seed: 202, seats: SEATS, clock });

    const a = await readFile(first, "utf8");
    const b = await readFile(second, "utf8");
    expect(withoutTimings(b)).toBe(withoutTimings(a));
    // The comparison is not vacuous: another seed is another match.
    expect(withoutTimings(await readFile(otherSeed, "utf8"))).not.toBe(withoutTimings(a));
  }, 120_000);

  it("writes the same log over a linked transport as over HTTP", async () => {
    const overHttp = join(dir, "linked-http.json");
    const linked = join(dir, "linked-direct.json");
    /** The MCP servers this run stands on the other end of, kept until it is over. */
    const servers: McpServer[] = [];

    await runMatch({ out: overHttp, seed: 135, seats: SEATS, clock });
    await runMatch({
      out: linked,
      seed: 135,
      seats: SEATS,
      clock,
      transport: (matches: MatchServer, _seat: Seat, token: string) => {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const mcp = playerToolServer(matches, token);
        servers.push(mcp);
        // `connect` installs the message handlers as it is called, so the seat
        // can be handed its end of the pair straight away.
        void mcp.connect(serverSide).catch(() => undefined);
        return clientSide;
      },
    });

    expect(withoutTimings(await readFile(linked, "utf8"))).toBe(
      withoutTimings(await readFile(overHttp, "utf8")),
    );
    await Promise.all(servers.map((server) => server.close()));
  }, 60_000);
});

describe("a match that ends before its turns run out", () => {
  it("stops at a knockout, and logs the match the engine reached", async () => {
    const out = join(dir, "knockout.json");

    const { log } = await runMatch({
      out,
      seed: 135,
      // Forty turns is more than this match needs: seat A walks onto the enemy
      // Base and ends it early.
      config: { ...DEFAULT_CONFIG, turns: 40 },
      seats: SEATS,
      clock,
    });

    expect(log.result.type).toBe("knockout");
    expect(log.result.winner).toBe("A");
    expect(log.result.turn).toBe(34);
    // The loop stopped at the knockout rather than playing out the forty turns the
    // config allowed, and the turn it stopped on is the last one in the log.
    expect(log.turns.length).toBe(34);
    expect(log.turns.at(-1)?.n).toBe(34);
    // The log replays to that end: the engine, given the logged orders, is out of
    // turns at the same turn and with the same score.
    replay(log);
  }, 120_000);
});

describe("a seat that does not play its turn", () => {
  /**
   * A wire that delivers the first `submit_orders` request `delayMs` late, which
   * is what a seat that cannot make up its mind does to the match: its submission
   * is on its way when the turn runs out, and the match sees it only after that
   * turn was closed and the next one opened — where it would be taken as the next
   * turn's submission. The answer it then earns has nowhere to go, because the
   * seat was taken out of the turn, and the wire does not report that going,
   * which is what a match server whose seat vanished mid-call sees.
   */
  class LateWire implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;

    /** Whether the first submission has been held back yet. */
    private held = false;

    constructor(
      private readonly inner: Transport,
      private readonly delayMs: number,
    ) {}

    async start(): Promise<void> {
      this.inner.onmessage = (message) => {
        if (this.held || !askedToSubmit(message)) {
          this.onmessage?.(message);
          return;
        }
        this.held = true;
        setTimeout(() => this.onmessage?.(message), this.delayMs);
      };
      // Deliberately not passed on: the seat went away, and the match server has
      // not noticed, which is the case that lets an abandoned call land late.
      this.inner.onclose = () => undefined;
    }

    async send(message: JSONRPCMessage): Promise<void> {
      try {
        await this.inner.send(message);
      } catch {
        // The answer belongs to a seat that is no longer connected.
      }
    }

    close(): Promise<void> {
      return this.inner.close();
    }
  }

  /** Whether a message on the wire is a call to `submit_orders`. */
  const askedToSubmit = (message: JSONRPCMessage): boolean => {
    const asked = message as { method?: unknown; params?: { name?: unknown } };
    return asked.method === "tools/call" && asked.params?.name === "submit_orders";
  };

  /** A tool call that is never answered, which is how a seat runs out of turn. */
  const neverAnswered = (): Promise<never> => new Promise<never>(() => undefined);

  /**
   * A seat whose tools are answered by the test rather than by the match: enough
   * of `get_rules` and `get_state` for a bot to decide on, and a `submit_orders`
   * that turns the submission away. Nothing reaches the match server for this
   * seat, so the match sees exactly what it would see of a seat that played a
   * turn and handed in nothing.
   */
  const seatThatNeverSubmits = (): McpServer => {
    const mcp = new McpServer({ name: "seat-that-never-submits", version: "0.0.0" });
    const text = (result: unknown): { content: { type: "text"; text: string }[] } => ({
      content: [{ type: "text", text: JSON.stringify(result) }],
    });
    const order = z.strictObject({ from: z.string(), to: z.string(), troops: z.number() });
    mcp.registerTool(
      "get_rules",
      { description: "The map.", inputSchema: z.strictObject({}) },
      async () =>
        text({ constants: { node_garrison: 3, home_bonus: 1 }, bases: { you: "B6", enemy: "J6" }, map: [] }),
    );
    mcp.registerTool(
      "get_state",
      { description: "The turn.", inputSchema: z.strictObject({}) },
      async () => text({ turn: 1, action_points_left: 6, hexes: [] }),
    );
    mcp.registerTool(
      "submit_orders",
      {
        description: "The orders to play.",
        inputSchema: z.strictObject({
          orders: z.array(order),
          intent: z.string(),
          prediction: z.string(),
        }),
      },
      async () => ({ ...text({ error: "turn_not_open" }), isError: true }),
    );
    return mcp;
  };

  /** A seat whose second tool call is never answered: it is still playing at the timeout. */
  const seatThatNeverAnswers = (): McpServer => {
    const mcp = new McpServer({ name: "seat-that-never-answers", version: "0.0.0" });
    mcp.registerTool(
      "get_rules",
      { description: "The map.", inputSchema: z.strictObject({}) },
      async () => ({ content: [{ type: "text", text: "{}" }] }),
    );
    mcp.registerTool(
      "get_state",
      { description: "The turn.", inputSchema: z.strictObject({}) },
      () => neverAnswered(),
    );
    return mcp;
  };

  /** The seat that misbehaves is seat B; seat A is played by the real tools. */
  const seatBIs = (build: (matches: MatchServer, token: string) => McpServer) => {
    const servers: McpServer[] = [];
    return {
      transport: (matches: MatchServer, seat: Seat, token: string) => {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const mcp = seat === "A" ? playerToolServer(matches, token) : build(matches, token);
        servers.push(mcp);
        void mcp.connect(serverSide).catch(() => undefined);
        return clientSide;
      },
      close: async (): Promise<void> => {
        await Promise.all(servers.map((server) => server.close()));
      },
    };
  };

  it("passes a seat that never submitted, with brief §6.3's reason", async () => {
    const out = join(dir, "never-submits.json");
    const seat = seatBIs(() => seatThatNeverSubmits());

    const { log } = await runMatch({
      out,
      seed: 135,
      config: { ...DEFAULT_CONFIG, turns: 2 },
      seats: SEATS,
      clock,
      transport: seat.transport,
    });
    await seat.close();

    expect(log.turns.length).toBe(2);
    for (const turn of log.turns) {
      expect(turn.players.B.passed).toBe("no_submission");
      expect(turn.players.B.orders).toEqual([]);
      expect(turn.players.B.wasted).toEqual([]);
      // The seat that did play is played on, and is asked again next turn.
      expect(turn.players.A.passed).toBeNull();
      expect(turn.players.A.orders.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it("passes a seat that is still playing at the timeout, and keeps the match going", async () => {
    const out = join(dir, "never-answers.json");
    const seat = seatBIs(() => seatThatNeverAnswers());

    const { log } = await runMatch({
      out,
      seed: 135,
      config: { ...DEFAULT_CONFIG, turns: 2 },
      seats: SEATS,
      clock,
      turnTimeoutMs: 1_000,
      transport: seat.transport,
    });
    await seat.close();

    expect(log.harness.turn_timeout_s).toBe(1);
    expect(log.turns.length).toBe(2);
    for (const turn of log.turns) {
      expect(turn.players.B.passed).toBe("timeout");
      expect(turn.players.B.orders).toEqual([]);
      // The turn was still resolved and recorded, and the seat was asked again.
      expect(turn.players.A.passed).toBeNull();
      expect(turn.players.A.orders.length).toBeGreaterThan(0);
      expect(turn.players.B.wall_ms).toBeGreaterThanOrEqual(1_000);
    }
  }, 60_000);

  it("keeps a seat that overran its turn out of the turn that follows it", async () => {
    const out = join(dir, "overran-turn.json");
    /** The MCP servers this run stands on the other end of, kept until it is over. */
    const servers: McpServer[] = [];
    /** How many times seat B has been connected, which decides how late it is. */
    let connections = 0;

    const { log } = await runMatch({
      out,
      seed: 135,
      config: { ...DEFAULT_CONFIG, turns: 2 },
      seats: SEATS,
      clock,
      turnTimeoutMs: 1_000,
      transport: (matches: MatchServer, seat: Seat, token: string) => {
        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        const mcp = playerToolServer(matches, token);
        servers.push(mcp);
        // Seat B is slow both times it is connected. Its first submission is held
        // 1200 ms, so it reaches the match after that turn ran out at 1000 ms and
        // the next one opened; its second is held 1500 ms, so it is still in
        // flight when the turn it belongs to runs out. The abandoned submission is
        // therefore on its way while the turn that follows is open.
        const delay = seat === "B" ? (connections++ === 0 ? 1_200 : 1_500) : 0;
        void mcp
          .connect(delay === 0 ? serverSide : new LateWire(serverSide, delay))
          .catch(() => undefined);
        return clientSide;
      },
    });
    await Promise.all(servers.map((server) => server.close()));

    const [first, second] = log.turns;
    // Seat B lost turn 1 to the clock, and its submission never reached the match.
    expect(first.players.B.passed).toBe("timeout");
    expect(first.players.B.orders).toEqual([]);
    // And it lost turn 2 the same way. The submission the abandoned turn had left
    // running did not become turn 2's while it was open: turn 2 holds only the
    // calls turn 2 made, and no orders at all. Had the leftover been taken as
    // turn 2's submission, this seat would show orders it never decided on, and
    // its own attempt would have been answered `already_submitted`.
    expect(second.players.B.passed).toBe("timeout");
    expect(second.players.B.orders).toEqual([]);
    expect(second.players.B.tool_calls.map((call) => call.tool)).toEqual([
      "get_rules",
      "get_state",
    ]);
    // The seat that kept up played both turns, and the match still reached one.
    for (const turn of [first, second]) {
      expect(turn.players.A.passed).toBeNull();
      expect(turn.players.A.orders.length).toBeGreaterThan(0);
    }
    expect(log.result).not.toBeNull();
  }, 60_000);
});

describe("a submission the server refused", () => {
  const order = (to: string, troops: number): { from: string; to: string; troops: number } => ({
    from: "B6",
    to,
    troops,
  });

  it("drops the refused orders and keeps the rest, one occurrence at a time", () => {
    const sent = [order("C6", 2), order("C6", 2), order("D6", 1)];
    const refused = { order: order("C6", 2), reason: "not enough troops in source hex" };

    // The server refused one of the two identical orders, so one of them stands.
    expect(salientVerdict({ accepted: false, wasted: [refused] }, sent).retry).toEqual([
      order("C6", 2),
      order("D6", 1),
    ]);
    // Refused twice is dropped twice.
    expect(salientVerdict({ accepted: false, wasted: [refused, refused] }, sent).retry).toEqual([
      order("D6", 1),
    ]);
  });

  it("reads an accepted submission as standing and an answer with no verdict as nothing submitted", () => {
    expect(salientVerdict({ accepted: true }, [order("C6", 2)])).toEqual({
      accepted: true,
      rejected: null,
      retry: [],
    });
    expect(salientVerdict({ error: "turn_not_open" }, [order("C6", 2)])).toEqual({
      accepted: false,
      rejected: null,
      retry: [],
    });
  });
});

/** Owner as the log writes it, back as the seat the engine plays. */
const SEAT_BY_OWNER: readonly (Seat | null)[] = [null, "A", "B"];

/**
 * The label of the hex the half-turn rotation `(q, r) -> (-q, -r)` puts where
 * `label` is, on the eleven-column board the log's labels are written for: a
 * letter index L and a row R name the hex at axial `(L - 5, R - 6)`.
 */
const mirrored = (label: string): string =>
  `${String.fromCharCode(65 + 10 - (label.charCodeAt(0) - 65))}${String(12 - Number(label.slice(1)))}`;

/** The log's constants, back in the engine's spelling. */
const engineConfig = (log: MatchLog): Config => ({
  ...DEFAULT_CONFIG,
  turns: log.config.turns,
  actionPoints: log.config.action_points,
  startingTroops: log.config.start_troops,
  baseProduction: log.config.base_production,
  nodeProduction: log.config.node_production,
  nodeGarrison: log.config.node_garrison,
  homeBonus: log.config.home_bonus,
  points: {
    plain: log.config.points.plain,
    node: log.config.points.node,
    base: log.config.points.base,
  },
});

/** The board's radius, which the log does not carry but its map's coordinates give away. */
const radiusOf = (log: MatchLog): number =>
  log.map.reduce((widest, hex) => Math.max(widest, Math.abs(hex.q), Math.abs(hex.r)), 0);

/**
 * The board the log says the match opened on, rebuilt from the log's own map and
 * `start.cells` — the same thing the viewer does, and the reason a log replays
 * without generating anything.
 */
const startStateOf = (log: MatchLog): MatchState => {
  const hexes: Record<HexKey, Hex> = {};
  log.map.forEach((at, i) => {
    const [owner, troops, garrison] = log.start.cells[i];
    hexes[hexKey(at.q, at.r)] = {
      id: at.id,
      q: at.q,
      r: at.r,
      terrain: at.terrain,
      owner: SEAT_BY_OWNER[owner] ?? null,
      troops,
      garrison,
    };
  });
  return {
    turn: 1,
    seed: log.seed,
    hexes,
    base: { A: hexKey(...baseCoord(log, "A")), B: hexKey(...baseCoord(log, "B")) },
    over: false,
    result: null,
  };
};

/** The coordinates of a seat's Base, read off the log's own map. */
function baseCoord(log: MatchLog, seat: Seat): [number, number] {
  const at = log.map.find((hex) => hex.id === log.bases[seat]);
  if (at === undefined) throw new Error(`the logged map has no ${log.bases[seat]}, which is seat ${seat}'s Base`);
  return [at.q, at.r];
}

/** Every hex of a board, in the order the log's `map` lists them. */
const loggedOrder = (log: MatchLog, state: MatchState): Hex[] =>
  log.map.map((at) => state.hexes[hexKey(at.q, at.r)]);

/** The board in the log's shape: its cells, the points, and the troops on the board. */
const boardOf = (log: MatchLog, state: MatchState, config: Config): BoardAfter => {
  const hexes = loggedOrder(log, state);
  const supply = { A: score(state, "A", config), B: score(state, "B", config) };
  const troops = (seat: Seat): number =>
    hexes.reduce((total, hex) => (hex.owner === seat ? total + hex.troops : total), 0);
  return {
    cells: cellsFor(hexes, supply.A.supplied, supply.B.supplied),
    score: { A: supply.A.points, B: supply.B.points },
    troops: { A: troops("A"), B: troops("B") },
  };
};

/** A logged order, back in the engine's coordinates. */
const toEngine = (orders: readonly LogOrder[], log: MatchLog): Order[] =>
  orders.map((order) => {
    const from = log.map.find((hex) => hex.id === order.from);
    const to = log.map.find((hex) => hex.id === order.to);
    if (from === undefined || to === undefined) {
      throw new Error(`the logged match orders ${order.from} to ${order.to}, which are not on its map`);
    }
    return { from: hexKey(from.q, from.r), to: hexKey(to.q, to.r), troops: order.troops };
  });

/**
 * The log replayed by the engine: its own map, its own start position, its own
 * constants, and every turn's orders — including the action points its logged
 * scouts cost. Each turn's board, events and dropped orders are compared with
 * what the log claims happened, and the result the engine reaches with what the
 * log recorded as the match's.
 */
function replay(log: MatchLog): void {
  const config = engineConfig(log);
  const radius = radiusOf(log);
  let state = startStateOf(log);

  for (const turn of log.turns) {
    const outcome = resolveTurn(
      state,
      { A: toEngine(turn.players.A.orders, log), B: toEngine(turn.players.B.orders, log) },
      { A: turn.players.A.scouts.length, B: turn.players.B.scouts.length },
      config,
    );
    state = outcome.state;

    expect(boardOf(log, state, config)).toEqual(turn.after);
    expect(eventsToLog(outcome.events, radius)).toEqual(turn.events);
    expect(wastedToLog(outcome.wasted.A, radius)).toEqual(turn.players.A.wasted);
    expect(wastedToLog(outcome.wasted.B, radius)).toEqual(turn.players.B.wasted);
  }

  const reached = state.result;
  expect(reached).not.toBeNull();
  expect(log.result).toEqual({
    type: reached?.type,
    winner: reached?.winner,
    turn: reached?.turn,
    score: { A: reached?.score.A, B: reached?.score.B },
    margin: Math.abs((reached?.score.A ?? 0) - (reached?.score.B ?? 0)),
  });
}
