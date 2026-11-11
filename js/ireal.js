/**
 * @module ireal
 * @description
 * Import and export in **iReal Pro** format (`irealb://`).
 *
 * ## Structure of a link
 *
 * ```
 * irealb://<tune>===<tune>===…===<playlist name>
 * tune = Title=Composer=(empty)=Style=Key=(transpose)=Music=(comp)=Tempo=Repeats
 * ```
 *
 * The whole thing is URL-encoded (`%20`…). The old `irealbook://` format is
 * simpler: `Title=Composer=Style=Key=n=Music`, with unobfuscated music.
 *
 * ## Obfuscation of the music field
 *
 * The music field starts with the signature `1r34LbKcu7`, followed by the
 * scrambled real string:
 *
 * - split into 50-character blocks (the last block, or a block followed by
 *   fewer than 2 characters, is not scrambled);
 * - in each block, positions 0–4 and 10–23 are swapped with their mirror
 *   `49 − i`.
 *
 * This permutation is an **involution** (applied twice, it gives back the
 * original): the same function {@link module:ireal.scramble|scramble} encodes
 * and decodes. Decoding adds three substitutions of compression tokens
 * (`XyQ` → 3 spaces, `LZ` → ` |`, `Kcl` → `| x`).
 *
 * ## Music language (once decoded)
 *
 * | Token            | Meaning                                |
 * |------------------|----------------------------------------|
 * | `T44`, `T34`…    | time signature                         |
 * | `*A`, `*B`, `*i` | section (A, B, intro…)                 |
 * | `[` `]`          | opening / closing double barline       |
 * | `{` `}`          | start / end repeat                     |
 * | `\|`             | single barline                         |
 * | `Z`              | final barline                          |
 * | `N1`, `N2`       | 1st / 2nd ending                       |
 * | `x`, `r`         | repeat 1 / 2 measures                  |
 * | `n`              | *no chord*                             |
 * | `p`              | slash (continues the chord)            |
 * | `<…>`, `(…)`     | comment, alternate chord (ignored)     |
 * | space            | an empty **slot** (4 slots per measure) |
 * | `,`              | separator without a slot               |
 *
 * iReal qualities: `^7` maj7, `-7` m7, `h7` m7♭5, `o7` dim7, `+` aug…
 *
 * ## Known limits
 *
 * Codas, segnos and D.C. are ignored on import. The format was coded from
 * open-source readers of this format and validated by round trip (export
 * then import), not against the iReal Pro app itself.
 */

import { t } from './i18n.js';
import { CHORD_RE } from './chords.js';
import { newGridBlock } from './model.js';

/** Signature preceding the obfuscated music field. */
const MUSIC_PREFIX = '1r34LbKcu7';

/**
 * Permutation of a 50-character block (see the module header).
 * @param {string} s Block of exactly 50 characters.
 * @returns {string}
 */
function obfuscate50(s) {
  const a = s.split('');
  for (let i = 0; i < 5; i++) {
    a[49 - i] = s[i];
    a[i] = s[49 - i];
  }
  for (let i = 10; i < 24; i++) {
    a[49 - i] = s[i];
    a[i] = s[49 - i];
  }
  return a.join('');
}

/**
 * Scrambles or unscrambles a string (involution).
 * @param {string} s
 * @returns {string}
 */
export function scramble(s) {
  let r = '';
  let p = s;
  while (p.length > 51) {
    const chunk = p.slice(0, 50);
    p = p.slice(50);
    r += p.length < 2 ? chunk : obfuscate50(chunk);
  }
  return r + p;
}

/**
 * Decodes a music field (without the signature).
 * @param {string} s
 * @returns {string}
 */
function unscramble(s) {
  return scramble(s).replace(/XyQ/g, '   ').replace(/LZ/g, ' |').replace(/Kcl/g, '| x');
}

/**
 * Inkline/free-text quality → iReal quality.
 * @example qualityToIReal('maj7') // '^7'
 * @param {string} q
 * @returns {string}
 */
function qualityToIReal(q) {
  let s = q.replace(/\s/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
  s = s.replace(/^(min|mi|m(?!aj)|–)/, '-');
  s = s.replace(/(maj|Maj|MA|Δ|∆)/, '^').replace(/^M(?=7|9|13|$)/, '^');
  if (s === '^' || s === '-^') s += '7';
  s = s
    .replace(/^(ø7?|h(?!7)|-7b5)/, 'h7')
    .replace(/^(dim|°)/, 'o')
    .replace(/^aug/, '+');
  return s;
}

/**
 * iReal quality → quality readable on a keyboard.
 * @example qualityFromIReal('-^7') // 'mMaj7'
 * @param {string} q
 * @returns {string}
 */
export function qualityFromIReal(q) {
  if (q.startsWith('^')) {
    const r = q.slice(1);
    return 'maj' + (r === '' ? '7' : r);
  }
  return q
    .replace(/^-\^(\d*)/, (m, d) => 'mMaj' + (d || '7'))
    .replace(/^-/, 'm')
    .replace(/^h7?/, 'm7b5')
    .replace(/^o/, 'dim');
}

/**
 * Chart slot → iReal token.
 * @param {string} c
 * @returns {string}
 */
export function chordToIReal(c) {
  if (c === '%') return 'x';
  if (c === 'n') return 'n';
  if (c === '') return 'p';
  const m = CHORD_RE.exec(c);
  if (!m) return 'n';
  const fix = (s) => s.replace('♭', 'b').replace('♯', '#');
  return m[1] + fix(m[2]) + qualityToIReal(m[3]) + (m[4] ? '/' + fix(m[4]) : '');
}

/** Time signatures ↔ iReal tokens. */
const TIME_TO_TOKEN = { '4/4': 'T44', '3/4': 'T34', '2/4': 'T24', '5/4': 'T54', '6/8': 'T68', '12/8': 'T12' };
const TOKEN_TO_TIME = { T44: '4/4', T34: '3/4', T24: '2/4', T54: '5/4', T68: '6/8', T12: '12/8', T64: '6/4' };

/**
 * Serializes a chart's measures into the iReal language (not obfuscated).
 *
 * Each measure is written over 4 **slots**: 1 chord = chord + 3 spaces,
 * 2 chords = 1st and 3rd slots, 3 chords = 2 + 1 + 1, 4 chords = 1 per slot.
 * Barlines are written between two measures according to each one's flags.
 *
 * @param {module:model~GridBlock} b
 * @returns {string}
 */
export function toIRealMusic(b) {
  const M = b.measures;
  let s = TIME_TO_TOKEN[b.time] || 'T44';
  M.forEach((m, i) => {
    const p = M[i - 1];
    // Barline between the previous measure and this one.
    if (p) {
      if (p.re) s += '}';
      else if (p.fin) s += 'Z';
      else if (p.dbl || m.sec || m.rs) s += ']';
      else s += '|';
    }
    if (m.sec) s += '*' + (m.sec === 'Intro' ? 'i' : m.sec[0]);
    if (m.rs) s += '{';
    else if (!p || m.sec || p.dbl || p.fin) s += '[';
    if (m.ending) s += 'N' + m.ending;
    const ch = m.ch.map(chordToIReal);
    if (!ch.length) s += '    ';
    else if (ch.length === 1) s += ch[0] + '   ';
    else if (ch.length === 2) s += ch[0] + ' ' + ch[1] + ' ';
    else if (ch.length === 3) s += ch[0] + ' ' + ch[1] + ',' + ch[2];
    else s += ch.join(',');
  });
  const l = M[M.length - 1];
  s += l && l.re ? '}' : ' Z';
  return s;
}

/**
 * Builds the `irealb://` link of a chart.
 * @param {string} title Title of the tune.
 * @param {module:model~GridBlock} b
 * @returns {string}
 */
export function toIRealLink(title, b) {
  const fields = [
    title,
    'Unknown',
    '',
    b.style || 'Medium Swing',
    b.key || 'C',
    '',
    MUSIC_PREFIX + scramble(toIRealMusic(b)),
    '',
    String(b.tempo || 0),
    '0',
  ];
  return 'irealb://' + fields.map((f) => encodeURIComponent(f)).join('=');
}

/**
 * Parses the iReal music language (already decoded) into chart measures.
 *
 * Hand-written scanner: at each position, anchored patterns are tried in
 * priority order. The state boils down to the current measure `cur` and
 * pending flags `pend` (section, start repeat) that will apply to the next
 * measure opened.
 *
 * @param {string} raw
 * @returns {{time: string, measures: module:model~GridMeasure[]}}
 */
export function parseIRealMusic(raw) {
  const p = newParser();
  const src = raw.replace(/<[^>]*>/g, ' ').replace(/\([^)]*\)/g, ' ');
  let i = 0;
  while (i < src.length) i += readToken(p, src.slice(i));
  p.close();
  return { time: p.time, measures: tidy(p.M) };
}

/**
 * State of the iReal reader: measures already read, current measure, pending
 * attributes (section, start repeat, which will apply to the next measure),
 * time signature.
 * @typedef {Object} IRealParser
 * @property {module:model~GridMeasure[]} M
 * @property {?module:model~GridMeasure} cur
 * @property {Object} pend
 * @property {string} time
 * @property {function(): module:model~GridMeasure} open Current measure (created if needed).
 * @property {function(string=)} close Closes the current measure, with an optional flag.
 */

/**
 * Creates the reader state.
 * @returns {IRealParser}
 */
function newParser() {
  const p = { M: [], cur: null, pend: {}, time: '4/4' };
  p.open = () => {
    if (!p.cur) {
      p.cur = { ch: [], ...p.pend };
      p.pend = {};
    }
    return p.cur;
  };
  p.close = (flag) => {
    if (p.cur) {
      if (flag) p.cur[flag] = true;
      p.M.push(p.cur);
      p.cur = null;
    } else if (flag && p.M.length) p.M[p.M.length - 1][flag] = true; // barline right after another barline
  };
  return p;
}

/**
 * One-character tokens: barlines, repeats, repeat measures, "no change"
 * chords (`n`) and empty slots (`p`).
 * @type {Object.<string, function(IRealParser)>}
 */
const SINGLE = {
  '{': (p) => {
    p.close();
    p.pend.rs = true;
  },
  '[': (p) => p.close(),
  '|': (p) => p.close(),
  ']': (p) => p.close('dbl'),
  '}': (p) => p.close('re'),
  Z: (p) => p.close('fin'),
  x: (p) => {
    p.open().ch = ['%'];
  },
  r: (p) => {
    p.close();
    p.M.push({ ch: ['%'] }, { ch: ['%'] });
  },
  n: (p) => p.open().ch.push('n'),
  p: (p) => p.open().ch.push(''),
};

/** iReal chord: root (W = invisible), accidental, quality, bass. */
const CHORD_TOKEN = /^([A-GW])([b#]?)([\^\-ho+0-9b#susaldt]*)(\/[A-G][b#]?)?/;

/**
 * Reads a token at the start of `r` and updates the reader.
 * @param {IRealParser} p
 * @param {string} r Rest of the text.
 * @returns {number} Number of characters consumed (at least 1).
 */
function readToken(p, r) {
  let mm;
  if ((mm = /^T(\d\d)/.exec(r))) {
    const ts = TOKEN_TO_TIME['T' + mm[1]];
    if (ts && !p.M.length) p.time = ts;
    return 3;
  }
  if ((mm = /^\*([A-Za-z])/.exec(r))) {
    const v = mm[1] === 'i' ? 'Intro' : mm[1] === 'V' ? 'Verse' : mm[1].toUpperCase();
    if (p.cur && !p.cur.ch.length) p.cur.sec = v;
    else p.pend.sec = v;
    return 2;
  }
  if ((mm = /^N([0-3])/.exec(r))) {
    if (Number(mm[1])) p.open().ending = Number(mm[1]);
    return 2;
  }
  if (SINGLE[r[0]]) {
    SINGLE[r[0]](p);
    return 1;
  }
  if ((mm = CHORD_TOKEN.exec(r)) && mm[0].length) {
    // W = "invisible root" (chord continued with a new bass): keep an empty slot.
    p.open().ch.push(mm[1] === 'W' ? '' : mm[1] + mm[2] + qualityFromIReal(mm[3]) + (mm[4] || ''));
    return mm[0].length;
  }
  return 1; // ignored token: space, comma, Y, S, Q, f, l, s, U…
}

/**
 * Final cleanup: empty measures at the end of the tune removed, implicit
 * final barline (unless the tune ends with a repeat).
 * @param {module:model~GridMeasure[]} M
 * @returns {module:model~GridMeasure[]}
 */
function tidy(M) {
  while (M.length && !M[M.length - 1].ch.length && !M[M.length - 1].sec) M.pop();
  if (M.length && !M[M.length - 1].re) M[M.length - 1].fin = true;
  M.forEach((m) => {
    if (m.re && m.fin) delete m.fin;
  });
  return M;
}

/**
 * An imported tune.
 * @typedef {Object} IRealSong
 * @property {string} title
 * @property {string} composer In iReal "Last First" format.
 * @property {string} style
 * @property {string} key
 * @property {number} tempo 0 if not given.
 * @property {string} time
 * @property {module:model~GridMeasure[]} measures
 */

/**
 * Extracts every tune from a text: single link, playlist, or `.html` file
 * shared by iReal Pro (the links are in `href` attributes).
 *
 * @param {string} text
 * @returns {IRealSong[]}
 */
export function parseIRealAll(text) {
  const urls = String(text).match(/irealb(?:ook)?:\/\/[^"'\s<>]+/g) || [];
  /** @type {IRealSong[]} */
  const out = [];
  urls.forEach((u) => {
    let d;
    try {
      d = decodeURIComponent(u.replace(/\+/g, '%20'));
    } catch (e) {
      d = u;
    }
    const isNew = d.startsWith('irealb://');
    d = d.replace(/^irealb(?:ook)?:\/\//, '');
    d.split('===').forEach((song) => {
      const p = song.split('=');
      if (p.length < 6) return; // playlist name or fragment
      const mi = p.findIndex((x) => x.startsWith(MUSIC_PREFIX));
      let music;
      let style;
      let key;
      let tempo = 0;
      if (mi >= 0) {
        // Fields are located relative to the music field, sturdier than a fixed index.
        music = unscramble(p[mi].slice(MUSIC_PREFIX.length));
        style = p[mi - 3] || '';
        key = p[mi - 2] || 'C';
        tempo = parseInt(p[mi + 2], 10) || 0;
      } else if (!isNew) {
        music = p[5];
        style = p[2];
        key = p[3];
      } else return;
      const r = parseIRealMusic(music);
      if (!r.measures.length) return;
      out.push({
        title: p[0] || t('list.untitled'),
        composer: p[1] || '',
        style: style || 'Medium Swing',
        key: key || 'C',
        tempo: tempo >= 30 && tempo <= 300 ? tempo : 0,
        time: r.time,
        measures: r.measures,
      });
    });
  });
  return out;
}

/**
 * Converts an imported tune into a chart block.
 * @param {IRealSong} s
 * @returns {module:model~GridBlock}
 */
export function songToGrid(s) {
  return Object.assign(newGridBlock(), {
    time: s.time,
    key: s.key,
    style: s.style,
    tempo: s.tempo || 120,
    measures: s.measures,
  });
}
