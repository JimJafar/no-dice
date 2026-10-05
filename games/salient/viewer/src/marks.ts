/**
 * The three marks a turn carries that the board cannot show: a first submission
 * that was refused, a turn the seat played no orders in, and a context that was
 * compacted. Brief §6.8 asks for all three, on the turn strip and in the seat's
 * panel, which is why they live beside each other rather than in either
 * renderer — the same facts have to say the same thing in both places.
 *
 * Every one of them is read off the turn record the log holds:
 * `rejected_submission` and the reasons its `wasted` entries give, `passed` as
 * `passReasonSchema` names it, and `compacted`. Nothing is inferred from the
 * board — a seat that moved no troops is not a seat that passed — so a log with
 * none of the three draws no marks, and a fixture that edits its turn records
 * to add them is marked where it says it was.
 *
 * The mock-ups' "Called it" and "Missed" tag is deliberately absent
 * (`salient/docs/salient-mockups.md`, "What is placeholder"): how a prediction
 * is scored is undecided, so the panel shows the prediction and no judgement of
 * it.
 */
import type { PassReason, Seat, TurnPlayerRecord, TurnRecord, WasteReason } from "@no-dice/log";

/** What one seat's turn record says happened that the board does not show. */
export interface SeatMarks {
  readonly seat: Seat;
  /** Why a first submission was refused, in the log's order; empty when there was none. */
  readonly rejected: readonly WasteReason[];
  /** Why the seat played no orders this turn, or `null` when it played. */
  readonly passed: PassReason | null;
  /** Whether the seat's context was compacted during the turn. */
  readonly compacted: boolean;
}

/** The seats, in the order a turn names them. */
const SEATS: readonly Seat[] = ["A", "B"];

/**
 * A pass reason in the panel's voice. The schema's own name is the fact; these
 * are the words brief §6.2's reasons read as, so `timeout` is shown as the seat
 * running out of time rather than as an enum member.
 */
export const PASS_TEXT: Record<PassReason, string> = {
  no_submission: "sent no orders",
  timeout: "ran out of time",
  token_budget: "ran out of output tokens",
  provider_error: "hit a provider error",
  harness_crash: "crashed its harness",
  tool_surface: "faulted in its tool surface",
};

/**
 * What one seat's turn is marked for. A refused submission is reported by the
 * reasons its `wasted` entries give, in the log's order with a reason repeated
 * by several orders named once — the panel is showing why the attempt was
 * refused, not how many orders each reason touched.
 */
export function marksFor(player: TurnPlayerRecord, seat: Seat): SeatMarks {
  const wasted = player.rejected_submission?.wasted ?? [];
  const reasons = wasted.map((entry) => entry.reason);
  return {
    seat,
    rejected: [...new Set(reasons)],
    passed: player.passed,
    compacted: player.compacted,
  };
}

/** Whether a seat's turn carries any mark at all. */
export function isMarked(marks: SeatMarks): boolean {
  return marks.rejected.length > 0 || marks.passed !== null || marks.compacted;
}

/** The marks of both seats at one turn, in seat order, an unmarked seat left out. */
export function marksOfTurn(record: TurnRecord): SeatMarks[] {
  return SEATS.map((seat) => marksFor(record.players[seat], seat)).filter(isMarked);
}

/**
 * One mark as a line: the kind it is, which is what the CSS colours it by, and
 * what it says.
 */
export type MarkKind = "rejected" | "passed" | "compacted";

export interface MarkLine {
  readonly kind: MarkKind;
  readonly text: string;
}

/**
 * The marks of one seat as lines, in the order above: what happened, and the
 * reason the log gives for it. A seat with several marks gets one line each, so
 * a turn whose submission was refused and whose context was then compacted says
 * both.
 */
export function markLines(marks: SeatMarks): MarkLine[] {
  const lines: MarkLine[] = [];
  if (marks.rejected.length > 0) {
    lines.push({ kind: "rejected", text: `first submission refused: ${marks.rejected.join(", ")}` });
  }
  if (marks.passed !== null) lines.push({ kind: "passed", text: `passed: ${PASS_TEXT[marks.passed]}` });
  if (marks.compacted) lines.push({ kind: "compacted", text: "context compacted" });
  return lines;
}

/** The same lines as sentences, for the turn strip's tooltip. */
export function markText(marks: SeatMarks): string[] {
  return markLines(marks).map((line) => line.text);
}
