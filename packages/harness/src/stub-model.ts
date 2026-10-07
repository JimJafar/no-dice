/**
 * A scripted model a Pi seat can play a match against, with no API key.
 *
 * brief §6.3 locks a seat down to one model and seven tools, and every rule in
 * it — the pass/void table, the turn timeout, compaction, the tool surface —
 * has to be proven in the gate. None of that can be proven against a real
 * model: the gate has no credentials, a real model does not reliably call a
 * tool that one particular test needs, and a 25-turn match costs money and
 * minutes either way. So the milestone plays a stub. It is an ordinary HTTP
 * server on loopback that answers `POST /v1/chat/completions` the way an
 * OpenAI-compatible endpoint does — SSE `chat.completion.chunk` lines, a final
 * `data: [DONE]` — and a `models.json` entry that points a seat's Pi home at
 * it. Checked against Pi 1.0.2 on this machine: with that file in
 * `PI_CODING_AGENT_DIR` and `PI_OFFLINE=1`, `pi --model stub/stub-1 --print`
 * answers from here, and the same file shape is how a seat reaches Jim's real
 * provider in task `pi-measure-match`.
 *
 * The stub is a recorder as well as an actor. Every request body it answers is
 * kept, so a test can assert what the model was actually *offered* — the tool
 * names in `tools`, the system prompt — which is the only way to show the
 * lock-down held, and what it was shown *later* — whether turn 1's `get_rules`
 * result is still in turn 25's request, which is the compaction question of
 * brief §6.3's checklist. Those are assertions about Pi's behaviour, not about
 * the stub's, and they are the reason this is a server rather than a fake
 * `Model` object inside the process.
 *
 * A script is a list of replies, one per request, held on the last one: a
 * one-reply script answers every request that way, which is what "a stub that
 * never submits" means. A function script is offered for the cases a list
 * cannot express, such as a 25-turn match whose turn N calls turn N's tool.
 */
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

/** The address the stub listens on: loopback, and nothing else. */
const STUB_HOST = "127.0.0.1";

/** The provider name in the seat's `models.json`, so the seat is run as `--model stub/stub-1`. */
export const STUB_PROVIDER = "stub";

/** The model id the stub answers for. */
export const STUB_MODEL_ID = "stub-1";

/** The path a seat's `models.json` is written to inside its Pi home. */
export const MODELS_FILE = "models.json";

/** A tool call one scripted reply makes. */
export interface StubToolCall {
  /**
   * The tool as the model names it, prefix included: `mcp__salient__get_state`
   * for a game tool, or anything else for the case where it invents one.
   */
  name: string;
  /** The arguments to send, as a value; it is JSON-encoded into the delta. */
  args?: unknown;
  /** The call id; generated per reply when omitted. */
  id?: string;
}

/** The tokens one scripted reply reports, in the harness's own terms. */
export interface StubUsage {
  /** Prompt tokens that were not read from the provider's cache. */
  input?: number;
  output?: number;
  /** Prompt tokens the provider read from its cache: `prompt_tokens_details.cached_tokens`. */
  cacheRead?: number;
  cacheWrite?: number;
}

/** What the stub answers one request with. */
export interface StubReply {
  /** Text to stream as the assistant's answer. */
  text?: string;
  /** Tool calls to stream, in order. A reply with one of these ends `tool_calls`. */
  toolCalls?: StubToolCall[];
  /** Tokens to report; see the default described on `StubModel.start`. */
  usage?: StubUsage;
  /**
   * Wait this long before answering at all. This is how a turn that runs past
   * its deadline is produced: the stub is doing nothing visible, and the
   * harness has to notice and abort.
   */
  delayMs?: number;
  /** HTTP status, 200 unless said otherwise. Anything 400 or above is answered with an OpenAI error body. */
  status?: number;
  /** The message of that error body, for a reply that fails like a provider does. */
  error?: string;
}

/** One request the stub answered, kept so a test can read what the model was shown. */
export interface StubRequest {
  /** Which request this is, counting from 0. */
  index: number;
  /** The whole JSON body, exactly as Pi sent it. */
  body: Record<string, unknown>;
  /** The `messages` array as sent, oldest first. */
  messages: Record<string, unknown>[];
  /** The name of every entry in `tools`, in the order the model was offered them. */
  toolNames: string[];
  /** The content of every `system`-role message, in order. */
  systemPrompts: string[];
}

/**
 * The replies, chosen per request: a list indexed by request, held on its last
 * entry, or a function that decides from the request itself.
 */
export type StubScript = StubReply[] | ((request: StubRequest) => StubReply);

/** How the stub's model is described to Pi. */
export interface StubModelOptions {
  /** The model id in `models.json` and in `--model`; defaults to `stub-1`. */
  modelId?: string;
  /**
   * The window Pi compacts against. Small on purpose is how a test forces
   * compaction in a long match.
   */
  contextWindow?: number;
  /** The reply cap Pi asks the endpoint for. */
  maxTokens?: number;
  /** Whether Pi may send thinking levels for this model. */
  reasoning?: boolean;
  /**
   * The rates the seat's `models.json` gives, in US dollars per million tokens,
   * which is what turns the stub's reported usage into a cost a harness can
   * read back. All zero by default — running a stub costs nothing — but a test
   * that checks the harness reports a cost has to be told what one is.
   */
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/** Read a whole request body. */
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

/** Answer with one JSON body, as an OpenAI-compatible endpoint would. */
const replyJson = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
};

/** The name a Salient tool has in a model request: the MCP server's name, then the tool's. */
export const salientToolName = (tool: string): string => `mcp__salient__${tool}`;

/**
 * The provider entry of a seat's `models.json`, pointing at `baseUrl`.
 *
 * This is the shape task `pi-measure-match` will use for Jim's Marvin server
 * too, so it is written out in full rather than filled in with defaults: an
 * `api` of `openai-completions`, a dummy `apiKey` (the documented pattern for
 * an endpoint that does not check one), and the model's metadata spelled out
 * because Pi does not discover it from a compatible endpoint.
 */
export const stubProviderEntry = (baseUrl: string, options: StubModelOptions = {}): unknown => ({
  baseUrl,
  api: "openai-completions",
  apiKey: "stub",
  models: [
    {
      id: options.modelId ?? STUB_MODEL_ID,
      name: "Stub",
      input: ["text"],
      contextWindow: options.contextWindow ?? 200_000,
      maxTokens: options.maxTokens ?? 2048,
      reasoning: options.reasoning ?? false,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...options.cost },
    },
  ],
});

/** The whole `models.json` a seat reads to reach the stub. */
export const stubModelsJson = (baseUrl: string, options: StubModelOptions = {}): unknown => ({
  providers: { [STUB_PROVIDER]: stubProviderEntry(baseUrl, options) },
});

/**
 * A running stub: the endpoint, the script it answers from, and the requests it
 * has answered so far.
 */
export class StubModel {
  /** The model id this stub answers for, and the one `--model` names. */
  readonly modelId: string;
  private readonly server: Server;
  private readonly options: StubModelOptions;
  private readonly requests: StubRequest[] = [];
  private script: StubScript;
  /** How far into the current script this stub has got; restarts with the script. */
  private scriptPosition = 0;
  private callSeq = 0;
  private stopped = false;
  /** Requests taken whose scripted reply has not been written yet. */
  private inFlight = 0;
  /** The waits a delayed reply is sitting in, so `stop` can cancel them. */
  private readonly waits = new Set<() => void>();

  // Assigned in the body rather than as constructor parameters: the `no-dice`
  // bin runs this file through Node's type stripping, which erases annotations
  // but does not support parameter properties.
  private constructor(server: Server, modelId: string, script: StubScript, options: StubModelOptions) {
    this.server = server;
    this.modelId = modelId;
    this.script = script;
    this.options = options;
  }

  /**
   * Start a stub on a free loopback port.
   *
   * A reply that does not say what it cost reports a growing conversation:
   * 1000 prompt tokens plus 100 for every request before it, 100 output
   * tokens, and — from the second request on — all of the previous request's
   * prompt tokens reported as cache reads, which is what a provider with
   * prompt caching does to a conversation that is re-sent every turn. A test
   * that cares about a particular figure sets `usage` on the reply.
   */
  static async start(script: StubScript, options: StubModelOptions = {}): Promise<StubModel> {
    if (Array.isArray(script) && script.length === 0) {
      throw new Error("a stub script needs at least one reply");
    }
    const server = createServer();
    const stub = new StubModel(server, options.modelId ?? STUB_MODEL_ID, script, options);
    server.on("request", (req, res) => {
      void stub.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, STUB_HOST, () => resolve());
    });
    return stub;
  }

  /** The loopback address and port it is actually listening on. */
  get address(): { address: string; port: number } {
    const bound = this.server.address() as AddressInfo | null;
    if (bound === null) throw new Error("the stub is not listening");
    return { address: bound.address, port: bound.port };
  }

  /** The port the stub chose. */
  get port(): number {
    return this.address.port;
  }

  /** What a `models.json` `baseUrl` has to say to reach this stub. */
  get baseUrl(): string {
    return `http://${STUB_HOST}:${this.port}/v1`;
  }

  /** What `--model` names this stub, e.g. `stub/stub-1`. */
  get modelRef(): string {
    return `${STUB_PROVIDER}/${this.modelId}`;
  }

  /** Every request it has answered, oldest first. */
  get recorded(): readonly StubRequest[] {
    return this.requests;
  }

  /** How many requests it has answered. */
  get requestCount(): number {
    return this.requests.length;
  }

  /**
   * How many requests it has taken but not answered yet.
   *
   * A delayed reply counts here for the whole of its delay, whether or not the
   * client is still listening: the question this answers is whether the model
   * had answered, not whether anyone was left to hear it. A harness that aborts
   * a seat mid-turn uses it to say the turn ended while the model was still
   * thinking, which is the one thing a wall clock cannot prove on a busy box.
   */
  get repliesInFlight(): number {
    return this.inFlight;
  }

  /** The last request it answered, or `null` before the first. */
  get lastRequest(): StubRequest | null {
    return this.requests[this.requests.length - 1] ?? null;
  }

  /**
   * Change what the next requests are answered with, from the start of the new
   * script.
   *
   * A runner that scripts one turn at a time sets the script before each turn,
   * so "this turn calls `scout` and submits" means the first reply of the list,
   * whatever the turns before it consumed.
   */
  setScript(script: StubScript): void {
    if (Array.isArray(script) && script.length === 0) {
      throw new Error("a stub script needs at least one reply");
    }
    this.script = script;
    this.scriptPosition = 0;
  }

  /** The `models.json` entry for this stub. */
  providerEntry(): unknown {
    return stubProviderEntry(this.baseUrl, this.options);
  }

  /**
   * Write the seat's `models.json` into its Pi home, and return the path.
   *
   * `createSeatHome` deliberately does not write this: which model a seat plays
   * is the runner's business, and a stub provider only exists once a stub is
   * listening. Writing it here keeps the entry that has to match the endpoint
   * next to the endpoint.
   */
  writeModelsJson(piHomeDir: string): string {
    const path = join(piHomeDir, MODELS_FILE);
    writeFileSync(path, `${JSON.stringify(stubModelsJson(this.baseUrl, this.options), null, 2)}\n`, "utf-8");
    return path;
  }

  /**
   * Stop listening, drop the keep-alive sockets an SDK client holds open, and
   * cancel the wait a delayed reply is sitting in — a seat aborted mid-turn
   * must not keep the test process alive for the rest of its deadline.
   */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.stopped = true;
    for (const cancel of this.waits) cancel();
    this.waits.clear();
    return new Promise((resolve) => {
      this.server.closeAllConnections();
      this.server.close(() => resolve());
    });
  }

  /** Sleep, cancellable by `stop`, so an aborted seat leaves nothing running. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waits.delete(cancel);
        resolve();
      }, ms);
      const cancel = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waits.add(cancel);
    });
  }

  /** The reply for one request: the script's next entry, held on the last. */
  private replyFor(request: StubRequest): StubReply {
    if (typeof this.script === "function") return this.script(request);
    // Held on the last entry rather than cycling: a one-reply script is then
    // "every request is answered this way", which is what a seat that never
    // submits, or one that always fails, has to mean.
    const reply = this.script[Math.min(this.scriptPosition, this.script.length - 1)];
    this.scriptPosition += 1;
    return reply;
  }

  /** The tokens a reply reports when it does not say. */
  private defaultUsage(index: number): Required<StubUsage> {
    const prompt = 1000 + 100 * index;
    return {
      input: index === 0 ? prompt : 100,
      output: 100,
      cacheRead: index === 0 ? 0 : 1000 + 100 * (index - 1),
      cacheWrite: 0,
    };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", `http://${STUB_HOST}`).pathname;
    if (req.method !== "POST" || path !== "/v1/chat/completions") {
      replyJson(res, 404, {
        error: { message: `the stub has no route ${req.method} ${path}`, type: "invalid_request_error" },
      });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      replyJson(res, 400, {
        error: { message: "the stub could not read the request body", type: "invalid_request_error" },
      });
      return;
    }

    // A seat pointed at a model the stub is not is a configuration mistake, and
    // the stub is the only thing in the way that can notice. Answering it would
    // let a seat play a turn nobody scripted.
    if (typeof body.model === "string" && body.model !== this.modelId) {
      replyJson(res, 400, {
        error: {
          message: `the stub is model ${this.modelId}; it was asked for ${body.model}`,
          type: "invalid_request_error",
          code: "model_not_found",
        },
      });
      return;
    }

    const messages = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]) : [];
    const tools = Array.isArray(body.tools) ? (body.tools as Record<string, unknown>[]) : [];
    const request: StubRequest = {
      index: this.requests.length,
      body,
      messages,
      toolNames: tools.map((tool) => {
        const fn = tool.function as Record<string, unknown> | undefined;
        return typeof fn?.name === "string" ? fn.name : String(tool.name ?? "");
      }),
      systemPrompts: messages
        .filter((message) => message.role === "system")
        .map((message) => (typeof message.content === "string" ? message.content : "")),
    };
    this.requests.push(request);
    this.inFlight += 1;

    // A script that throws, or tool-call arguments that cannot be serialised, is
    // a bug in the test rather than in the seat. Answering with the message makes
    // the seat fail at the script, instead of leaving the request unanswered
    // until the client times out and an unhandled rejection lands somewhere else.
    try {
      await this.answer(request, body, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
      } else {
        replyJson(res, 500, {
          error: {
            message: `the stub's script failed: ${message}`,
            type: "server_error",
            code: "script_error",
          },
        });
      }
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * Answer one recorded request from the script: one JSON completion when the
   * caller asked not to stream, and the streamed form otherwise, which is what
   * Pi asks for and what every scripted reply in this milestone travels in.
   */
  private async answer(
    request: StubRequest,
    body: Record<string, unknown>,
    res: ServerResponse,
  ): Promise<void> {
    const reply = this.replyFor(request);
    if (reply.delayMs !== undefined && reply.delayMs > 0) {
      await this.sleep(reply.delayMs);
    }
    // A harness that aborted its seat stopped caring about this answer.
    if (res.writableEnded || res.destroyed) return;

    const status = reply.status ?? 200;
    if (status >= 400) {
      replyJson(res, status, {
        error: {
          message: reply.error ?? "stub model failure",
          type: "server_error",
          code: "stub_error",
        },
      });
      return;
    }

    const usage = { ...this.defaultUsage(request.index), ...reply.usage };
    const id = `chatcmpl-stub-${request.index + 1}`;
    const created = Math.floor(Date.now() / 1000);
    // The calls are put in their wire form once, before anything is answered, so
    // arguments that cannot be serialised fail as a status rather than as a
    // half-written stream.
    const calls = (reply.toolCalls ?? []).map((call, position) => ({
      index: position,
      id: call.id ?? `stub-call-${request.index + 1}-${(this.callSeq += 1)}`,
      name: call.name,
      arguments: JSON.stringify(call.args ?? {}),
    }));
    const finishReason = calls.length > 0 ? "tool_calls" : "stop";
    const usagePayload = {
      prompt_tokens: usage.input + usage.cacheRead + usage.cacheWrite,
      completion_tokens: usage.output,
      total_tokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
      prompt_tokens_details: {
        cached_tokens: usage.cacheRead,
        ...(usage.cacheWrite > 0 ? { cache_write_tokens: usage.cacheWrite } : {}),
      },
      completion_tokens_details: {},
    };

    // Pi always asks for a stream. A caller that does not is answered with the
    // one JSON completion it asked for, rather than an event stream it would
    // not parse.
    if (body.stream === false) {
      replyJson(res, 200, {
        id,
        object: "chat.completion",
        created,
        model: this.modelId,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: reply.text ?? null,
              ...(calls.length > 0
                ? {
                    tool_calls: calls.map((call) => ({
                      id: call.id,
                      type: "function",
                      function: { name: call.name, arguments: call.arguments },
                    })),
                  }
                : {}),
            },
            logprobs: null,
            finish_reason: finishReason,
          },
        ],
        usage: usagePayload,
      });
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const chunk = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      const chunkBody = JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: this.modelId,
        ...payload,
      });
      res.write(`data: ${chunkBody}\n\n`);
    };

    chunk({
      choices: [{ index: 0, delta: { role: "assistant", content: "" }, logprobs: null, finish_reason: null }],
    });
    if (reply.text !== undefined && reply.text.length > 0) {
      chunk({ choices: [{ index: 0, delta: { content: reply.text }, logprobs: null, finish_reason: null }] });
    }
    // Arguments arrive in slices, as a real endpoint streams them, so the seat
    // is exercised against a tool call that is parsed as it arrives rather than
    // one that lands whole in a single delta.
    const ARGUMENT_SLICE = 64;
    for (const call of calls) {
      const first = call.arguments.slice(0, ARGUMENT_SLICE);
      chunk({
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: call.index,
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: first },
                },
              ],
            },
            logprobs: null,
            finish_reason: null,
          },
        ],
      });
      for (let offset = ARGUMENT_SLICE; offset < call.arguments.length; offset += ARGUMENT_SLICE) {
        chunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: call.index,
                    type: "function",
                    function: { arguments: call.arguments.slice(offset, offset + ARGUMENT_SLICE) },
                  },
                ],
              },
              logprobs: null,
              finish_reason: null,
            },
          ],
        });
      }
    }
    chunk({ choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: finishReason }] });
    chunk({ choices: [], usage: usagePayload });
    res.write("data: [DONE]\n\n");
    res.end();
  }
}

/**
 * Start a stub that calls `tool` and then submits.
 *
 * The submission carries no orders, which the server accepts: what the test
 * needs is a seat whose turn is played and recorded, not a particular move.
 * The reply that follows the submission is plain text, so the seat settles
 * instead of calling another tool, and stays settled on every later request.
 */
export const callsToolThenSubmits = (tool: string, args: unknown = {}): StubReply[] => [
  { toolCalls: [{ name: salientToolName(tool), args }] },
  {
    toolCalls: [
      {
        name: salientToolName("submit_orders"),
        args: { orders: [], intent: "The stub is holding still.", prediction: "The other seat moves east." },
      },
    ],
  },
  { text: "I have submitted. I will hold this line." },
];

/** A seat that talks and never submits, so every turn is a pass. */
export const neverSubmits = (text = "I am not moving this turn."): StubReply[] => [{ text }];

/**
 * A seat whose conversation outgrows the model's window inside one turn.
 *
 * Pi compacts when the conversation passes `contextWindow - reserveTokens`, and
 * the reserve defaults to 16384 tokens, so compaction cannot be forced by a
 * small window alone: the cut point has to fall somewhere, which needs a reply
 * with real bulk in it. Play this against a `contextWindow` of 40000 and the
 * session crosses the line on the first turn.
 *
 * The summarisation call compaction makes is answered by the same script, which
 * is why a test that plays past compaction re-arms it: the summary eats one of
 * its entries.
 */
export const outgrowsTheWindow = (
  text = "the map is a hex grid and the map is the territory ".repeat(3_000),
  usage: StubUsage = { input: 30_000, output: 2_000, cacheRead: 0, cacheWrite: 0 },
): StubReply[] => [
  { toolCalls: [{ name: salientToolName("get_state"), args: {} }], usage },
  {
    toolCalls: [
      {
        name: salientToolName("submit_orders"),
        args: { orders: [], intent: "The stub is holding still.", prediction: "The other seat moves east." },
      },
    ],
    usage,
  },
  { text, usage },
  { text: "I have submitted. I will hold this line." },
];

/**
 * A seat that is busy for longer than its turn allows.
 *
 * The script is held on its last entry, so every turn overruns the same way,
 * which is what "still prompted next turn, still timing out next turn" needs.
 */
export const sleepsPastDeadline = (ms: number, text = "Still working on it."): StubReply[] => [
  { delayMs: ms, text },
];

/**
 * A seat whose provider fails.
 *
 * A 5xx is what a provider error looks like to Pi, and Pi retries it — each
 * retry is another recorded request — before the turn is given up on.
 */
export const providerError = (message = "the stub provider is down", status = 500): StubReply[] => [
  { status, error: message },
];
