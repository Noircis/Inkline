/**
 * @module search
 * @description
 * **Search and sort** for the notes on the home screen (since 2.0). Pure functions.
 *
 * ## Search
 *
 * The query is split into words; a note matches if **every word** appears
 * somewhere in its title, its text blocks or its **chords** (charts and
 * chord symbols on staves). Typing "bb7alt" therefore finds every note
 * containing that chord, and "blues f" a note titled "Blues en F".
 *
 * Comparison ignores case and accents, and treats `♭`/`b` and `♯`/`#` as
 * equal: "reponse" finds "réponse", "B♭7" finds "Bb7".
 *
 * ## Sort
 *
 * Three orders ({@link module:search.SORT_MODES|SORT_MODES}); in every case,
 * **pinned** notes come first.
 */

/**
 * Sort orders offered on the home screen.
 * Labels: `sort.*` keys in the dictionaries ({@link module:i18n|i18n}).
 * @type {Array.<{key: string}>}
 */
export const SORT_MODES = [{ key: 'updated' }, { key: 'created' }, { key: 'title' }];

/** Valid sort keys. */
export const SORT_KEYS = SORT_MODES.map((m) => m.key);

/**
 * Normalized form of a text for comparison: lowercase, no accents, ♭ and ♯
 * replaced with b and #.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  return String(s || '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * All the searchable text of a note, normalized: title, texts, chords.
 * @param {module:model~Note} note
 * @returns {string}
 */
function searchableText(note) {
  const parts = [note.title];
  note.blocks.forEach((b) => {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'grid') b.measures.forEach((m) => parts.push(m.ch.join(' ')));
    else if (b.type === 'staff') b.items.forEach((it) => it.c && parts.push(it.c));
  });
  return normalize(parts.join('\n'));
}

/**
 * Does the note match the query? An empty query matches everything.
 * @param {module:model~Note} note
 * @param {string} query
 * @returns {boolean}
 */
export function matchNote(note, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchableText(note);
  return words.every((w) => text.includes(w));
}

/**
 * Sorts notes (new array), pinned first.
 * - `updated`: last change, most recent first;
 * - `created`: creation, most recent first;
 * - `title`: French alphabetical order, untitled notes last.
 * @param {module:model~Note[]} notes
 * @param {string} mode A key of {@link SORT_MODES}.
 * @returns {module:model~Note[]}
 */
export function sortNotes(notes, mode) {
  const byMode = {
    updated: (a, b) => b.updated - a.updated,
    created: (a, b) => (b.created || b.updated) - (a.created || a.updated),
    title: (a, b) => {
      if (!a.title !== !b.title) return a.title ? -1 : 1; // untitled last
      return (
        a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true }) || b.updated - a.updated
      );
    },
  };
  const cmp = byMode[mode] || byMode.updated;
  return notes.slice().sort((a, b) => !!b.pinned - !!a.pinned || cmp(a, b));
}
