/**
 * @module ui/staff-ui
 * @description
 * Interaction avec un bloc **portée** (ou ligne rythmique) :
 *
 * - en-tête du bloc (clé, mesure, tempo, swing, lecture) ;
 * - **toucher** sur la portée ({@link module:ui/staff-ui~staffTap|staffTap}) : ajout,
 *   sélection, déplacement d'une note ;
 * - **palette** fixée en bas d'écran : valeurs, point, triolet, silence,
 *   liaison, altérations, barres, accord chiffré, navigation, annuler, effacer.
 *
 * ## Deux modes pour chaque bouton de la palette
 *
 * - **Une note est sélectionnée** : le bouton modifie cette note.
 * - **Aucune sélection** : le bouton règle la **prochaine** note ajoutée
 *   (voir {@link module:ui/state~InputSettings|InputSettings}).
 *
 * Toute modification est précédée de `pushSnapshot` (pour pouvoir annuler) et
 * suivie de `touch` (sauvegarde) puis d'un redessin du bloc.
 */

import { esc } from '../util.js';

/**
 * Armures proposées : nombre de dièses (> 0) ou de bémols (< 0), avec les
 * tonalités majeure et mineure correspondantes.
 * @type {Array.<{v: number, label: string}>}
 */
const KEY_SIGS = [
  { v: 0, label: 'Sans armure' },
  ...['Sol / Mi m', 'Ré / Si m', 'La / Fa♯ m', 'Mi / Do♯ m', 'Si / Sol♯ m', 'Fa♯ / Ré♯ m', 'Do♯ / La♯ m'].map(
    (t, i) => ({ v: i + 1, label: `${i + 1}♯ · ${t}` }),
  ),
  ...[
    'Fa / Ré m',
    'Si♭ / Sol m',
    'Mi♭ / Do m',
    'La♭ / Fa m',
    'Ré♭ / Si♭ m',
    'Sol♭ / Mi♭ m',
    'Do♭ / La♭ m',
  ].map((t, i) => ({ v: -(i + 1), label: `${i + 1}♭ · ${t}` })),
];
import { state, app, curNote, blockById, touch } from './state.js';
import { TIME_SIGNATURES } from '../model.js';
import { pitchName } from '../pitch.js';
import { normalizeStaff, resizeEvent, chainStart, chainEnd, singleValue } from '../measure-fit.js';
import { qlen } from '../model.js';
import { staffSvg } from '../render-staff.js';
import { layout, geom, stepFromY, INSERT_GAP } from '../layout.js';
import { pushSnapshot, discardSnapshot } from '../history.js';
import * as audio from '../audio.js';
import { toolsHtml, syncPaletteSpace, updatePlayBtn, playCallbacks } from './common.js';
import { setActive, undo, registerBlockKind } from './blocks.js';
import { isFolded, applyFold, guardFoldedTaps, FOLD_PREVIEW_LINES } from './fold.js';

const pal = /** @type {HTMLElement} */ (document.getElementById('palette'));
const barBar = /** @type {HTMLElement} */ (document.getElementById('barBar'));
const chordBar = /** @type {HTMLElement} */ (document.getElementById('chordBar'));
const chordIn = /** @type {HTMLInputElement} */ (document.getElementById('chordIn'));

/** Glyphes Unicode des boutons de valeur, en mode note et en mode silence. */
const GLYPHS = {
  note: { w: '\u{1D15D}', h: '\u{1D15E}', q: '\u{1D15F}', 8: '\u{1D160}', 16: '\u{1D161}' },
  rest: { w: '\u{1D13B}', h: '\u{1D13C}', q: '\u{1D13D}', 8: '\u{1D13E}', 16: '\u{1D13F}' },
};
/** Noms accessibles des boutons de valeur. */
const LABELS = {
  note: { w: 'Ronde', h: 'Blanche', q: 'Noire', 8: 'Croche', 16: 'Double croche' },
  rest: { w: 'Pause', h: 'Demi-pause', q: 'Soupir', 8: 'Demi-soupir', 16: 'Quart de soupir' },
};

/**
 * Remplit l'élément d'un bloc portée : en-tête, zone SVG, outils.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {HTMLElement} el
 */
export function staffBlockEl(n, b, el) {
  const rh = b.clef === 'rhythm';
  el.innerHTML =
    `<div class="shead"><span class="kind">${rh ? 'Rythme' : 'Portée'}</span>
    ${rh ? '' : `<select data-f="clef" id="c_${esc(b.id)}" aria-label="Clé"><option value="treble">Sol</option><option value="bass">Fa</option></select>`}
    ${rh ? '' : `<select data-f="ks" id="k_${esc(b.id)}" aria-label="Armure">${KEY_SIGS.map((k) => `<option value="${k.v}">${k.label}</option>`).join('')}</select>`}
    <select data-f="time" id="m_${esc(b.id)}" aria-label="Mesure">${TIME_SIGNATURES.map((t) => `<option>${t}</option>`).join('')}</select>
    <label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" data-f="tempo" id="tp_${esc(b.id)}"></label>
    <button type="button" class="chip" data-f="swing" aria-pressed="${!!b.swing}">Swing</button>
    <button type="button" class="playbtn" data-play="${esc(b.id)}">&#9654; Écouter</button></div>
    <div class="staff-wrap" data-staff="${esc(b.id)}"></div>` + toolsHtml();

  const cs = /** @type {HTMLSelectElement|null} */ (el.querySelector('[data-f=clef]'));
  if (cs) {
    cs.value = b.clef;
    cs.onchange = () => {
      pushSnapshot(n);
      b.clef = /** @type {any} */ (cs.value);
      touch(n);
      redrawStaff(b.id);
    };
  }
  const kss = /** @type {HTMLSelectElement|null} */ (el.querySelector('[data-f=ks]'));
  if (kss) {
    kss.value = String(b.ks || 0);
    kss.onchange = () => {
      pushSnapshot(n);
      const v = Number(kss.value);
      if (v) b.ks = v;
      else delete b.ks;
      touch(n);
      redrawStaff(b.id);
    };
  }
  const ms = /** @type {HTMLSelectElement} */ (el.querySelector('[data-f=time]'));
  ms.value = b.time;
  ms.onchange = () => {
    pushSnapshot(n);
    b.time = ms.value;
    refit(b); // tout est recoupé selon la nouvelle mesure
    touch(n);
    redrawStaff(b.id);
  };
  const tp = /** @type {HTMLInputElement} */ (el.querySelector('[data-f=tempo]'));
  tp.value = String(b.tempo);
  tp.onchange = () => {
    const v = Math.max(30, Math.min(300, parseInt(tp.value, 10) || 100));
    tp.value = String(v);
    b.tempo = v;
    touch(n);
  };
  const swb = el.querySelector('[data-f=swing]');
  swb.onclick = () => {
    b.swing = !b.swing;
    swb.setAttribute('aria-pressed', String(b.swing));
    touch(n);
  };
  el.querySelector('[data-play]').onclick = () => {
    // Un bloc réduit s'écoute sans se déplier : on ne l'active pas.
    if (!el.classList.contains('folded')) setActive(b.id);
    audio.playStaff(b, playCallbacks(b.id, redrawStaff));
    updatePlayBtn(b.id);
  };
  const wrap = /** @type {HTMLElement} */ (el.querySelector('.staff-wrap'));
  guardFoldedTaps(wrap, b);
  wrap.addEventListener('click', (e) => staffTap(n, b, /** @type {MouseEvent} */ (e)));
}

/**
 * Redessine le SVG d'un bloc portée (sans effet si `id` n'est pas une portée affichée).
 * La largeur utilisée est mémorisée sur l'élément (`_W`) pour que le
 * hit-testing refasse exactement la même mise en page.
 * @param {string} id
 */
export function redrawStaff(id) {
  const b = blockById(id);
  if (!b || b.type !== 'staff') return;
  const wrap = /** @type {HTMLElement} */ (app.querySelector(`[data-staff="${CSS.escape(id)}"]`));
  if (!wrap) return;
  const W = Math.max(220, wrap.clientWidth || 300);
  const isAct = state.activeId === id;
  const write = isAct && state.mode === 'write';
  if (isAct) clampCursor(b);
  // Nombre de lignes à cette largeur, pour décider de l'affichage réduit.
  const lines = layout(b, W, isAct).systems.length;
  const folded = isFolded(b, lines);
  wrap.innerHTML = staffSvg(b, W, {
    // En mode Écrire, rien n'est sélectionné ; on surligne seulement la note
    // dont on saisit l'accord chiffré.
    sel: isAct ? (write ? (chordTarget ? chordTarget.i : null) : state.sel) : null,
    selEnd: isAct && !write && state.sel != null && b.items[state.sel] ? chainEnd(b.items, state.sel) : null,
    play: audio.isPlaying(id) ? state.playIdx : null,
    cursor: write,
    insertAt: write ? state.cursor : null,
    maxSystems: folded ? FOLD_PREVIEW_LINES : undefined,
  }).svg;
  applyFold(wrap, b, lines, folded);
  wrap._W = W;
  if (isAct) updateStaffPalette();
}

/**
 * Garde le curseur d'insertion dans les bornes (après une suppression ou une
 * annulation, par exemple). `null` = fin de portée.
 * @param {module:model~StaffBlock} b
 */
function clampCursor(b) {
  if (state.cursor != null && (state.cursor < 0 || state.cursor >= b.items.length)) state.cursor = null;
  if (state.sel != null && !b.items[state.sel]) state.sel = null;
}

/**
 * Remet la portée en mesure après une modification (liaisons automatiques aux
 * barres, voir {@link module:measure-fit|measure-fit}) et recale la sélection
 * et le curseur sur les nouveaux index.
 * @param {module:model~StaffBlock} b
 * @returns {{startOf: number[], tupCross: Set.<number>}}
 */
function refit(b) {
  const res = normalizeStaff(b.items, b.time);
  if (state.sel != null) state.sel = res.startOf[state.sel] ?? null;
  if (state.cursor != null) {
    const c = res.startOf[state.cursor];
    state.cursor = c == null || c >= res.items.length ? null : c;
  }
  b.items = res.items;
  return res;
}

/** Message ponctuel affiché dans la ligne d'aide de la palette (refus d'une action). */
let notice = '';
let noticeTimer = null;

/**
 * Affiche un message dans la ligne d'aide pendant quelques secondes.
 * @param {string} text
 */
function flash(text) {
  notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice = '';
    updateStaffPalette();
  }, 3500);
  updateStaffPalette();
}

/**
 * Valeur (durée écrite) de la note logique qui commence en `i` : celle de
 * l'élément s'il est seul, sinon la valeur unique équivalente à la somme de
 * ses morceaux (une ronde coupée en blanche⁀blanche vaut une ronde), à défaut
 * celle du premier morceau.
 * @param {module:model~StaffBlock} b
 * @param {number} i
 * @returns {{d: string, dot: boolean, tup: boolean}}
 */
function logicalValue(b, i) {
  const a = chainStart(b.items, i);
  const z = chainEnd(b.items, i);
  const first = b.items[a];
  if (a === z) return { d: first.d, dot: !!first.dot, tup: !!first.tup };
  let len = 0;
  for (let k = a; k <= z; k++) len += qlen(b.items[k]);
  const one = singleValue(len, true);
  return one ? { ...one, tup: false } : { d: first.d, dot: !!first.dot, tup: false };
}

/**
 * Mode Modifier : change la durée de la note sélectionnée, en gardant la
 * suite à sa place ({@link module:measure-fit.resizeEvent|resizeEvent}).
 * @param {function({d: string, dot: boolean, tup: boolean}): {d: string, dot: boolean, tup: boolean}} change
 * @returns {boolean} `false` hors mode Modifier ou sans sélection.
 */
function resizeSel(change) {
  if (state.mode !== 'edit') return false;
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null || !b.items[state.sel]) return false;
  const value = change(logicalValue(b, state.sel));
  const res = resizeEvent(b.items, b.time, state.sel, value);
  if (value.tup && res.tupCross.has(res.index)) {
    flash('Un triolet ne peut pas passer la barre de mesure');
    return true;
  }
  pushSnapshot(n);
  b.items = res.items;
  state.sel = res.index;
  touch(n);
  redrawStaff(b.id);
  audio.previewItem(b, state.sel);
  return true;
}

/**
 * Position d'insertion effective : index de l'élément devant lequel la
 * prochaine note arrivera (`items.length` = à la fin).
 * @param {module:model~StaffBlock} b
 * @returns {number}
 */
function insertIndex(b) {
  return state.cursor != null ? state.cursor : b.items.length;
}

/**
 * Note logique à laquelle s'appliquent les barres et l'accord chiffré : la
 * note sélectionnée en mode Modifier, la note juste avant le curseur en mode
 * Écrire (à défaut, la dernière ou la première). Renvoie son premier morceau.
 * @param {module:model~StaffBlock} b
 * @returns {number} -1 si la portée est vide.
 */
function targetIndex(b) {
  if (!b.items.length) return -1;
  if (state.mode === 'edit') return state.sel != null ? state.sel : b.items.length - 1;
  return chainStart(b.items, Math.max(0, insertIndex(b) - 1));
}

/**
 * Insère une note (ou un silence) avec les réglages de saisie, à la position `at`.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g Géométrie de la ligne touchée.
 * @param {number} y Ordonnée du toucher (hauteur de la note).
 * @param {number} at Index d'insertion.
 */
function insertNote(n, b, L, g, y, at) {
  const inp = state.input;
  /** @type {module:model~StaffItem} */
  const it = { d: inp.d };
  if (inp.dot) it.dot = true;
  if (inp.tup) it.tup = 3;
  pushSnapshot(n);
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
  const before = b.items.slice();
  const cursorBefore = state.cursor;
  b.items.splice(at, 0, it);
  // Le curseur reste juste après la note insérée : on peut enchaîner.
  if (state.cursor != null) state.cursor = at + 1;
  const res = refit(b);
  const idx = res.startOf[at];
  if (it.tup && res.tupCross.has(idx)) {
    // Refus : un triolet ne peut pas être coupé par une barre.
    b.items = before;
    state.cursor = cursorBefore;
    discardSnapshot(n);
    flash('Un triolet ne peut pas passer la barre de mesure');
    return;
  }
  // Réglages « à usage unique » consommés ; triolet et silence restent actifs.
  inp.acc = null;
  inp.rs = false;
  inp.tie = false;
  touch(n);
  audio.previewItem(b, idx);
}

/**
 * Gère un toucher sur la portée.
 *
 * 1. Active le bloc s'il ne l'était pas (et ferme le clavier éventuel).
 * 2. Refait la mise en page avec la même largeur et le même curseur que le
 *    rendu, puis convertit les coordonnées : ligne = `floor(y / hauteurDeLigne)`,
 *    élément = celui dont l'intervalle `[x0, x1)` contient x, hauteur =
 *    {@link module:layout.stepFromY|stepFromY}.
 * 3. **Mode Écrire** (comme le mode saisie « N » de MuseScore) :
 *    - **zone bleue** (au curseur, ou en fin de portée) : insère une note avec
 *      les réglages de saisie, à la hauteur touchée ;
 *    - **une note** : place le curseur juste avant elle (rien n'est modifié) ;
 *    - **fin de portée**, quand le curseur est au milieu : y ramène le curseur.
 * 4. **Mode Modifier** :
 *    - **la note déjà sélectionnée** : la déplace à la hauteur touchée ;
 *    - **une autre note** : la sélectionne ;
 *    - ailleurs : désélectionne.
 *
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {MouseEvent} e
 */
function staffTap(n, b, e) {
  const wrap = /** @type {HTMLElement} */ (e.currentTarget);
  const r = wrap.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  if (state.activeId !== b.id) {
    setActive(b.id);
    const ae = /** @type {HTMLElement} */ (document.activeElement);
    if (ae && ae.blur && ae !== document.body) ae.blur();
  }
  clampCursor(b);
  const write = state.mode === 'write';
  const L = layout(b, wrap._W || wrap.clientWidth, true, write ? state.cursor : null);
  const si = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
  const g = geom(L, si);
  const hit = b.items.findIndex((it, i) => L.pos[i].sys === si && x >= L.pos[i].x0 && x < L.pos[i].x1);
  const inAppend = L.appendX != null && si === L.appendSys && x >= L.appendX - 14;

  if (write) {
    if (L.insertX != null && si === L.insertSys && Math.abs(x - L.insertX) <= INSERT_GAP / 2 + 2) {
      insertNote(n, b, L, g, y, state.cursor);
    } else if (hit >= 0) {
      state.cursor = chainStart(b.items, hit); // jamais au milieu d'une note coupée
    } else if (inAppend) {
      if (state.cursor != null) state.cursor = null;
      else insertNote(n, b, L, g, y, b.items.length);
    }
  } else if (hit >= 0) {
    const h = chainStart(b.items, hit); // une note coupée se sélectionne en entier
    const it = b.items[h];
    if (state.sel === h && !it.r && !L.rh) {
      const s = stepFromY(g, y);
      if (s !== it.s) {
        pushSnapshot(n);
        it.s = s;
        // Une liaison relie deux notes de même hauteur : déplacer une note
        // rompt la liaison qui y arrive, et entraîne la note à laquelle elle est liée.
        const prev = b.items[h - 1];
        if (prev && prev.tie) delete prev.tie;
        for (let k = h; b.items[k] && b.items[k].tie && b.items[k + 1] && !b.items[k + 1].r; k++)
          b.items[k + 1].s = s;
        touch(n);
      }
    } else {
      state.sel = h;
    }
    audio.previewItem(b, h);
  } else {
    state.sel = null;
  }
  redrawStaff(b.id);
}

/**
 * Change de mode. En passant en Modifier, la note juste avant le curseur est
 * sélectionnée ; en revenant en Écrire, le curseur se place juste après la
 * note qui était sélectionnée : on reprend là où on en était.
 * @param {'write'|'edit'} mode
 */
function setMode(mode) {
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
  redrawStaff(b.id);
}

/**
 * Affiche ou cache la palette de portée.
 * @param {boolean} on
 */
export function showStaffPalette(on) {
  if (!on) {
    closeChord();
    barBar.hidden = true;
  }
  pal.hidden = !on;
  if (on) updateStaffPalette();
}

/**
 * Met la palette en accord avec la sélection ou les réglages de saisie :
 * boutons enfoncés, glyphes (note ou silence), message d'aide.
 */
function updateStaffPalette() {
  const b = blockById(state.activeId);
  if (!b || b.type !== 'staff') return;
  const inp = state.input;
  const rh = b.clef === 'rhythm';
  const editing = state.mode === 'edit';
  // En mode Écrire, la palette montre toujours les réglages de la prochaine note.
  // Note coupée par une barre : on affiche sa valeur entière (une ronde, pas une blanche).
  const it =
    editing && state.sel != null && b.items[state.sel]
      ? { ...b.items[state.sel], ...logicalValue(b, state.sel) }
      : null;
  const last = b.items[b.items.length - 1];
  pal
    .querySelectorAll('[data-mode]')
    .forEach((x) =>
      x.setAttribute('aria-checked', String(/** @type {HTMLElement} */ (x).dataset.mode === state.mode)),
    );
  pal
    .querySelector('[data-act=del]')
    .setAttribute(
      'aria-label',
      editing ? 'Effacer la note sélectionnée' : 'Effacer la note avant le curseur',
    );
  const d = it ? it.d : inp.d;
  const dot = it ? !!it.dot : inp.dot;
  const rest = it ? !!it.r : inp.rest;
  const acc = it ? (it.a ?? null) : inp.acc;
  const tup = it ? !!it.tup : inp.tup;
  const tie = it ? !!it.tie : inp.tie;
  const mode = rest ? 'rest' : 'note';

  pal.querySelectorAll('[data-dur]').forEach((x) => {
    const k = x.dataset.dur;
    x.setAttribute('aria-pressed', String(k === d));
    x.textContent = GLYPHS[mode][k];
    x.setAttribute('aria-label', LABELS[mode][k]);
    x.classList.toggle('restmode', rest);
  });
  const press = (sel, v) => pal.querySelector(sel).setAttribute('aria-pressed', String(v));
  press('[data-act=dot]', dot);
  press('[data-act=rest]', rest);
  press('[data-act=tup]', tup);
  press('[data-act=tie]', tie);
  press('[data-act=bar]', !barBar.hidden);
  pal.querySelectorAll('[data-acc]').forEach((x) => {
    x.hidden = rh;
    x.setAttribute('aria-pressed', String(acc != null && String(acc) === x.dataset.acc));
  });
  // État des boutons du sous-menu des barres.
  const target = b.items[targetIndex(b)] || last;
  barBar.querySelectorAll('[data-bar]').forEach((x) => {
    const t = x.dataset.bar;
    const on = t === 'rs' ? (it ? !!it.rs : inp.rs) : target ? t !== 'none' && target.bar === t : false;
    x.setAttribute('aria-pressed', String(on));
  });

  // Message d'aide, du plus spécifique au plus général.
  const info = document.getElementById('palInfo');
  if (it) {
    info.textContent = it.r
      ? 'Silence sélectionné'
      : rh
        ? 'Note sélectionnée'
        : pitchName(b.clef, it.s, it.a, b.ks) + ' · touche plus haut ou plus bas pour la déplacer';
  } else if (editing) info.textContent = 'Touche une note pour la modifier';
  else if (state.cursor != null)
    info.textContent = `Insertion avant la note ${state.cursor + 1} · touche la zone bleue`;
  else if (last && last.bar === 'final')
    info.textContent = 'Motif terminé · retire la barre de fin pour continuer';
  else if (inp.tie) info.textContent = 'Liaison · la prochaine note prolonge la précédente';
  else if (inp.rs) info.textContent = 'La prochaine note ouvrira une reprise';
  else if (rest)
    info.textContent = 'Mode silence (' + LABELS.rest[d].toLowerCase() + ') · touche la zone bleue';
  else if (inp.tup) info.textContent = 'Mode triolet · touche la zone bleue';
  else
    info.textContent = rh
      ? 'Touche la zone bleue pour ajouter'
      : 'Touche la portée dans la zone bleue pour ajouter';
  if (notice) info.textContent = notice;
  syncPaletteSpace();
}

/**
 * Applique `fn` à la note sélectionnée (avec annulation, sauvegarde, redessin).
 * @param {function(module:model~StaffItem, module:model~StaffBlock)} fn
 * @returns {boolean} `false` s'il n'y a pas de sélection (le bouton agit alors sur la saisie).
 */
function withSel(fn) {
  if (state.mode !== 'edit') return false; // en mode Écrire, la palette règle la saisie
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null || !b.items[state.sel]) return false;
  pushSnapshot(n);
  fn(b.items[state.sel], b);
  refit(b);
  touch(n);
  redrawStaff(b.id);
  return true;
}

/**
 * Bascule la liaison sur la note sélectionnée. Si la note suivante existe,
 * elle prend la même hauteur (une liaison de prolongation relie deux notes
 * identiques) et perd son altération (la hauteur est portée par la liaison).
 * Sans sélection : la prochaine note ajoutée sera liée à la dernière.
 */
function toggleTie() {
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  const done = withSel((first, blk) => {
    // La liaison de l'utilisateur part de la fin de la note logique.
    const it = blk.items[chainEnd(blk.items, state.sel)];
    if (it.r) return;
    if (it.tie && !it.auto) {
      delete it.tie;
      return;
    }
    if (it.auto) return;
    it.tie = true;
    const next = blk.items[chainEnd(blk.items, state.sel) + 1];
    if (next && !next.r) {
      next.s = it.s;
      delete next.a;
    }
  });
  if (!done) {
    const prev = b.items[insertIndex(b) - 1];
    if (prev && !prev.r) state.input.tie = !state.input.tie;
    updateStaffPalette();
  } else {
    audio.previewItem(b, state.sel);
  }
}

/**
 * Applique un choix du sous-menu des barres.
 * @param {string} type `'single'|'double'|'final'|'rep'|'rs'|'none'`
 */
function applyBar(type) {
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!n || !b) return;
  const tgt = targetIndex(b);
  if (type === 'rs') {
    // Le début de reprise se place AVANT une note : sur la sélection, ou sur la prochaine note.
    if (state.mode === 'edit' && state.sel != null) {
      pushSnapshot(n);
      const it = b.items[state.sel];
      if (it.rs) delete it.rs;
      else it.rs = true;
      touch(n);
    } else state.input.rs = !state.input.rs;
  } else {
    if (tgt < 0) return;
    pushSnapshot(n);
    const it = b.items[chainEnd(b.items, tgt)]; // la barre suit la fin de la note logique
    if (type === 'none') {
      delete it.bar;
      delete it.rs;
    } else if (it.bar === type) delete it.bar;
    else it.bar = /** @type {any} */ (type);
    refit(b);
    touch(n);
  }
  barBar.hidden = true;
  redrawStaff(b.id);
  updateStaffPalette();
}

// ---------- Câblage de la palette (une seule fois, au chargement du module) ----------
pal.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('button');
  if (!btn) return;
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!n || !b || b.type !== 'staff') return;
  const inp = state.input;

  if (btn.dataset.mode) {
    setMode(/** @type {'write'|'edit'} */ (btn.dataset.mode));
    return;
  }
  if (btn.dataset.bar) {
    applyBar(btn.dataset.bar);
    return;
  }
  if (btn.dataset.dur) {
    const d = /** @type {any} */ (btn.dataset.dur);
    if (!resizeSel((v) => ({ ...v, d }))) {
      inp.d = d;
      updateStaffPalette();
    }
    return;
  }
  if (btn.hasAttribute('data-acc')) {
    const a = /** @type {number} */ (Number(btn.dataset.acc));
    if (
      withSel((it) => {
        if (it.r) return;
        if (it.a === a) delete it.a;
        else it.a = a;
      })
    )
      audio.previewItem(b, state.sel);
    else {
      inp.acc = inp.acc === a ? null : a;
      updateStaffPalette();
    }
    return;
  }
  switch (btn.dataset.act) {
    case 'bar':
      barBar.hidden = !barBar.hidden;
      if (!barBar.hidden) closeChord();
      updateStaffPalette();
      return;
    case 'dot':
      if (!resizeSel((v) => ({ ...v, dot: !v.dot }))) {
        inp.dot = !inp.dot;
        updateStaffPalette();
      }
      return;
    case 'tup':
      if (!resizeSel((v) => ({ ...v, tup: !v.tup }))) {
        inp.tup = !inp.tup;
        updateStaffPalette();
      }
      return;
    case 'tie':
      toggleTie();
      return;
    case 'rest':
      if (
        !withSel((it, blk) => {
          // Toute la note logique change (tous ses morceaux).
          const toNote = !!it.r;
          for (let k = state.sel; k <= chainEnd(blk.items, state.sel); k++) {
            const p = blk.items[k];
            if (toNote) {
              delete p.r;
              if (blk.clef !== 'rhythm') p.s = it.s ?? 4;
              if (p.auto) p.tie = true;
            } else {
              p.r = true;
              delete p.tie;
              delete p.a;
            }
          }
        })
      ) {
        inp.rest = !inp.rest;
        updateStaffPalette();
      }
      return;
    case 'prev':
    case 'next':
      if (!b.items.length) return;
      if (state.mode === 'write') {
        // Le curseur va de 0 (avant la 1re note) à items.length (fin, noté null).
        // On saute d'une note logique à l'autre (jamais au milieu d'une note coupée).
        const cur = insertIndex(b);
        const c =
          btn.dataset.act === 'prev'
            ? cur > 0
              ? chainStart(b.items, cur - 1)
              : 0
            : cur < b.items.length
              ? chainEnd(b.items, cur) + 1
              : cur;
        state.cursor = c >= b.items.length ? null : c;
        redrawStaff(b.id);
        return;
      }
      if (state.sel == null)
        state.sel = chainStart(b.items, btn.dataset.act === 'prev' ? b.items.length - 1 : 0);
      else if (btn.dataset.act === 'prev') state.sel = chainStart(b.items, Math.max(0, state.sel - 1));
      else {
        const nx = chainEnd(b.items, state.sel) + 1;
        if (nx < b.items.length) state.sel = nx;
      }
      redrawStaff(b.id);
      audio.previewItem(b, state.sel);
      return;
    case 'undo':
      undo();
      return;
    case 'del': {
      if (!b.items.length) return;
      // Écrire : efface la note juste avant le curseur (comme la touche ⌫).
      // Modifier : efface la note sélectionnée (à défaut, la dernière).
      const write = state.mode === 'write';
      const last = write
        ? insertIndex(b) - 1
        : state.sel != null
          ? chainEnd(b.items, state.sel)
          : b.items.length - 1;
      if (last < 0) return;
      const i = chainStart(b.items, last); // une note coupée s'efface en entier
      pushSnapshot(n);
      b.items.splice(i, last - i + 1);
      if (write && state.cursor != null) state.cursor = i;
      // Une liaison qui menait à la note supprimée n'a plus de sens.
      if (b.items[i - 1] && b.items[i - 1].tie && (!b.items[i] || b.items[i].r)) delete b.items[i - 1].tie;
      if (state.sel != null)
        state.sel = b.items.length ? chainStart(b.items, Math.min(i, b.items.length - 1)) : null;
      if (state.cursor != null && state.cursor >= b.items.length) state.cursor = null;
      refit(b);
      touch(n);
      redrawStaff(b.id);
      return;
    }
    case 'chord':
      if (b.items.length) openChord(b);
      return;
    default:
  }
});
document.getElementById('palDone').onclick = () => setActive(null);

// ---------- Accord chiffré au-dessus d'une note ----------
/** @type {{b: module:model~StaffBlock, i: number}|null} */
let chordTarget = null;

/**
 * Ouvre le champ de saisie d'accord pour la note sélectionnée (ou la dernière).
 * @param {module:model~StaffBlock} b
 */
function openChord(b) {
  barBar.hidden = true;
  chordTarget = { b, i: targetIndex(b) };
  if (state.mode === 'edit' && state.sel == null) state.sel = chordTarget.i;
  redrawStaff(b.id); // surligne la note visée
  chordIn.value = b.items[chordTarget.i].c || '';
  chordBar.hidden = false;
  updateStaffPalette();
  chordIn.focus();
}

/** Ferme le champ d'accord sans appliquer. */
function closeChord() {
  chordBar.hidden = true;
  chordTarget = null;
}

/** Applique l'accord saisi (vide = suppression), 16 caractères au plus. */
function applyChord() {
  if (!chordTarget) return;
  const n = curNote();
  const { b, i } = chordTarget;
  const it = b.items[i];
  if (it && n) {
    pushSnapshot(n);
    const v = chordIn.value.trim().slice(0, 16);
    if (v) it.c = v;
    else delete it.c;
    touch(n);
  }
  closeChord();
  chordIn.blur();
  redrawStaff(b.id);
  updateStaffPalette();
}
document.getElementById('chordOk').onclick = applyChord;
document.getElementById('chordCancel').onclick = () => {
  closeChord();
  chordIn.blur();
  updateStaffPalette();
};
chordIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    applyChord();
  }
});

registerBlockKind('staff', { build: staffBlockEl, redraw: redrawStaff, showPalette: showStaffPalette });
