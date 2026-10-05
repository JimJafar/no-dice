/**
 * A seat's isolated Pi home: the three directories brief §6.3 gives each seat,
 * the two config files inside one of them, and the environment the child needs.
 *
 * A Pi session inherits everything in `~/.pi/agent` unless it is told not to:
 * the developer's settings, extensions, skills, context files and provider
 * logins. A match played with those in play is not the match the brief
 * describes — the model would have `bash` and `read` beside the seven game
 * tools, and a different system prompt and set of skills than the next match
 * had. `PI_CODING_AGENT_DIR` moves Pi's whole config directory, which is the
 * one switch that takes all of that out; on a fresh match directory the two
 * files written here are the only configuration a seat has — the runner may add
 * a third, the `models.json` that `StubModel.writeModelsJson` writes to name the
 * model the seat plays — and the `settings.json` written here plus the flags
 * brief §6.3 lists leave it the seven Salient tools and nothing else.
 *
 * The three directories are separate on purpose. `pi-home-<seat>/` is what Pi
 * reads and writes as its config; `cwd-<seat>/` is the empty working directory
 * the process runs in, so a model with a file tool would find an empty board
 * rather than the repository and the match log; `session-<seat>/` holds the
 * transcript Pi saves, which is the raw record of the match and belongs with
 * the match, not with the config.
 *
 * The seat's bearer token never goes in a file. `mcp.json` names the
 * environment variable Pi substitutes it from, so the token exists only in the
 * child's environment, and the file that can be committed, read and diffed
 * holds a placeholder.
 *
 * `--no-extensions` is deliberately not part of this: it switches off Pi's
 * built-in MCP extension, and with it the game tools. The narrowing is done by
 * `settings.json` and by the flags brief §6.3 lists, which leave MCP on.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The two seats of a match, named as the runner and the log name them. */
export type SeatId = "A" | "B";

/** What a seat home is built for. */
export interface SeatHomeOptions {
  /**
   * The match's directory; the three seat directories are made inside it. May
   * be relative to this process, and is resolved to an absolute path.
   */
  matchDir: string;
  /** Which seat this home is. */
  seat: SeatId;
  /** The match's MCP endpoint, e.g. `http://127.0.0.1:8787/mcp`. */
  serverUrl: string;
  /** The seat's bearer token, handed to the child through the environment only. */
  token: string;
}

/** A seat home as written: where everything is, and how to start the child. */
export interface SeatHome {
  /** The seat this home is for. */
  seat: SeatId;
  /** The config directory, and what `PI_CODING_AGENT_DIR` is set to. */
  piHomeDir: string;
  /** The empty directory to run the child in. */
  cwd: string;
  /** The directory Pi saves the match's transcript to (`--session-dir`). */
  sessionDir: string;
  /** `$PI_CODING_AGENT_DIR/mcp.json`, the only MCP config the seat reads. */
  mcpConfigPath: string;
  /** `$PI_CODING_AGENT_DIR/settings.json`, the lock-down of brief §6.3. */
  settingsPath: string;
  /**
   * The variables the child needs, to be merged over the parent's environment:
   * the relocated config directory, the seat's token, and the three Pi settings
   * that keep a match quiet — no version check, no telemetry, long provider
   * cache retention for the conversation that is re-sent every turn.
   */
  env: Record<string, string>;
}

/**
 * The MCP server's name, which is what makes the tools read as
 * `mcp__salient__get_state` and the rest, and matches the name the Salient
 * server registers itself under.
 */
const MCP_SERVER_NAME = "salient";

/** What Pi's system prompt says the server offers. */
const MCP_DESCRIPTION = "Salient game tools for this match";

/** The environment variable the bearer token is substituted from. */
const TOKEN_VAR = "SALIENT_TOKEN";

/**
 * The seat's `settings.json`, verbatim from brief §6.3.
 *
 * `defaultTools: []` leaves the model no built-in tool, `autoEnableCodemode`
 * and the three disabled built-in extensions take away the ways Pi would hand
 * it one anyway, `compaction.enabled` keeps a long match playing on a summary
 * instead of failing, and `quietStartup` keeps Pi's own noise out of the RPC
 * stream the runner reads.
 */
const SETTINGS = {
  defaultTools: [],
  autoEnableCodemode: false,
  extensions: ["-builtin:codemode", "-builtin:tool-search", "-builtin:llama.cpp"],
  compaction: { enabled: true },
  quietStartup: true,
};

/** Write an object as the JSON file Pi reads. */
const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
};

/**
 * Create one seat's home under `matchDir`, and say what to run with it.
 *
 * `matchDir` may be relative to this process's working directory; every path
 * this returns, and `PI_CODING_AGENT_DIR` with it, is absolute.
 *
 * Writing the same `matchDir` again rewrites the two config files rather than
 * colliding, which is what a runner that restarts a match wants. It does not
 * empty the directories: a restarted match inherits whatever the previous run
 * left in `pi-home-<seat>/` and `cwd-<seat>/`, so a match that has to start
 * from nothing is given a fresh `matchDir`.
 */
export const createSeatHome = (options: SeatHomeOptions): SeatHome => {
  const { matchDir, seat, serverUrl, token } = options;

  // Resolved once, here, because the child runs with its working directory set
  // to `cwd-<seat>/`. Pi normalises `PI_CODING_AGENT_DIR` but never resolves it
  // against anything, so a relative one is looked for inside that empty
  // directory — and that is not a loud failure: `pi mcp list` answers
  // `{"servers": [], "errors": []}` and exits 0 when the config directory is
  // simply not there, so a seat would play a whole match with no game tools and
  // no signal that anything was wrong. The same goes for `--session-dir`, which
  // would then write the match's transcript under the seat's own cwd.
  const base = resolve(matchDir);

  const piHomeDir = join(base, `pi-home-${seat}`);
  const cwd = join(base, `cwd-${seat}`);
  const sessionDir = join(base, `session-${seat}`);
  for (const dir of [piHomeDir, cwd, sessionDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const mcpConfigPath = join(piHomeDir, "mcp.json");
  writeJson(mcpConfigPath, {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        url: serverUrl,
        // A placeholder, not the token: Pi substitutes it from the child's
        // environment when it connects.
        headers: { Authorization: `Bearer \${${TOKEN_VAR}}` },
        // `direct` is what makes every game action an ordinary tool call the
        // server and the log can count; Pi's default is `codemode`, where the
        // model writes a script that calls the tools.
        exposure: "direct",
        description: MCP_DESCRIPTION,
      },
    },
  });

  const settingsPath = join(piHomeDir, "settings.json");
  writeJson(settingsPath, SETTINGS);

  return {
    seat,
    piHomeDir,
    cwd,
    sessionDir,
    mcpConfigPath,
    settingsPath,
    env: {
      PI_CODING_AGENT_DIR: piHomeDir,
      [TOKEN_VAR]: token,
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      PI_CACHE_RETENTION: "long",
    },
  };
};
