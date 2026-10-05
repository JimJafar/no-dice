/**
 * The per-seat, per-turn caps brief §6.2 sets that are not action points. They
 * live in one module because two places read them: the dispatch in `session`
 * refuses a call that would pass a cap, and `get_state` counts down from the
 * same numbers so a player is never told it has a call it will not get.
 */

/** Tool calls a seat may make in a turn, not counting `submit_orders`. */
export const TOOL_CALL_LIMIT = 12;

/** `simulate` calls a seat may make in a turn. */
export const SIMULATE_LIMIT = 3;
