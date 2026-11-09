/**
 * @module ui/staff/input
 * @description
 * **Toucher sur la portée** et **modes de saisie** (2.5), sur le modèle du
 * mode « N » de MuseScore :
 *
 * - **Écrire** : la palette règle la prochaine note ; toucher une note place
 *   le curseur d'insertion devant elle ; la zone bleue insère une note.
 * - **Modifier** : toucher une note la sélectionne ; la palette la modifie ;
 *   toucher plus haut ou plus bas la déplace.
 *
 * **Glisser** (2.8.2) : le doigt n'est pas toujours précis. Dans la zone
 * d'insertion (Écrire) ou sur la note sélectionnée (Modifier), la note suit
 * le doigt tant qu'il reste posé : on l'entend changer de hauteur, et une
 * bulle au-dessus du doigt affiche son nom. Elle est posée en levant le doigt.
 * Ailleurs, rien ne change : on peut faire défiler la page depuis la portée.
 *
 * Après toute insertion, la portée est remise en mesure
 * ({@link module:ui/staff/shared.refit|refit}) : une note qui déborde est
 * coupée à la barre et liée.
 */

import { state, blockById, touch } from '../state.js';
import { chainStart, chainEnd } from '../../measure-fit.js';
import { layout, geom, stepFromY, INSERT_GAP } from '../../layout.js';
import { pushSnapshot, discardSnapshot } from '../../history.js';
import { pitchName } from '../../pitch.js';
import * as audio from '../../audio.js';
import { setActive } from '../blocks.js';
import { hooks, clampCursor, refit, flash, insertIndex } from './shared.js';
import { closeChord } from './chord.js';

/**
 * Élément à insérer, construit à partir des réglages de saisie.
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g Géométrie de la ligne touchée.
 * @param {number} y Ordonnée du toucher (hauteur de la note).
 * @param {number} at Index d'insertion.
 * @returns {module:model~StaffItem}
 */
function newItem(b, L, g, y, at) {
  const inp = state.input;
  /** @type {module:model~StaffItem} */
  const it = { d: inp.d };
  if (inp.dot) it.dot = true;
  if (inp.tup) it.tup = 3;
  const prev = b.items[at - 1];
  // Une liaison qui partait de la note précédente visait l'ancienne voisine :
  // elle n'a plus de sens si l'on insère une autre note entre les deux.
  if (prev && prev.tie && !(inp.tie && !inp.rest)) delete prev.tie;
  if (inp.rest) {
    it.r = true;
  } else if (inp.tie && prev && !prev.r) {
    // Note liée : même hauteur que la précédente, la position touchée est ignorée.
    prev.tie = true;
    if (!L.rh) it.s = prev.s;
  } else if (!L.rh) {
    it.s = stepFromY(g, y);
    if (inp.acc != null) it.a = inp.acc;
  }
  if (inp.rs) it.rs = true;
  return it;
}

/**
 * Insère une note (ou un silence) avec les réglages de saisie, à la position
 * `at`, puis remet la portée en mesure. Un triolet qui traverserait une barre
 * est refusé (message dans la palette).
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g
 * @param {number} y
 * @param {number} at
 * @returns {number} Index de la note insérée (premier morceau), -1 si refusée.
 */
function insertNote(n, b, L, g, y, at) {
  const before = b.items.map((it) => ({ ...it }));
  const cursorBefore = state.cursor;
  pushSnapshot(n);
  const it = newItem(b, L, g, y, at);
  b.items.splice(at, 0, it);
  // Le curseur reste juste après la note insérée : on peut enchaîner.
  if (state.cursor != null) state.cursor = at + 1;
  const res = refit(b);
  const idx = res.startOf[at];
  if (it.tup && res.tupCross.has(idx)) {
    b.items = before;
    state.cursor = cursorBefore;
    discardSnapshot(n);
    flash('Un triolet ne peut pas passer la barre de mesure');
    return -1;
  }
  // Réglages « à usage unique » consommés ; triolet et silence restent actifs.
  const inp = state.input;
  inp.acc = null;
  inp.rs = false;
  inp.tie = false;
  touch(n);
  audio.previewItem(b, idx);
  return idx;
}

/**
 * Met la note `h` (et les notes qui lui sont liées) à la position `s`, sans
 * annulation ni sauvegarde. Une liaison relie deux notes de même hauteur :
 * déplacer une note rompt la liaison qui y arrive, et entraîne les notes qui
 * lui sont liées.
 * @param {module:model~StaffBlock} b
 * @param {number} h Index de la note.
 * @param {number} s Nouvelle position.
 */
function setStep(b, h, s) {
  b.items[h].s = s;
  const prev = b.items[h - 1];
  if (prev && prev.tie) delete prev.tie;
  for (let k = h; b.items[k] && b.items[k].tie && b.items[k + 1] && !b.items[k + 1].r; k++)
    b.items[k + 1].s = s;
}

/**
 * Où tombe un toucher : ligne, élément touché, zones d'insertion. Refait la
 * mise en page avec la même largeur et le même curseur que le rendu.
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} wrap
 * @param {number} cx Abscisse dans la fenêtre.
 * @param {number} cy Ordonnée dans la fenêtre.
 */
function hitTest(b, wrap, cx, cy) {
  const r = wrap.getBoundingClientRect();
  const x = cx - r.left;
  const y = cy - r.top;
  const write = state.mode === 'write';
  const L = layout(b, wrap._W || wrap.clientWidth, true, write ? state.cursor : null);
  const si = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
  const g = geom(L, si);
  const hit = b.items.findIndex((it, i) => L.pos[i].sys === si && x >= L.pos[i].x0 && x < L.pos[i].x1);
  const inAppend = L.appendX != null && si === L.appendSys && x >= L.appendX - 14;
  const inInsert = L.insertX != null && si === L.insertSys && Math.abs(x - L.insertX) <= INSERT_GAP / 2 + 2;
  return { x, y, top: r.top, L, g, hit, inAppend, inInsert };
}

/**
 * Gère un toucher sur la portée.
 *
 * 1. Active le bloc s'il ne l'était pas (et ferme le clavier éventuel).
 * 2. Refait la mise en page avec la même largeur et le même curseur que le
 *    rendu, puis convertit les coordonnées : ligne = `floor(y / hauteurDeLigne)`,
 *    élément = celui dont l'intervalle `[x0, x1)` contient x, hauteur =
 *    {@link module:layout.stepFromY|stepFromY}.
 * 3. **Mode Écrire** :
 *    - **zone bleue** (au curseur, ou en fin de portée) : insère une note avec
 *      les réglages de saisie, à la hauteur touchée ;
 *    - **une note** : place le curseur juste avant elle (rien n'est modifié) ;
 *    - **fin de portée**, quand le curseur est au milieu : y ramène le curseur.
 * 4. **Mode Modifier** :
 *    - **la note déjà sélectionnée** : la déplace à la hauteur touchée ;
 *    - **une autre note** : la sélectionne ;
 *    - ailleurs : désélectionne.
 *
 * Une note coupée par une barre est traitée en entier : on la sélectionne, ou
 * on place le curseur, toujours sur son premier morceau.
 *
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {MouseEvent} e
 */
function staffTap(n, b, e) {
  if (state.activeId !== b.id) {
    setActive(b.id);
    const ae = /** @type {HTMLElement} */ (document.activeElement);
    if (ae && ae.blur && ae !== document.body) ae.blur();
  }
  clampCursor(b);
  const wrap = /** @type {HTMLElement} */ (e.currentTarget);
  const { y, L, g, hit, inAppend, inInsert } = hitTest(b, wrap, e.clientX, e.clientY);

  if (state.mode === 'write') {
    if (inInsert) {
      insertNote(n, b, L, g, y, state.cursor);
    } else if (hit >= 0) {
      state.cursor = chainStart(b.items, hit);
    } else if (inAppend) {
      if (state.cursor != null) state.cursor = null;
      else insertNote(n, b, L, g, y, b.items.length);
    }
  } else if (hit >= 0) {
    const h = chainStart(b.items, hit);
    if (state.sel === h && !b.items[h].r && !L.rh) {
      const s = stepFromY(g, y);
      if (s !== b.items[h].s) {
        pushSnapshot(n);
        setStep(b, h, s);
        touch(n);
      }
    } else state.sel = h;
    audio.previewItem(b, h);
  } else {
    state.sel = null;
  }
  hooks.redraw(b.id);
}

/**
 * Zones où un glisser peut commencer, posées en calques invisibles sur la
 * portée (`touch-action: none`). Le navigateur décide de faire défiler la
 * page dès que le doigt touche l'écran, avant même nos gestionnaires : il
 * faut donc lui dire à l'avance où le doigt sert à placer une note. Partout
 * ailleurs, la page défile comme avant.
 *
 * Mêmes zones que {@link hitTest} : la zone d'insertion et la zone d'ajout
 * (Écrire), la note sélectionnée (Modifier), sur toute la hauteur de la ligne.
 *
 * @param {module:model~StaffBlock} b
 * @param {number} W Largeur du rendu.
 * @returns {string} HTML des calques (vide si aucun).
 */
export function dragZonesHtml(b, W) {
  if (state.activeId !== b.id || b.clef === 'rhythm') return '';
  const write = state.mode === 'write';
  const L = layout(b, W, true, write ? state.cursor : null);
  const zone = (sys, x0, x1) =>
    `<div class="drag-zone" style="left:${Math.max(0, x0)}px;top:${sys * L.SH}px;width:${Math.max(0, Math.min(W, x1) - Math.max(0, x0))}px;height:${L.SH}px"></div>`;
  if (write) {
    if (L.insertX != null)
      return zone(L.insertSys, L.insertX - INSERT_GAP / 2 - 2, L.insertX + INSERT_GAP / 2 + 2);
    if (L.appendX != null && state.cursor == null) return zone(L.appendSys, L.appendX - 14, W);
    return '';
  }
  const h = state.sel;
  if (h == null || !b.items[h] || b.items[h].r) return '';
  let out = '';
  for (let i = h; i <= chainEnd(b.items, h); i++)
    if (L.pos[i]) out += zone(L.pos[i].sys, L.pos[i].x0, L.pos[i].x1);
  return out;
}

/** Bulle qui affiche le nom de la note pendant un glisser (créée au premier usage). */
let tip = null;

/**
 * Affiche (ou cache, `text` vide) la bulle au-dessus du doigt.
 * @param {string} text
 * @param {number} [cx]
 * @param {number} [cy]
 */
function showTip(text, cx = 0, cy = 0) {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'pitch-tip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tip);
  }
  tip.hidden = !text;
  if (!text) return;
  tip.textContent = text;
  tip.style.left = `${cx}px`;
  tip.style.top = `${cy - 44}px`; // au-dessus du doigt, qui cache la note
}

/**
 * Branche le toucher sur la zone d'une portée : glisser une note (2.8.2) et
 * touchers simples ({@link staffTap}).
 *
 * Un glisser commence au `pointerdown` :
 * - **Écrire**, dans la zone d'insertion (ou la zone d'ajout en fin de
 *   portée) : la note est insérée tout de suite, à la hauteur du doigt ;
 * - **Modifier**, sur la note déjà sélectionnée : elle va à la hauteur du doigt.
 *
 * Puis, tant que le doigt reste posé, la note suit (`pointermove`) ; on la
 * pose en levant le doigt. Tout le geste ne compte que pour une annulation.
 * Pendant le geste, le défilement de la page est bloqué (`touchmove`
 * annulé) ; partout ailleurs sur la portée, la page défile normalement.
 *
 * Le point de repère vertical est figé au début du geste : si la portée
 * s'agrandit (note très aiguë), la note ne s'emballe pas sous le doigt.
 *
 * Un toucher qui ne commence pas de glisser reste un simple `click`
 * ({@link staffTap}) : placer le curseur, sélectionner, désélectionner.
 *
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} wrap
 */
export function bindStaffInput(n, b, wrap) {
  /** Geste en cours. */
  let drag = null;
  /** Le `click` qui suit un geste ne doit pas être traité une 2e fois. */
  let consumed = false;

  wrap.addEventListener('pointerdown', (e) => {
    consumed = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Bloc inactif ou réduit : le premier toucher l'active (voir staffTap / fold).
    if (state.activeId !== b.id || wrap.closest('.folded')) return;
    clampCursor(b);
    const t = hitTest(b, wrap, e.clientX, e.clientY);
    let h;
    let movable;
    if (state.mode === 'write') {
      const at = t.inInsert
        ? state.cursor
        : t.hit < 0 && t.inAppend && state.cursor == null
          ? b.items.length
          : null;
      if (at == null) return;
      const tie = state.input.tie && !state.input.rest;
      h = insertNote(n, b, t.L, t.g, t.y, at);
      consumed = true;
      hooks.redraw(b.id);
      if (h < 0) return;
      // Silence, note liée (hauteur imposée), ligne rythmique : rien à glisser.
      movable = !b.items[h].r && !t.L.rh && !tie;
      drag = { h, g: t.g, top: t.top, id: e.pointerId, s: b.items[h].s, start: b.items[h].s, fresh: true };
    } else {
      if (t.hit < 0) return;
      h = chainStart(b.items, t.hit);
      if (state.sel !== h || b.items[h].r || t.L.rh) return;
      movable = true;
      consumed = true;
      pushSnapshot(n);
      drag = { h, g: t.g, top: t.top, id: e.pointerId, s: b.items[h].s, start: b.items[h].s, fresh: false };
      moveTo(stepFromY(t.g, t.y));
      audio.previewItem(b, h);
    }
    if (!movable) {
      drag = null;
      return;
    }
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    showTip(pitchName(b.clef, drag.s, b.items[h].a, b.ks), e.clientX, e.clientY);
  });

  /**
   * Met la note du geste à la position `s` et redessine.
   * @param {number} s
   * @returns {boolean} La hauteur a changé.
   */
  function moveTo(s) {
    if (s === drag.s) return false;
    drag.s = s;
    setStep(b, drag.h, s);
    hooks.redraw(b.id);
    return true;
  }

  wrap.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (moveTo(stepFromY(drag.g, e.clientY - drag.top))) audio.previewItem(b, drag.h);
    showTip(pitchName(b.clef, drag.s, b.items[drag.h].a, b.ks), e.clientX, e.clientY);
  });

  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.s !== drag.start) touch(n);
    else if (!drag.fresh) discardSnapshot(n); // touché sans rien changer
    drag = null;
    showTip('');
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // Pendant un glisser, le doigt déplace la note, pas la page.
  wrap.addEventListener(
    'touchmove',
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false },
  );
  wrap.addEventListener('click', (e) => {
    if (consumed) {
      consumed = false;
      return;
    }
    staffTap(n, b, /** @type {MouseEvent} */ (e));
  });
}

/**
 * Change de mode. En passant en Modifier, la note juste avant le curseur est
 * sélectionnée ; en revenant en Écrire, le curseur se place juste après la
 * note qui était sélectionnée : on reprend là où on en était.
 * @param {'write'|'edit'} mode
 */
export function setMode(mode) {
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!b || state.mode === mode) return;
  closeChord();
  if (mode === 'edit') {
    const i = insertIndex(b) - 1;
    state.sel = i >= 0 ? chainStart(b.items, i) : null;
    state.cursor = null;
  } else {
    const after = state.sel != null ? chainEnd(b.items, state.sel) + 1 : null;
    state.cursor = after != null && after < b.items.length ? after : null;
    state.sel = null;
  }
  state.mode = mode;
  hooks.redraw(b.id);
}
