/**
 * The page's two fetch calls, and what they do with an answer.
 *
 * The stub is only a `fetch` that hands back a real `Response`: the parsing, the
 * status test and the message the page ends up showing are the module's own
 * code over the platform's own response object.
 */
import { describe, expect, it } from "vitest";

import { getJson, postJson } from "./api.ts";

/** What a stubbed `fetch` was asked for, and the answer it gave. */
interface Call {
  path: string;
  init?: RequestInit;
}

/** A `fetch` that answers `body` with `status`, and records what it was asked. */
const answering = (status: number, body: string, calls: Call[]) => {
  return async (path: string, init?: RequestInit): Promise<Response> => {
    calls.push({ path, init });
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
};

describe("getJson", () => {
  it("reads the JSON a 200 carries", async () => {
    const calls: Call[] = [];
    const state = await getJson<{ bots: string[] }>(
      "/api/state",
      answering(200, JSON.stringify({ bots: ["bot:random", "bot:greedy"] }), calls),
    );

    expect(state.bots).toEqual(["bot:random", "bot:greedy"]);
    expect(calls).toEqual([{ path: "/api/state", init: undefined }]);
  });

  it("fails with the console's own line when it refuses, so the terminal's wording reaches the page", async () => {
    const line = '--max-pairs takes a whole number of 1 or more, not "75.5"';
    const calls: Call[] = [];

    await expect(getJson("/api/run/series", answering(400, JSON.stringify({ error: line }), calls))).rejects.toThrow(
      line,
    );
  });

  it("fails with the status when the refusal is not one it can read", async () => {
    const calls: Call[] = [];
    await expect(getJson("/api/state", answering(500, "<!doctype html>oops", calls))).rejects.toThrow(
      "the console answered 500",
    );
  });

  it("says when an answer that should be JSON is not", async () => {
    const calls: Call[] = [];
    await expect(getJson("/api/state", answering(200, "not json at all", calls))).rejects.toThrow(
      "the answer at /api/state is not JSON",
    );
  });
});

describe("postJson", () => {
  it("sends the body as JSON and reads the answer", async () => {
    const calls: Call[] = [];
    const started = await postJson<{ ok: boolean }>(
      "/api/run/match",
      { game: "salient", a: "bot:greedy", b: "bot:random", seed: 135 },
      answering(200, JSON.stringify({ ok: true }), calls),
    );

    expect(started.ok).toBe(true);
    expect(calls[0]?.path).toBe("/api/run/match");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      game: "salient",
      a: "bot:greedy",
      b: "bot:random",
      seed: 135,
    });
  });

  it("fails with the console's line naming the run already in flight", async () => {
    const line = "a series of bot:greedy vs bot:random in series/x, started 12:03, is already running";
    const calls: Call[] = [];

    await expect(
      postJson("/api/run/series", { game: "salient" }, answering(409, JSON.stringify({ error: line }), calls)),
    ).rejects.toThrow(line);
  });
});
