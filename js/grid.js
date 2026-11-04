/**
 * @module grid
 * @description
 * Logique **pure** des grilles d'accords (façon iReal Pro) : saisie, durées,
 * ordre de lecture, rendu HTML (écran) et SVG (export en image). L'interaction (palette, clics) est dans
 * {@link module:ui/grid-ui|ui/grid-ui}.
 *
 * ## Rendu
 *
 * La grille est une CSS Grid de 4 colonnes : une mesure par cellule, 4 mesures
 * par ligne comme dans iReal. Les barres de mesure ne sont pas dessinées :
 * ce sont les **bordures** des cellules, choisies par classes CSS selon les
 * drapeaux de la mesure et de sa voisine de gauche :
 *
 * | Classe     | Signification                                   |
 * |------------|--------------------------------------------------|
 * | `lb-rs`    | bord gauche = début de reprise `‖:`              |
 * | `lb-dbl`   | bord gauche = double barre (début de section)    |
 * | `lb-none`  | pas de bord gauche (la voisine a déjà une barre spéciale) |
 * | `rb-re`    | bord droit = fin de reprise `:‖`                 |
 * | `rb-dbl`   | bord droit = double barre                        |
 * | `rb-fin`   | bord droit = barre de fin                        |
 * | `rb`       | bord droit simple (fin de ligne)                 |
 */

import { esc } from './util.js';
import { mlen } from './model.js';
import { chordHtml, chordParts } from './chords.js';

/** Styles iReal Pro proposés (le style d'un morceau importé est ajouté s'il manque). */
export const STYLES = [
  'Medium Swing',
  'Medium Up Swing',
  'Up Tempo Swing',
  'Slow Swing',
  'Ballad',
  'Jazz Waltz',
  'Bossa Nova',
  'Samba',
  'Latin',
  'Afro Cuban',
  'Funk',
  'Even 8ths',
  'Rock',
  'Pop',
  'Blues',
  'Gospel',
  'Waltz',
];

/** Les 12 toniques, notation iReal (bémols plutôt que dièses, sauf exceptions usuelles). */
export const KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Séquence des repères de section parcourue par le bouton « Section ». */
export const SECTIONS = ['', 'A', 'B', 'C', 'D', 'Intro'];

/**
 * Libellé français d'une tonalité iReal (`'Bb'` → `'B♭ majeur'`, `'C-'` → `'C mineur'`).
 * @param {string} k
 * @returns {string}
 */
export function keyLabel(k) {
  return k.endsWith('-') ? k.slice(0, -1).replace('b', '♭') + ' mineur' : k.replace('b', '♭') + ' majeur';
}

/**
 * Transforme la saisie d'une mesure en cases.
 *
 * - séparateurs : espaces et virgules ;
 * - `/` → case vide (prolonge l'accord précédent) ;
 * - `n`, `NC`, `N.C.` → *no chord* ;
 * - `%` → répétition de la mesure ;
 * - la première lettre est mise en majuscule (`bb7` → `Bb7`), pratique au clavier du téléphone.
 *
 * @example
 * gridTokens('cm7 / f7 NC')  // ['Cm7', '', 'F7', 'n']
 *
 * @param {string} txt
 * @returns {string[]}
 */
export function gridTokens(txt) {
  return txt
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => {
      if (/^(n|nc|n\.c\.?)$/i.test(t)) return 'n';
      if (t === '/') return '';
      if (t === '%') return '%';
      return /^[a-g]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
    });
}

/**
 * Texte d'édition d'une mesure (opération inverse de {@link gridTokens}).
 * @param {module:model~GridMeasure} m
 * @returns {string}
 */
export function measureText(m) {
  return m.ch.map((x) => (x === '' ? '/' : x === 'n' ? 'NC' : x)).join(' ');
}

/**
 * Durée (en noires) de chacune des `k` cases d'une mesure.
 *
 * On répartit les **temps** de la mesure entre les cases, les premières
 * recevant le surplus, comme iReal :
 * - 4/4, 2 accords → 2 + 2 ; 3 accords → 2 + 1 + 1 ; 4 accords → 1 chacun ;
 * - 3/4, 2 accords → 2 + 1.
 * En mesure composée (x/8), le temps est la noire pointée.
 *
 * @param {number} k Nombre de cases.
 * @param {string} time
 * @returns {number[]}
 */
export function slotDurations(k, time) {
  const total = mlen(time);
  const n = Number(time.split('/')[0]);
  const units = time.endsWith('/8') ? n / 3 : n;
  const u = total / units;
  if (k >= units) return Array(k).fill(total / k);
  const base = Math.floor(units / k);
  const extra = units % k;
  return Array.from({ length: k }, (_, i) => (base + (i < extra ? 1 : 0)) * u);
}

/**
 * Ordre de lecture des mesures, avec reprises et voltas.
 *
 * Automate à trois variables :
 * - `rsI` : index du dernier début de reprise (0 par défaut) ;
 * - `pass` : 1er ou 2e passage dans la reprise courante ;
 * - `jumped` : fins de reprise déjà prises.
 *
 * Transitions :
 * - une nouvelle mesure `rs` (autre que celle où l'on vient de sauter) ouvre
 *   une reprise : `pass = 1` ;
 * - au 2e passage, une mesure qui commence la 1re fin fait sauter
 *   directement à la 2e fin ;
 * - une fin de reprise non encore prise renvoie à `rsI` avec `pass = 2` ;
 * - une barre de fin arrête la lecture.
 *
 * @param {module:model~GridMeasure[]} M
 * @returns {number[]} Suite d'index de mesures.
 */
export function gridPlayOrder(M) {
  const order = [];
  let i = 0;
  let rsI = 0;
  let pass = 1;
  const jumped = new Set();
  while (i < M.length && order.length < 2000) {
    const m = M[i];
    if (m.rs && i !== rsI) {
      rsI = i;
      pass = 1;
    }
    if (m.ending === 1 && pass === 2) {
      const j = M.findIndex((x, k) => k > i && x.ending === 2);
      if (j > 0) {
        i = j;
        continue;
      }
    }
    order.push(i);
    if (m.re && !jumped.has(i)) {
      jumped.add(i);
      i = rsI;
      pass = 2;
      continue;
    }
    if (m.fin) break;
    i++;
  }
  return order;
}

/**
 * HTML de la grille.
 *
 * Chaque mesure est un `<button data-gm="index">` (zone de toucher native,
 * accessible au clavier). Une cellule `+` termine la grille tant qu'elle
 * n'est pas fermée par une barre de fin.
 *
 * @param {module:model~GridBlock} b
 * @param {number|null} selI Mesure sélectionnée.
 * @param {number|null} playI Mesure en cours de lecture.
 * @param {number} [limit=0] N'afficher que les `limit` premières mesures
 *   (bloc réduit, sans cellule `+`). 0 : toutes.
 * @returns {string}
 */
export function gridHtml(b, selI, playI, limit = 0) {
  const all = b.measures;
  const M = limit ? all.slice(0, limit) : all;
  const ended = all.length && all[all.length - 1].fin;
  let h = '<div class="grid">';
  M.forEach((m, i) => {
    const prev = M[i - 1];
    const c = ['gm', 'n' + Math.min(4, m.ch.length)]; // n0..n4 : taille de police selon le nombre d'accords
    if (i === selI) c.push('sel');
    if (i === playI) c.push('play');
    // Barre de gauche : la voisine de gauche dessine déjà une barre spéciale
    // sur la même ligne → on n'en remet pas une (évite les doubles traits).
    const special = prev && (prev.re || prev.fin || prev.dbl);
    if (m.rs) c.push('lb-rs');
    else if (special && i % 4 !== 0) c.push('lb-none');
    else if (m.sec || special) c.push('lb-dbl');
    if (m.re) c.push('rb-re');
    else if (m.fin) c.push('rb-fin');
    else if (m.dbl) c.push('rb-dbl');
    if (i % 4 === 3 || (i === all.length - 1 && ended)) c.push('rb');
    const inner =
      m.ch.length === 1 && m.ch[0] === '%'
        ? '<span class="sim" aria-label="Mesure répétée">\u{1D10E}</span>'
        : m.ch.map((x) => `<span class="gc">${chordHtml(x)}</span>`).join('');
    h +=
      `<button type="button" class="${c.join(' ')}" data-gm="${i}">` +
      (m.sec ? `<span class="sec">${esc(m.sec)}</span>` : '') +
      (m.ending ? `<span class="volta">${esc(String(m.ending))}.</span>` : '') +
      `<span class="gcs">${inner}</span></button>`;
  });
  if (!ended && M.length === all.length)
    h += '<button type="button" class="gm add" data-gm="add" aria-label="Ajouter une mesure">+</button>';
  return h + '</div>';
}

/** Hauteur d'une mesure dans l'export (px). */
const SVG_ROW = 58;
/** Espace entre deux lignes de mesures (px), où se placent sections et voltas. */
const SVG_GAP = 18;
/** Marge haute réservée aux repères de la première ligne (px). */
const SVG_TOP = 14;

/** Trait vertical de barre (rectangle, pour une épaisseur nette). */
const svgVline = (x, y, w = 1.4) => `<rect class="f" x="${x}" y="${y}" width="${w}" height="${SVG_ROW}"/>`;

/** Deux points de reprise centrés verticalement. */
const svgDots = (x, y) =>
  `<circle class="f" cx="${x}" cy="${y + SVG_ROW / 2 - 6}" r="2.1"/><circle class="f" cx="${x}" cy="${y + SVG_ROW / 2 + 6}" r="2.1"/>`;

/**
 * Rendu SVG d'une grille, pour l'export en image ou en PDF.
 *
 * Même logique que {@link module:grid.gridHtml|gridHtml}, mais les barres sont
 * de vrais traits (pas des bordures CSS) et les accords des `<text>` :
 * le résultat est autonome et peut être rasterisé.
 *
 * Mise en page : 4 mesures par ligne, cellules de `W / 4` de large. Les
 * repères de section et de volta débordent au-dessus de chaque ligne, d'où
 * l'espace réservé en haut.
 *
 * @param {module:model~GridBlock} b
 * @param {number} W Largeur en px.
 * @returns {{svg: string, height: number}} Fragment SVG (sans balise `<svg>` englobante) et hauteur.
 */
export function gridSvg(b, W) {
  const M = b.measures;
  const cellW = W / 4;
  let out = '';
  M.forEach((m, i) => {
    const col = i % 4;
    const x0 = col * cellW;
    const x1 = x0 + cellW;
    const y0 = SVG_TOP + Math.floor(i / 4) * (SVG_ROW + SVG_GAP);
    out += svgBarlines(M, i, col, x0, x1, y0);
    out += svgLabels(m, x0, x1, y0);
    out += svgChords(m, x0 + (m.rs ? 18 : 9), x1 - (m.re ? 16 : 6), y0);
  });
  const rows = Math.max(1, Math.ceil(M.length / 4));
  return { svg: out, height: SVG_TOP + rows * (SVG_ROW + SVG_GAP) - SVG_GAP + 4 };
}

/**
 * Barres gauche et droite de la mesure `i` (même logique que les classes
 * `lb-*` / `rb-*` de {@link module:grid.gridHtml|gridHtml}).
 * @param {module:model~GridMeasure[]} M
 * @param {number} i
 * @param {number} col Colonne (0 à 3).
 * @param {number} x0 Bord gauche.
 * @param {number} x1 Bord droit.
 * @param {number} y0 Haut de la mesure.
 * @returns {string}
 */
function svgBarlines(M, i, col, x0, x1, y0) {
  const m = M[i];
  const prev = M[i - 1];
  const prevSpecial = prev && (prev.re || prev.fin || prev.dbl);
  let out = '';
  // Gauche. Si la voisine de gauche (même ligne) a déjà une barre spéciale, on n'en remet pas.
  const leftAlreadyDrawn = prevSpecial && col !== 0;
  if (m.rs) {
    out += svgVline(x0, y0, 4) + svgVline(x0 + 6, y0) + svgDots(x0 + 11.5, y0);
  } else if (!leftAlreadyDrawn) {
    out += m.sec || prevSpecial ? svgVline(x0, y0) + svgVline(x0 + 3.5, y0) : svgVline(x0, y0);
  }
  // Droite.
  if (m.re) out += svgDots(x1 - 11.5, y0) + svgVline(x1 - 7.4, y0) + svgVline(x1 - 4, y0, 4);
  else if (m.fin) out += svgVline(x1 - 7.4, y0) + svgVline(x1 - 4, y0, 4);
  else if (m.dbl) out += svgVline(x1 - 5, y0) + svgVline(x1 - 1.4, y0);
  else if (col === 3 || i === M.length - 1) out += svgVline(x1 - 1.4, y0);
  return out;
}

/**
 * Repère de section (étiquette pleine) et volta (crochet), au-dessus de la mesure.
 * @param {module:model~GridMeasure} m
 * @param {number} x0
 * @param {number} x1
 * @param {number} y0
 * @returns {string}
 */
function svgLabels(m, x0, x1, y0) {
  let out = '';
  let voltaX = x0 + 14;
  if (m.sec) {
    const w = m.sec.length * 7.5 + 9;
    out += `<rect class="f" x="${x0 - 3}" y="${y0 - 12}" width="${w}" height="16" rx="3"/><text class="secl" x="${x0 - 3 + w / 2}" y="${y0 + 0.5}" text-anchor="middle">${esc(m.sec)}</text>`;
    voltaX = x0 + w + 4; // la volta commence après l'étiquette de section
  }
  if (m.ending) {
    out += `<path class="s" stroke-width="1.4" d="M${voltaX} ${y0 + 2} V${y0 - 9} H${x1 - 3}"/><text class="volt" x="${voltaX + 4}" y="${y0 + 1}">${esc(String(m.ending))}.</text>`;
  }
  return out;
}

/**
 * Accords d'une mesure, entre `left` et `right`.
 * 1 ou 2 accords : sur une ligne ; 3 ou 4 : en carré 2 × 2 (plus petit).
 * La qualité est en exposant (`tspan` décalé de 42 % de la taille de police).
 * @param {module:model~GridMeasure} m
 * @param {number} left
 * @param {number} right
 * @param {number} y0
 * @returns {string}
 */
function svgChords(m, left, right, y0) {
  if (m.ch.length === 1 && m.ch[0] === '%') {
    return `<text class="simg" x="${(left + right) / 2}" y="${y0 + SVG_ROW / 2 + 9}" text-anchor="middle">\u{1D10E}</text>`;
  }
  const k = m.ch.length;
  const fs = k <= 1 ? 20 : k === 2 ? 17 : 13.5;
  const slotW = (right - left) / (k <= 2 ? Math.max(1, k) : 2);
  let out = '';
  m.ch.forEach((c, j) => {
    const cx = left + (k <= 2 ? j : j % 2) * slotW;
    const cy = y0 + (k <= 2 ? SVG_ROW / 2 + fs * 0.35 : j < 2 ? SVG_ROW * 0.42 : SVG_ROW * 0.82);
    if (c === '') {
      out += `<text class="chm" x="${cx}" y="${cy}" font-size="${fs}">/</text>`;
      return;
    }
    if (c === 'n') {
      out += `<text class="chg" x="${cx}" y="${cy}" font-size="${fs * 0.7}">N.C.</text>`;
      return;
    }
    const p = chordParts(c);
    if (!p) {
      out += `<text class="chg" x="${cx}" y="${cy}" font-size="${fs}">${esc(c)}</text>`;
      return;
    }
    const up = (fs * 0.42).toFixed(1);
    out +=
      `<text class="chg" x="${cx}" y="${cy}" font-size="${fs}">${esc(p.root)}` +
      (p.quality ? `<tspan font-size="${fs * 0.62}" dy="-${up}">${esc(p.quality)}</tspan>` : '') +
      (p.bass
        ? `<tspan font-size="${fs * 0.72}" font-weight="500" dy="${p.quality ? up : 0}">${esc(p.bass)}</tspan>`
        : '') +
      '</text>';
  });
  return out;
}
