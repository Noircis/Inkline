/**
 * @module ireal
 * @description
 * Import et export au format **iReal Pro** (`irealb://`).
 *
 * ## Structure d'un lien
 *
 * ```
 * irealb://<morceau>===<morceau>===…===<nom de playlist>
 * morceau = Titre=Compositeur=(vide)=Style=Tonalité=(transposition)=Musique=(comp)=Tempo=Répétitions
 * ```
 *
 * Le tout est encodé en URL (`%20`…). L'ancien format `irealbook://` est plus
 * simple : `Titre=Compositeur=Style=Tonalité=n=Musique`, musique non obfusquée.
 *
 * ## Obfuscation du champ musique
 *
 * Le champ musique commence par la signature `1r34LbKcu7`, suivie de la
 * chaîne réelle brouillée :
 *
 * - découpage en blocs de 50 caractères (le dernier bloc, ou un bloc suivi
 *   de moins de 2 caractères, n'est pas brouillé) ;
 * - dans chaque bloc, les positions 0–4 et 10–23 sont échangées avec leurs
 *   symétriques `49 − i`.
 *
 * Cette permutation est une **involution** (appliquée deux fois, elle redonne
 * l'original) : la même fonction {@link module:ireal.scramble|scramble} sert à
 * encoder et à décoder. Au décodage s'ajoutent trois substitutions de jetons
 * de compression (`XyQ` → 3 espaces, `LZ` → ` |`, `Kcl` → `| x`).
 *
 * ## Langage de la musique (une fois décodée)
 *
 * | Jeton            | Sens                                   |
 * |------------------|----------------------------------------|
 * | `T44`, `T34`…    | chiffrage de mesure                    |
 * | `*A`, `*B`, `*i` | section (A, B, intro…)                 |
 * | `[` `]`          | double barre ouvrante / fermante       |
 * | `{` `}`          | reprise ouvrante / fermante            |
 * | `\|`             | barre simple                           |
 * | `Z`              | barre de fin                           |
 * | `N1`, `N2`       | 1re / 2e fin                           |
 * | `x`, `r`         | répéter 1 / 2 mesures                  |
 * | `n`              | *no chord*                             |
 * | `p`              | barre oblique (prolonge l'accord)      |
 * | `<…>`, `(…)`     | commentaire, accord alternatif (ignorés) |
 * | espace           | une **case** vide (4 cases par mesure) |
 * | `,`              | séparateur sans case                   |
 *
 * Qualités iReal : `^7` maj7, `-7` m7, `h7` m7♭5, `o7` dim7, `+` aug…
 *
 * ## Limites connues
 *
 * Les codas, segnos et D.C. sont ignorés à l'import. Le format a été codé
 * d'après les lecteurs open source de ce format et validé par aller-retour
 * (export puis import), pas contre l'application iReal Pro elle-même.
 */

import { CHORD_RE } from './chords.js';
import { newGridBlock } from './model.js';

/** Signature qui précède le champ musique obfusqué. */
const MUSIC_PREFIX = '1r34LbKcu7';

/**
 * Permutation d'un bloc de 50 caractères (voir l'en-tête du module).
 * @param {string} s Bloc de 50 caractères exactement.
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
 * Brouille ou débrouille une chaîne (involution).
 * @param {string} s
 * @returns {string}
 */
export function scramble(s) {
  let r = '';
  let p = s;
  while (p.length > 51) {
    const t = p.slice(0, 50);
    p = p.slice(50);
    r += p.length < 2 ? t : obfuscate50(t);
  }
  return r + p;
}

/**
 * Décode un champ musique (sans la signature).
 * @param {string} s
 * @returns {string}
 */
function unscramble(s) {
  return scramble(s).replace(/XyQ/g, '   ').replace(/LZ/g, ' |').replace(/Kcl/g, '| x');
}

/**
 * Qualité Inkline/texte libre → qualité iReal.
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
 * Qualité iReal → qualité lisible au clavier.
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
 * Case de grille → jeton iReal.
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

/** Chiffrages ↔ jetons iReal. */
const TIME_TO_TOKEN = { '4/4': 'T44', '3/4': 'T34', '2/4': 'T24', '5/4': 'T54', '6/8': 'T68', '12/8': 'T12' };
const TOKEN_TO_TIME = { T44: '4/4', T34: '3/4', T24: '2/4', T54: '5/4', T68: '6/8', T12: '12/8', T64: '6/4' };

/**
 * Sérialise les mesures d'une grille dans le langage iReal (non obfusqué).
 *
 * Chaque mesure est écrite sur 4 **cases** : 1 accord = accord + 3 espaces,
 * 2 accords = 1re et 3e cases, 3 accords = 2 + 1 + 1, 4 accords = 1 par case.
 * Les barres sont écrites entre deux mesures selon les drapeaux de chacune.
 *
 * @param {module:model~GridBlock} b
 * @returns {string}
 */
export function toIRealMusic(b) {
  const M = b.measures;
  let s = TIME_TO_TOKEN[b.time] || 'T44';
  M.forEach((m, i) => {
    const p = M[i - 1];
    // Barre entre la mesure précédente et celle-ci.
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
 * Construit le lien `irealb://` d'une grille.
 * @param {string} title Titre du morceau.
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
 * Analyse le langage musical iReal (déjà décodé) en mesures de grille.
 *
 * Scanner écrit à la main : à chaque position on essaie des motifs ancrés
 * par ordre de priorité. L'état se réduit à la mesure en cours `cur` et à des
 * drapeaux en attente `pend` (section, début de reprise) qui s'appliqueront
 * à la prochaine mesure ouverte.
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
 * État du lecteur iReal : mesures déjà lues, mesure en cours, attributs en
 * attente (section, début de reprise, qui s'appliqueront à la prochaine
 * mesure), chiffrage.
 * @typedef {Object} IRealParser
 * @property {module:model~GridMeasure[]} M
 * @property {?module:model~GridMeasure} cur
 * @property {Object} pend
 * @property {string} time
 * @property {function(): module:model~GridMeasure} open Mesure en cours (créée au besoin).
 * @property {function(string=)} close Ferme la mesure en cours, avec un drapeau éventuel.
 */

/**
 * Crée l'état du lecteur.
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
    } else if (flag && p.M.length) p.M[p.M.length - 1][flag] = true; // barre juste après une autre barre
  };
  return p;
}

/**
 * Jetons d'un caractère : barres, reprises, mesures de répétition, accords
 * « pas de changement » (`n`) et cases vides (`p`).
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

/** Accord iReal : fondamentale (W = invisible), altération, qualité, basse. */
const CHORD_TOKEN = /^([A-GW])([b#]?)([\^\-ho+0-9b#susaldt]*)(\/[A-G][b#]?)?/;

/**
 * Lit un jeton en tête de `r` et met à jour le lecteur.
 * @param {IRealParser} p
 * @param {string} r Reste du texte.
 * @returns {number} Nombre de caractères consommés (au moins 1).
 */
function readToken(p, r) {
  let mm;
  if ((mm = /^T(\d\d)/.exec(r))) {
    const t = TOKEN_TO_TIME['T' + mm[1]];
    if (t && !p.M.length) p.time = t;
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
    // W = « fondamentale invisible » (accord prolongé avec nouvelle basse) : on garde une case vide.
    p.open().ch.push(mm[1] === 'W' ? '' : mm[1] + mm[2] + qualityFromIReal(mm[3]) + (mm[4] || ''));
    return mm[0].length;
  }
  return 1; // jeton ignoré : espace, virgule, Y, S, Q, f, l, s, U…
}

/**
 * Nettoyage final : mesures vides en fin de morceau retirées, barre de fin
 * implicite (sauf si le morceau finit par une reprise).
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
 * Un morceau importé.
 * @typedef {Object} IRealSong
 * @property {string} title
 * @property {string} composer Au format iReal « Nom Prénom ».
 * @property {string} style
 * @property {string} key
 * @property {number} tempo 0 si non précisé.
 * @property {string} time
 * @property {module:model~GridMeasure[]} measures
 */

/**
 * Extrait tous les morceaux d'un texte : lien seul, playlist, ou fichier
 * `.html` partagé par iReal Pro (les liens y sont dans des attributs `href`).
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
      if (p.length < 6) return; // nom de playlist ou fragment
      const mi = p.findIndex((x) => x.startsWith(MUSIC_PREFIX));
      let music;
      let style;
      let key;
      let tempo = 0;
      if (mi >= 0) {
        // Les champs sont repérés par rapport au champ musique, plus robuste qu'un index fixe.
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
        title: p[0] || 'Sans titre',
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
 * Convertit un morceau importé en bloc grille.
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
