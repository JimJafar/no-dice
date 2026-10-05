/**
 * Whether a seat's model has a credential, asked of Pi before a match is played.
 *
 * brief §6.3: "With a relocated config directory, logins stored in `~/.pi/agent`
 * are not available. Pass provider API keys as environment variables, or use
 * `--api-key`. `pi auth check --provider <name> --json` confirms a credential
 * resolves." A seat whose provider cannot answer does not fail loudly: every one
 * of its turns settles with a provider error, so the match plays, writes a log,
 * and reads as a model that passed 25 times rather than a run that never
 * started. So the credential is resolved before the first prompt is sent, and a
 * seat that has none stops the run with one line naming the provider.
 *
 * The check runs the pinned CLI, never the `pi` on `PATH`, with the environment
 * the seat's own process is about to get: `PI_CODING_AGENT_DIR` at the seat's
 * home, so a provider named in the seat's `models.json` is found there, and a key
 * the operator exported is found in the environment. That is what lets a test
 * point a seat at a stub provider on loopback and pass the check with no
 * credential in the world.
 */
import { execFile } from "node:child_process";

import { piCli } from "./pi-cli.ts";

/** How long Pi may take to answer about its own credentials. */
const AUTH_TIMEOUT_MS = 30_000;

/** What to ask, and in whose environment to ask it. */
export interface PiAuthOptions {
  /** The model the seat plays, as `--model` takes it: `<provider>/<id>`. */
  model: string;
  /**
   * The variables the seat's process will be given, merged over this process's
   * own. The seat's `models.json` is read from the `PI_CODING_AGENT_DIR` in here.
   */
  env?: Record<string, string>;
}

/** What Pi said about the credential. */
export interface PiAuth {
  /** Whether a credential resolves for the model's provider. */
  ok: boolean;
  /** The provider the check was made for. */
  provider: string;
  /** Pi's own reason, or the reason this module inferred. */
  reason: string | null;
  /** One line naming the problem, for the operator to act on. */
  message: string;
}

/**
 * The provider half of a model reference. Pi takes `<provider>/<id>`, and a
 * reference without the provider half is a mistake in the run rather than a
 * question Pi can answer.
 */
export const providerOfModel = (model: string): string => {
  const at = model.indexOf("/");
  if (at <= 0 || at === model.length - 1) {
    throw new Error(`a Pi seat's model is "<provider>/<id>", not "${model}"`);
  }
  return model.slice(0, at);
};

/** Pi's `auth check --json` answer, as far as this module reads it. */
interface PiAuthReport {
  status?: unknown;
  reason?: unknown;
}

/** The JSON Pi printed, or `null` when the run printed something else. */
const reportOf = (stdout: string): PiAuthReport | null => {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as PiAuthReport) : null;
  } catch {
    return null;
  }
};

/**
 * Ask the pinned Pi whether a credential resolves for `model`'s provider.
 *
 * The exit code is the answer Pi means a script to read — 0 when ready, 1 when
 * not — and the JSON says why. A run that printed neither, or never answered at
 * all, is reported as a failure rather than assumed ready: a match is expensive
 * and a wrong "ready" costs a whole match.
 */
export const checkPiAuth = async (options: PiAuthOptions): Promise<PiAuth> => {
  const provider = providerOfModel(options.model);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries({ ...process.env, ...(options.env ?? {}) })) {
    if (typeof value === "string") env[name] = value;
  }

  const ran = await new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>(
    (done) => {
      execFile(
        process.execPath,
        [piCli().path, "auth", "check", "--provider", provider, "--json"],
        { env, timeout: AUTH_TIMEOUT_MS },
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
    },
  );

  const report = reportOf(ran.stdout);
  if (ran.timedOut) {
    return {
      ok: false,
      provider,
      reason: "check_timed_out",
      message: `the credential check for provider "${provider}" took more than ${String(
        Math.round(AUTH_TIMEOUT_MS / 1000),
      )} seconds`,
    };
  }
  if (ran.code === 0 && report?.status === "ready") {
    return { ok: true, provider, reason: null, message: "" };
  }
  // Pi says `not_ready` and names the reason; a build that printed nothing else
  // leaves the exit code and whatever it wrote to stderr.
  const reason =
    typeof report?.reason === "string"
      ? report.reason
      : ran.stderr.trim() === ""
        ? `pi exited ${String(ran.code)} without a credential for it`
        : ran.stderr.trim();
  return {
    ok: false,
    provider,
    reason,
    message:
      `provider "${provider}" has no credential for model ${options.model}: ${reason}; ` +
      "give the seat the provider's key in its environment, or name the provider in its models.json",
  };
};
