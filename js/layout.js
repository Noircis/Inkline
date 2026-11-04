/**
 * @module layout
 * @description
 * Moteur de **mise en page** d'une portée : décide où chaque élément se place
 * (ligne et abscisse), où tombent les barres, et où se trouve la zone d'ajout.
 *
 * C'est une fonction pure : même entrée, même sortie, sans DOM. Le rendu SVG
 * ({@link module:render-staff|render-staff}) **et** le hit-testing (le toucher de
 * l'utilisateur, dans {@link module:ui/staff-ui|ui/staff-ui}) appellent tous deux
 * {@link module:layout.layout|layout} avec les mêmes paramètres : ils sont donc
 * cohérents par construction.
 *
 * ## Algorithme
 *
 * 1. **Largeurs intrinsèques** : chaque élément reçoit une largeur de base
 *    selon sa valeur (gravure proportionnelle : une ronde prend plus de place
 *    qu'une croche), plus de la place pour une altération, un point ou un
 *    accord chiffré trop long.
 * 2. **Mesures** : découpage par {@link module:rhythm.segmentMeasures|segmentMeasures}.
 * 3. **Coupure de lignes**, algorithme glouton (*first-fit*) : une mesure va
 *    sur la ligne courante si elle tient, sinon elle ouvre une ligne. On ne
 *    coupe jamais une mesure en deux.
 * 4. **Justification** : chaque ligne est étirée d'un facteur
 *    `sc = largeurDisponible / largeurUtilisée`, plafonné à 2.4 pour éviter
 *    un étirement absurde. La dernière ligne n'est pas étirée, sauf si le
 *    motif se termine par une barre de fin **et** que la ligne est déjà
 *    remplie à plus de 50 %. Une ligne trop pleine (mesure plus large que
 *    l'écran) est comprimée (`sc < 1`).
 * 5. **Positions finales** des éléments, des barres et des débuts de reprise.
 *
 * ## Repère vertical
 *
 * Chaque ligne (système) occupe une bande de hauteur fixe `SH` ; les
 * coordonnées y à l'intérieur sont données par {@link module:layout.geom|geom}.
 */

import { segmentMeasures } from './rhythm.js';
import { mlen } from './model.js';

/** Moitié d'un interligne, en pixels : l'écart vertical entre deux positions `s` consécutives. */
export const HALF_SPACE = 5;

/** Largeur de base (px) par valeur de note, avant justification. */
const BASE_WIDTH = { w: 46, h: 34, q: 27, 8: 23, 16: 21 };

/** Largeur supplémentaire (px) réservée après la mesure selon le type de barre. */
const BAR_EXTRA = { double: 4, final: 6, rep: 14 };

/** Marges intérieures de mesure (px) avant la première et après la dernière note. */
const PAD_L = 10;
const PAD_R = 8;

/** Largeur (px) réservée au signe de début de reprise `‖:`. */
const REPEAT_START_W = 16;

/** Facteur d'étirement maximal d'une ligne justifiée. */
const MAX_STRETCH = 2.4;

/**
 * Position calculée d'un élément.
 * @typedef {Object} ItemPos
 * @property {number} sys Index de la ligne.
 * @property {number} x Abscisse de la tête de note (centre).
 * @property {number} x0 Début de la zone horizontale de l'élément (pour le toucher).
 * @property {number} x1 Fin de cette zone.
 */

/**
 * Une ligne (système) de la portée.
 * @typedef {Object} System
 * @property {number} start Abscisse où commence la musique (après clé et chiffrage).
 * @property {number} end Abscisse après la dernière mesure.
 * @property {number} used Largeur naturelle occupée (avant justification).
 * @property {number} firstMeasure Numéro (à partir de 1) de la première mesure, affiché en début de ligne.
 * @property {Array.<{m: module:rhythm~Measure, w: number}>} ms Mesures placées sur la ligne.
 */

/**
 * Résultat de la mise en page.
 * @typedef {Object} Layout
 * @property {boolean} rh Ligne rythmique (une seule ligne de portée, pas de hauteurs).
 * @property {System[]} systems
 * @property {ItemPos[]} pos Une position par élément, même index que `items`.
 * @property {Array.<{sys:number, x:number, type:string}>} bars Barres de fin de mesure.
 * @property {Array.<{sys:number, x:number}>} starts Débuts de reprise.
 * @property {number} appendSys Ligne de la zone d'ajout.
 * @property {number|null} appendX Abscisse de la zone d'ajout, `null` si le
 *   motif est terminé par une barre de fin.
 * @property {boolean} ended Le dernier élément porte une barre de fin.
 * @property {number} SH Hauteur d'une ligne en px.
 * @property {number} height Hauteur totale en px.
 * @property {number} ML Capacité d'une mesure en noires.
 */

/**
 * Largeur naturelle (px) d'un élément.
 * @param {module:model~StaffItem} it
 * @param {boolean} rh Ligne rythmique (pas d'altérations).
 * @returns {number}
 */
function itemWidth(it, rh) {
  let w = BASE_WIDTH[it.d];
  if (it.dot) w += 7;
  if (it.a != null && !it.r && !rh) w += 12;
  if (it.c) w = Math.max(w, it.c.length * 8 + 10); // l'accord chiffré ne doit pas déborder sur le suivant
  return w;
}

/**
 * Met en page une portée.
 *
 * @param {module:model~StaffBlock} b Bloc portée.
 * @param {number} W Largeur disponible en px.
 * @param {boolean} [active=false] Bloc en cours d'édition : on garantit alors
 *   une zone d'ajout assez large, quitte à ouvrir une nouvelle ligne vide.
 * @returns {Layout}
 */
export function layout(b, W, active = false) {
  const rh = b.clef === 'rhythm';
  const items = b.items;
  const widths = items.map((it) => itemWidth(it, rh));
  const measures = segmentMeasures(items, b.time);

  // La 1re ligne porte la clé ET le chiffrage ; les suivantes seulement la clé.
  const firstStart = rh ? 46 : 64;
  const otherStart = rh ? 30 : 44;

  // --- 3. Coupure de lignes (glouton) ---
  /** @type {System[]} */
  const systems = [];
  let sys;
  const newSys = () => {
    sys = { start: systems.length ? otherStart : firstStart, ms: [], used: 0, end: 0, firstMeasure: 1 };
    systems.push(sys);
  };
  newSys();
  measures.forEach((m) => {
    const w = PAD_L + (m.rs ? REPEAT_START_W : 0) + m.idx.reduce((s, i) => s + widths[i], 0) + PAD_R + (BAR_EXTRA[m.type] || 0);
    const avail = W - sys.start - 4;
    if (sys.ms.length && sys.used + w > avail) newSys();
    sys.ms.push({ m, w });
    sys.used += w;
  });

  // --- 4 et 5. Justification et positions ---
  /** @type {ItemPos[]} */
  const pos = [];
  const bars = [];
  const starts = [];
  let mcount = 0;
  const ended = items.length > 0 && items[items.length - 1].bar === 'final';
  systems.forEach((s, si) => {
    const avail = W - s.start - 4;
    const last = si === systems.length - 1;
    let sc = 1;
    if (s.used > avail) sc = avail / s.used; // trop plein : on comprime
    else if (!last && s.used > 0) sc = Math.min(avail / s.used, MAX_STRETCH);
    else if (last && ended && s.used > avail * 0.5) sc = avail / s.used; // justification de fin de motif
    s.firstMeasure = mcount + 1;
    let x = s.start;
    s.ms.forEach(({ m }) => {
      mcount++;
      const mx = x;
      x += PAD_L * sc;
      if (m.rs) { starts.push({ sys: si, x: mx + 2 }); x += REPEAT_START_W * sc; }
      m.idx.forEach((i) => {
        const it = items[i];
        const iw = widths[i] * sc;
        // La tête est décalée à droite de la zone pour laisser la place à l'altération.
        const off = (it.a != null && !it.r && !rh ? 12 : 0) + 8;
        pos[i] = { sys: si, x: x + off * Math.min(1, sc), x0: x, x1: x + iw };
        x += iw;
      });
      x += (PAD_R + (BAR_EXTRA[m.type] || 0)) * sc;
      if (m.full) bars.push({ sys: si, x, type: m.type || 'single' });
    });
    s.end = x;
  });

  // --- Zone d'ajout ---
  let ls = systems[systems.length - 1];
  if (active && !ended && W - ls.end < 48) {
    // Plus de place sur la dernière ligne : on prépare une ligne vide.
    newSys();
    sys.end = sys.start;
    sys.firstMeasure = mcount + 1;
    ls = sys;
  }
  const appendSys = systems.length - 1;
  const appendX = ended ? null : ls.ms.length ? ls.end + 8 : ls.start + 6;

  const SH = rh ? 92 : 124;
  return { rh, systems, pos, bars, starts, appendSys, appendX, ended, SH, height: systems.length * SH, ML: mlen(b.time) };
}

/**
 * Repères verticaux d'une ligne.
 * @typedef {Object} SystemGeom
 * @property {number} top Haut de la bande.
 * @property {number} chordY Ligne de base des accords chiffrés.
 * @property {number} staffTop Ordonnée de la 5e ligne (en haut).
 * @property {number} staffBottom Ordonnée de la 1re ligne (en bas) ; `s = 0` ici.
 * @property {number} mid Ligne du milieu (3e ligne), pivot du sens des hampes.
 * @property {number} [line] Ligne unique d'une ligne rythmique.
 */

/**
 * Ordonnées de référence de la ligne `si`.
 * @param {Layout} L
 * @param {number} si Index de ligne.
 * @returns {SystemGeom}
 */
export function geom(L, si) {
  const top = si * L.SH;
  if (L.rh) {
    const ly = top + 56;
    return { top, chordY: top + 20, staffTop: ly, staffBottom: ly, mid: ly, line: ly };
  }
  const st = top + 46;
  return { top, chordY: top + 20, staffTop: st, staffBottom: st + 40, mid: st + 20 };
}

/**
 * Ordonnée d'une position `s` (tête de note) sur la ligne de géométrie `g`.
 * Sur une ligne rythmique, toutes les notes sont sur la ligne.
 * @param {Layout} L
 * @param {SystemGeom} g
 * @param {number} s
 * @returns {number}
 */
export function yOfStep(L, g, s) {
  return L.rh ? g.line : g.staffBottom - s * HALF_SPACE;
}

/**
 * Hit-testing vertical : position `s` la plus proche d'une ordonnée touchée.
 * Bornée à [-6, 14] (trois lignes supplémentaires de chaque côté).
 * @param {SystemGeom} g
 * @param {number} y
 * @returns {number}
 */
export function stepFromY(g, y) {
  return Math.max(-6, Math.min(14, Math.round((g.staffBottom - y) / HALF_SPACE)));
}
