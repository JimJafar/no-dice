/**
 * The two notes a bot submits, kept inside the length `submit_orders` accepts.
 *
 * Brief §6.2 makes `intent` and `prediction` required and 1 to 280 characters
 * each, and a submission that breaks that is refused — a bot that lost a match
 * over a long sentence would deserve it. Both bots build their text from the
 * orders they actually chose, which is short by construction, and then clamp it
 * here so the length is a property of the code rather than of the position.
 */

/** The longest `intent` or `prediction` the server takes. */
export const NOTE_LIMIT = 280;

/** `text` with its tail taken off if it is longer than the server will accept. */
export function withinNote(text: string): string {
  return text.length <= NOTE_LIMIT ? text : text.slice(0, NOTE_LIMIT);
}
