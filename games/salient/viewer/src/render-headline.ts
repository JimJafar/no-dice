/**
 * Drawing the one line above the board, and nothing else.
 *
 * The sentence is `headline.ts`'s — built from the turn's events and the supply
 * the turn leaves — and this file only puts it in the element the frame holds for
 * it. The style is the mock-up's (`salient/docs/mockups/spectator-view.html`,
 * where the line is the first child of the centre column, directly above the
 * board box): 24 px Barlow Semi Condensed at 600 weight, on one line, centred
 * over the board. That style sits in `viewer.css` as `.headline`, so nothing is
 * set here.
 *
 * The line is replaced whole on every render, so a stepped or scrubbed frame
 * shows the sentence of the turn it is on with no clause left over from the turn
 * before. There is no empty state to draw: `headline.ts` gives frame 0, and a
 * turn whose events changed no hex, a sentence of their own, because an empty
 * line above the board reads as a broken viewer rather than a quiet turn.
 */
export function renderHeadline(container: HTMLElement, text: string): void {
  container.textContent = text;
}
