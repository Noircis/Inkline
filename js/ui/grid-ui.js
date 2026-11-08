/**
 * @module ui/grid-ui
 * @description
 * Interaction avec un bloc **grille d'accords** :
 *
 * - en-tête (tonalité, mesure, style, tempo, iReal, lecture) ;
 * - panneau **iReal Pro** : ouvrir/copier le lien, importer un lien ou un fichier ;
 * - sélection d'une mesure par toucher ;
 * - **palette** : champ de saisie des accords, repères de structure, navigation.
 *
 * ## Saisie rapide
 *
 * Le champ met à jour la mesure **à chaque frappe** (aperçu en direct). Entrée
 * (ou ↵) valide et passe à la mesure suivante, en en créant une au besoin.
 * Le caractère `|` permet de remplir plusieurs mesures d'un coup ; il n'est
 * interprété qu'à la validation, pour ne pas créer de mesures pendant la frappe.
 */

import { state, app, curNote, blockById, touch } from './state.js';
import { esc } from '../util.js';
import { TIME_SIGNATURES } from '../model.js';
import { chordOk } from '../chords.js';
import { STYLES, KEYS, SECTIONS, keyLabel, gridTokens, measureText, gridHtml } from '../grid.js';
import { toIRealLink, parseIRealAll } from '../ireal.js';
import { pushSnapshot } from '../history.js';
import { sanitizeBlock } from '../sanitize.js';
import * as audio from '../audio.js';
import { toolsHtml, syncPaletteSpace, updatePlayBtn, playCallbacks, readFile } from './common.js';
import { setActive, undo, registerBlockKind } from './blocks.js';
import { isFolded, applyFold, guardFoldedTaps, FOLD_PREVIEW_LINES } from './fold.js';
import { renderScreen } from './nav.js';

/** Mesures par ligne de grille. */
const GRID_COLS = 4;

const gpal = /** @type {HTMLElement} */ (document.getElementById('gpal'));
const gin = /** @type {HTMLInputElement} */ (document.getElementById('gIn'));

/**
 * HTML d'un bloc grille : en-tête de réglages, panneau iReal (replié), zone de la grille, outils.
 * @param {module:model~GridBlock} b
 * @returns {string}
 */
function gridBlockHtml(b) {
  const id = esc(b.id);
  const keyOptions =
    KEYS.map((k) => `<option value="${k}">${keyLabel(k)}</option>`).join('') +
    KEYS.map((k) => `<option value="${k}-">${keyLabel(k + '-')}</option>`).join('');
  // Un style importé absent de la liste y est ajouté, pour ne pas le perdre.
  const styles = STYLES.includes(b.style) ? STYLES : [b.style, ...STYLES];
  return (
    `<div class="shead"><span class="kind">Grille</span>
    <select data-f="key" aria-label="Tonalité">${keyOptions}</select>
    <select data-f="time" aria-label="Mesure">${TIME_SIGNATURES.map((t) => `<option>${t}</option>`).join('')}</select>
    <select data-f="style" aria-label="Style">${styles.map((st) => `<option>${esc(st)}</option>`).join('')}</select>
    <label class="tempo"><span class="mus">&#x1D15F;</span>=<input type="number" inputmode="numeric" min="30" max="300" data-f="tempo" aria-label="Tempo"></label>
    <button type="button" class="chip" data-f="ireal" aria-expanded="false">iReal</button>
    <button type="button" class="playbtn" data-play="${id}">&#9654; Écouter</button></div>
    <div class="irealbox" hidden>
      <div class="ir-actions"><a class="btn" data-ir="open" href="#">Ouvrir dans iReal Pro</a><button class="btn" type="button" data-ir="copy">Copier le lien</button></div>
      <label class="ir-lbl" for="ir_${id}">Importer depuis iReal Pro : colle un lien <code>irealb://</code> (Partager &gt; iReal Pro format)</label>
      <textarea id="ir_${id}" rows="2" placeholder="irealb://…" spellcheck="false"></textarea>
      <div class="ir-actions"><button class="btn primary" type="button" data-ir="import">Remplacer cette grille</button><label class="btn" for="irf_${id}">Ouvrir un fichier</label><input type="file" id="irf_${id}" accept=".html,.htm,.txt,text/html,text/plain" hidden></div>
      <div class="status ir-msg"></div>
    </div>
    <div class="gridwrap" data-grid="${id}"></div>` + toolsHtml()
  );
}

/**
 * Branche les réglages de l'en-tête (tonalité, mesure, style, tempo) et le bouton Écouter.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindGridSettings(n, b, el) {
  /** @param {string} k */
  const field = (k) => /** @type {HTMLInputElement} */ (el.querySelector(`[data-f=${k}]`));
  // Tonalité, mesure, style : même traitement (annulable, sauvegardé).
  ['key', 'time', 'style'].forEach((k) => {
    field(k).value = b[k];
    field(k).onchange = () => {
      pushSnapshot(n);
      b[k] = field(k).value;
      touch(n);
    };
  });
  const tempo = field('tempo');
  tempo.value = String(b.tempo);
  tempo.onchange = () => {
    const v = Math.max(30, Math.min(300, parseInt(tempo.value, 10) || 120));
    tempo.value = String(v);
    b.tempo = v;
    touch(n);
  };
  el.querySelector('[data-play]').onclick = () => {
    // Un bloc réduit s'écoute sans se déplier : on ne l'active pas.
    if (!el.classList.contains('folded')) setActive(b.id);
    audio.playGrid(b, playCallbacks(b.id, redrawGrid));
    updatePlayBtn(b.id);
  };
}

/**
 * Remplace le contenu d'une grille par le premier morceau iReal trouvé dans `txt`.
 * Le morceau passe par la validation, comme toute donnée importée.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {string} txt Lien ou contenu de fichier.
 * @param {Element} msg Zone de message du panneau.
 */
function importIntoGrid(n, b, txt, msg) {
  const songs = parseIRealAll(txt);
  if (!songs.length) {
    msg.textContent = 'Aucun morceau iReal trouvé. Le lien doit commencer par irealb:// ou irealbook://.';
    return;
  }
  const song = songs[0];
  pushSnapshot(n);
  const clean = sanitizeBlock({
    ...b,
    type: 'grid',
    time: song.time,
    key: song.key,
    style: song.style,
    tempo: song.tempo || b.tempo,
    measures: song.measures,
  });
  Object.assign(b, {
    time: clean.time,
    key: clean.key,
    style: clean.style,
    tempo: clean.tempo,
    measures: clean.measures,
  });
  if (!n.title.trim()) n.title = song.title.slice(0, 200);
  touch(n);
  state.sel = null;
  renderScreen({ keepScroll: true });
  // Le bloc a été recréé par le re-rendu : on écrit dans sa nouvelle zone de message.
  const newMsg = app.querySelector(`[data-block="${CSS.escape(b.id)}"] .ir-msg`);
  if (newMsg) {
    newMsg.textContent =
      `« ${song.title} » importé (${song.measures.length} mesures)` +
      (songs.length > 1
        ? `. ${songs.length - 1} autre(s) morceau(x) ignoré(s) : importe la playlist depuis les Options.`
        : '.');
  }
}

/**
 * Branche le panneau iReal : ouvrir dans iReal Pro, copier le lien, importer.
 * Le lien est recalculé au moment du clic : la grille a pu changer depuis
 * l'ouverture du panneau.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindIRealPanel(n, b, el) {
  const toggle = el.querySelector('[data-f=ireal]');
  const box = /** @type {HTMLElement} */ (el.querySelector('.irealbox'));
  const msg = el.querySelector('.ir-msg');
  const textarea = /** @type {HTMLTextAreaElement} */ (el.querySelector('textarea'));
  const openLink = /** @type {HTMLAnchorElement} */ (el.querySelector('[data-ir=open]'));
  const link = () => toIRealLink(n.title || 'Sans titre', b);

  toggle.onclick = () => {
    box.hidden = !box.hidden;
    toggle.setAttribute('aria-expanded', String(!box.hidden));
    if (!box.hidden) openLink.href = link();
  };
  openLink.addEventListener('click', () => {
    openLink.href = link();
  });
  el.querySelector('[data-ir=copy]').onclick = () => {
    const l = link();
    // Presse-papiers refusé (vieux navigateur, permission) : on sélectionne le lien pour une copie manuelle.
    const fallback = () => {
      textarea.value = l;
      textarea.select();
      msg.textContent = 'Copie bloquée : le lien est sélectionné ci-dessus, copie-le à la main.';
    };
    try {
      navigator.clipboard.writeText(l).then(() => {
        msg.textContent = "Lien copié. Ouvre-le sur ce téléphone pour l'importer dans iReal Pro.";
      }, fallback);
    } catch (e) {
      fallback();
    }
  };
  el.querySelector('[data-ir=import]').onclick = () => importIntoGrid(n, b, textarea.value, msg);
  el.querySelector('input[type=file]').onchange = (e) =>
    readFile(e, (text) => importIntoGrid(n, b, text, msg));
}

/**
 * Branche la sélection d'une mesure (ou l'ajout via la cellule « + »).
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function bindMeasureSelection(n, b, el) {
  const wrap = /** @type {HTMLElement} */ (el.querySelector('.gridwrap'));
  guardFoldedTaps(wrap, b);
  wrap.addEventListener('click', (e) => {
    const cell = /** @type {HTMLElement} */ (e.target).closest('[data-gm]');
    if (!cell) return;
    if (state.activeId !== b.id) setActive(b.id);
    if (cell.dataset.gm === 'add') {
      pushSnapshot(n);
      b.measures.push({ ch: [] });
      touch(n);
      state.sel = b.measures.length - 1;
    } else {
      state.sel = Number(cell.dataset.gm);
    }
    loadInput(b);
    redrawGrid(b.id);
    gin.focus();
  });
}

/**
 * Remplit l'élément d'un bloc grille et branche ses interactions.
 * @param {module:model~Note} n
 * @param {module:model~GridBlock} b
 * @param {HTMLElement} el
 */
function gridBlockEl(n, b, el) {
  el.innerHTML = gridBlockHtml(b);
  bindGridSettings(n, b, el);
  bindIRealPanel(n, b, el);
  bindMeasureSelection(n, b, el);
}

/**
 * Redessine une grille (sans effet si `id` n'est pas une grille affichée).
 * @param {string} id
 */
export function redrawGrid(id) {
  const b = blockById(id);
  if (!b || b.type !== 'grid') return;
  const w = /** @type {HTMLElement} */ (app.querySelector(`[data-grid="${CSS.escape(id)}"]`));
  if (!w) return;
  const lines = Math.ceil(b.measures.length / GRID_COLS);
  const folded = isFolded(b, lines);
  w.innerHTML = gridHtml(
    b,
    state.activeId === id ? state.sel : null,
    audio.isPlaying(id) ? state.playIdx : null,
    folded ? FOLD_PREVIEW_LINES * GRID_COLS : 0,
  );
  applyFold(w, b, lines, folded);
  if (state.activeId === id) updateGridPalette();
}

/**
 * Remplit le champ de saisie avec la mesure sélectionnée.
 * @param {module:model~GridBlock} b
 */
function loadInput(b) {
  const m = state.sel != null && b.measures[state.sel];
  gin.value = m ? measureText(m) : '';
  gin.classList.remove('err');
}

/**
 * Affiche ou cache la palette de grille. À l'ouverture sans sélection, on se
 * place sur la première mesure vide (là où l'on veut écrire).
 * @param {boolean} on
 */
function showGridPalette(on) {
  gpal.hidden = !on;
  if (!on) return;
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!b) return;
  if (state.sel == null) {
    const empty = b.measures.findIndex((m) => !m.ch.length);
    state.sel = empty >= 0 ? empty : 0;
    redrawGrid(b.id);
  }
  loadInput(b);
  updateGridPalette();
}

/**
 * Met à jour le message et l'état des boutons de la palette de grille.
 */
function updateGridPalette() {
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!b || b.type !== 'grid') return;
  const m = state.sel != null ? b.measures[state.sel] : null;
  const info = document.getElementById('gInfo');
  info.textContent = m
    ? `Mesure ${state.sel + 1}` +
      (m.sec ? ` · section ${m.sec}` : '') +
      (m.ending ? ' · ' + (m.ending === 1 ? '1re' : m.ending + 'e') + ' fin' : '') +
      (gin.classList.contains('err') ? ' · accord non reconnu' : '')
    : 'Touche une mesure';
  gpal.querySelectorAll('[data-g]').forEach((x) => {
    const k = x.dataset.g;
    const on =
      !!m &&
      ({ sec: !!m.sec, end: !!m.ending, rs: !!m.rs, re: !!m.re, dbl: !!m.dbl, fin: !!m.fin }[k] || false);
    if (k === 'sec') x.textContent = m && m.sec ? 'Section ' + m.sec : 'Section';
    if (k === 'end')
      x.textContent = m && m.ending ? m.ending + (m.ending === 1 ? 're' : 'e') + ' fin' : 'Volta';
    x.setAttribute('aria-pressed', String(on));
  });
  syncPaletteSpace();
}

/**
 * Applique le contenu du champ à la mesure sélectionnée.
 * @param {boolean} commit `true` à la validation : interprète aussi les `|`
 *   (mesures suivantes), en réutilisant les mesures vides déjà présentes.
 */
function applyInput(commit) {
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null) return;
  const parts = gin.value.split('|');
  const bad = gin.value
    .split(/[\s,|]+/)
    .filter(Boolean)
    .map((t) => (/^(n|nc|n\.c\.?|\/)$/i.test(t) ? '' : t))
    .some((t) => !chordOk(t));
  gin.classList.toggle('err', bad);
  b.measures[state.sel].ch = gridTokens(parts[0]);
  if (commit && parts.length > 1) {
    parts.slice(1).forEach((p, k) => {
      const idx = state.sel + 1 + k;
      const ch = gridTokens(p);
      if (idx < b.measures.length && !b.measures[idx].ch.length) b.measures[idx].ch = ch;
      else b.measures.splice(idx, 0, { ch });
    });
    state.sel += parts.length - 1;
  }
  touch(n);
  redrawGrid(b.id);
}

/** Valide la saisie et passe à la mesure suivante (sauf après une barre de fin). */
function nextMeasure() {
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b || state.sel == null) return;
  applyInput(true);
  if (b.measures[state.sel].fin) {
    gin.blur();
    return;
  }
  if (state.sel >= b.measures.length - 1) {
    b.measures.push({ ch: [] });
    touch(n);
  }
  state.sel++;
  loadInput(b);
  redrawGrid(b.id);
  const c = app.querySelector(`[data-grid="${CSS.escape(b.id)}"] [data-gm="${state.sel}"]`);
  if (c) c.scrollIntoView({ block: 'nearest' });
}

// ---------- Câblage (une seule fois) ----------
gin.addEventListener('focus', () => {
  const n = curNote();
  if (n) pushSnapshot(n);
});
gin.addEventListener('input', () => {
  if (!gin.value.includes('|')) applyInput(false);
});
gin.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    nextMeasure();
  }
});
document.getElementById('gOk').onclick = () => {
  nextMeasure();
  gin.focus();
};
document.getElementById('gDone').onclick = () => {
  gin.blur();
  setActive(null);
};

gpal.addEventListener('click', (e) => {
  const x = /** @type {HTMLElement} */ (e.target).closest('[data-g]');
  if (!x) return;
  const k = x.dataset.g;
  const n = curNote();
  const b = /** @type {module:model~GridBlock} */ (blockById(state.activeId));
  if (!n || !b) return;
  if (k === 'prev' || k === 'next') {
    if (state.sel != null) applyInput(false);
    state.sel =
      state.sel == null
        ? 0
        : Math.max(0, Math.min(b.measures.length - 1, state.sel + (k === 'prev' ? -1 : 1)));
    loadInput(b);
    redrawGrid(b.id);
    return;
  }
  if (k === 'undo') {
    undo();
    return;
  }
  if (state.sel == null) return;
  const m = b.measures[state.sel];
  pushSnapshot(n);
  switch (k) {
    case 'sec': // A → B → C → D → Intro → (rien)
      m.sec = SECTIONS[(SECTIONS.indexOf(m.sec || '') + 1) % SECTIONS.length];
      if (!m.sec) delete m.sec;
      break;
    case 'end': // 1re fin → 2e fin → (rien)
      m.ending = /** @type {any} */ (((m.ending || 0) + 1) % 3);
      if (!m.ending) delete m.ending;
      break;
    case 'sim':
      m.ch = ['%'];
      loadInput(b);
      break;
    case 'ins':
      b.measures.splice(state.sel + 1, 0, { ch: [] });
      state.sel++;
      loadInput(b);
      break;
    case 'del':
      if (b.measures.length > 1) {
        b.measures.splice(state.sel, 1);
        state.sel = Math.min(state.sel, b.measures.length - 1);
        loadInput(b);
      }
      break;
    default: {
      // Barres : rs, re, dbl, fin (une barre de droite exclut les autres).
      const flag = { rs: 'rs', re: 're', dbl: 'dbl', fin: 'fin' }[k];
      if (!flag) break;
      if (m[flag]) {
        delete m[flag];
        break;
      }
      m[flag] = true;
      if (flag === 'fin') {
        delete m.dbl;
        delete m.re;
      }
      if (flag === 're') {
        delete m.fin;
        delete m.dbl;
      }
      if (flag === 'dbl') {
        delete m.fin;
        delete m.re;
      }
    }
  }
  touch(n);
  redrawGrid(b.id);
  updateGridPalette();
});

registerBlockKind('grid', { build: gridBlockEl, redraw: redrawGrid, showPalette: showGridPalette });
