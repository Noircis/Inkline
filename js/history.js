/**
 * @module history
 * @description
 * Undo ("↶") through **snapshots**: the *Memento* pattern.
 *
 * Before each change, the interface calls {@link module:history.pushSnapshot|pushSnapshot},
 * which pushes a serialized (JSON) copy of the note's title and blocks.
 * Undo pops the last snapshot and applies it again.
 *
 * ## Why snapshots rather than inverse commands?
 *
 * A *Command* pattern (each action knows how to undo itself) would use less
 * memory, but every new feature would have to write its own inverse: a
 * source of bugs. A note weighs a few KB; 80 snapshots per note are
 * negligible. The stack holds at most 80 entries (the oldest are dropped)
 * and is not persisted: it starts empty at each launch.
 */

/** Maximum stack depth, per note. */
const MAX_DEPTH = 80;

// stacks of JSON snapshots, by note id
/** @type {Object.<string, string[]>} */
const stacks = {};

/**
 * Pushes the current state of a note.
 * @param {module:model~Note} n
 */
export function pushSnapshot(n) {
  const h = stacks[n.id] || (stacks[n.id] = []);
  h.push(JSON.stringify({ t: n.title, b: n.blocks }));
  if (h.length > MAX_DEPTH) h.shift();
}

/**
 * Restores a note's last snapshot (modifies the note in place).
 * @param {module:model~Note} n
 * @returns {boolean} `false` if there was nothing to undo.
 */
export function popSnapshot(n) {
  const h = stacks[n.id];
  if (!h || !h.length) return false;
  const s = JSON.parse(h.pop());
  n.title = s.t;
  n.blocks = s.b;
  return true;
}

/**
 * Drops the last snapshot without restoring it: for an action that was
 * started then refused (for example a triplet that would cross a barline)
 * and undone by hand by the caller.
 * @param {module:model~Note} n
 */
export function discardSnapshot(n) {
  const h = stacks[n.id];
  if (h && h.length) h.pop();
}
