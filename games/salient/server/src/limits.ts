/**
 * The caps brief §6.2 sets, other than the action points, which come from the
 * match's config. They live in one module because two places read them: the
 * dispatch in `session` refuses a call that would pass a cap, and `get_state`
 * counts down from the same numbers so a player is never told it has a call it
 * will not get. The two note lengths are read in one place too, so the length a
 * call is refused for is the length `get_state`'s own answers are written under.
 */

/** Tool calls a seat may make in a turn, not counting `submit_orders`. */
export const TOOL_CALL_LIMIT = 12;

/** `simulate` calls a seat may make in a turn. */
export const SIMULATE_LIMIT = 3;

/** The longest `notes` a seat may store with `write_notes`. */
export const NOTES_CHAR_LIMIT = 2000;

/** The longest `intent` or `prediction` a `submit_orders` may carry. */
export const SUBMISSION_NOTE_CHARS = 280;
