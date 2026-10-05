#!/usr/bin/env node
/**
 * One real match, and what it cost.
 *
 * This is an operator script, not a `no-dice` subcommand: it is what Jim runs
 * when he wants the price of a match before a series pays it 150 times. It seats
 * the model `--model` names against the Greedy bot, plays the match through the
 * same runner `no-dice match` uses, prints a per-turn table of input, output,
 * cache-read and cache-write tokens, cost, context size, wall time and tool
 * calls with the match totals underneath, and writes the same table to the file
 * `--out` names, beside the log.
 *
 * **Why tokens and wall time, and not dollars.** The provider this script is
 * written for is Marvin, Jim's own llama-swap box: it checks no API key and its
 * `models.json` entry prices every token at zero. `cost_usd` is therefore 0 in
 * every turn and in the totals, and the report says so out loud rather than
 * letting a column of noughts read as a model that costs nothing. The scarce
 * quantities are the tokens Marvin's hardware has to evaluate and the seconds it
 * takes to evaluate them, and those are the numbers brief §10's per-turn output
 * budget, brief §11's series cost ceiling and the compaction question all wait on.
 *
 * **The provider entry comes from `providers.json`, not from here.** Marvin is
 * one entry in the registry the CLI reads, and the script reads the same file:
 * base URL, the environment variable a key would come from, `api`, `reasoning`,
 * and the two numbers that are decisions rather than lookups —
 * `contextWindow: 131072` and `maxTokens: 8192`, because `/v1/models` reports
 * neither. They are recorded in the report header, and the window is in the
 * log's `players.A.context_window` too, which is Pi's reading of the seat's own
 * `models.json`. `apiKey: "none"` is Pi's pattern for an endpoint that checks no
 * key, and it is what an entry with no `apiKeyEnv` turns into. Marvin's answers
 * name the llama-swap model behind the alias (`qwen3.8-flash-next-iq3_s` for
 * `subagent`), not `subagent`, so nothing here treats that name as an identity
 * check: the seat is identified by the `--model` it was given and the log's
 * `players.A.model`.
 *
 * **The guards.** `--max-tokens` and `--max-cost` are ceilings on the finished
 * match, checked once its log is written: over either one the report is still
 * written, the script names the ceiling it crossed and exits 1. The one token
 * ceiling the runner can enforce *while a match is still playing* is brief §6.3's
 * per-turn output budget, and `--per-turn-output` sets it — a turn over it is
 * aborted, passes with `token_budget`, and the log's header records the number
 * the match was played under.
 *
 * The report also answers the provider-dependent lines of brief §6.3's first-run
 * checklist from the log and the seat's own session transcript: whether Marvin's
 * prompt cache gives the harness non-zero `cache_read` figures over a whole match,
 * whether the seat was offered and used only the seven tools, what happened to
 * the model's reasoning output, and whether 25 turns fit the window.
 * `docs/pi-harness-notes.md` §7 quotes those answers.
 *
 * **A real model can void the run, and this script does not work around it.** The
 * first attempt at the Marvin match ended on turn 3 with `tool_surface`: the seat
 * called `simulate` instead of `mcp__salient__simulate`, Pi answered "Tool
 * simulate not found", and brief §6.3 voids a match over any tool outside the
 * seven. A voided run writes no log and no report, so the operator replays it:
 * measuring a match the harness refused to accept would measure nothing.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { matchLogSchema } from "@no-dice/log";
import { runMatch } from "@no-dice/runner/match";
import { providerEntry, providerRegistry, seatModelsJson } from "@no-dice/runner/providers";

/** What a run prints when its command line did not parse. */
const USAGE =
  "usage: node scripts/measure-match.mjs --model <provider>/<id> --seed <n> " +
  "[--out <report.md>] [--log <log.json>] [--thinking <level>] " +
  "[--max-tokens <n>] [--max-cost <usd>] [--per-turn-output <n>] [--match-dir <dir>]";

/** The reasoning levels `--thinking` takes, as Pi and the log name them. */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The prefix Pi puts on every tool of the seat's MCP server, as the transcript names them. */
const TOOL_PREFIX = "mcp__salient__";

/**
 * How much of a turn's prompt has to come from the provider's cache for the turn
 * not to count as a re-evaluation. Marvin's cache covers 98.6% or more of a turn
 * that hit it and 72% or less of one that did not, so any line between those two
 * separates them; 90% is comfortably inside the gap and is stated in the report
 * rather than left to the reader.
 */
const COLD_CACHE_SHARE = 0.9;

/** The seven tools a seat is locked to, named as the log names them. */
const SEVEN_TOOLS = [
  "get_rules",
  "get_state",
  "scout",
  "simulate",
  "submit_orders",
  "read_notes",
  "write_notes",
];

/** A flag that takes a non-negative number, or the line saying it did not get one. */
const numberFlag = (flag, raw) => {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : { error: `${flag} takes a number, not "${raw}"` };
};

/** What `--model` and `--seed` have to be, before anything is started. */
const parseArgs = (argv) => {
  const FLAGS = [
    "--model",
    "--seed",
    "--out",
    "--log",
    "--match-dir",
    "--thinking",
    "--max-tokens",
    "--max-cost",
    "--per-turn-output",
  ];

  const given = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!flag.startsWith("--")) return { error: `unexpected argument "${flag}"` };
    if (!FLAGS.includes(flag)) return { error: `unknown flag "${flag}"` };
    if (given.has(flag)) return { error: `${flag} given twice` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return { error: `${flag} needs a value` };
    given.set(flag, value);
    i += 1;
  }

  for (const required of ["--model", "--seed"]) {
    if (!given.has(required)) return { error: `${required} is required` };
  }

  const model = String(given.get("--model"));
  const at = model.indexOf("/");
  if (at <= 0 || at === model.length - 1) {
    return { error: `--model takes <provider>/<id>, not "${model}"` };
  }
  const provider = model.slice(0, at);
  if (providerEntry(provider) === null) {
    return {
      error:
        `--model names provider "${provider}", which providers.json has no entry for; ` +
        `it names ${Object.keys(providerRegistry()).join(", ")}`,
    };
  }

  const rawSeed = String(given.get("--seed"));
  const seed = Number(rawSeed);
  if (!/^-?[0-9]+$/.test(rawSeed) || seed < -2_147_483_648 || seed > 2_147_483_647) {
    return { error: `--seed takes a whole number the engine can deal from, not "${rawSeed}"` };
  }

  const thinking = given.has("--thinking") ? String(given.get("--thinking")) : "medium";
  if (!THINKING_LEVELS.includes(thinking)) {
    return { error: `--thinking takes ${THINKING_LEVELS.join(", ")}, not "${thinking}"` };
  }

  for (const flag of ["--max-tokens", "--max-cost", "--per-turn-output"]) {
    const value = numberFlag(flag, given.get(flag));
    if (value !== null && typeof value === "object") return value;
  }

  return {
    command: {
      model,
      seed,
      thinking,
      out: given.has("--out") ? String(given.get("--out")) : null,
      log: given.has("--log") ? String(given.get("--log")) : null,
      matchDir: given.has("--match-dir") ? String(given.get("--match-dir")) : null,
      // The default ceilings: ten million tokens for one match, and zero dollars
      // because this script's provider bills nothing. A probe match of two turns
      // costs about 70,000 of them, so ten million is far above a match that
      // behaved and still a ceiling a runaway 25-turn seat would hit. A run that
      // costs money at all is not the run these defaults describe, and a paid
      // provider has to be given its own ceiling on purpose.
      maxTokens: numberFlag("--max-tokens", given.get("--max-tokens")) ?? 10_000_000,
      maxCost: numberFlag("--max-cost", given.get("--max-cost")) ?? 0,
      perTurnOutput: numberFlag("--per-turn-output", given.get("--per-turn-output")),
    },
  };
};

/** How a seat's model is spelled inside a file name. */
const slug = (model) => model.replace(/[^A-Za-z0-9._-]+/g, "-");

/** One markdown table row out of its cells. */
const row = (cells) => `| ${cells.join(" | ")} |`;

/** A count as the table prints it: plain digits, so the table stays parseable. */
const num = (value) => String(value);

/** A cost as the table prints it: enough places to show a fraction of a cent. */
const money = (value) => value.toFixed(6);

/** Milliseconds as the table prints them: seconds, to one decimal. */
const seconds = (ms) => (ms / 1000).toFixed(1);

/** A number as prose prints it: with its thousands separated. */
const pretty = (value) => Math.round(value).toLocaleString("en-US");

/**
 * What the seat's own Pi session says: the tools it was offered, the model that
 * answered, and whether its reasoning survived into the transcript.
 *
 * The transcript is the raw record of the match, and the only place the tool
 * loadout is written down: Pi persists a system message naming every tool the
 * session was given, which is what turns "the lock-down held against a real
 * model" into a check on bytes rather than an inference from the calls the seat
 * happened to make.
 */
const readSession = (sessionDir) => {
  let files;
  try {
    files = readdirSync(sessionDir).filter((entry) => entry.endsWith(".jsonl"));
  } catch {
    files = [];
  }

  const tools = new Set();
  const models = new Set();
  const thinkingLevels = new Set();
  let assistantMessages = 0;
  let withThinking = 0;
  let thinkingChars = 0;

  for (const file of files) {
    for (const line of readFileSync(join(sessionDir, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        // A half-written line at the end of a session file is Pi still writing,
        // not a finding.
        continue;
      }
      const message = entry?.message;
      if (!message) continue;
      for (const added of message.toolsAdded ?? []) {
        if (typeof added?.name === "string") tools.add(added.name);
      }
      for (const removed of message.toolsRemoved ?? []) {
        if (typeof removed?.name === "string") tools.delete(removed.name);
      }
      if (message.role !== "assistant") continue;
      assistantMessages += 1;
      if (typeof message.model === "string") models.add(message.model);
      if (typeof message.thinkingLevel === "string") thinkingLevels.add(message.thinkingLevel);
      const blocks = Array.isArray(message.content) ? message.content : [];
      const thinking = blocks.filter((block) => block?.type === "thinking");
      if (thinking.length > 0) {
        withThinking += 1;
        thinkingChars += thinking.reduce((total, block) => total + (block.thinking?.length ?? 0), 0);
      }
    }
  }

  return {
    sessions: files.length,
    tools: [...tools].sort(),
    models: [...models].sort(),
    assistantMessages,
    withThinking,
    thinkingChars,
    thinkingLevels: [...thinkingLevels].sort(),
  };
};

/** The four token counts of one seat's turn, added up. */
const turnTokens = (record) =>
  record.usage.input + record.usage.output + record.usage.cache_read + record.usage.cache_write;

/** What one seat's turn sent as prompt tokens: what the provider has to evaluate. */
const promptTokens = (record) =>
  record.usage.input + record.usage.cache_read + record.usage.cache_write;

/** The share of a turn's prompt that came out of the provider's cache. */
const cacheShare = (record) => {
  const prompt = promptTokens(record);
  return prompt === 0 ? 0 : record.usage.cache_read / prompt;
};

/** A share as a percentage, to one decimal. */
const pct = (share) => (share * 100).toFixed(1);

/**
 * The ceilings the finished match crossed, each as the sentence naming it.
 *
 * This is the guard the operator ran the match under: an empty array means the
 * run exits 0, and anything in it is both what the report prints and what the
 * script prints to stderr on its way to exit 1. A match that went over its
 * budget must not look like a match that finished inside it.
 */
const guardBreaches = (log, guards) => {
  const totals = log.turns.reduce(
    (sum, turn) => ({
      tokens: sum.tokens + turnTokens(turn.players.A),
      cost: sum.cost + turn.players.A.cost_usd,
    }),
    { tokens: 0, cost: 0 },
  );
  const breaches = [];
  if (totals.tokens > guards.maxTokens) {
    breaches.push(
      `the match cost ${num(totals.tokens)} tokens, over --max-tokens ${num(guards.maxTokens)}`,
    );
  }
  if (totals.cost > guards.maxCost + 1e-9) {
    breaches.push(
      `the match cost ${money(totals.cost)} USD, over --max-cost ${money(guards.maxCost)}`,
    );
  }
  return breaches;
};

/**
 * How a seat reaches its provider's key, as the registry says it. The key itself
 * is never in `providers.json`: an entry names the variable, and the seat's own
 * `models.json` interpolates it, so the value exists only in the seat's
 * environment. An entry that names no variable is a keyless endpoint.
 */
const keyWord = (provider) =>
  provider.apiKeyEnv === null
    ? '`apiKey: "none"` — the endpoint checks no key'
    : `key read from \`${provider.apiKeyEnv}\` in the environment the seat starts in`;

/**
 * What one provider's committed rates mean for the `cost_usd` column, as one
 * report line. All-zero rates are the case this script was written for — Jim's
 * own hardware bills nothing, so tokens and wall time are the scarce quantities
 * — and the report says which of the two a run is in rather than letting a
 * column of noughts read as a model that costs nothing.
 */
const costLine = (provider) => {
  const rates = provider.cost;
  const free =
    rates.input === 0 && rates.output === 0 && rates.cacheRead === 0 && rates.cacheWrite === 0;
  return free
    ? "**`cost_usd` is 0 in every turn and in the totals, and that is not a measurement failure:** " +
      "the provider's entry in `providers.json` prices input, output, cache-read and " +
      "cache-write tokens at 0, so this run is not billed in dollars. Tokens and wall " +
      "time are what it charges in, and they are the figures a series budget is set from."
    : `**\`cost_usd\` below is those rates against the usage the provider reported:** the entry in ` +
      `\`providers.json\` prices tokens at ${money(rates.input)} per M input, ` +
      `${money(rates.output)} per M output, ${money(rates.cacheRead)} per M cache-read and ` +
      `${money(rates.cacheWrite)} per M cache-write.`;
};

/**
 * The report: the run's facts, the per-turn table, the totals underneath it, what
 * one match costs, and the four questions the milestone asks of a real provider,
 * answered from the log and the seat's transcript.
 */
const renderReport = ({ log, logPath, reportPath, matchDir, model, thinking, provider, runWallMs, guards }) => {
  const seat = "A";
  const turns = log.turns;
  const header = log.players[seat];
  const records = turns.map((turn) => turn.players[seat]);
  const window = header.context_window;

  const total = records.reduce(
    (sum, record) => ({
      input: sum.input + record.usage.input,
      output: sum.output + record.usage.output,
      cacheRead: sum.cacheRead + record.usage.cache_read,
      cacheWrite: sum.cacheWrite + record.usage.cache_write,
      prompt: sum.prompt + record.usage.input + record.usage.cache_read + record.usage.cache_write,
      cost: sum.cost + record.cost_usd,
      wallMs: sum.wallMs + record.wall_ms,
      calls: sum.calls + record.tool_calls.length,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, prompt: 0, cost: 0, wallMs: 0, calls: 0 },
  );

  const contexts = records.map((record) => record.context_tokens);
  const compactedTurns = records.filter((record) => record.compacted).length;
  const cacheTurns = records.filter((record) => record.usage.cache_read > 0).length;
  const passed = records.filter((record) => record.passed !== null);
  const tools = new Set(records.flatMap((record) => record.tool_calls.map((call) => call.tool)));
  const outside = [...tools].filter((tool) => !SEVEN_TOOLS.includes(tool)).sort();
  const session = readSession(join(matchDir, `session-${seat}`));
  const tokens = total.input + total.output + total.cacheRead + total.cacheWrite;
  const modelId = model.slice(model.indexOf("/") + 1);

  // Which turns the provider's cache missed, and whether they are the slow ones.
  // A series budget is set from this, so it is computed from the log here rather
  // than written down as prose somewhere that can drift from the table.
  const byWall = turns.map((turn, index) => ({ n: turn.n, index, wallMs: records[index].wall_ms }));
  const shareOf = (entry) => cacheShare(records[entry.index]);
  const cold = byWall.filter((entry) => shareOf(entry) < COLD_CACHE_SHARE);
  const warm = byWall.filter((entry) => shareOf(entry) >= COLD_CACHE_SHARE);
  const warmShares = warm.map(shareOf);
  const warmWalls = warm.map((entry) => entry.wallMs);
  const slowestTurns = [...byWall].sort((a, b) => b.wallMs - a.wallMs).slice(0, cold.length);
  const coldAreSlowest =
    cold.length > 0 &&
    cold.length < turns.length &&
    cold.every((entry) => slowestTurns.some((slow) => slow.n === entry.n));

  // The log's own bytes, so a committed report can be tied to the log it came
  // from when the log itself is too big to commit.
  const logSha = createHash("sha256").update(readFileSync(logPath)).digest("hex");
  const breaches = guardBreaches(log, guards);

  const lines = [];
  lines.push(`# Pi cost report: ${model} versus Greedy`);
  lines.push("");
  lines.push(`- **Seat A:** \`kind: pi\`, model \`${header.model}\`, thinking \`${header.thinking}\``);
  lines.push("- **Seat B:** `kind: bot`, `greedy` — it runs no provider, so every figure below is seat A's");
  lines.push(
    `- **Provider:** \`${model.slice(0, model.indexOf("/"))}\`, the entry \`providers.json\` commits for it — \`${provider.baseUrl}\` (\`api: ${provider.api}\`, ${keyWord(provider)}, \`reasoning: ${String(provider.reasoning)}\`)`,
  );
  lines.push(
    `- **contextWindow: ${pretty(window)} tokens — a decision, not a lookup, and now a committed one.** The entry in \`providers.json\` is what the seat was played with; a compatible endpoint reports no length of its own, so the number had to be chosen rather than read. The log's \`players.${seat}.context_window\` carries the same figure because it is Pi's reading of the seat's own \`models.json\`.`,
  );
  lines.push(
    `- **maxTokens: ${pretty(provider.maxTokens)} — also a decision, not a lookup.** The endpoint advertises no output cap either, so this is the cap the run's model requests were made under, and it bounds the output-token figures below; a run under a different cap is a different run.`,
  );
  lines.push(`- **Seed:** ${String(log.seed)} — **turns played:** ${String(turns.length)} of ${String(log.config.turns)}`);
  lines.push(
    `- **Result:** \`${log.result.type}\`, seat ${log.result.winner ?? "nobody"}, A ${String(log.result.score.A)} – B ${String(log.result.score.B)}`,
  );
  lines.push(`- **Pi:** ${String(log.harness.pi_version)} in RPC mode, one session per seat — **engine:** ${String(log.engine_version)} — **created:** ${String(log.created)}`);
  lines.push(`- **Log:** \`${logPath}\` — sha256 \`${logSha}\``);
  lines.push(`- **Report:** \`${reportPath}\``);
  lines.push(
    `- **Seat transcript:** \`${join(matchDir, `session-${seat}`)}\` (${String(session.sessions)} session file${session.sessions === 1 ? "" : "s"})`,
  );
  lines.push("");
  lines.push(costLine(provider));
  lines.push("");

  lines.push("## Seat A, turn by turn");
  lines.push("");
  lines.push(
    row([
      "Turn",
      "input",
      "output",
      "cache_read",
      "cache_write",
      "cost_usd",
      "context",
      "% window",
      "wall_s",
      "tool calls",
      "passed",
    ]),
  );
  lines.push(row(["---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---"]));
  for (const [index, record] of records.entries()) {
    lines.push(
      row([
        num(turns[index].n),
        num(record.usage.input),
        num(record.usage.output),
        num(record.usage.cache_read),
        num(record.usage.cache_write),
        money(record.cost_usd),
        num(record.context_tokens),
        window === 0 ? "-" : ((record.context_tokens / window) * 100).toFixed(1),
        seconds(record.wall_ms),
        num(record.tool_calls.length),
        record.passed ?? "-",
      ]),
    );
  }
  lines.push("");
  lines.push(
    row([
      "**Total**",
      `**${num(total.input)}**`,
      `**${num(total.output)}**`,
      `**${num(total.cacheRead)}**`,
      `**${num(total.cacheWrite)}**`,
      `**${money(total.cost)}**`,
      "-",
      "-",
      `**${seconds(total.wallMs)}**`,
      `**${num(total.calls)}**`,
      `**${num(passed.length)}**`,
    ]),
  );
  lines.push(
    row([
      "**Mean per turn**",
      `**${num(Math.round(total.input / turns.length))}**`,
      `**${num(Math.round(total.output / turns.length))}**`,
      `**${num(Math.round(total.cacheRead / turns.length))}**`,
      `**${num(Math.round(total.cacheWrite / turns.length))}**`,
      `**${money(total.cost / turns.length)}**`,
      "-",
      "-",
      `**${seconds(total.wallMs / turns.length)}**`,
      `**${(total.calls / turns.length).toFixed(1)}**`,
      "-",
    ]),
  );
  lines.push("");
  lines.push(
    `Seat B played all ${String(turns.length)} turns and costs nothing by construction: no provider, so \`usage\`, \`cost_usd\` and \`context_tokens\` stand at 0 in its turn records.`,
  );
  lines.push("");

  lines.push("## What one match costs");
  lines.push("");
  lines.push(
    `- **Tokens:** ${pretty(tokens)} in seat A — ${pretty(total.input)} input, ${pretty(total.output)} output, ${pretty(total.cacheRead)} read from the provider's prompt cache, ${pretty(total.cacheWrite)} written to it.`,
  );
  lines.push(
    `- **Wall time:** ${seconds(total.wallMs)} s of seat-A turns out of ${seconds(runWallMs)} s for the whole run, which includes the runner's start-up and both seats' processes. The two seats are asked for a turn together, so seat B's turns run inside the same wall time.`,
  );
  lines.push(
    `- **Money:** ${money(total.cost)} US dollars, at the rates \`providers.json\` commits for this provider. The token counts above are the transferable figure: another provider at the same counts costs whatever its own rates say.`,
  );
  lines.push(
    `- **Prompt tokens:** ${pretty(total.prompt)} over the match. The conversation is re-sent on every model call, so this is what a series multiplies, and the cache-read share of it — ${pct(total.cacheRead / Math.max(1, total.prompt))}% — is what softens the cost of doing that.`,
  );
  lines.push("");

  lines.push("## What this run answers");
  lines.push("");
  lines.push(
    `- **Cache reads (\`tokens.cacheRead\`):** ${cacheTurns} of ${turns.length} turns report a non-zero \`cache_read\`, ${pretty(total.cacheRead)} tokens in all, which is ${pct(total.cacheRead / Math.max(1, total.prompt))}% of the ${pretty(total.prompt)} prompt tokens the match sent. Marvin's prompt cache ${total.cacheRead > 0 ? "**does** reach the harness over a whole match" : "**does not** reach the harness over a whole match"}.`,
  );
  lines.push(
    cold.length === 0
      ? `- **Where the cache missed:** no turn read less than ${pct(COLD_CACHE_SHARE)}% of its prompt from the cache, so every turn of this match was served from it.`
      : `- **Where the cache missed:** ${String(cold.length)} of ${turns.length} turns read under ${pct(COLD_CACHE_SHARE)}% of their prompt from the cache — ${cold
          .map((entry) => `turn ${String(entry.n)} at ${pct(shareOf(entry))}% (${seconds(entry.wallMs)} s)`)
          .join(", ")}${coldAreSlowest ? `, which are the ${String(cold.length)} slowest turns of the match` : ""}. The other ${String(warm.length)} sit at ${pct(Math.min(...warmShares))}–${pct(Math.max(...warmShares))}% cached and ${seconds(Math.min(...warmWalls))}–${seconds(Math.max(...warmWalls))} s. A series budgets for those re-evaluations, not for the average.`,
  );
  lines.push(
    `- **The tool lock-down, as the seat used it:** ${num(total.calls)} tool calls over ${turns.length} turns, ${tools.size} distinct tool name${tools.size === 1 ? "" : "s"} — ${[...tools].sort().map((tool) => `\`${tool}\``).join(", ") || "none"}. ${outside.length === 0 ? "Every one is inside the seven, and the match was not voided for `tool_surface`." : `Outside the seven: ${outside.map((tool) => `\`${tool}\``).join(", ")}.`}`,
  );
  const offered = session.tools.map((tool) => (tool.startsWith(TOOL_PREFIX) ? tool.slice(TOOL_PREFIX.length) : tool));
  lines.push(
    `- **The tool lock-down, as the session recorded it:** ${String(session.tools.length)} tools declared in the seat's transcript — ${session.tools.map((tool) => `\`${tool}\``).join(", ") || "none recorded"}. ${offered.length === SEVEN_TOOLS.length && SEVEN_TOOLS.every((tool) => offered.includes(tool)) ? "Exactly the seven, so `defaultTools: []`, the disabled built-in extensions and `--no-builtin-tools` held against a real model." : "Not exactly the seven, which needs looking at."}`,
  );
  lines.push(
    `- **Reasoning output:** ${String(session.withThinking)} of ${String(session.assistantMessages)} assistant messages in the transcript carry a \`thinking\` block, ${pretty(session.thinkingChars)} characters in all, so Marvin's \`reasoning_content\` reached Pi and was kept as thinking — and thinking is inside the \`output\` token counts above. The seat was asked at thinking level \`${thinking}\` and the messages record \`${session.thinkingLevels.join(", ") || "nothing"}\`.`,
  );
  lines.push(
    `- **Which model answered:** the transcript names \`${session.models.join(", ") || "no model name"}\`, the id the seat was given. Marvin's own answer names the llama-swap model behind the alias instead, so neither name is an identity check on \`${modelId}\`; the seat is identified by \`--model\` and the log's \`players.${seat}.model\`.`,
  );
  lines.push(
    `- **Context growth:** ${num(contexts[0])} tokens on turn 1, ${num(Math.max(...contexts))} at the largest, ${num(contexts.at(-1))} on turn ${String(turns.at(-1).n)} — ${num(Math.round((contexts.at(-1) - contexts[0]) / Math.max(1, turns.length - 1)))} a turn on average, against a ${num(window)}-token window, so the match reached ${((Math.max(...contexts) / Math.max(1, window)) * 100).toFixed(1)}% of it. Compaction ran on ${String(compactedTurns)} turn${compactedTurns === 1 ? "" : "s"}.`,
  );
  lines.push(
    `- **Turns that did not play:** ${passed.length === 0 ? "none — every turn ended with an accepted submission." : `${String(passed.length)} turn${passed.length === 1 ? "" : "s"} passed (${passed.map((record) => `\`${record.passed}\``).join(", ")}).`}`,
  );
  lines.push("");

  lines.push("## Guards this run was played under");
  lines.push("");
  lines.push(
    `- \`--max-tokens ${num(guards.maxTokens)}\` — a ceiling on the match's total tokens, checked against the totals above. ${tokens <= guards.maxTokens ? "Not crossed." : `**Crossed: ${num(tokens)}.**`}`,
  );
  lines.push(
    `- \`--max-cost ${money(guards.maxCost)}\` — a ceiling on the match's cost, checked the same way. ${total.cost <= guards.maxCost + 1e-9 ? "Not crossed." : `**Crossed: ${money(total.cost)}.**`}`,
  );
  lines.push(
    `- \`--per-turn-output ${guards.perTurnOutput === null ? "none" : num(guards.perTurnOutput)}\` — brief §6.3's per-turn output budget, the one ceiling the runner enforces while a match is still playing. The log's header records \`output_token_budget: ${log.harness.output_token_budget === null ? "null" : num(log.harness.output_token_budget)}\`.`,
  );
  lines.push(
    breaches.length === 0
      ? "- **Outcome:** no ceiling crossed, so the run exits 0."
      : `- **Outcome:** ${breaches.join("; ")}, so the run exits 1.`,
  );
  lines.push("");
  lines.push(`_Written by \`scripts/measure-match.mjs\` from the log at \`${logPath}\`._`);
  lines.push("");

  return lines.join("\n");
};

/** Play the match, write the report beside its log, and print it. */
const main = async (command, cwd) => {
  const provider = providerEntry(command.model.slice(0, command.model.indexOf("/")));
  const reportPath = resolve(
    cwd,
    command.out ?? join("reports", `pi-cost-${slug(command.model)}-${String(command.seed)}.md`),
  );
  // The log goes beside the report, which is where the run's evidence is kept.
  const logPath = resolve(
    cwd,
    command.log ?? join(dirname(reportPath), `${String(command.seed)}-${slug(command.model)}-greedy.json`),
  );
  const matchDir =
    command.matchDir === null
      ? `${logPath.replace(/\.json$/i, "")}-match`
      : resolve(cwd, command.matchDir);

  mkdirSync(dirname(reportPath), { recursive: true });

  console.log(`playing ${command.model} versus greedy on seed ${String(command.seed)}`);
  console.log(`  log       ${logPath}`);
  console.log(`  report    ${reportPath}`);
  console.log(`  homes     ${matchDir}`);
  console.log(
    `  thinking  ${command.thinking} — contextWindow ${num(provider.contextWindow)} from providers.json`,
  );
  console.log("a real match takes minutes; the table is printed when it is over.");

  const started = performance.now();
  const { path } = await runMatch({
    out: logPath,
    seed: command.seed,
    seats: {
      A: {
        kind: "pi",
        model: command.model,
        thinking: command.thinking,
        modelsJson: seatModelsJson(command.model),
        ...(command.perTurnOutput === null ? {} : { outputTokenBudget: command.perTurnOutput }),
      },
      B: { kind: "bot", bot: "greedy" },
    },
    matchDir,
  });
  const runWallMs = Math.max(0, Math.round(performance.now() - started));

  // Read the log back off the disk: the report is a claim about the bytes the
  // runner wrote, and they have to validate against `salient-log/1` for its
  // numbers to mean anything to milestone 04.
  const log = matchLogSchema.parse(JSON.parse(readFileSync(path, "utf8")));

  const report = renderReport({
    log,
    logPath: path,
    reportPath,
    matchDir,
    model: command.model,
    thinking: command.thinking,
    provider,
    runWallMs,
    guards: command,
  });
  writeFileSync(reportPath, report, "utf8");
  console.log("");
  console.log(report);
  console.log(`report written to ${reportPath}`);

  const breaches = guardBreaches(log, command);
  for (const breach of breaches) console.error(`error: ${breach}`);
  return breaches.length === 0 ? 0 : 1;
};

// The bin: run the command line this process was started with, and leave the
// exit code for the shell. Only when executed — importing this file for a test
// must not start a match. Both sides are compared after resolving symlinks, as
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
    process.exitCode = await main(parsed.command, process.cwd()).catch((error) => {
      console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    });
  }
}

export { guardBreaches, parseArgs, renderReport };
