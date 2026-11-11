/**
 * @module chord-keys
 * @description
 * **Chord keyboard** (2.8.5): what each key does. Pure functions; the
 * interface is in {@link module:ui/chord-keyboard|ui/chord-keyboard}.
 *
 * A chord is typed in two steps: the **root** (`C` … `B`, then ♭ or ♯), then
 * the **quality** in a single tap (`7`, `−7`, `Δ7`, `ø7`…). The detailed pad
 * (`⋯`) adds pieces one by one for rare chords (`C7♯9♭13`).
 *
 * Chords are **stored as text** in iReal Pro notation (`-7`, `^7`, `h7`,
 * `o7`), which the rest of the app already reads
 * ({@link module:chords|chords}, {@link module:ireal|ireal}); the display
 * formats them (`C−7`, `CΔ7`, `Cø7`, `C°7`).
 *
 * A chart measure is a list of slots (`ch`); typing always goes into the
 * **last** slot. `␣` opens a new one (two chords in the measure), `⌫` erases
 * the last piece typed.
 */

/**
 * A key.
 * @typedef {Object} ChordKey
 * @property {'root'|'acc'|'qual'|'add'|'slash'|'nc'|'sim'|'space'|'back'} t Kind:
 *   root (or bass after `/`), accidental of the last letter, full quality
 *   (replaces), quality piece (appends), bass, *no chord*, repeated measure,
 *   next slot, erase.
 * @property {string} [v] Value: letter, `b`/`#`, quality in iReal notation.
 */

/** Maximum number of slots in a measure. */
export const MAX_SLOTS = 4;

/**
 * Splits a chord being typed. The bass may be pending (`C/`, after the `/`
 * key).
 * @param {string} c
 * @returns {?{root: string, q: string, slash: boolean, bass: string}}
 */
export function splitChord(c) {
  const m = /^([A-G][b#]?)([^/]*)(\/([A-G][b#]?)?)?$/.exec(c);
  if (!m) return null;
  return { root: m[1], q: m[2], slash: !!m[3], bass: m[4] || '' };
}

/** Rebuilds a chord. */
const join = (p) => p.root + p.q + (p.slash ? '/' + p.bass : '');

/**
 * Adds, changes or removes the accidental of a note name (same key twice:
 * removed).
 * @param {string} name `C`, `Bb`…
 * @param {string} acc `b` or `#`.
 * @returns {string}
 */
function toggleAcc(name, acc) {
  const cur = name.slice(1);
  return name[0] + (cur === acc ? '' : acc);
}

/**
 * Applies a key to a measure (or to a note's chord: a single slot).
 *
 * @example
 * applyChordKey([], { t: 'root', v: 'B' })          // ['B']
 * applyChordKey(['B'], { t: 'acc', v: 'b' })        // ['Bb']
 * applyChordKey(['Bb'], { t: 'qual', v: '-7' })     // ['Bb-7']
 * applyChordKey(['Bb-7'], { t: 'space' })           // ['Bb-7', '']
 * applyChordKey(['Bb-7', ''], { t: 'root', v: 'E' }) // ['Bb-7', 'E']
 *
 * @param {Array.<string>} slots Slots of the measure (not modified).
 * @param {ChordKey} key
 * @returns {Array.<string>} New slots (`[]`: empty measure).
 */
export function applyChordKey(slots, key) {
  if (key.t === 'sim') return ['%'];
  const s = slots.length ? slots.slice() : [''];
  if (s.length === 1 && s[0] === '%') s[0] = ''; // typing over the repeat sign
  const i = s.length - 1;
  let c = s[i];
  if (c === 'n' && key.t !== 'back' && key.t !== 'space') c = '';
  const p = splitChord(c);

  switch (key.t) {
    case 'root':
      if (p && p.slash && !p.bass) c = join({ ...p, bass: key.v });
      else c = key.v; // new chord in the slot
      break;
    case 'acc':
      if (!p) break;
      if (p.slash && p.bass) c = join({ ...p, bass: toggleAcc(p.bass, key.v) });
      else c = join({ ...p, root: toggleAcc(p.root, key.v) });
      break;
    case 'qual': // full quality; the same key twice removes it
      if (!p) break;
      c = join({ ...p, q: p.q === key.v ? '' : key.v });
      break;
    case 'add':
      if (!p || p.slash) break;
      c = join({ ...p, q: p.q + key.v });
      break;
    case 'slash':
      if (p && !p.slash) c = join({ ...p, slash: true });
      break;
    case 'nc':
      c = 'n';
      break;
    case 'space':
      if (c !== '' && s.length < MAX_SLOTS) {
        s[i] = c;
        s.push('');
        return s;
      }
      break;
    case 'back':
      if (c === '') {
        if (s.length > 1) s.pop();
        else return [];
        return s.length === 1 && s[0] === '' ? [] : s;
      }
      c = backChord(c);
      break;
    default:
      break;
  }
  s[i] = c;
  return s.length === 1 && s[0] === '' ? [] : s;
}

/**
 * Erases the last piece of a chord: bass accidental, bass, slash, last
 * quality piece (`alt`, `sus`, `11`, `♭9`, `7`…), root accidental, root.
 * @param {string} c
 * @returns {string}
 */
function backChord(c) {
  const p = splitChord(c);
  if (!p) return '';
  if (p.slash) {
    if (p.bass.length > 1) return join({ ...p, bass: p.bass[0] });
    if (p.bass) return join({ ...p, bass: '' });
    return join({ ...p, slash: false });
  }
  if (p.q) return join({ ...p, q: p.q.replace(/(sus|add|alt|[b#]?1[13]|[b#]?\d|.)$/, '') });
  if (p.root.length > 1) return p.root[0];
  return '';
}
