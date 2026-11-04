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
import { state, app, curNote, blockById, touch } from './state.js';
import { TIME_SIGNATURES } from '../model.js';
import { pitchName } from '../pitch.js';
import { staffSvg } from '../render-staff.js';
import { layout, geom, stepFromY } from '../layout.js';
import { pushSnapshot } from '../history.js';
import * as audio from '../audio.js';
import { toolsHtml, setActive, syncPaletteSpace, undo, updatePlayBtn, playCallbacks } from './views.js';

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
  const ms = /** @type {HTMLSelectElement} */ (el.querySelector('[data-f=time]'));
  ms.value = b.time;
  ms.onchange = () => {
    pushSnapshot(n);
    b.time = ms.value;
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
    setActive(b.id);
    audio.playStaff(b, playCallbacks(b.id, redrawStaff));
    updatePlayBtn(b.id);
  };
  el.querySelector('.staff-wrap').addEventListener('click', (e) =>
    staffTap(n, b, /** @type {MouseEvent} */ (e)),
  );
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
  wrap.innerHTML = staffSvg(b, W, {
    sel: isAct ? state.sel : null,
    play: audio.isPlaying(id) ? state.playIdx : null,
    cursor: isAct,
  }).svg;
  wrap._W = W;
  if (isAct) updateStaffPalette();
}

/**
 * Gère un toucher sur la portée.
 *
 * 1. Active le bloc s'il ne l'était pas (et ferme le clavier éventuel).
 * 2. Refait la mise en page avec la même largeur que le rendu, puis convertit
 *    les coordonnées : ligne = `floor(y / hauteurDeLigne)`, élément = celui
 *    dont l'intervalle `[x0, x1)` contient x, hauteur = {@link module:layout.stepFromY|stepFromY}.
 * 3. Selon la cible :
 *    - **un élément déjà sélectionné** : déplace la note à la hauteur touchée ;
 *    - **un autre élément** : le sélectionne ;
 *    - **la zone d'ajout** (après la dernière note) : ajoute une note avec les
 *      réglages de saisie ;
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
  const L = layout(b, wrap._W || wrap.clientWidth, true);
  const si = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
  const g = geom(L, si);
  const hit = b.items.findIndex((it, i) => L.pos[i].sys === si && x >= L.pos[i].x0 && x < L.pos[i].x1);
  const inp = state.input;

  if (hit >= 0) {
    const it = b.items[hit];
    if (state.sel === hit && !it.r && !L.rh) {
      const s = stepFromY(g, y);
      if (s !== it.s) {
        pushSnapshot(n);
        it.s = s;
        // Une liaison relie deux notes de même hauteur : déplacer une note
        // rompt la liaison qui y arrive, et entraîne la note à laquelle elle est liée.
        const prev = b.items[hit - 1];
        if (prev && prev.tie) delete prev.tie;
        for (let k = hit; b.items[k] && b.items[k].tie && b.items[k + 1] && !b.items[k + 1].r; k++)
          b.items[k + 1].s = s;
        touch(n);
      }
      audio.previewItem(b, hit);
    } else {
      state.sel = hit;
      audio.previewItem(b, hit);
    }
  } else if (L.appendX != null && si === L.appendSys && x >= L.appendX - 14) {
    pushSnapshot(n);
    /** @type {module:model~StaffItem} */
    const it = { d: inp.d };
    if (inp.dot) it.dot = true;
    if (inp.tup) it.tup = 3;
    const last = b.items[b.items.length - 1];
    if (inp.rest) {
      it.r = true;
    } else if (inp.tie && last && !last.r) {
      // Note liée : même hauteur que la précédente, la position touchée est ignorée.
      last.tie = true;
      if (!L.rh) it.s = last.s;
    } else if (!L.rh) {
      it.s = stepFromY(g, y);
      if (inp.acc != null) it.a = inp.acc;
    }
    if (inp.rs) it.rs = true;
    b.items.push(it);
    // Réglages « à usage unique » consommés ; triolet et silence restent actifs.
    inp.acc = null;
    inp.rs = false;
    inp.tie = false;
    state.sel = null;
    touch(n);
    audio.previewItem(b, b.items.length - 1);
  } else {
    state.sel = null;
  }
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
  const it = state.sel != null ? b.items[state.sel] : null;
  const last = b.items[b.items.length - 1];
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
  const target = it || last;
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
        : pitchName(b.clef, it.s, it.a) + ' · touche plus haut ou plus bas pour la déplacer';
  } else if (last && last.bar === 'final')
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
  syncPaletteSpace();
}

/**
 * Applique `fn` à la note sélectionnée (avec annulation, sauvegarde, redessin).
 * @param {function(module:model~StaffItem, module:model~StaffBlock)} fn
 * @returns {boolean} `false` s'il n'y a pas de sélection (le bouton agit alors sur la saisie).
 */
function withSel(fn) {
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null || !b.items[state.sel]) return false;
  pushSnapshot(n);
  fn(b.items[state.sel], b);
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
  const done = withSel((it, blk) => {
    if (it.r) return;
    if (it.tie) {
      delete it.tie;
      return;
    }
    it.tie = true;
    const next = blk.items[state.sel + 1];
    if (next && !next.r) {
      next.s = it.s;
      delete next.a;
    }
  });
  if (!done) {
    const last = b.items[b.items.length - 1];
    if (last && !last.r) state.input.tie = !state.input.tie;
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
  const tgt = state.sel != null ? state.sel : b.items.length - 1;
  if (type === 'rs') {
    // Le début de reprise se place AVANT une note : sur la sélection, ou sur la prochaine note.
    if (state.sel != null) {
      pushSnapshot(n);
      const it = b.items[state.sel];
      if (it.rs) delete it.rs;
      else it.rs = true;
      touch(n);
    } else state.input.rs = !state.input.rs;
  } else {
    if (tgt < 0) return;
    pushSnapshot(n);
    const it = b.items[tgt];
    if (type === 'none') {
      delete it.bar;
      delete it.rs;
    } else if (it.bar === type) delete it.bar;
    else it.bar = /** @type {any} */ (type);
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

  if (btn.dataset.bar) {
    applyBar(btn.dataset.bar);
    return;
  }
  if (btn.dataset.dur) {
    const d = /** @type {any} */ (btn.dataset.dur);
    if (
      withSel((it) => {
        it.d = d;
      })
    )
      audio.previewItem(b, state.sel);
    else {
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
      if (
        !withSel((it) => {
          if (it.dot) delete it.dot;
          else it.dot = true;
        })
      ) {
        inp.dot = !inp.dot;
        updateStaffPalette();
      }
      return;
    case 'tup':
      if (
        !withSel((it) => {
          if (it.tup) delete it.tup;
          else it.tup = 3;
        })
      ) {
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
          if (it.r) {
            delete it.r;
            if (blk.clef !== 'rhythm') it.s = it.s ?? 4;
          } else {
            it.r = true;
            delete it.tie;
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
      if (state.sel == null) state.sel = btn.dataset.act === 'prev' ? b.items.length - 1 : 0;
      else
        state.sel = Math.max(
          0,
          Math.min(b.items.length - 1, state.sel + (btn.dataset.act === 'prev' ? -1 : 1)),
        );
      redrawStaff(b.id);
      audio.previewItem(b, state.sel);
      return;
    case 'undo':
      undo();
      return;
    case 'del': {
      if (!b.items.length) return;
      pushSnapshot(n);
      const i = state.sel != null ? state.sel : b.items.length - 1;
      b.items.splice(i, 1);
      // Une liaison qui menait à la note supprimée n'a plus de sens.
      if (b.items[i - 1] && b.items[i - 1].tie && (!b.items[i] || b.items[i].r)) delete b.items[i - 1].tie;
      if (state.sel != null) state.sel = b.items.length ? Math.min(i, b.items.length - 1) : null;
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
  chordTarget = { b, i: state.sel != null ? state.sel : b.items.length - 1 };
  if (state.sel == null) {
    state.sel = chordTarget.i;
    redrawStaff(b.id);
  }
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
