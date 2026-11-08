/**
 * @module rhythm
 * @description
 * Tout ce qui relève du **temps** sur une portée, indépendamment du dessin :
 *
 * - découpage en mesures ({@link module:rhythm.segmentMeasures|segmentMeasures}),
 * - regroupement des triolets ({@link module:rhythm.tupletGroups|tupletGroups}),
 * - regroupement des ligatures ({@link module:rhythm.beamGroups|beamGroups}),
 * - ordre de lecture avec reprises ({@link module:rhythm.staffPlayOrder|staffPlayOrder}),
 * - swing ({@link module:rhythm.swingWarp|swingWarp}),
 * - calcul de la liste d'événements sonores ({@link module:rhythm.staffEvents|staffEvents}).
 *
 * Ces fonctions sont **pures** (sans DOM, sans effet de bord) : le moteur de
 * mise en page, le rendu SVG et le lecteur audio s'appuient tous dessus, ce
 * qui garantit qu'ils sont d'accord entre eux. Elles sont couvertes par
 * `tests/rhythm.test.js`.
 */

import { EPS, snap } from './util.js';
import { qlen, writtenLen, mlen, groupStarts } from './model.js';
import { resolveMidis } from './pitch.js';

/**
 * Une mesure issue du découpage.
 * @typedef {Object} Measure
 * @property {number[]} idx Index des éléments de la mesure, dans l'ordre.
 * @property {boolean} full `true` si la mesure est fermée (pleine, ou fermée par une barre).
 * @property {module:model~BarType} [type] Barre qui ferme la mesure (`'single'` par défaut).
 * @property {boolean} rs La mesure commence par un début de reprise.
 */

/**
 * Découpe une suite d'éléments en mesures.
 *
 * Règles, dans l'ordre :
 * 1. un élément marqué `rs` (début de reprise) ouvre toujours une nouvelle
 *    mesure ; la mesure en cours est fermée par une barre simple ;
 * 2. un élément portant une barre (`bar`) ferme la mesure **même si elle est
 *    incomplète** : c'est ce qui permet de terminer un motif n'importe où ;
 * 3. sinon la mesure se ferme quand la somme des durées atteint la capacité.
 *
 * La dernière mesure peut rester ouverte (`full: false`) : c'est là que
 * l'utilisateur ajoute les notes suivantes.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time Chiffrage de mesure.
 * @returns {Measure[]}
 */
export function segmentMeasures(items, time) {
  const ML = mlen(time);
  /** @type {Measure[]} */
  const measures = [];
  let cur = [];
  let pos = 0;
  items.forEach((it, i) => {
    if (it.rs && cur.length) {
      measures.push({ idx: cur, full: true, type: 'single', rs: false });
      cur = [];
      pos = 0;
    }
    cur.push(i);
    pos = snap(pos + qlen(it));
    if (it.bar) {
      measures.push({ idx: cur, full: true, type: it.bar, rs: false });
      cur = [];
      pos = 0;
    } else if (pos >= ML - EPS) {
      measures.push({ idx: cur, full: true, type: 'single', rs: false });
      cur = [];
      pos = 0;
    }
  });
  if (cur.length) measures.push({ idx: cur, full: false, rs: false });
  // Le drapeau rs est porté par le premier élément de la mesure.
  measures.forEach((m) => {
    m.rs = !!items[m.idx[0]].rs;
  });
  return measures;
}

/**
 * Index de mesure de chaque élément (table inverse de {@link segmentMeasures}).
 * @param {Measure[]} measures
 * @param {number} count Nombre d'éléments.
 * @returns {number[]}
 */
function measureOfItem(measures, count) {
  const out = new Array(count).fill(0);
  measures.forEach((m, k) =>
    m.idx.forEach((i) => {
      out[i] = k;
    }),
  );
  return out;
}

/**
 * Un groupe de triolet.
 * @typedef {Object} TupletGroup
 * @property {number[]} idx Index des éléments du groupe.
 * @property {boolean} complete `true` si le groupe remplit exactement ses
 *   « 3 pour 2 » ; un groupe incomplet est quand même dessiné, pour que
 *   l'utilisateur voie qu'il manque une note.
 */

/**
 * Regroupe les éléments de triolet consécutifs en triolets.
 *
 * ## Règle de fermeture d'un groupe
 *
 * Un triolet, c'est **3 fois la plus petite valeur du groupe, jouées dans le
 * temps de 2**. On suit donc la plus petite durée écrite `min` rencontrée et la
 * somme écrite `written` ; le groupe est complet quand `written ≥ 3 × min`.
 *
 * Ça couvre les cas usuels :
 * - croche-croche-croche : min = ½, 3 × ½ = 1.5 = somme → complet (dure 1 noire)
 * - noire-croche : min = ½, 1 + ½ = 1.5 → complet (dure 1 noire)
 * - noire-noire-noire : min = 1 → complet sur 3 (dure 2 noires)
 *
 * Un groupe est aussi coupé, même incomplet, par un élément sans `tup` ou
 * par une barre de mesure.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @returns {TupletGroup[]}
 */
export function tupletGroups(items, time) {
  const mOf = measureOfItem(segmentMeasures(items, time), items.length);
  /** @type {TupletGroup[]} */
  const groups = [];
  let cur = null;
  const close = (complete) => {
    if (cur) {
      groups.push({ idx: cur.idx, complete });
      cur = null;
    }
  };
  items.forEach((it, i) => {
    if (!it.tup) {
      close(false);
      return;
    }
    if (cur && mOf[i] !== mOf[cur.idx[0]]) close(false);
    if (!cur) cur = { idx: [], written: 0, min: Infinity };
    cur.idx.push(i);
    cur.written = snap(cur.written + writtenLen(it));
    cur.min = Math.min(cur.min, writtenLen(it));
    if (cur.written >= 3 * cur.min - EPS) close(true);
  });
  close(false);
  return groups;
}

/**
 * Pour chaque élément, l'index de son groupe de triolet, ou -1.
 * @param {TupletGroup[]} groups
 * @param {number} count
 * @returns {number[]}
 */
function tupletIndex(groups, count) {
  const out = new Array(count).fill(-1);
  groups.forEach((g, k) =>
    g.idx.forEach((i) => {
      out[i] = k;
    }),
  );
  return out;
}

/**
 * Regroupe les croches et doubles croches à relier par une ligature.
 *
 * Règles :
 * - seules les notes (pas les silences) de valeur croche ou double croche sont ligaturées ;
 * - un groupe ne dépasse pas un **temps** (une noire en x/4, une noire pointée en x/8) ;
 * - un groupe ne traverse ni une barre de mesure ni la frontière d'un triolet
 *   (un triolet de croches forme sa propre ligature) ;
 * - un groupe d'un seul élément n'est pas une ligature (la note garde son crochet).
 *
 * Le découpage par **ligne** (système) n'est pas fait ici : il dépend de la
 * mise en page et est appliqué par le rendu.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @param {Array.<number>} [meter] Groupement des croches (2.8, voir {@link module:model.meterGroups|meterGroups}).
 * @returns {number[][]} Groupes d'index (longueur ≥ 2).
 */
export function beamGroups(items, time, meter) {
  const starts = groupStarts({ time, groups: meter });
  /** Groupe (temps) qui contient la position `q` de la mesure. */
  const end = mlen(time);
  const groupAt = (q) => {
    if (q >= end - EPS) return starts.length + Math.floor(q - end + EPS); // mesure trop pleine
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= q + EPS) k++;
    return k;
  };
  const measures = segmentMeasures(items, time);
  const tIdx = tupletIndex(tupletGroups(items, time), items.length);
  /** @type {number[][]} */
  const groups = [];
  measures.forEach((m) => {
    let pos = 0;
    let cur = [];
    let curKey = null;
    const flush = () => {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
      curKey = null;
    };
    m.idx.forEach((i) => {
      const it = items[i];
      const beat = groupAt(snap(pos));
      // Clé de regroupement : même temps ET même triolet (ou hors triolet).
      const key = tIdx[i] >= 0 ? 't' + tIdx[i] : 'b' + beat;
      if (!it.r && (it.d === '8' || it.d === '16')) {
        if (key !== curKey) flush();
        cur.push(i);
        curKey = key;
      } else {
        flush();
      }
      pos = snap(pos + qlen(it));
    });
    flush();
  });
  return groups;
}

/**
 * Ordre de lecture des éléments, reprises déroulées.
 *
 * On parcourt les éléments en mémorisant le dernier début de reprise `rs`.
 * En arrivant sur une fin de reprise (`bar: 'rep'`) pour la première fois,
 * on revient au début de reprise ; la deuxième fois on continue. L'ensemble
 * `done` mémorise les fins de reprise déjà prises.
 *
 * Une garde de 4000 éléments empêche toute boucle infinie sur des données
 * incohérentes.
 *
 * @param {module:model~StaffItem[]} items
 * @returns {number[]} Suite d'index, éventuellement avec répétitions.
 */
export function staffPlayOrder(items) {
  const order = [];
  let rs = 0;
  const done = new Set();
  for (let i = 0; i < items.length && order.length < 4000; i++) {
    const it = items[i];
    if (it.rs) rs = i;
    order.push(i);
    if (it.bar === 'rep') {
      if (!done.has(i)) {
        done.add(i);
        i = rs - 1;
      } // -1 car la boucle fait i++
      else rs = i + 1;
    }
  }
  return order;
}

/**
 * Déformation temporelle du swing (croches ternaires).
 *
 * À l'intérieur de chaque temps (partie fractionnaire `r` de la position en
 * noires), la première moitié est étirée à 2/3 et la seconde comprimée à 1/3 :
 * la croche du levé tombe aux 2/3 du temps, comme une croche de triolet.
 *
 * ```
 * r :   0 ──── 0.5 ──── 1
 * w :   0 ──── 0.667 ── 1
 * ```
 *
 * La fonction est continue et monotone : l'ordre des événements est conservé.
 *
 * @param {number} q Position en noires.
 * @returns {number} Position déformée en noires.
 */
export function swingWarp(q) {
  const f = Math.floor(q + 1e-9);
  const r = q - f;
  return f + (r < 0.5 ? (r * 4) / 3 : 2 / 3 + ((r - 0.5) * 2) / 3);
}

/**
 * Temps à jouer **droits** malgré le swing : ceux où une note (hors triolet)
 * commence ou finit ailleurs que sur le temps ou sur la croche du levé.
 *
 * Pourquoi : {@link swingWarp} est pensé pour des croches. Appliqué à des
 * doubles croches, il les rendait inégales (1/3, 1/3, 1/6, 1/6 du temps au
 * lieu de quatre quarts égaux). En jazz, un passage en doubles croches dans
 * un morceau swing se joue droit (comme en « double time ») : seuls les
 * temps écrits en croches sont swingués.
 *
 * @param {module:model~StaffItem[]} items
 * @param {number[]} order Ordre de lecture ({@link staffPlayOrder}).
 * @returns {Set.<number>} Index des temps (en noires depuis le début de la lecture).
 */
function straightBeats(items, order) {
  const out = new Set();
  const onGrid = (t) => {
    const r = t - Math.floor(t + 1e-9);
    return Math.abs(r) < 1e-6 || Math.abs(r - 0.5) < 1e-6 || Math.abs(r - 1) < 1e-6;
  };
  let q = 0;
  order.forEach((i) => {
    const it = items[i];
    const start = q;
    q = snap(q + qlen(it));
    if (it.tup) return;
    if (!onGrid(start)) out.add(Math.floor(start + 1e-9));
    if (!onGrid(q)) out.add(Math.floor(q + 1e-9));
  });
  return out;
}

/**
 * Un événement sonore d'une portée, prêt à être programmé par l'audio.
 * Les temps sont en **noires** depuis le début ; l'audio les convertit en
 * secondes avec le tempo.
 *
 * @typedef {Object} StaffEvent
 * @property {number} i Index de l'élément (pour le surlignage pendant la lecture).
 * @property {number} start Début en noires (swing appliqué).
 * @property {number} end Fin en noires (swing appliqué ; prolongée par les liaisons).
 * @property {number|null} midi Hauteur, `null` pour un silence ou une ligne rythmique.
 * @property {boolean} rest Silence.
 * @property {boolean} held Note liée à la précédente : elle n'est **pas**
 *   rejouée (la précédente est prolongée), mais l'événement sert au surlignage.
 * @property {boolean} downbeat Premier temps de la mesure (accent sur la ligne rythmique).
 */

/**
 * Construit la liste des événements sonores d'une portée.
 *
 * Étapes :
 * 1. ordre de lecture avec reprises ({@link staffPlayOrder}) ;
 * 2. positions en noires par cumul des durées réelles (triolets compris) ;
 * 3. liaisons : si l'élément précédent dans l'ordre de lecture est la note
 *    juste avant dans la partition et qu'elle est liée, on prolonge sa fin au
 *    lieu de déclencher une nouvelle note ;
 * 4. swing : on applique {@link swingWarp} temps par temps, **seulement aux
 *    temps écrits en croches** ({@link straightBeats}) : un temps qui contient
 *    des doubles croches (ou un point qui tombe au quart de temps) est joué
 *    droit. Les notes de triolet ne sont jamais déformées (déjà ternaires).
 *    Le swing n'est pas appliqué en mesure composée (x/8).
 *
 * @param {module:model~StaffBlock} b
 * @returns {{events: StaffEvent[], total: number}} Événements et durée totale en noires.
 */
export function staffEvents(b) {
  const items = b.items;
  const midis = resolveMidis(b);
  const order = staffPlayOrder(items);
  const ML = mlen(b.time);
  const swing = b.swing && !b.time.endsWith('/8');
  const straight = swing ? straightBeats(items, order) : new Set();
  const warp = (t, tup) => (swing && !tup && !straight.has(Math.floor(t + 1e-9)) ? swingWarp(t) : t);
  /** @type {StaffEvent[]} */
  const events = [];
  let q = 0;
  let mpos = 0;
  let lastSounding = null; // dernier événement réellement joué (pour les liaisons)
  order.forEach((i, k) => {
    const it = items[i];
    if (it.rs) mpos = 0;
    const start = q;
    q = snap(q + qlen(it));
    const ev = {
      i,
      start: warp(start, it.tup),
      end: warp(q, it.tup),
      midi: midis[i],
      rest: !!it.r,
      held: false,
      downbeat: mpos < EPS,
    };
    const prevIdx = order[k - 1];
    const prev = items[i - 1];
    if (!it.r && prevIdx === i - 1 && prev && prev.tie && !prev.r && lastSounding) {
      ev.held = true;
      lastSounding.end = ev.end; // prolonge la note précédente
    } else if (!it.r) {
      lastSounding = ev;
    }
    events.push(ev);
    mpos = snap(mpos + qlen(it));
    if (it.bar || mpos >= ML - EPS) mpos = 0;
  });
  return { events, total: warp(q, false) };
}
