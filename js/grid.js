/**
 * @module grid
 * @description
 * Logique **pure** des grilles d'accords (façon iReal Pro) : saisie, durées,
 * ordre de lecture et rendu HTML. L'interaction (palette, clics) est dans
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
import { chordHtml } from './chords.js';

/** Styles iReal Pro proposés (le style d'un morceau importé est ajouté s'il manque). */
export const STYLES = ['Medium Swing', 'Medium Up Swing', 'Up Tempo Swing', 'Slow Swing', 'Ballad', 'Jazz Waltz', 'Bossa Nova', 'Samba', 'Latin', 'Afro Cuban', 'Funk', 'Even 8ths', 'Rock', 'Pop', 'Blues', 'Gospel', 'Waltz'];

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
  return txt.trim().split(/[\s,]+/).filter(Boolean).map((t) => {
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
    if (m.rs && i !== rsI) { rsI = i; pass = 1; }
    if (m.ending === 1 && pass === 2) {
      const j = M.findIndex((x, k) => k > i && x.ending === 2);
      if (j > 0) { i = j; continue; }
    }
    order.push(i);
    if (m.re && !jumped.has(i)) { jumped.add(i); i = rsI; pass = 2; continue; }
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
 * @returns {string}
 */
export function gridHtml(b, selI, playI) {
  const M = b.measures;
  const ended = M.length && M[M.length - 1].fin;
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
    if (i % 4 === 3 || (i === M.length - 1 && ended)) c.push('rb');
    const inner = m.ch.length === 1 && m.ch[0] === '%'
      ? '<span class="sim" aria-label="Mesure répétée">\u{1D10E}</span>'
      : m.ch.map((x) => `<span class="gc">${chordHtml(x)}</span>`).join('');
    h += `<button type="button" class="${c.join(' ')}" data-gm="${i}">`
      + (m.sec ? `<span class="sec">${esc(m.sec)}</span>` : '')
      + (m.ending ? `<span class="volta">${m.ending}.</span>` : '')
      + `<span class="gcs">${inner}</span></button>`;
  });
  if (!ended) h += '<button type="button" class="gm add" data-gm="add" aria-label="Ajouter une mesure">+</button>';
  return h + '</div>';
}
