/**
 * The one reading of a tool's answer that both players share.
 *
 * `BotPlayer` sees the MCP wire form and `PiPlayer` sees whatever Pi's
 * `tool_execution_end` carries, which is typed `any`. These are the cases that
 * have to read the same from both sides, or a model seat's tool calls stop
 * being comparable with a bot seat's.
 */
import { describe, expect, it } from "vitest";

import { answerOf } from "./tool-answer.ts";

describe("reading a tool's answer back as a value", () => {
  it("parses the JSON text a game server answers with", () => {
    const wire = { content: [{ type: "text", text: '{"accepted":true}' }] };
    expect(answerOf(wire)).toEqual({ accepted: true });
  });

  it("joins the text parts of a result that came in several", () => {
    const wire = { content: [{ type: "text", text: '{"hexes":' }, { type: "text", text: "[]}" }] };
    expect(answerOf(wire)).toEqual({ hexes: [] });
  });

  it("keeps an answer that is not JSON as the text it is", () => {
    expect(answerOf({ content: [{ type: "text", text: "the board has moved" }] })).toBe(
      "the board has moved",
    );
  });

  it("reads a bare string, which is how a tool outside the wire form can answer", () => {
    expect(answerOf('{"error":"turn_not_open"}')).toEqual({ error: "turn_not_open" });
  });

  it("answers null when the call answered nothing", () => {
    expect(answerOf(null)).toBeNull();
    expect(answerOf(undefined)).toBeNull();
    expect(answerOf({ content: [] })).toBeNull();
    expect(answerOf({ content: [{ type: "image", data: "…" }] })).toBeNull();
  });

  it("passes through a value that never had the content wrapper", () => {
    expect(answerOf({ ok: true, result: { troops: 3 } })).toEqual({ ok: true, result: { troops: 3 } });
  });
});
