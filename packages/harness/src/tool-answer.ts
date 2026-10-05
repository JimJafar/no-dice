/**
 * A tool's answer, read back as a value.
 *
 * A game server answers its players in JSON text — it is what the Salient
 * server sends and what a model reads — so the text parts of a result are
 * joined and parsed back. Anything that is not JSON is kept as the text it is,
 * and a call that answered nothing comes back as `null`.
 *
 * Both players need the same reading. `BotPlayer` applies it to the result the
 * MCP client hands back; `PiPlayer` applies it to the `result` of Pi's
 * `tool_execution_end` event, which carries the same content blocks that came
 * over the wire. One function means the two players report a call's answer
 * identically, which is what lets a test compare a model seat's tool calls with
 * a bot seat's.
 */

/** Parse JSON text, or keep the text when it is not JSON. */
const parseText = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** The text parts of a tool result, in order, joined. */
const textOf = (content: unknown[]): string =>
  content
    .flatMap((part) => {
      if (typeof part !== "object" || part === null) return [];
      const block = part as { type?: unknown; text?: unknown };
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    })
    .join("");

/**
 * The answer a tool call got, as a value.
 *
 * A result with `content` is the wire form and is read from its text parts. A
 * bare string is read the same way. Anything else is already a value and is
 * passed through, so a caller that answers without the content wrapper is not
 * flattened into nothing.
 */
export const answerOf = (answered: unknown): unknown => {
  if (answered === null || answered === undefined) return null;
  if (typeof answered === "string") return parseText(answered);
  // A result that carries `content` is the wire form, and is read from its text
  // parts. One that does not is already a value, and is passed through rather
  // than flattened into nothing.
  if (typeof answered === "object" && !("content" in answered)) return answered;
  const content = (answered as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = textOf(content);
  return text === "" ? null : parseText(text);
};
