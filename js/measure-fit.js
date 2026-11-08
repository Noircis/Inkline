/**
 * @module measure-fit
 * @description
 * **Mise en mesure automatique** (depuis la 2.6). Fonctions pures.
 *
 * ## Le problème
 *
 * Inkline stocke une portée comme une **suite d'éléments** ; les barres de
 * mesure se placent d'elles-mêmes ({@link module:rhythm.segmentMeasures|segmentMeasures}).
 * Une note peut donc « déborder » de sa mesure : noire, noire, ronde en 4/4.
 * La gravure correcte coupe la ronde à la barre et lie les deux morceaux :
 *
 * ```
 * noire noire ronde   →   noire noire blanche⁀ | blanche
 * ```
 *
 * ## Notes logiques et liaisons automatiques
 *
 * Les morceaux créés par ce découpage sont marqués `auto: true` (« ce morceau
 * continue dans l'élément suivant ») ; pour une note, ils portent aussi
 * `tie: true`, ce qui suffit au dessin et à l'audio. Une suite de morceaux
 * `auto` forme une **note logique** ({@link module:measure-fit.eventsOf|eventsOf}).
 * Les liaisons posées par l'utilisateur n'ont pas `auto` : on n'y touche jamais.
 *
 * Après chaque modification, {@link module:measure-fit.normalizeStaff|normalizeStaff}
 * **recolle** les notes logiques puis les **recoupe** aux barres actuelles :
 * insérer une note au début décale toutes les barres, et le découpage suit.
 * Une note qui ne traverse aucune barre reste écrite comme l'utilisateur l'a
 * voulu (syncopes comprises) : on ne coupe qu'aux barres.
 *
 * ## Compensation par des silences (mode Modifier)
 *
 * {@link module:measure-fit.resizeEvent|resizeEvent} change la durée d'une
 * note en gardant la suite à sa place, comme MuseScore :
 * - raccourcir ajoute un silence de la différence (noire → croche + demi-soupir) ;
 * - allonger **mange** d'abord les silences qui suivent ; s'il n'y en a pas
 *   assez, la suite se décale (et les barres sont recoupées).
 *
 * ## Écriture des durées
 *
 * Une durée quelconque est écrite avec les valeurs usuelles
 * ({@link module:measure-fit.decompose|decompose}) : on prend à chaque fois
 * la plus grande valeur qui tient et qui tombe « juste » (une blanche commence
 * sur un temps pair, une noire sur un temps…). Points autorisés pour les
 * notes ; pour les silences, seulement en mesure composée (6/8, 12/8).
 *
 * Les triolets ne sont jamais coupés ni recollés.
 */

import { EPS, snap } from './util.js';
import { DUR, qlen, mlen, beatUnit } from './model.js';

/** Plus petite valeur écrite (double croche), en noires. */
const GRID = Math.min(...Object.values(DUR));

/** Valeurs simples, de la plus longue à la plus courte. */
const PLAIN = Object.entries(DUR)
  .map(([d, v]) => ({ d, v }))
  .sort((a, b) => b.v - a.v);

/**
 * Une note logique : un élément seul, ou une suite de morceaux `auto`.
 * @typedef {Object} FitEvent
 * @property {module:model~StaffItem[]} orig Morceaux d'origine (copies).
 * @property {number} len Durée totale en noires.
 * @property {boolean} rest Silence.
 * @property {boolean} tup Contient un triolet (jamais coupé).
 * @property {boolean} [gen] Durée calculée : à réécrire (pas de morceaux d'origine à garder).
 * @property {number} from Index du premier morceau dans la suite d'origine (-1 si créé).
 */

/**
 * `x` est-il un multiple de `a` (à l'arrondi près) ?
 * @param {number} x
 * @param {number} a
 * @returns {boolean}
 */
function isMult(x, a) {
  const r = x / a;
  return Math.abs(r - Math.round(r)) < 1e-6;
}

/**
 * Valeur unique (avec point éventuel) d'une durée, si elle existe.
 * @example
 * singleValue(3, true)   // { d: 'h', dot: true }
 * singleValue(2.5, true) // null
 * @param {number} len Durée en noires.
 * @param {boolean} allowDot
 * @returns {?{d: string, dot: boolean}}
 */
export function singleValue(len, allowDot) {
  for (const p of PLAIN) {
    if (Math.abs(p.v - len) < EPS) return { d: p.d, dot: false };
    if (allowDot && Math.abs(p.v * 1.5 - len) < EPS) return { d: p.d, dot: true };
  }
  return null;
}

/**
 * Écrit une durée en valeurs usuelles, à partir d'une position dans la mesure.
 *
 * Algorithme glouton « aligné » : à chaque pas, la plus grande valeur qui
 * tient dans ce qui reste et qui tombe juste :
 * - une valeur d'un temps ou plus commence sur un temps (pour les silences,
 *   plus strictement, sur un multiple d'elle-même : une demi-pause en 4/4 sur
 *   le 1 ou le 3, jamais sur le 2, pour que le milieu de la mesure reste lisible) ;
 * - une valeur plus courte qu'un temps commence sur un multiple d'elle-même
 *   (du double de sa valeur simple si elle est pointée : croche pointée sur
 *   le temps, pas sur le contretemps) et ne déborde pas sur le temps suivant :
 *   on complète le temps en cours avant d'avancer.
 *
 * À défaut, la plus grande valeur simple qui tient.
 *
 * @example
 * decompose(0.5, 1.5, false) // croche puis noire : [{d:'8'}, {d:'q'}]
 * decompose(1, 3, true)      // blanche pointée sur le 2e temps
 * @param {number} start Position de départ dans la mesure (noires).
 * @param {number} len Durée à écrire (noires).
 * @param {boolean} allowDot
 * @param {number} [beat=1] Durée d'un temps en noires (1,5 en 6/8).
 * @param {boolean} [rest=false] Écrire des silences (alignement strict).
 * @returns {?Array.<{d: string, dot: boolean}>} `null` si la durée n'est pas
 *   exprimable (reste plus petit qu'une double croche, par exemple après un triolet).
 */
export function decompose(start, len, allowDot, beat = 1, rest = false) {
  /** @type {Array.<{d: string, dot: boolean, v: number, b: number}>} */
  const cands = [];
  PLAIN.forEach((p) => {
    if (allowDot) cands.push({ d: p.d, dot: true, v: p.v * 1.5, b: p.v });
    cands.push({ d: p.d, dot: false, v: p.v, b: p.v });
  });
  cands.sort((a, b) => b.v - a.v);
  const out = [];
  let s = start;
  let rem = len;
  for (let guard = 0; rem > EPS && guard < 64; guard++) {
    const fits = (c) => c.v <= rem + EPS;
    const aligned = (c) =>
      c.v >= beat - EPS
        ? isMult(s, rest ? c.v : beat)
        : isMult(s, c.dot ? 2 * c.b : c.b) &&
          Math.floor(s / beat + 1e-9) === Math.floor((s + c.v) / beat - 1e-9);
    const pick = cands.find((c) => fits(c) && aligned(c)) || cands.find((c) => fits(c) && !c.dot);
    if (!pick) return null;
    out.push({ d: pick.d, dot: pick.dot });
    s = snap(s + pick.v);
    rem = snap(rem - pick.v);
  }
  return rem > EPS ? null : out;
}

/**
 * Regroupe les éléments en notes logiques.
 * @param {module:model~StaffItem[]} items
 * @returns {FitEvent[]}
 */
export function eventsOf(items) {
  const out = [];
  for (let i = 0; i < items.length; ) {
    let j = i;
    while (items[j].auto && j + 1 < items.length && !items[j].tup) j++;
    const orig = items.slice(i, j + 1).map((it) => ({ ...it }));
    out.push({
      orig,
      len: snap(orig.reduce((t, it) => t + qlen(it), 0)),
      rest: !!orig[0].r,
      tup: orig.some((it) => it.tup),
      from: i,
    });
    i = j + 1;
  }
  return out;
}

/**
 * Premier morceau de la note logique qui contient l'élément `i`.
 * @param {module:model~StaffItem[]} items
 * @param {number} i
 * @returns {number}
 */
export function chainStart(items, i) {
  while (i > 0 && items[i - 1] && items[i - 1].auto) i--;
  return i;
}

/**
 * Dernier morceau de la note logique qui contient l'élément `i`.
 * @param {module:model~StaffItem[]} items
 * @param {number} i
 * @returns {number}
 */
export function chainEnd(items, i) {
  while (items[i] && items[i].auto && i + 1 < items.length) i++;
  return i;
}

/**
 * Propriétés d'un morceau, hors durée et liens.
 * @param {module:model~StaffItem} it
 * @param {boolean} first Premier morceau (garde altération, accord, début de reprise).
 * @returns {Object}
 */
function baseProps(it, first) {
  // eslint-disable-next-line no-unused-vars
  const { d, dot, tie, auto, bar, a, c, rs, ...rest } = it;
  const out = { ...rest };
  if (first) {
    if (a != null) out.a = a;
    if (c) out.c = c;
    if (rs) out.rs = true;
  }
  return out;
}

/**
 * Réécrit une suite de notes logiques en éléments, coupés aux barres.
 * @param {FitEvent[]} events
 * @param {string} time
 * @returns {{items: module:model~StaffItem[], starts: number[], tupCross: Set.<number>}}
 *   `starts[k]` : index du premier morceau de l'événement k ; `tupCross` :
 *   index des triolets qui traversent une barre.
 */
function materialize(events, time) {
  const ML = mlen(time);
  const beat = beatUnit(time);
  const compound = time.endsWith('/8');
  const items = [];
  const starts = [];
  const tupCross = new Set();
  let pos = 0;

  const keep = (ev) => {
    ev.orig.forEach((it) => {
      const i = items.length;
      items.push({ ...it });
      const end = snap(pos + qlen(it));
      if (it.tup && end > ML + EPS) tupCross.add(i);
      pos = it.bar || end >= ML - EPS ? 0 : end;
    });
  };

  events.forEach((ev) => {
    const first = ev.orig[0];
    const last = ev.orig[ev.orig.length - 1];
    if (first.rs) pos = 0;
    starts.push(items.length);
    if (ev.tup) {
      keep(ev);
      return;
    }
    // 1. Découpage aux barres.
    const segs = [];
    let p = pos;
    let rem = ev.len;
    while (rem > EPS) {
      const take = Math.min(rem, ML - p);
      segs.push({ start: p, len: take });
      p = snap(p + take);
      rem = snap(rem - take);
      if (p >= ML - EPS) p = 0;
    }
    // 2. Valeurs de chaque segment.
    const allowDot = !ev.rest || compound;
    let vals;
    if (segs.length === 1 && ev.orig.length === 1 && !ev.gen) {
      keep(ev); // ni coupée ni recollée : écrite telle que l'utilisateur l'a voulue
      return;
    }
    if (segs.length === 1) {
      const one = singleValue(ev.len, allowDot);
      vals = [one ? [one] : decompose(segs[0].start, segs[0].len, allowDot, beat, ev.rest)];
    } else {
      vals = segs.map((sg) => decompose(sg.start, sg.len, allowDot, beat, ev.rest));
    }
    if (vals.some((v) => !v)) {
      // Durée non exprimable. Une note d'origine est gardée telle quelle ; un
      // silence calculé (compensation) n'a pas de morceaux d'origine fiables
      // (ce n'est qu'un modèle) : on le réécrit ci-dessous.
      if (!ev.gen) {
        keep(ev);
        return;
      }
      // Silence calculé qui tombe hors de la grille (après une double croche
      // pointée, par exemple) : on l'écrit d'un bloc, sans le couper à la barre,
      // plutôt que de perdre sa durée.
      const whole = decompose(0, ev.len, allowDot, beat, ev.rest);
      if (whole) {
        ev.orig = whole.map((v, k) => {
          const piece = { ...baseProps(first, k === 0), d: v.d };
          if (v.dot) piece.dot = true;
          if (k < whole.length - 1) piece.auto = true;
          else if (last.bar) piece.bar = last.bar;
          return piece;
        });
        keep(ev);
      }
      return;
    }
    // 3. Morceaux, liés entre eux.
    const flat = vals.flat();
    flat.forEach((v, k) => {
      const piece = { ...baseProps(first, k === 0), d: v.d };
      if (v.dot) piece.dot = true;
      if (k < flat.length - 1) {
        piece.auto = true;
        if (!ev.rest) piece.tie = true;
      } else {
        if (last.tie && !last.auto && !ev.rest) piece.tie = true;
        if (last.bar) piece.bar = last.bar;
      }
      items.push(piece);
    });
    pos = last.bar ? 0 : p;
  });
  return { items, starts, tupCross };
}

/**
 * Remet une portée en mesure : recolle les notes logiques et les recoupe aux
 * barres actuelles. Sans débordement ni morceau automatique, la portée est
 * rendue à l'identique.
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @returns {{items: module:model~StaffItem[], startOf: number[], tupCross: Set.<number>}}
 *   `startOf[i]` : nouvel index du premier morceau de la note logique qui
 *   contenait l'ancien élément `i` (et `startOf[items.length]` = nouvelle longueur).
 */
export function normalizeStaff(items, time) {
  const events = eventsOf(items);
  const res = materialize(events, time);
  const startOf = new Array(items.length + 1);
  events.forEach((ev, k) => {
    for (let i = ev.from; i < ev.from + ev.orig.length; i++) startOf[i] = res.starts[k];
  });
  startOf[items.length] = res.items.length;
  return { items: res.items, startOf, tupCross: res.tupCross };
}

/**
 * Change la durée de la note logique qui contient l'élément `i`, en gardant
 * la suite à sa place quand c'est possible (voir l'en-tête du module).
 *
 * @param {module:model~StaffItem[]} items
 * @param {string} time
 * @param {number} i Un morceau de la note à modifier.
 * @param {{d: string, dot: (boolean|undefined), tup: (boolean|undefined)}} value Nouvelle valeur.
 * @returns {{items: module:model~StaffItem[], index: number, tupCross: Set.<number>}}
 *   `index` : nouvel index du premier morceau de la note modifiée.
 */
export function resizeEvent(items, time, i, value) {
  const events = eventsOf(items);
  const k = events.findIndex((ev) => i >= ev.from && i < ev.from + ev.orig.length);
  const ev = events[k];
  const first = ev.orig[0];
  const last = ev.orig[ev.orig.length - 1];
  const single = { ...baseProps(first, true), d: value.d };
  if (value.dot) single.dot = true;
  if (value.tup) single.tup = 3;
  if (last.tie && !last.auto && !single.r) single.tie = true;
  if (last.bar) single.bar = last.bar;
  const oldLen = ev.len;
  const newLen = qlen(single);
  events[k] = { orig: [single], len: newLen, rest: !!single.r, tup: !!single.tup, from: ev.from };

  // Pas de compensation quand la différence ne s'écrit pas en valeurs simples
  // (triolet avant ou après, ou moins d'une double croche : double croche ⇄
  // double croche pointée, 1/8 de temps). La suite se décale alors, et
  // l'opération inverse la ramène : rien ne s'accumule.
  if (!ev.tup && !value.tup) {
    const diff = snap(oldLen - newLen);
    if (diff > EPS && isMult(diff, GRID)) {
      // Raccourcir : un silence comble la différence. La barre manuelle et la
      // liaison éventuelles passent après lui (la liaison n'a plus de sens).
      const restItem = { d: (singleValue(diff, false) || { d: 'q' }).d, r: true }; // modèle : réécrit (gen)
      if (single.bar) {
        restItem.bar = single.bar;
        delete single.bar;
      }
      delete single.tie;
      events.splice(k + 1, 0, { orig: [restItem], len: diff, rest: true, tup: false, gen: true, from: -1 });
    } else if (diff < -EPS && isMult(-diff, GRID)) {
      // Allonger : on mange les silences qui suivent.
      let extra = -diff;
      const j = k + 1;
      while (extra > EPS && events[j] && events[j].rest && !events[j].tup && !events[j].orig[0].rs) {
        const r = events[j];
        const rLast = r.orig[r.orig.length - 1];
        if (r.len <= extra + EPS) {
          extra = snap(extra - r.len);
          events.splice(j, 1);
          if (rLast.bar) {
            single.bar = rLast.bar; // la barre qui fermait le silence ferme maintenant la note
            break;
          }
        } else {
          // On n'entame un silence que si son reste s'écrit (multiple de la
          // double croche) ; sinon on s'arrête là et la suite se décale.
          if (!isMult(snap(r.len - extra), GRID)) break;
          r.len = snap(r.len - extra);
          r.gen = true;
          extra = 0;
        }
      }
    }
  }
  const res = materialize(events, time);
  return { items: res.items, index: res.starts[k], tupCross: res.tupCross };
}
