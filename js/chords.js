/**
 * @module chords
 * @description
 * Parsing of **chord symbols** typed as free text (`Cm7`, `Bb7alt`, `F#m7b5`,
 * `Ebmaj9/G`…).
 *
 * The user can write qualities in several ways (`maj7`, `Δ`, `^7`, `M7`;
 * `m7`, `-7`, `min7`; `m7b5`, `ø`; `dim7`, `°7`, `o7`). This module:
 *
 * - **splits** a chord into root / quality / bass ({@link module:chords.CHORD_RE|CHORD_RE});
 * - **formats** it for display with the quality as superscript
 *   ({@link module:chords.chordHtml|chordHtml});
 * - derives the **notes to play** ({@link module:chords.chordTones|chordTones}).
 *
 * Conversion to and from iReal Pro notation is in {@link module:ireal|ireal}.
 */

import { esc, mod } from './util.js';

/**
 * Splitting a chord: `[1]` letter, `[2]` accidental, `[3]` quality, `[4]` bass.
 *
 * @example
 * CHORD_RE.exec('Bbm7/F')  // ['Bbm7/F', 'B', 'b', 'm7', 'F']
 * @type {RegExp}
 */
export const CHORD_RE = /^([A-G])([b#♭♯]?)([^/]*)(?:\/([A-G][b#♭♯]?))?$/;

/** Pitch class (0 = C … 11 = B) of each letter. */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Pitch class of a note name (`'Bb'` → 10, `'F#'` → 6).
 * @param {string} s Letter + optional accidental.
 * @returns {number}
 */
function pitchClass(s) {
  const acc = s.slice(1);
  return LETTER_PC[s[0]] + (/[b♭]/.test(acc) ? -1 : /[#♯]/.test(acc) ? 1 : 0);
}

/** Letters in degree order. */
const LETTERS = 'CDEFGAB';

/**
 * Transposes a note name ("Bb", "F#", "C") by `steps` degrees and `semis`
 * semitones, keeping the musical spelling: C + major sixth gives A (not
 * B𝄫), B♭ + major sixth gives G. If the spelling would need a double sharp
 * or a double flat, the neighboring name is used.
 * @param {string} name
 * @param {number} steps
 * @param {number} semis
 * @returns {string}
 */
function transposeName(name, steps, semis) {
  const target = mod(pitchClass(name) + semis, 12);
  let li = mod(LETTERS.indexOf(name[0]) + steps, 7);
  let alter = mod(target - LETTER_PC[LETTERS[li]] + 6, 12) - 6;
  if (Math.abs(alter) > 1) {
    li = mod(li + Math.sign(alter), 7);
    alter = mod(target - LETTER_PC[LETTERS[li]] + 6, 12) - 6;
  }
  return LETTERS[li] + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter));
}

/**
 * Transposes a chord symbol (root and bass). Special symbols and
 * unrecognized texts are returned as is.
 *
 * @example
 * transposeChord('Bb7/D', 5, 9) // 'G7/B' (C → A: major sixth)
 * @param {string} c
 * @param {number} steps Degrees.
 * @param {number} semis Semitones.
 * @returns {string}
 */
export function transposeChord(c, steps, semis) {
  const m = CHORD_RE.exec(c);
  if (!m) return c;
  const root = transposeName(m[1] + m[2].replace('♭', 'b').replace('♯', '#'), steps, semis);
  const bass = m[4] ? '/' + transposeName(m[4].replace('♭', 'b').replace('♯', '#'), steps, semis) : '';
  return root + m[3] + bass;
}

/**
 * Tells whether a chart slot is valid: recognized chord, empty slot
 * (continuation), *no chord* or measure repeat.
 * @param {string} c
 * @returns {boolean}
 */
export function chordOk(c) {
  return c === '' || c === 'n' || c === '%' || CHORD_RE.test(c);
}

/**
 * Formats the quality for display, like iReal Pro (2.8.5): minor `−`, major
 * 7 `Δ7`, half-diminished `ø7`, diminished `°`, augmented `+`, and `b`/`#` →
 * `♭`/`♯`. Every way of typing it gives the same display:
 *
 * | Typed                           | Display   |
 * |---------------------------------|-----------|
 * | `m7`, `-7`, `min7`, `mi7`       | `−7`      |
 * | `maj7`, `^7`, `^`, `Δ`, `M7`    | `Δ7`      |
 * | `maj9`, `^9`                    | `Δ9`      |
 * | `mMaj7`, `-^7`                  | `−Δ7`     |
 * | `m7b5`, `-7b5`, `h7`, `h`, `ø`  | `ø7`      |
 * | `dim7`, `o7`, `°7`              | `°7`      |
 * | `aug`, `+`                      | `+`       |
 *
 * @param {string} q Raw quality.
 * @returns {string}
 */
function prettyQuality(q) {
  return q
    .replace(/^(min|mi|m(?!aj)|-|–|−)/, '−')
    .replace(/^(−?)(maj|Maj|MA|M(?=7|9|13|$)|\^|Δ|∆)/, '$1Δ')
    .replace(/^(−?Δ)(?![0-9])/, '$17')
    .replace(/^(−7b5|ø7?|h7?)/, 'ø7')
    .replace(/^(dim|o|°)/, '°')
    .replace(/^aug/, '+')
    .replace(/b/g, '♭')
    .replace(/#/g, '♯');
}

/**
 * Display parts of a chord.
 * @typedef {Object} ChordParts
 * @property {string} root Root with accidental ("B♭").
 * @property {string} quality Formatted quality ("–7", "Δ", "7♭9"), shown as superscript.
 * @property {string} bass Bass ("/F") or empty string.
 */

/**
 * Splits a chord for display (used by the chart HTML and by the image
 * export).
 * @param {string} c
 * @returns {ChordParts|null} `null` if the chord is not recognized.
 */
export function chordParts(c) {
  const m = CHORD_RE.exec(c);
  if (!m) return null;
  const sym = (x) => x.replace('b', '♭').replace('#', '♯');
  return { root: m[1] + sym(m[2]), quality: prettyQuality(m[3]), bass: m[4] ? '/' + sym(m[4]) : '' };
}

/**
 * Display HTML of a chart slot: large root, quality as superscript, small
 * bass. An invalid slot is rendered as is with the `bad` class (underlined
 * in red by the CSS).
 *
 * @param {string} c Slot content.
 * @returns {string} HTML fragment (already escaped).
 */
export function chordHtml(c) {
  if (c === '') return '<span class="slash">/</span>';
  if (c === 'n') return '<span class="nc">N.C.</span>';
  const p = chordParts(c);
  if (!p) return `<span class="bad">${esc(c)}</span>`;
  return `<span class="cr">${esc(p.root)}</span>${p.quality ? `<sup>${esc(p.quality)}</sup>` : ''}${p.bass ? `<span class="cb">${esc(p.bass)}</span>` : ''}`;
}

/**
 * Playable voicing of a chord.
 * @typedef {Object} ChordVoicing
 * @property {number} bass MIDI bass note (between E2 and D♯3).
 * @property {number[]} notes MIDI notes of the chord (between E3 and C5).
 */

/**
 * Derives the notes of a chord from its quality.
 *
 * ## Parsing the quality
 *
 * The family is detected first (major 7, minor, half-diminished,
 * diminished), then the additions in the rest of the string:
 *
 * | Clue          | Effect                              |
 * |---------------|-------------------------------------|
 * | 7, 9, 11, 13  | minor seventh (or major if maj)     |
 * | 6 (no 7)      | sixth instead of the seventh        |
 * | sus           | fourth instead of the third         |
 * | b5 / #5, +    | diminished / augmented fifth        |
 * | b9 / #9 / 9   | ninth                               |
 * | #11, 13, b13  | extensions                          |
 * | alt           | ♭9 + ♯9 + ♯5                        |
 *
 * ## Voicing
 *
 * The root is played in the bass **and** in the chord (since 2.8.8).
 * Without it, two different chords could give exactly the same pad: Fmaj7
 * without F and F♯ø7 without F♯ both give A, C, E. On a phone, where the
 * bass is barely heard, no change could be heard at all.
 *
 * Intervals are folded into a fixed range (MIDI 52 to 72): this gives close
 * voicings, and progressions with little movement, with no voice-leading
 * algorithm. The fifth, the least useful note, is left out as soon as there
 * are two extensions.
 *
 * @param {string} c Chord.
 * @returns {ChordVoicing|null} `null` if the chord is not recognized.
 */
export function chordTones(c) {
  const m = CHORD_RE.exec(c);
  if (!m) return null;
  const root = pitchClass(m[1] + m[2]);
  const q = m[3].replace(/\s/g, '');
  const isMaj = /^(maj|Maj|MA|M(?=7|9|13|$)|\^|Δ|∆)/.test(q);
  const isHalf = /^(ø|h|m7b5|-7b5|mi7b5|min7b5)/.test(q);
  const isDim = /^(dim|o|°)/.test(q);
  const isMin = !isMaj && !isHalf && !isDim && /^(min|mi|m|-)/.test(q);
  const body = q.replace(/^(maj|Maj|MA|M|\^|Δ|∆|min|mi|m|-|ø|h|dim|o|°)/, '');
  const minMaj = isMin && /^(maj|Maj|\^|Δ)/.test(body);

  let third = isMin || isHalf || isDim ? 3 : 4;
  let fifth = 7;
  let sev = null;
  const ext = [];
  const hasExt = /(7|9|11|13)/.test(body);
  if (isMaj || minMaj) sev = 11;
  else if (isHalf) sev = 10;
  else if (isDim)
    sev = /7/.test(body) ? 9 : null; // diminished seventh = 9 semitones
  else if (hasExt) sev = 10;
  if (/(^|[^1b#])6/.test(body) && !/7/.test(body)) sev = 9;
  if (/sus/.test(body)) third = 5;
  if (isHalf || isDim || /b5/.test(body)) fifth = 6;
  if (/\+|aug|#5/.test(q)) fifth = 8;
  if (/b9/.test(body)) ext.push(13);
  else if (/#9/.test(body)) ext.push(15);
  else if (/9/.test(body)) ext.push(14);
  if (/#11/.test(body)) ext.push(18);
  if (/13/.test(body)) ext.push(/b13/.test(body) ? 20 : 21);
  if (/alt/.test(body)) {
    ext.push(13, 15);
    fifth = 8;
  }

  const iv = [0, third, sev, ...ext];
  if (ext.length < 2 || sev == null) iv.push(fifth);
  const bass = m[4] ? pitchClass(m[4]) : root;
  return {
    bass: 40 + mod(bass - 4, 12),
    notes: iv
      .filter((x) => x != null)
      .map((x) => {
        let n = 48 + root + x;
        while (n < 52) n += 12;
        while (n > 72) n -= 12;
        return n;
      }),
  };
}
