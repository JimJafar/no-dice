/**
 * The scripted model a Pi seat plays against.
 *
 * Two different things are being tested here.
 *
 * The stub is a double at a real boundary — an OpenAI Chat Completions
 * endpoint — so it is tested against what that boundary actually requires: SSE
 * `chat.completion.chunk` lines a streaming client parses, a final
 * `data: [DONE]`, a tool-call delta a seat can turn into a tool call, usage a
 * harness can read cache reads out of, and an HTTP status an SDK treats as a
 * provider failure. A stub that only worked for one client would be useless to
 * the next task, and a stub that quietly answered something else would make
 * every later test mean nothing.
 *
 * The second thing is the seat: that a real Pi process, started the way the
 * runner starts one, reaches this stub with no credentials at all, and that the
 * request it sends names exactly the seven tools and the player system prompt.
 * That is an assertion about Pi and about the lock-down, and the only place it
 * can be made is from the body the stub recorded — which is the whole reason
 * the stub is a server rather than an in-process fake.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { networkInterfaces, tmpdir, type NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_CONFIG } from "@no-dice/salient-engine";
import { MatchServer, TOOL_NAMES, startServer, type RunningServer } from "@no-dice/salient-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { piCli } from "./pi-cli.ts";
import { createSeatHome, type SeatHome, type SeatId } from "./pi-home.ts";
import {
  StubModel,
  callsToolThenSubmits,
  callsToolOutsideTheSeven,
  neverSubmits,
  providerError,
  salientToolName,
  sleepsPastDeadline,
  stubModelsJson,
  type StubReply,
  type StubScript,
} from "./stub-model.ts";

/** The seven tools as a model is offered them. */
const SEVEN = TOOL_NAMES.map((name) => salientToolName(name));

/** A chat request small enough to read in the test, with the tools named plainly. */
const probeBody = (tools: string[], system = "You play Salient."): Record<string, unknown> => ({
  model: "stub-1",
  stream: true,
  messages: [
    { role: "system", content: system },
    { role: "user", content: "Turn 1 of 25. Play your turn." },
  ],
  tools: tools.map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } })),
});

/** What a raw completion request came back as, before any of it is interpreted. */
interface RawAnswer {
  status: number;
  contentType: string | null;
  text: string;
  /** Every `data:` payload that was JSON, in order; `[DONE]` is not one of them. */
  chunks: Record<string, unknown>[];
  /** Whether the stream ended with `data: [DONE]`. */
  done: boolean;
}

/** Ask the stub for a completion, and get the raw answer back. */
const chat = async (stub: StubModel, body: Record<string, unknown>): Promise<RawAnswer> => {
  const response = await fetch(`${stub.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const lines = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6));
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    text,
    chunks: lines.slice(0, -1).map((data) => JSON.parse(data) as Record<string, unknown>),
    done: lines.at(-1) === "[DONE]",
  };
};

/** The text a streamed completion answered with. */
const streamedText = (chunks: Record<string, unknown>[]): string =>
  chunks
    .flatMap((chunk) => (chunk.choices as { delta?: { content?: string } }[] | undefined) ?? [])
    .map((choice) => choice.delta?.content ?? "")
    .join("");

/** The `usage` of the chunk that carried one, if any. */
const usageOf = (chunks: Record<string, unknown>[]): Record<string, unknown> => {
  const withUsage = chunks.filter((chunk) => chunk.usage !== undefined);
  return (withUsage.at(-1)?.usage ?? {}) as Record<string, unknown>;
};

/** The `finish_reason` of the chunk that carried one, if any. */
const finishReasonOf = (chunks: Record<string, unknown>[]): string | undefined => {
  for (const chunk of chunks.slice().reverse()) {
    for (const choice of (chunk.choices as { finish_reason?: string }[] | undefined) ?? []) {
      if (choice.finish_reason !== undefined && choice.finish_reason !== null) return choice.finish_reason;
    }
  }
  return undefined;
};

/** Every non-loopback IPv4 this machine has, which is where the stub must not answer. */
const externalIpv4 = (): string[] =>
  Object.values(networkInterfaces())
    .flat()
    .filter((entry): entry is NetworkInterfaceInfo => entry !== undefined)
    .filter((entry) => entry.family === "IPv4" && !entry.address.startsWith("127."))
    .map((entry) => entry.address);

describe("the stub endpoint", () => {
  let stub: StubModel;

  beforeAll(async () => {
    stub = await StubModel.start([{ text: "Holding the ridge." }]);
  });

  afterAll(async () => {
    await stub.stop();
  });

  it("listens on loopback only, on a port it chose for itself", async () => {
    const bound = stub.address;
    expect(bound.address).toBe("127.0.0.1");
    expect(bound.port).toBeGreaterThan(0);
    expect(stub.baseUrl).toBe(`http://127.0.0.1:${bound.port}/v1`);

    // The same port on another interface has nothing on it: a seat's prompts
    // and tool results are not something a match leaves the machine through.
    // A container with no non-loopback interface has nothing outside to try, and
    // there the bound address above is what carries the guarantee.
    for (const address of externalIpv4()) {
      const elsewhere = await fetch(`http://${address}:${bound.port}/v1/chat/completions`, {
        method: "POST",
        body: "{}",
        signal: AbortSignal.timeout(3000),
      }).then(
        () => null,
        (error: unknown) => (error as Error).message,
      );
      expect(elsewhere, `the stub answered on ${address}`).not.toBeNull();
    }
  });

  it("answers a scripted reply as chat.completion.chunk lines ending in [DONE]", async () => {
    const answer = await chat(stub, probeBody([salientToolName("get_state")]));

    expect(answer.status).toBe(200);
    expect(answer.contentType).toContain("text/event-stream");
    expect(answer.done).toBe(true);
    expect(answer.chunks.length).toBeGreaterThan(1);
    for (const chunk of answer.chunks) {
      expect(chunk.object).toBe("chat.completion.chunk");
      // Every chunk of one completion carries the same id, as OpenAI documents.
      expect(chunk.id).toBe(answer.chunks[0].id);
      expect(chunk.model).toBe("stub-1");
    }
    expect(streamedText(answer.chunks)).toBe("Holding the ridge.");
    expect(finishReasonOf(answer.chunks)).toBe("stop");
  });

  it("streams a tool call as a delta and ends the turn with finish_reason tool_calls", async () => {
    // Long enough to be streamed in more than one slice, as a real endpoint
    // streams it.
    const args = { notes: `Turn 1. ${"Holding the ridge and watching F6. ".repeat(12)}` };
    const scripted = await StubModel.start([{ toolCalls: [{ name: salientToolName("write_notes"), args }] }]);
    const answer = await chat(scripted, probeBody([salientToolName("write_notes")]));
    await scripted.stop();

    const deltas = answer.chunks
      .flatMap((chunk) => (chunk.choices as { delta?: { tool_calls?: unknown[] } }[] | undefined) ?? [])
      .flatMap((choice) => choice.delta?.tool_calls ?? []) as {
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }[];

    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas[0]).toMatchObject({
      index: 0,
      type: "function",
      function: { name: salientToolName("write_notes") },
    });
    expect(typeof deltas[0].id).toBe("string");
    // Only the first slice names the tool; the rest carry arguments, so a seat
    // parses a tool call as it arrives rather than only when it lands whole.
    expect(deltas.slice(1).every((call) => call.function?.name === undefined)).toBe(true);
    expect(JSON.parse(deltas.map((call) => call.function?.arguments ?? "").join(""))).toEqual(args);
    expect(finishReasonOf(answer.chunks)).toBe("tool_calls");
  });

  it("reports usage with cached tokens, so a cache read is visible to the harness", async () => {
    const scripted = await StubModel.start([{ text: "one" }, { text: "two" }]);
    const first = usageOf((await chat(scripted, probeBody([]))).chunks);
    const second = usageOf((await chat(scripted, probeBody([]))).chunks);
    await scripted.stop();

    expect(first.prompt_tokens).toBeGreaterThan(0);
    expect(first.completion_tokens).toBeGreaterThan(0);
    expect((first.prompt_tokens_details as Record<string, unknown>).cached_tokens).toBe(0);

    // A conversation re-sent every turn is a cache hit from the second request
    // on, which is what brief §6.3's `PI_CACHE_RETENTION=long` is for.
    const cached = (second.prompt_tokens_details as { cached_tokens: number }).cached_tokens;
    expect(cached).toBeGreaterThan(0);
    // And the prompt is not all cache: some of it is new tokens, which is what
    // the harness reports as `usage.input`.
    expect((second.prompt_tokens as number) - cached).toBeGreaterThan(0);
  });

  it("records the tools and the system prompt of every request it answers", async () => {
    const scripted = await StubModel.start([{ text: "noted" }]);
    await chat(scripted, probeBody([salientToolName("get_rules"), salientToolName("get_state")]));
    await chat(scripted, probeBody([salientToolName("scout")], "A different prompt."));
    await scripted.stop();

    expect(scripted.requestCount).toBe(2);
    const [first, second] = scripted.recorded;
    expect(first.index).toBe(0);
    expect(first.toolNames).toEqual([salientToolName("get_rules"), salientToolName("get_state")]);
    expect(first.systemPrompts).toEqual(["You play Salient."]);
    expect(first.messages.map((message) => message.role)).toEqual(["system", "user"]);

    // The second request is kept whole as well: a later task asks whether an
    // early turn's tool result is still in a later request, and that is a
    // substring check over `body`.
    expect(second.index).toBe(1);
    expect(second.toolNames).toEqual([salientToolName("scout")]);
    expect(second.systemPrompts).toEqual(["A different prompt."]);
    expect(JSON.stringify(second.body)).toContain("Play your turn");
  });

  it("answers each request with its own script entry, and holds on the last", async () => {
    const scripted = await StubModel.start([{ text: "one" }, { text: "two" }]);
    const answers: string[] = [];
    for (let turn = 0; turn < 4; turn += 1) {
      answers.push(streamedText((await chat(scripted, probeBody([]))).chunks));
    }
    await scripted.stop();

    // Held, not cycled: a one-reply script then answers every request that
    // way, which is what "a seat that never submits" has to mean.
    expect(answers).toEqual(["one", "two", "two", "two"]);
  });

  it("lets a script decide the reply from the request it is answering", async () => {
    const scripted = await StubModel.start((request) => ({
      text: request.toolNames.includes(salientToolName("scout")) ? "scouting" : "holding",
    }));
    const scouted = streamedText((await chat(scripted, probeBody([salientToolName("scout")]))).chunks);
    const held = streamedText((await chat(scripted, probeBody([salientToolName("get_state")]))).chunks);
    await scripted.stop();

    // A 25-turn match cannot be a list: turn N's reply depends on what turn N
    // was offered and what came before it.
    expect([scouted, held]).toEqual(["scouting", "holding"]);
  });

  it("answers a scripted provider error the way an OpenAI client sees a provider fail", async () => {
    const failing = await StubModel.start(providerError("marvin is not listening"));
    const answer = await chat(failing, probeBody([]));
    await failing.stop();

    expect(answer.status).toBe(500);
    expect(answer.contentType).toContain("application/json");
    const body = JSON.parse(answer.text) as { error: { message: string; type: string } };
    expect(body.error.message).toBe("marvin is not listening");
    expect(body.error.type).toBe("server_error");
  });

  it("waits before answering, for a turn that runs past its deadline", async () => {
    const slow = await StubModel.start(sleepsPastDeadline(250));
    const started = Date.now();
    const answer = await chat(slow, probeBody([]));
    const elapsed = Date.now() - started;
    await slow.stop();

    expect(answer.status).toBe(200);
    expect(streamedText(answer.chunks)).toBeTruthy();
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it("answers a caller that asked for no stream with one JSON completion", async () => {
    const scripted = await StubModel.start([
      { text: "Holding.", toolCalls: [{ name: salientToolName("scout"), args: { hex: "F6" } }] },
    ]);
    const response = await fetch(`${scripted.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...probeBody(SEVEN), stream: false }),
    });
    const contentType = response.headers.get("content-type");
    const completion = (await response.json()) as Record<string, unknown>;
    await scripted.stop();

    // Pi always streams, but the stub is described as an OpenAI-compatible
    // endpoint, so a caller that asked not to stream gets what it asked for
    // rather than an event stream it would not parse.
    expect(response.status).toBe(200);
    expect(contentType).toContain("application/json");
    expect(completion.object).toBe("chat.completion");
    expect(completion.model).toBe("stub-1");
    const choice = (completion.choices as Record<string, unknown>[])[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message).toMatchObject({
      role: "assistant",
      content: "Holding.",
      tool_calls: [{ type: "function", function: { name: salientToolName("scout"), arguments: '{"hex":"F6"}' } }],
    });
    expect((completion.usage as Record<string, unknown>).prompt_tokens_details).toMatchObject({ cached_tokens: 0 });
  });

  it("answers a script that fails as a 500 naming the script, rather than going unanswered", async () => {
    // A script that throws, or tool-call arguments that cannot be serialised, is
    // a bug in the test. The seat has to fail at the script rather than hang
    // until its client times out.
    const broken = await StubModel.start(() => {
      throw new Error("the script was written wrong");
    });
    const answer = await chat(broken, probeBody([]));
    await broken.stop();

    expect(answer.status).toBe(500);
    expect(answer.text).toContain("the script was written wrong");
  });

  it("refuses a path it does not speak, rather than answering everything", async () => {
    // From the origin, not from `baseUrl`, which already ends in `/v1`: these
    // are the paths a client might send to a provider, named in full.
    const origin = `http://127.0.0.1:${stub.port}`;
    for (const [method, path] of [
      ["POST", "/v1/completions"],
      ["GET", "/v1/models"],
      ["GET", "/v1/chat/completions"],
    ] as const) {
      const response = await fetch(`${origin}${path}`, { method });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
  });

  it("refuses a request for a model it is not, rather than answering any model", async () => {
    const before = stub.requestCount;
    const answer = await chat(stub, { ...probeBody([]), model: "stub-one" });

    // A seat whose `--model` names the wrong id is a configuration mistake, and
    // a stub that answered it would play a turn no test scripted.
    expect(answer.status).toBe(400);
    expect(answer.text).toContain("stub-1");
    expect(answer.text).toContain("stub-one");
    // And a request that was refused consumed nothing from the script.
    expect(stub.requestCount).toBe(before);
  });

  it("lets a stopped stub exit rather than sitting out the rest of a delayed reply", async () => {
    // The milestone's deadline case scripts a reply that sleeps past the turn.
    // A harness aborts the seat long before that ends, and a stub that leaves
    // the wait running keeps the test process alive for the whole deadline. So
    // this is proved in a child that would otherwise not exit by itself.
    const modulePath = pathToFileURL(join(import.meta.dirname, "stub-model.ts")).href;
    const childScript = [
      `const { StubModel, sleepsPastDeadline } = await import(${JSON.stringify(modulePath)});`,
      "const stub = await StubModel.start(sleepsPastDeadline(300_000));",
      // A seat's request, still waiting for its answer when the harness gives up.
      "fetch(stub.baseUrl + '/chat/completions', {",
      "  method: 'POST',",
      "  body: JSON.stringify({ stream: true, messages: [] }),",
      "}).catch(() => {});",
      "await new Promise((resolve) => setTimeout(resolve, 200));",
      "await stub.stop();",
    ].join("\n");

    let stderr = "";
    const started = Date.now();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", childScript], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      // Only a stub that cancelled nothing leaves the child running, in which
      // case this is what ends the run, five minutes short of where it should.
      const killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.on("close", (status) => {
        clearTimeout(killer);
        resolve(status);
      });
    });

    expect(code, `the child did not exit on its own: ${stderr}`).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("the seat's models.json entry", () => {
  it("points a provider at the stub with the model written out in full", async () => {
    const stub = await StubModel.start(neverSubmits());
    const config = stubModelsJson(stub.baseUrl);
    const port = stub.port;
    await stub.stop();

    expect(config).toEqual({
      providers: {
        stub: {
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: "openai-completions",
          apiKey: "stub",
          models: [
            {
              id: "stub-1",
              name: "Stub",
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 2048,
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    });
  });

  it("writes that file into the seat's Pi home, where Pi reads it", async () => {
    const stub = await StubModel.start(neverSubmits());
    const home = mkdtempSync(join(tmpdir(), "no-dice-stub-home-"));
    try {
      const path = stub.writeModelsJson(home);
      expect(path).toBe(join(home, "models.json"));
      expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(stubModelsJson(stub.baseUrl));
    } finally {
      rmSync(home, { recursive: true, force: true });
      await stub.stop();
    }
  });

  it("lets a test give the stub the small window that forces compaction", async () => {
    const stub = await StubModel.start(neverSubmits(), { contextWindow: 4000, maxTokens: 256 });
    const entry = stub.providerEntry() as { models: Record<string, unknown>[] };
    await stub.stop();

    expect(entry.models[0].contextWindow).toBe(4000);
    expect(entry.models[0].maxTokens).toBe(256);
  });
});

describe("a Pi seat played by the stub", () => {
  /**
   * How long a seat gets: Pi takes a second or two to start and to connect
   * MCP, and the stub answers as soon as it is asked.
   */
  const SEAT_TIMEOUT_MS = 120_000;

  /** The player prompt a seat is given, which is what the request has to carry. */
  const playerSystem = readFileSync(
    join(import.meta.dirname, "../../../games/salient/prompts/player-system.md"),
    "utf-8",
  );

  let matches: MatchServer;
  let running: RunningServer;
  let matchId: string;
  let tokens: { A: string; B: string };
  const matchDirs: string[] = [];
  const stubs: StubModel[] = [];

  /** A stub, remembered so it is stopped when these tests are done. */
  const startStub = async (script: StubScript): Promise<StubModel> => {
    const stub = await StubModel.start(script);
    stubs.push(stub);
    return stub;
  };

  /** A seat's own home, at this match, whose Pi home points at `stub`. */
  const seatHome = (seat: SeatId, stub: StubModel): SeatHome => {
    const matchDir = mkdtempSync(join(tmpdir(), "no-dice-stub-seat-"));
    matchDirs.push(matchDir);
    const home = createSeatHome({ matchDir, seat, serverUrl: running.url, token: tokens[seat] });
    stub.writeModelsJson(home.piHomeDir);
    return home;
  };

  /** Run one seat the way the runner will: the pinned CLI, the seat's home, nothing else. */
  const runSeat = (
    stub: StubModel,
    home: SeatHome,
    prompt: string,
  ): Promise<{ status: number | null; stdout: string; stderr: string }> =>
    new Promise((settled, failed) => {
      // The child's environment is an allowlist rather than `process.env` with
      // the known key names taken out: a machine can hold a provider credential
      // under a name nobody thought to list, and the point of these tests is
      // that a seat needs none of them. The stub is the only thing a seat here
      // can reach, so nothing in this milestone can be passing because it found
      // a real key on this machine.
      const env: NodeJS.ProcessEnv = { PI_OFFLINE: "1" };
      for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "TZ"]) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      Object.assign(env, home.env);

      const child = spawn(
        process.execPath,
        [
          piCli().path,
          "--print",
          "--model",
          stub.modelRef,
          "--thinking",
          "off",
          "--no-builtin-tools",
          "--no-context-files",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--session-dir",
          home.sessionDir,
          "--system-prompt",
          playerSystem,
          "--",
          prompt,
        ],
        { cwd: home.cwd, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", failed);
      child.on("close", (status) => settled({ status, stdout, stderr }));
    });

  /** Resolve the turn in play and open the next one, as the runner does between turns. */
  const nextTurn = (): void => {
    matches.resolveTurn(matchId);
    matches.openTurn(matchId);
  };

  beforeAll(async () => {
    matches = new MatchServer();
    running = await startServer({ matches, port: 0 });
    const created = matches.createMatch(135, DEFAULT_CONFIG);
    matchId = created.matchId;
    tokens = created.tokens;
    matches.openTurn(matchId);
  });

  afterAll(async () => {
    await running.close();
    for (const stub of stubs.splice(0)) await stub.stop();
    for (const dir of matchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it(
    "calls a Salient tool over its own MCP connection, and the match server records it for that seat",
    async () => {
      const stub = await startStub(callsToolThenSubmits("get_state"));
      const run = await runSeat(stub, seatHome("A", stub), "Turn 1 of 25. Play your turn.");
      expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);

      // The seat's calls as the server saw them: the tool the stub was scripted
      // to call, then the submission, in that order, under seat A.
      const recorded = matches.turnRecord(matchId, 1).A.tool_calls;
      expect(recorded.map((call) => call.tool)).toEqual(["get_state", "submit_orders"]);
      expect(recorded.every((call) => !call.error)).toBe(true);
      expect(recorded[0].args).toEqual({});
      expect(recorded[1].args).toEqual({ orders: [], intent: expect.any(String), prediction: expect.any(String) });
      expect(matches.status(matchId).submitted).toEqual({ A: true, B: false });
      // The seat's own token is what made them seat A's: seat B did nothing.
      expect(matches.turnRecord(matchId, 1).B.tool_calls).toEqual([]);
      // And the stub, not a provider, is what answered: one reply per request.
      expect(stub.requestCount).toBeGreaterThanOrEqual(3);
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "is offered exactly the seven Salient tools, and the player prompt as its only system prompt",
    async () => {
      nextTurn();
      const stub = await startStub(callsToolThenSubmits("scout", { hex: "F6" }));
      const run = await runSeat(stub, seatHome("B", stub), "Turn 2 of 25. Play your turn.");
      expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
      expect(stub.requestCount).toBeGreaterThan(0);

      // What the model was actually offered, read off the body Pi sent rather
      // than off what the seat home was configured with.
      for (const request of stub.recorded) {
        // The seat asked this stub for the id its own `models.json` names.
        expect(request.body.model).toBe("stub-1");
        expect(request.toolNames.slice().sort()).toEqual(SEVEN.slice().sort());
        expect(request.systemPrompts).toHaveLength(1);
        expect(request.systemPrompts[0]).toContain("You act only through the salient tools.");
        expect(request.systemPrompts[0]).toContain("You have 12 tool calls a turn");
      }
      expect(matches.turnRecord(matchId, 2).B.tool_calls.map((call) => call.tool)).toEqual([
        "scout",
        "submit_orders",
      ]);
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "plays a turn with no provider credential anywhere in its environment",
    async () => {
      // The dummy `apiKey` in the seat's own `models.json` is the whole of the
      // provider story, with every key the machine happens to hold removed from
      // the child's environment.
      nextTurn();
      const stub = await startStub(callsToolThenSubmits("get_rules"));
      const run = await runSeat(stub, seatHome("A", stub), "Turn 3 of 25. Play your turn.");
      expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
      expect(matches.turnRecord(matchId, 3).A.tool_calls.map((call) => call.tool)).toEqual([
        "get_rules",
        "submit_orders",
      ]);
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "plays a scripted provider error as a turn with nothing submitted in it",
    async () => {
      nextTurn();
      const stub = await startStub(providerError("the stub is refusing this seat"));
      const run = await runSeat(stub, seatHome("B", stub), "Turn 4 of 25. Play your turn.");

      // Pi retries a 5xx and then gives up on the turn. Either way the seat made
      // no call, submitted nothing, and the failure is visible rather than
      // silent — which is what `provider_error` in brief §6.3's table needs.
      expect(stub.requestCount).toBeGreaterThan(1);
      expect(matches.turnRecord(matchId, 4).B.tool_calls).toEqual([]);
      expect(matches.status(matchId).submitted).toEqual({ A: false, B: false });
      expect(`${run.stdout}\n${run.stderr}`).toContain("the stub is refusing this seat");
    },
    SEAT_TIMEOUT_MS,
  );

  it(
    "settles without submitting when the script never submits",
    async () => {
      nextTurn();
      const stub = await startStub(neverSubmits("I am holding this turn."));
      const run = await runSeat(stub, seatHome("A", stub), "Turn 5 of 25. Play your turn.");

      expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
      expect(matches.turnRecord(matchId, 5).A.tool_calls).toEqual([]);
      expect(matches.status(matchId).submitted.A).toBe(false);
      expect(run.stdout).toContain("I am holding this turn.");
    },
    SEAT_TIMEOUT_MS,
  );
});


describe("the script builders the milestone's cases need", () => {
  const toolsOf = (replies: StubReply[]): (string | undefined)[] =>
    replies.flatMap((reply) => (reply.toolCalls ?? []).map((call) => call.name));

  it("calls a named tool and then submits, in that order", () => {
    const script = callsToolThenSubmits("scout", { hex: "F6" });

    expect(toolsOf(script)).toEqual([salientToolName("scout"), salientToolName("submit_orders")]);
    expect(script[0].toolCalls?.[0].args).toEqual({ hex: "F6" });
    // The reply that ends the turn calls nothing, so the seat settles instead of
    // calling another tool forever.
    expect(script.at(-1)?.toolCalls).toBeUndefined();
    expect(script.at(-1)?.text).toBeTruthy();
  });

  it("never submits, and says so", () => {
    const script = neverSubmits();

    expect(script).toHaveLength(1);
    expect(script[0].toolCalls).toBeUndefined();
    expect(script[0].text).toBeTruthy();
  });

  it("calls a tool outside the seven", () => {
    const called = toolsOf(callsToolOutsideTheSeven());

    expect(called).toHaveLength(1);
    expect(SEVEN).not.toContain(called[0]);
    expect(called[0]).toMatch(/^mcp__salient__/);
  });

  it("sleeps past a deadline instead of answering", () => {
    const script = sleepsPastDeadline(300_000);

    expect(script[0].delayMs).toBe(300_000);
    expect(script[0].toolCalls).toBeUndefined();
  });

  it("fails with a provider error", () => {
    const script = providerError("upstream gone");

    expect(script[0].status).toBe(500);
    expect(script[0].error).toBe("upstream gone");
  });
});
