#!/usr/bin/env node
/**
 * The five golden logs, as `salient-log/1` files the viewer is allowed to load.
 *
 * `games/salient/golden/` holds the five matches the prototype played, in the
 * prototype's shape: no `format` field, `orders` as `[from, to, troops]`
 * triples, terrain under `t`, `cfg` as `{turns, ap, radius}`, `map` as
 * `{id, q, r, t}`, and every board as `[owner, troops, garrison]` cells.
 * `matchLogSchema` is strict about `salient-log/1`, so the viewer has nothing
 * it may load until something converts them, and brief §8's viewer test has no
 * input. This script writes the five fixtures to
 * `games/salient/viewer/fixtures/`, which is under Vite's root, so
 * `pnpm --filter @no-dice/salient-viewer dev` serves them at
 * `?log=/fixtures/golden-01-time-win.json`.
 *
 * **The conversion replays each log through the shipped engine** rather than
 * translating its fields: the log's own `map` and `start` go into a
 * `MatchState`, each turn's orders go through `resolveTurn` with no scouts, and
 * the board, both scores, both supply sets and the events come out of the
 * engine — the same replay `games/salient/engine/src/golden-replay.test.ts`
 * runs, and the same shape `packages/runner/src/match.ts` writes for a match it
 * played itself. That is what makes `cut_off` possible: the prototype's cells
 * hold three numbers and no supply at all, and only the engine's `score()`
 * knows which hexes are out of reach of their own Base. Every turn is checked
 * against the board and the score the log recorded, so a fixture is never
 * written for a match the engine does not agree was played.
 *
 * **The header facts the logs do not carry.** `format`, `ruleset`,
 * `engine_version` (read from the engine's own `package.json`), `created`,
 * `harness` and the log-spelling `config` are supplied here: the prototype
 * recorded none of them. `created` is a fixed timestamp, because a fixture that
 * carried the time it was generated would differ every time the script ran and
 * the viewer's input would stop being a fixed frame. `harness` says what these
 * matches were: scripted bots with no Pi and no harness, so `pi_version` is
 * `null` and every cap the harness could have enforced is 0 — no tool-call cap,
 * no simulate cap, no resubmissions, no turn timeout — with
 * `output_token_budget: null` because there was no budget to enforce rather
 * than a budget of none.
 *
 * **`intent` and `prediction` are generated here, not logged.** The prototype's
 * bots did write a sentence apiece, but those sentences are themselves template
 * text — `salient/docs/salient-mockups.md` calls the mock-ups' intent and
 * prediction "template text from the scripted bots" — and a converter inventing
 * a seat's words is a worse fiction than a converter admitting which sentences
 * it wrote. So both fields are template sentences built from that seat's
 * orders, and the viewer shows them as the mock-ups show theirs. What the logs
 * really record about a seat's turn — its orders — is carried over unchanged;
 * what they do not record — tool calls, scouts, wasted orders, passes, usage,
 * cost, context, wall time, notes — is the zero or the empty a bot's turn record
 * carries anyway.
 *
 * **The margin is unsigned.** `games/salient/server/src/session.ts` writes
 * `Math.abs(score.A - score.B)`, and the fixtures follow it. The golden logs
 * record a signed margin seen from seat A (golden-03 logs `-93`, golden-05
 * `-11`), which reads as a loss for whoever logged it.
 *
 * The engine is reached by relative path, the way `scripts/measure-match.test.mjs`
 * reaches the harness stub: this script sits outside the workspace graph, and
 * naming `@no-dice/salient-engine` would mean adding it to the root package's
 * dependencies for the sake of one generator.
 *
 * Usage:
 *
 *   node scripts/golden-to-log.mjs                        # all five, into the viewer
 *   node scripts/golden-to-log.mjs --out <dir> [log.json ...]
 */
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { cellsFor, matchLogSchema } from "@no-dice/log";

import engineManifest from "../games/salient/engine/package.json" with { type: "json" };
import { DEFAULT_CONFIG } from "../games/salient/engine/src/config.ts";
import { hexKey, hexLabel, parseHexKey } from "../games/salient/engine/src/hex.ts";
import { resolveTurn } from "../games/salient/engine/src/resolve.ts";
import { score } from "../games/salient/engine/src/supply.ts";

/** The five matches, in the order they are numbered. */
const GOLDEN_NAMES = [
  "golden-01-time-win.json",
  "golden-02-knockout-by-A.json",
  "golden-03-knockout-by-B.json",
  "golden-04-mirror-draw.json",
  "golden-05-random-chaos.json",
];

/** Where the prototype's logs live, and where the viewer's fixtures go. */
const GOLDEN_DIR = fileURLToPath(new URL("../games/salient/golden/", import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL("../games/salient/viewer/fixtures/", import.meta.url));

/**
 * The `created` every fixture carries. The prototype recorded no timestamp, and
 * a generated one would make the viewer's input a different file on every run,
 * so the header is fixed instead and regenerating a fixture is byte-identical.
 * The value is brief §7's example timestamp: it names the fixture, not the
 * match, which was played on a date nobody wrote down.
 */
const CREATED = "2026-10-04T22:00:00Z";

/** The prototype's owner numbers, as the engine names the seats. */
const SEAT_BY_OWNER = [null, "A", "B"];

/** What a run prints when its command line did not parse. */
const USAGE = "usage: node scripts/golden-to-log.mjs [--out <dir>] [<golden.json> ...]";

/** The match's own constants: the log names turns, action points and radius. */
const configOf = (golden) => ({
  ...DEFAULT_CONFIG,
  radius: golden.cfg.radius,
  turns: golden.cfg.turns,
  actionPoints: golden.cfg.ap,
});

/**
 * The engine's constants in the log's snake_case spelling — the same renaming
 * `matchConstants` in `games/salient/server/src/view.ts` does for a match the
 * runner plays. `radius`, `blockedPairs` and `supply` stay out: brief §7's
 * config names what a log has to replay under, and the map is logged in full.
 */
const constantsOf = (config) => ({
  turns: config.turns,
  action_points: config.actionPoints,
  start_troops: config.startingTroops,
  base_production: config.baseProduction,
  node_production: config.nodeProduction,
  node_garrison: config.nodeGarrison,
  home_bonus: config.homeBonus,
  points: {
    plain: config.points.plain,
    base: config.points.base,
    node: config.points.node,
  },
});

/** A golden log's text, refused with a readable message when it is not one. */
function parseGolden(text, name) {
  let golden;
  try {
    golden = JSON.parse(text);
  } catch (error) {
    throw new Error(`${name} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (golden === null || typeof golden !== "object") {
    throw new Error(`${name} is not a golden log: it holds ${golden}`);
  }
  if (golden.format !== undefined) {
    throw new Error(`${name} is already a ${golden.format} log, not a golden log`);
  }
  for (const field of ["seed", "cfg", "players", "map", "base", "start", "turns", "result"]) {
    if (golden[field] === undefined) throw new Error(`${name} has no ${field}`);
  }
  return golden;
}

/** The `"q,r"` key each of the log's own board labels names. */
function keysOf(golden) {
  const byLabel = {};
  for (const hex of golden.map) byLabel[hex.id] = hexKey(hex.q, hex.r);
  return byLabel;
}

/** The board the log starts from: its map, its start position, its Bases. */
function startState(golden, keys) {
  const hexes = {};
  golden.map.forEach((hex, i) => {
    const cell = golden.start.cells[i];
    hexes[keys[hex.id]] = {
      id: hex.id,
      q: hex.q,
      r: hex.r,
      terrain: hex.t,
      owner: SEAT_BY_OWNER[cell[0]] ?? null,
      troops: cell[1],
      garrison: cell[2],
    };
  });
  return {
    turn: 1,
    seed: golden.seed,
    hexes,
    base: { A: keys[golden.base.A], B: keys[golden.base.B] },
    over: false,
    result: null,
  };
}

/** One seat's orders, in the log's shape and in the engine's. */
function ordersOf(list, keys) {
  const logged = list.map(([from, to, troops]) => ({ from, to, troops }));
  const engine = logged.map((order) => ({
    from: keys[order.from],
    to: keys[order.to],
    troops: order.troops,
  }));
  return { logged, engine };
}

/** Every hex of the board, in the order the log lists its hexes. */
const boardHexes = (golden, state) => golden.map.map((hex) => state.hexes[hexKey(hex.q, hex.r)]);

/**
 * The board in the log's shape: one cell per hex with `cut_off` from the
 * engine's supply sets, both seats' points, and both seats' troops summed over
 * the hexes they own. Supply is the engine's answer, as it is for the runner.
 */
function boardOf(golden, state, config) {
  const hexes = boardHexes(golden, state);
  const supply = { A: score(state, "A", config), B: score(state, "B", config) };
  const troops = (seat) => hexes.reduce((total, hex) => (hex.owner === seat ? total + hex.troops : total), 0);
  return {
    cells: cellsFor(hexes, supply.A.supplied, supply.B.supplied),
    score: { A: supply.A.points, B: supply.B.points },
    troops: { A: troops("A"), B: troops("B") },
  };
}

/**
 * The engine's board against the board the log recorded, hex by hex and score by
 * score. The fixture claims to be the match the prototype played, and the only
 * way to know that is to ask the engine for the same match and compare.
 */
function checkLogged(golden, name, logged, after) {
  logged.after.cells.forEach((cell, i) => {
    const at = after.cells[i];
    if (cell[0] !== at[0] || cell[1] !== at[1] || cell[2] !== at[2]) {
      throw new Error(
        `${name} turn ${logged.n}: the engine left ${golden.map[i].id} at [${at.join(", ")}] ` +
          `and the log recorded [${cell.join(", ")}]`,
      );
    }
  });
  if (logged.after.score.A !== after.score.A || logged.after.score.B !== after.score.B) {
    throw new Error(
      `${name} turn ${logged.n}: the engine scores A ${after.score.A} and B ${after.score.B}, ` +
        `and the log recorded A ${logged.after.score.A} and B ${logged.after.score.B}`,
    );
  }
}

/** The label of the hex the engine keys `key`, in the log's board labels. */
const labelOf = (key, radius) => {
  const at = parseHexKey(key);
  return hexLabel(at.q, at.r, radius);
};

/** What the engine did in a turn, with every hex named the way the log names it. */
function eventsToLog(events, radius) {
  return events.map((event) => {
    switch (event.type) {
      case "clash":
        return {
          type: "clash",
          between: [labelOf(event.between[0], radius), labelOf(event.between[1], radius)],
          A: event.A,
          B: event.B,
        };
      case "battle":
        return {
          type: "battle",
          at: labelOf(event.at, radius),
          A: event.A,
          B: event.B,
          owner: event.owner,
        };
      case "repelled":
        return { type: "repelled", at: labelOf(event.at, radius), by: event.by, n: event.n };
      case "capture":
        return {
          type: "capture",
          at: labelOf(event.at, radius),
          by: event.by,
          from: event.from,
          terrain: event.terrain,
        };
      default:
        // The engine has four event types and the log has the same four. An event
        // outside them is a version skew, and it fails here rather than turning
        // into an `undefined` entry in a fixture.
        throw new Error(`the engine reported an event of unknown type "${String(event.type)}"`);
    }
  });
}

/**
 * `intent` for a seat's turn: what its orders did, in the order it gave them.
 * Generated from the orders, not logged — see the header comment. Exported so a
 * test can pin the sentence, the same way `measure-match.mjs` exports the lines
 * its report is made of.
 */
const intentSentence = (orders) =>
  orders.length === 0
    ? "Held position: no orders this turn."
    : `${String(orders.length)} ${orders.length === 1 ? "order" : "orders"}: ` +
      `${orders.map((order) => `${String(order.troops)} from ${order.from} to ${order.to}`).join(", ")}.`;

/**
 * `prediction` for a seat's turn: where its own largest move is heading, which
 * is where it should expect the other seat to answer. Generated from the orders
 * for the same reason `intentSentence` is. Exported for the same reason.
 */
const predictionSentence = (orders, other) => {
  if (orders.length === 0) return "Nothing moved, so there is nothing to answer.";
  const push = orders.reduce((best, order) => (order.troops > best.troops ? order : best), orders[0]);
  return `The largest move, ${String(push.troops)} troops, heads for ${push.to}: expect ${other} to answer there.`;
};

/**
 * One seat's turn record. The golden logs record orders and nothing else, so
 * every harness figure is the zero a bot's record carries anyway: no provider,
 * no tool calls, no scouts, no dropped orders, no pass, no notes. `intent` and
 * `prediction` are the generated sentences above.
 */
const recordOf = (orders, other) => ({
  tool_calls: [],
  scouts: [],
  rejected_submission: null,
  orders,
  wasted: [],
  intent: intentSentence(orders),
  prediction: predictionSentence(orders, other),
  passed: null,
  notes_after: "",
  usage: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  cost_usd: 0,
  context_tokens: 0,
  compacted: false,
  wall_ms: 0,
});

/** A seat as the header names it. The prototype's `botSeed` is not a log field. */
const playerOf = (player) => ({ kind: "bot", bot: player.bot });

/**
 * One golden log, as a `salient-log/1` log: replayed through the engine, with
 * the header facts the prototype never recorded. Validated against
 * `matchLogSchema` on the way out, so a fixture that does not parse is an error
 * here rather than a viewer that refuses to open it.
 */
function convertGolden(text, name) {
  const golden = parseGolden(text, name);
  const config = configOf(golden);
  const keys = keysOf(golden);
  let state = startState(golden, keys);

  // The opening board. `start` carries no troops total — brief §7's start is the
  // map's cells and the score the match opens on — so the same board read is
  // narrowed to the two fields here.
  const opened = boardOf(golden, state, config);
  const turns = [];
  for (const logged of golden.turns) {
    const orders = {
      A: ordersOf(logged.orders.A, keys),
      B: ordersOf(logged.orders.B, keys),
    };
    const outcome = resolveTurn(state, { A: orders.A.engine, B: orders.B.engine }, {}, config);
    state = outcome.state;
    const after = boardOf(golden, state, config);
    checkLogged(golden, name, logged, after);
    turns.push({
      n: logged.n,
      players: { A: recordOf(orders.A.logged, "B"), B: recordOf(orders.B.logged, "A") },
      events: eventsToLog(outcome.events, config.radius),
      after,
    });
  }

  if (state.result === null) {
    throw new Error(`${name} has no result after ${String(turns.length)} turns of replay`);
  }
  const result = state.result;

  return matchLogSchema.parse({
    format: "salient-log/1",
    ruleset: "v0",
    engine_version: engineManifest.version,
    created: CREATED,
    seed: golden.seed,
    config: constantsOf(config),
    harness: {
      // Scripted bots: no Pi ran them, and no harness capped anything.
      pi_version: null,
      context: "continuous",
      compaction: false,
      tool_call_cap: 0,
      simulate_cap: 0,
      resubmissions: 0,
      turn_timeout_s: 0,
      output_token_budget: null,
    },
    players: { A: playerOf(golden.players.A), B: playerOf(golden.players.B) },
    map: golden.map.map((hex) => ({ id: hex.id, q: hex.q, r: hex.r, terrain: hex.t })),
    bases: { A: golden.base.A, B: golden.base.B },
    start: { cells: opened.cells, score: opened.score },
    turns,
    result: {
      type: result.type,
      winner: result.winner,
      turn: result.turn,
      score: { A: result.score.A, B: result.score.B },
      margin: Math.abs(result.score.A - result.score.B),
    },
  });
}

/** The bytes a fixture is written as: readable, and stable from run to run. */
const fixtureText = (log) => `${JSON.stringify(log, null, 2)}\n`;

/**
 * Convert each named golden log and write it under `outDir` under its own name.
 * Returns the paths written, in the order they were named.
 */
function writeFixtures({ goldenDir = GOLDEN_DIR, outDir = FIXTURE_DIR, names = GOLDEN_NAMES } = {}) {
  mkdirSync(outDir, { recursive: true });
  return names.map((name) => {
    const path = join(outDir, name);
    writeFileSync(path, fixtureText(convertGolden(readFileSync(join(goldenDir, name), "utf8"), name)));
    return path;
  });
}

/** What the command line asked for: which logs, and where the fixtures go. */
function parseArgs(argv) {
  const names = [];
  let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      if (out !== null) return { error: "--out given twice" };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { error: "--out needs a value" };
      out = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      return { error: `unknown flag "${arg}"` };
    } else if (!arg.endsWith(".json")) {
      return { error: `"${arg}" is not a golden log file name` };
    } else {
      names.push(arg);
    }
  }
  return { command: { out, names } };
}

/** Convert the logs the command line named, and say what was written. */
function main({ out, names }) {
  const written = writeFixtures({
    ...(out === null ? {} : { outDir: out }),
    ...(names.length === 0 ? {} : { names: names.map((name) => basename(name)) }),
  });
  for (const path of written) console.log(`wrote ${path}`);
  return 0;
}

// The bin: run the command line this process was started with, and leave the
// exit code for the shell. Only when executed — importing this file for a test
// must not write fixtures. Both sides are compared after resolving symlinks, as
// `packages/runner/src/cli.ts` does, so a run through a shim still runs.
const invoked = (() => {
  try {
    return realpathSync(process.argv[1] ?? "");
  } catch {
    return null;
  }
})();

if (invoked !== null && import.meta.url === pathToFileURL(invoked).href) {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    console.error(`error: ${parsed.error}`);
    console.error(USAGE);
    process.exitCode = 1;
  } else {
    try {
      process.exitCode = main(parsed.command);
    } catch (error) {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}

export { CREATED, GOLDEN_NAMES, convertGolden, intentSentence, parseArgs, predictionSentence, writeFixtures };
