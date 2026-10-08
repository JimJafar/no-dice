/**
 * Which of the models Pi knows natively this environment has a key for, asked
 * of the pinned Pi itself.
 *
 * A seat on a provider the console registered needs a `models.json` entry
 * naming it, because Pi has never heard of that provider. A seat on a provider
 * Pi knows natively needs nothing but the key in the environment —
 * `--model deepseek/deepseek-flash` has always worked at the terminal — so the
 * console cannot list those models off its own registry. It has to ask Pi, and
 * asking Pi wrongly is worse than not asking: pointed at the operator's own
 * `~/.pi/agent`, `--list-models` lists the models that directory's `models.json`
 * names as well, and no seat could ever play one of them, because
 * `createSeatHome` relocates `PI_CODING_AGENT_DIR` to an empty directory for
 * every seat it starts. So the question is always asked with that variable
 * pointed at a fresh empty directory, which is what makes the answer be the
 * models a seat can reach: Pi's built-in catalogue, filtered to the providers
 * with a usable key.
 *
 * The child is the pinned build — `node <piCli().path> --list-models` — the same
 * door `pi auth check` and a seat's `--models-json` go through, so the list is
 * the pinned Pi's list and not some Pi on the path.
 *
 * There is no JSON mode for `--list-models`, so the table it prints is parsed
 * rather than guessed at. The last four columns are kept as Pi printed them:
 * `1M` and `384K` are rounded figures for a person to read, and a seat needs no
 * numbers for them, because Pi knows that model's real window natively — a
 * number invented here would be a figure the console then has to defend.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piCli } from "./pi-cli.ts";

/** How long Pi may take to print its own model table. */
const MODELS_TIMEOUT_MS = 30_000;

/** The columns `--list-models` prints, in the order it prints them. */
const COLUMNS = ["provider", "model", "context", "max-out", "thinking", "images"] as const;

/** What Pi's answer begins with when no provider has a usable key. */
const NO_MODELS_SENTENCE = "No models available.";

/** One row of that table: a model a seat could be seated on. */
export interface PiModel {
  /** The provider Pi knows natively, e.g. `"deepseek"`. */
  provider: string;
  /** The model id, e.g. `"deepseek-flash"`. */
  id: string;
  /** `<provider>/<id>` — the string a seat is seated with. */
  reference: string;
  /** Pi's own rounded context window, as printed, e.g. `"1M"`. */
  context: string;
  /** Pi's own rounded maximum output, as printed, e.g. `"384K"`. */
  maxOut: string;
  /** Whether the model reasons, as Pi printed it: `"yes"` or `"no"`. */
  thinking: string;
  /** Whether the model takes images, as Pi printed it: `"yes"` or `"no"`. */
  images: string;
}

/** What to ask, and in whose environment to ask it. */
export interface PiModelsOptions {
  /**
   * The environment the child gets, in full. It replaces this process's rather
   * than merging over it, which differs deliberately from `checkPiAuth`: the
   * question here is *which keys are set*, so a caller that wants an
   * environment with nothing in it has to be able to say so. Omit it to inherit
   * this process's own, which is the honest environment — the seats a console
   * starts get exactly that one.
   */
  env?: Record<string, string>;
}

/** Split one printed line into its cells: the columns are padded and joined by two spaces. */
const cellsOf = (line: string): string[] => line.trim().split(/\s{2,}/);

/**
 * Pi's printed table, read.
 *
 * Exported because the table is what a Pi that changed its output breaks on, and
 * the branch that catches that is only reachable by handing the parser a table
 * no Pi build prints today.
 *
 * The empty sentence is an empty list. Anything else in the first line that is
 * not the header the columns name is a Pi whose output cannot be read, and is
 * thrown rather than answered as an empty list — an empty list tells the
 * operator that no key is set, which is the opposite of what happened.
 */
export const parsePiModelTable = (stdout: string): PiModel[] => {
  const lines = stdout.split("\n").filter((line) => line.trim() !== "");
  const first = (lines[0] ?? "").trim();

  if (first === "") {
    throw new Error("the pinned Pi's --list-models printed nothing at all");
  }
  if (first.startsWith(NO_MODELS_SENTENCE)) {
    return [];
  }

  const header = cellsOf(first);
  if (header.join(" ") !== COLUMNS.join(" ")) {
    throw new Error(
      `the pinned Pi's --list-models did not print a model table; its first line was "${first}"`,
    );
  }

  const models: PiModel[] = [];
  for (const line of lines.slice(1)) {
    const cells = cellsOf(line);
    if (cells.length !== COLUMNS.length) {
      throw new Error(
        `the pinned Pi's --list-models printed a row that is not ${String(COLUMNS.length)} ` +
          `columns: "${line.trim()}"`,
      );
    }
    models.push({
      provider: cells[0],
      id: cells[1],
      reference: `${cells[0]}/${cells[1]}`,
      context: cells[2],
      maxOut: cells[3],
      thinking: cells[4],
      images: cells[5],
    });
  }
  return models;
};

/** What the pinned CLI answered about its own models. */
interface PiAnswer {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Ask the pinned CLI for its model table, in `env`. */
const askPi = (env: Record<string, string>): Promise<PiAnswer> =>
  new Promise((done) => {
    execFile(
      process.execPath,
      [piCli().path, "--list-models"],
      { env, timeout: MODELS_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        done({
          code,
          stdout,
          stderr,
          // `error.code` is the signal-killed exit, which looks like a refusal;
          // the timeout is the fact, and it gets the message.
          timedOut: error !== null && error.killed === true,
        });
      },
    );
  });

/**
 * The models the pinned Pi knows natively that `env` carries a key for.
 *
 * Measured on the pinned build, the call costs about 0.7 s and answers a row per
 * model: with `DEEPSEEK_API_KEY` set to any value, `deepseek/deepseek-flash` and
 * `deepseek/deepseek-v4-pro`; with an environment holding no key at all, nothing.
 *
 * The config directory is always a fresh empty one, and never one the caller
 * names. That is the whole of the call: a directory holding a `models.json`
 * makes `--list-models` list that file's models too — one entry named `ghost`
 * answers a row for `evil/ghost` — and a seat could never play that model,
 * because the seat's own home relocates the same variable to an empty directory.
 * The directory goes as soon as Pi has answered.
 */
export const listPiModels = async (options: PiModelsOptions = {}): Promise<PiModel[]> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.env ?? process.env)) {
    if (typeof value === "string") env[name] = value;
  }

  const home = mkdtempSync(join(tmpdir(), "no-dice-models-"));
  let ran: PiAnswer;
  try {
    ran = await askPi({ ...env, PI_CODING_AGENT_DIR: home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  if (ran.timedOut) {
    throw new Error(
      `the pinned Pi's --list-models took more than ${String(
        Math.round(MODELS_TIMEOUT_MS / 1000),
      )} seconds`,
    );
  }
  if (ran.code !== 0) {
    throw new Error(
      `the pinned Pi's --list-models exited ${String(ran.code)}: ${
        ran.stderr.trim() === "" ? "and wrote nothing to stderr" : ran.stderr.trim()
      }`,
    );
  }
  return parsePiModelTable(ran.stdout);
};
