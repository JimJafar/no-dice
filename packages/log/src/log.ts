/**
 * The `salient-log/1` match log format, exactly as `salient/docs/salient-build-brief.md`
 * §7 defines it. This is the one place the log's fields are named: the runner
 * writes a log against these schemas, the stats package reads one, and the
 * viewer replays one.
 *
 * The module is deliberately browser-safe — it imports nothing from `node:*`
 * and nothing from the engine, so the viewer and the stats package can bundle
 * it. Two consequences: hexes are named by their board label (`B6`) and never
 * by the engine's `"q,r"` key, so every label here is checked as a label; and
 * supply is not computed here — the caller passes the two supplied sets the
 * engine's `score()` returned, and `cellsFor` turns them into `cut_off`.
 *
 * Every object here is strict: a log carrying a field §7 does not name is a
 * format change, and has to be argued about before it is written.
 */
import { z } from "zod";

/** A seat in a match. The log names seats the way the engine does. */
export const seatSchema = z.enum(["A", "B"]);
export type Seat = z.infer<typeof seatSchema>;

/** The four terrains from the rules. */
export const terrainSchema = z.enum(["plain", "node", "base", "blocked"]);
export type Terrain = z.infer<typeof terrainSchema>;

/**
 * A hex named by its board label: the letter of its diagonal column and the
 * number of its row, so `B6` and `F6`. The engine's `"q,r"` key is an internal
 * address and never appears in a log; the runner translates it on the way out.
 */
export const hexLabelSchema = z
  .string()
  .regex(/^[A-Z][0-9]{1,2}$/, "hexes are named by their board label, e.g. F6");
export type HexLabel = z.infer<typeof hexLabelSchema>;

/** A move, as the player submitted it. Invalid orders are logged too, under `wasted`. */
export const orderSchema = z
  .object({ from: hexLabelSchema, to: hexLabelSchema, troops: z.number() })
  .strict();
export type LogOrder = z.infer<typeof orderSchema>;

/**
 * Why an order was dropped, in the engine's wording. An order that breaks
 * several rules is reported under the first of these the engine checks.
 */
export const wasteReasonSchema = z.enum([
  "no action points left",
  "unknown hex",
  "source hex not owned",
  "destination is blocked",
  "hexes are not adjacent",
  "troop count must be a positive integer",
  "not enough troops in source hex",
]);
export type WasteReason = z.infer<typeof wasteReasonSchema>;

/** An order the engine dropped, with the reason it dropped it. */
export const wastedOrderSchema = z
  .object({ order: orderSchema, reason: wasteReasonSchema })
  .strict();
export type WastedLogOrder = z.infer<typeof wastedOrderSchema>;

/**
 * A first submission that was refused: every order the attempt carried, and
 * the reason each invalid one was refused. Nothing from it was committed.
 */
export const rejectedSubmissionSchema = z
  .object({
    orders: z.array(orderSchema),
    wasted: z.array(wastedOrderSchema),
  })
  .strict();
export type RejectedSubmission = z.infer<typeof rejectedSubmissionSchema>;

/**
 * Why a player played no orders this turn. `harness_crash` and `tool_surface`
 * void or abort the match rather than just passing a turn, and are logged the
 * same way when a partial log is kept.
 */
export const passReasonSchema = z.enum([
  "no_submission",
  "timeout",
  "token_budget",
  "provider_error",
  "harness_crash",
  "tool_surface",
]);
export type PassReason = z.infer<typeof passReasonSchema>;

/** One tool call the player made, in the order it made them. */
export const toolCallSchema = z
  .object({
    /** The tool as the player called it, without any `mcp__salient__` prefix. */
    tool: z.string(),
    args: z.unknown(),
    result: z.unknown(),
    error: z.boolean(),
    ms: z.number().int().nonnegative(),
  })
  .strict();
export type ToolCallRecord = z.infer<typeof toolCallSchema>;

/** Provider tokens one seat used this turn. A bot uses none, so all four are 0. */
export const usageSchema = z
  .object({
    input: z.number().int().nonnegative(),
    output: z.number().int().nonnegative(),
    cache_read: z.number().int().nonnegative(),
    cache_write: z.number().int().nonnegative(),
  })
  .strict();
export type Usage = z.infer<typeof usageSchema>;

/**
 * One hex on the board, as `cells[i]` describes `map[i]`:
 * `[owner, troops, garrison, cut_off]`, with owner `0` neutral, `1` A, `2` B,
 * and `cut_off` `1` for an owned hex its owner is out of supply on.
 */
export const cellSchema = z.tuple(
  [
    z.union([z.literal(0), z.literal(1), z.literal(2)], {
      error: "owner is 0 for neutral, 1 for A, 2 for B",
    }),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.union([z.literal(0), z.literal(1)], {
      error: "cut_off is 1 for a hex its owner is out of supply on, otherwise 0",
    }),
  ],
  { error: "a cell is [owner, troops, garrison, cut_off]" },
);
export type Cell = z.infer<typeof cellSchema>;

/** The whole board in log form, one cell per hex of `map` and in `map`'s order. */
export const cellsSchema = z.array(cellSchema);
export type Cells = z.infer<typeof cellsSchema>;

/** Both seats' points. */
export const scoreSchema = z
  .object({
    A: z.number().int(),
    B: z.number().int(),
  })
  .strict();
export type LogScore = z.infer<typeof scoreSchema>;

/** Both seats' troops on the board. */
export const troopsSchema = scoreSchema;
export type LogTroops = z.infer<typeof troopsSchema>;

/**
 * Both players crossed the same edge in opposite directions and met on it.
 * `between` gives the two hexes in the direction seat A crossed the edge.
 */
export const clashEventSchema = z
  .object({
    type: z.literal("clash"),
    between: z.tuple([hexLabelSchema, hexLabelSchema]),
    A: z.number().int().nonnegative(),
    B: z.number().int().nonnegative(),
  })
  .strict();

/** Both seats had troops in the hex, so they fought there. */
export const battleEventSchema = z
  .object({
    type: z.literal("battle"),
    at: hexLabelSchema,
    A: z.number().int().nonnegative(),
    B: z.number().int().nonnegative(),
    owner: seatSchema.nullable(),
  })
  .strict();

/** An attack that was turned back: the hex keeps what it had, the attackers are gone. */
export const repelledEventSchema = z
  .object({
    type: z.literal("repelled"),
    at: hexLabelSchema,
    /** The seat whose attack failed — the one that was repelled. */
    by: seatSchema,
    /** The size of the force that was turned back. */
    n: z.number().int().nonnegative(),
  })
  .strict();

/** The hex changed hands. */
export const captureEventSchema = z
  .object({
    type: z.literal("capture"),
    at: hexLabelSchema,
    by: seatSchema,
    from: seatSchema.nullable(),
    terrain: terrainSchema,
  })
  .strict();

/** What happened during a turn, in the order the engine saw it. */
export const turnEventSchema = z.discriminatedUnion("type", [
  clashEventSchema,
  battleEventSchema,
  repelledEventSchema,
  captureEventSchema,
]);
export type LogEvent = z.infer<typeof turnEventSchema>;

/** What one seat did in one turn, and what it cost. */
export const turnPlayerSchema = z
  .object({
    tool_calls: z.array(toolCallSchema),
    /** The hexes the seat scouted this turn, in the order it scouted them. */
    scouts: z.array(hexLabelSchema),
    rejected_submission: rejectedSubmissionSchema.nullable(),
    /** The orders the seat's final submission carried, valid or not. */
    orders: z.array(orderSchema),
    wasted: z.array(wastedOrderSchema),
    intent: z.string(),
    prediction: z.string(),
    passed: passReasonSchema.nullable(),
    /** The seat's notes on the server at the end of the turn. */
    notes_after: z.string(),
    usage: usageSchema,
    cost_usd: z.number(),
    /** The size of the seat's conversation after the turn. */
    context_tokens: z.number().int().nonnegative(),
    compacted: z.boolean(),
    wall_ms: z.number().int().nonnegative(),
  })
  .strict();
export type TurnPlayerRecord = z.infer<typeof turnPlayerSchema>;

/** The board and the score after a turn, which is what the viewer replays. */
export const boardAfterSchema = z
  .object({ cells: cellsSchema, score: scoreSchema, troops: troopsSchema })
  .strict();
export type BoardAfter = z.infer<typeof boardAfterSchema>;

/** One turn of the match: both seats' records, then what the engine did. */
export const turnSchema = z
  .object({
    n: z.number().int().positive(),
    players: z.object({ A: turnPlayerSchema, B: turnPlayerSchema }).strict(),
    events: z.array(turnEventSchema),
    after: boardAfterSchema,
  })
  .strict();
export type TurnRecord = z.infer<typeof turnSchema>;

/** The constants the match was played under, in the log's snake_case spelling. */
export const matchConfigSchema = z
  .object({
    turns: z.number().int().positive(),
    action_points: z.number().int().nonnegative(),
    start_troops: z.number().int().nonnegative(),
    base_production: z.number().int().nonnegative(),
    node_production: z.number().int().nonnegative(),
    node_garrison: z.number().int().nonnegative(),
    home_bonus: z.number().int().nonnegative(),
    points: z
      .object({
        plain: z.number().int().nonnegative(),
        base: z.number().int().nonnegative(),
        node: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type LogConfig = z.infer<typeof matchConfigSchema>;

/** How the players were driven, so a match can be repeated under the same harness. */
export const harnessSchema = z
  .object({
    /** `pi --version`, or `null` when neither seat ran through Pi. */
    pi_version: z.string().nullable(),
    context: z.literal("continuous"),
    compaction: z.boolean(),
    tool_call_cap: z.number().int().nonnegative(),
    simulate_cap: z.number().int().nonnegative(),
    resubmissions: z.number().int().nonnegative(),
    turn_timeout_s: z.number().int().nonnegative(),
    output_token_budget: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type LogHarness = z.infer<typeof harnessSchema>;

/** A seat driven by a model through Pi. */
export const piPlayerSchema = z
  .object({
    kind: z.literal("pi"),
    /** `<provider>/<model-id>` as Pi was given it. */
    model: z.string(),
    thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
    context_window: z.number().int().nonnegative(),
  })
  .strict();
export type PiPlayerHeader = z.infer<typeof piPlayerSchema>;

/** A seat driven by one of the baseline bots. */
export const botPlayerSchema = z
  .object({ kind: z.literal("bot"), bot: z.string() })
  .strict();
export type BotPlayerHeader = z.infer<typeof botPlayerSchema>;

export const playerSchema = z.discriminatedUnion("kind", [piPlayerSchema, botPlayerSchema]);
export type PlayerHeader = z.infer<typeof playerSchema>;

/**
 * One hex of the static map. The map is logged in full, in the order the cells
 * of every board are aligned to, so a log replays without generating anything.
 */
export const mapHexSchema = z
  .object({
    id: hexLabelSchema,
    q: z.number().int(),
    r: z.number().int(),
    terrain: terrainSchema,
  })
  .strict();
export type MapHex = z.infer<typeof mapHexSchema>;

/** The starting board: the map's cells, and the score the match opens on. */
export const startSchema = z
  .object({ cells: cellsSchema, score: scoreSchema })
  .strict();
export type StartState = z.infer<typeof startSchema>;

/** How the match ended. `winner` is `null` for a draw. */
export const resultSchema = z
  .object({
    type: z.enum(["time", "knockout"]),
    winner: seatSchema.nullable(),
    turn: z.number().int().positive(),
    score: scoreSchema,
    margin: z.number().int(),
  })
  .strict();
export type LogResult = z.infer<typeof resultSchema>;

/** One whole match, from the header to the result. */
export const matchLogSchema = z
  .object({
    format: z.literal("salient-log/1"),
    ruleset: z.literal("v0"),
    engine_version: z.string(),
    created: z.iso.datetime({ offset: true }),
    seed: z.number().int(),
    config: matchConfigSchema,
    harness: harnessSchema,
    players: z.object({ A: playerSchema, B: playerSchema }).strict(),
    map: z.array(mapHexSchema),
    bases: z.object({ A: hexLabelSchema, B: hexLabelSchema }).strict(),
    start: startSchema,
    turns: z.array(turnSchema),
    result: resultSchema,
  })
  .strict()
  .superRefine((log, ctx) => {
    // `cells[i]` describes `map[i]`, so a board of any other length is not a
    // board of this map. Checked here rather than on the cell arrays, because
    // only the whole log knows how many hexes the map has.
    const seen = new Set<string>();
    for (const [i, hex] of log.map.entries()) {
      if (seen.has(hex.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["map", i, "id"],
          message: `map names ${hex.id} twice, so cells cannot align with it`,
        });
      }
      seen.add(hex.id);
    }
    if (log.start.cells.length !== log.map.length) {
      ctx.addIssue({
        code: "custom",
        path: ["start", "cells"],
        message: `start.cells holds ${log.start.cells.length} cells for a map of ${log.map.length} hexes`,
      });
    }
    for (const [i, turn] of log.turns.entries()) {
      if (turn.after.cells.length !== log.map.length) {
        ctx.addIssue({
          code: "custom",
          path: ["turns", i, "after", "cells"],
          message: `turn ${turn.n} after.cells holds ${turn.after.cells.length} cells for a map of ${log.map.length} hexes`,
        });
      }
    }
  });
export type MatchLog = z.infer<typeof matchLogSchema>;

/**
 * The part of an engine hex `cellsFor` reads. The engine's `Hex` satisfies this
 * on its own; naming it here keeps the log module from importing the engine.
 */
export interface BoardHex {
  q: number;
  r: number;
  owner: Seat | null;
  troops: number;
  garrison: number;
}

/** The engine's hex key for a coordinate: `hexKey(q, r)` in the engine, spelled out here. */
const keyOf = (hex: BoardHex): string => `${hex.q},${hex.r}`;

/**
 * The board in log form: one `[owner, troops, garrison, cut_off]` cell per hex,
 * in the order the hexes are given, which is the order the log's `map` lists.
 *
 * Supply is not computed here — that is the engine's job. The caller passes the
 * two `supplied` sets its `score()` calls returned, keyed by the engine's
 * `"q,r"`, and a hex its owner holds out of supply comes back with `cut_off` 1.
 * A neutral hex is never cut off.
 */
export function cellsFor(
  hexes: readonly BoardHex[],
  suppliedA: ReadonlySet<string>,
  suppliedB: ReadonlySet<string>,
): Cell[] {
  return hexes.map((hex) => {
    const owner: Cell[0] = hex.owner === "A" ? 1 : hex.owner === "B" ? 2 : 0;
    const supplied =
      hex.owner === null || (hex.owner === "A" ? suppliedA : suppliedB).has(keyOf(hex));
    const cell: Cell = [owner, hex.troops, hex.garrison, supplied ? 0 : 1];
    return cell;
  });
}
