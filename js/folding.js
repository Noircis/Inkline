/**
 * @module folding
 * @description
 * **Collapsed display rule** for long blocks (2.2), as a pure function
 * testable in Node. The matching interface lives in
 * {@link module:ui/fold|ui/fold}.
 */

/** Number of lines from which a block can be collapsed. */
export const FOLD_MIN_LINES = 5;

/** Number of lines shown when a block is collapsed. */
export const FOLD_PREVIEW_LINES = 3;

/**
 * Should the block be shown collapsed? In order:
 * 1. a block being edited is always shown in full;
 * 2. a block shorter than {@link FOLD_MIN_LINES} lines is never collapsed;
 * 3. the manual choice stored on the block (`fold`);
 * 4. otherwise, the "Collapse long blocks automatically" option.
 *
 * @param {{fold: (string|undefined)}} b The block (only its `fold` field is read).
 * @param {number} lines Total number of lines in the block.
 * @param {boolean} active The block is being edited.
 * @param {boolean} autoFold Automatic collapse option.
 * @returns {boolean}
 */
export function shouldFold(b, lines, active, autoFold) {
  if (active || lines < FOLD_MIN_LINES) return false;
  if (b.fold === 'closed') return true;
  if (b.fold === 'open') return false;
  return autoFold;
}
