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

/** Abscisse de début de la musique : la 1re ligne porte la clé ET le chiffrage, les suivantes seulement la clé. */
function systemStart(rh, isFirst) {
  if (isFirst) return rh ? 46 : 64;
  return rh ? 30 : 44;
}

/**
 * Ajoute une ligne vide à la liste.
 * @param {System[]} systems
 * @param {boolean} rh
 * @returns {System}
 */
function newSystem(systems, rh) {
  const sys = { start: systemStart(rh, systems.length === 0), ms: [], used: 0, end: 0, firstMeasure: 1 };
  systems.push(sys);
  return sys;
}

/**
 * Largeur naturelle d'une mesure : marges, signe de reprise éventuel,
 * éléments, et place pour la barre de fin.
 * @param {module:rhythm~Measure} m
 * @param {number[]} widths Largeur naturelle de chaque élément.
 * @returns {number}
 */
function measureWidth(m, widths) {
  const content = m.idx.reduce((sum, i) => sum + widths[i], 0);
  return PAD_L + (m.rs ? REPEAT_START_W : 0) + content + PAD_R + (BAR_EXTRA[m.type] || 0);
}

/**
 * Étape 3 : coupure de lignes, algorithme glouton (*first-fit*). Une mesure
 * va sur la ligne courante si elle tient, sinon elle ouvre une nouvelle ligne.
 * @param {module:rhythm~Measure[]} measures
 * @param {number[]} widths
 * @param {number} W
 * @param {boolean} rh
 * @returns {System[]}
 */
function breakIntoSystems(measures, widths, W, rh) {
  const systems = [];
  let sys = newSystem(systems, rh);
  measures.forEach((m) => {
    const w = measureWidth(m, widths);
    const avail = W - sys.start - 4;
    if (sys.ms.length && sys.used + w > avail) sys = newSystem(systems, rh);
    sys.ms.push({ m, w });
    sys.used += w;
  });
  return systems;
}

/**
 * Facteur d'étirement d'une ligne (étape 4, justification).
 * - ligne trop pleine : on comprime (`< 1`) ;
 * - ligne pleine non finale : on étire jusqu'au bord, au plus ×{@link MAX_STRETCH} ;
 * - dernière ligne : largeur naturelle, sauf fin de motif remplie à plus de
 *   50 %, ou bloc `justify` (entraînement) : la dernière ligne est alors
 *   étirée comme les autres (au plus ×{@link MAX_STRETCH}).
 * @param {System} sys
 * @param {number} W
 * @param {boolean} isLast
 * @param {boolean} ended Le motif se termine par une barre de fin.
 * @param {boolean} [justify=false] Étirer aussi la dernière ligne, comme les autres.
 * @returns {number}
 */
function stretchFactor(sys, W, isLast, ended, justify = false) {
  const avail = W - sys.start - 4;
  if (sys.used > avail) return avail / sys.used;
  if (!isLast && sys.used > 0) return Math.min(avail / sys.used, MAX_STRETCH);
  if (isLast && justify && sys.used > 0) return Math.min(avail / sys.used, MAX_STRETCH);
  if (isLast && ended && sys.used > avail * 0.5) return avail / sys.used;
  return 1;
}

/**
 * Étapes 4 et 5 : justification de chaque ligne et calcul des positions des
 * éléments, des barres et des débuts de reprise. Renseigne aussi `end` et
 * `firstMeasure` de chaque ligne.
 * @param {System[]} systems
 * @param {module:model~StaffItem[]} items
 * @param {number[]} widths
 * @param {number} W
 * @param {boolean} rh
 * @param {boolean} ended
 * @param {boolean} [justify=false]
 * @returns {{pos: ItemPos[], bars: Array.<{sys: number, x: number, type: string}>, starts: Array.<{sys: number, x: number}>, measureCount: number}}
 */
function placeSystems(systems, items, widths, W, rh, ended, justify = false) {
  const pos = [];
  const bars = [];
  const starts = [];
  let measureCount = 0;
  systems.forEach((sys, si) => {
    const sc = stretchFactor(sys, W, si === systems.length - 1, ended, justify);
    sys.firstMeasure = measureCount + 1;
    let x = sys.start;
    sys.ms.forEach(({ m }) => {
      measureCount++;
      const measureX = x;
      x += PAD_L * sc;
      if (m.rs) {
        starts.push({ sys: si, x: measureX + 2 });
        x += REPEAT_START_W * sc;
      }
      m.idx.forEach((i) => {
        const it = items[i];
        const w = widths[i] * sc;
        // La tête est décalée à droite de sa zone pour laisser la place à l'altération.
        const headOffset = (it.a != null && !it.r && !rh ? 12 : 0) + 8;
        pos[i] = { sys: si, x: x + headOffset * Math.min(1, sc), x0: x, x1: x + w };
        x += w;
      });
      x += (PAD_R + (BAR_EXTRA[m.type] || 0)) * sc;
      if (m.full) bars.push({ sys: si, x, type: m.type || 'single' });
    });
    sys.end = x;
  });
  return { pos, bars, starts, measureCount };
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
  const ended = items.length > 0 && items[items.length - 1].bar === 'final';

  const systems = breakIntoSystems(segmentMeasures(items, b.time), widths, W, rh);
  const { pos, bars, starts, measureCount } = placeSystems(systems, items, widths, W, rh, ended, !!b.justify);

  // Zone d'ajout : après la dernière mesure, ou sur une nouvelle ligne vide
  // s'il ne reste pas assez de place (en édition seulement).
  let last = systems[systems.length - 1];
  if (active && !ended && W - last.end < 48) {
    last = newSystem(systems, rh);
    last.end = last.start;
    last.firstMeasure = measureCount + 1;
  }
  const appendX = ended ? null : last.ms.length ? last.end + 8 : last.start + 6;

  const SH = rh ? 92 : 124;
  return {
    rh,
    systems,
    pos,
    bars,
    starts,
    appendSys: systems.length - 1,
    appendX,
    ended,
    SH,
    height: systems.length * SH,
    ML: mlen(b.time),
  };
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
