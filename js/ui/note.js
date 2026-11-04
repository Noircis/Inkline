/**
 * @module ui/note
 * @description
 * **Écran note** : titre, rangement (dossier, épingle), blocs, barre d'ajout,
 * partage, suppression.
 *
 * Le rendu est fait par template strings et `innerHTML`, puis les
 * gestionnaires d'événements sont branchés sur les éléments créés. Les blocs
 * texte sont gérés ici ; les blocs portée et grille sont délégués, via le
 * registre de {@link module:ui/blocks|ui/blocks}, à
 * {@link module:ui/staff-ui|ui/staff-ui} et {@link module:ui/grid-ui|ui/grid-ui}.
 */

import { state, app, curNote, touch, saveArrangement } from './state.js';
import { esc } from '../util.js';
import { newTextBlock, newStaffBlock, newGridBlock } from '../model.js';
import { sortedFolders, folderOf } from '../folders.js';
import { flushSave } from '../storage.js';
import { noteToInkline, noteToPng, noteToPdf, shareOrDownload, slug } from '../export.js';
import { pushSnapshot } from '../history.js';
import * as audio from '../audio.js';
import { registerScreen, backToList, renderScreen } from './nav.js';
import { toolsHtml, autosize, confirmTap } from './common.js';
import { PIN_ICON } from './icons.js';
import { blockKind, redrawBlock, setActive, updateActive } from './blocks.js';
import { openFolderSheet } from './folder-sheet.js';

/** Valeur spéciale du sélecteur de dossier : créer un dossier. */
const NEW_FOLDER = '__new';

/**
 * HTML du sélecteur de dossier d'une note.
 * @param {module:model~Note} n
 * @returns {string}
 */
function folderSelectHtml(n) {
  const f = folderOf(n, state.folders);
  const opts = sortedFolders(state.folders)
    .map(
      (x) => `<option value="${esc(x.id)}"${f && f.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`,
    )
    .join('');
  return `<label class="note-folder"><span class="fdot ${f ? 'fc-' + f.color : 'none'}" aria-hidden="true"></span><span class="sr">Dossier</span><select id="folderSel"><option value=""${f ? '' : ' selected'}>Non classée</option>${opts}<option value="${NEW_FOLDER}">+ Nouveau dossier…</option></select></label>`;
}

/**
 * Écran note.
 * @param {module:ui/nav~RenderOptions} [opts={}]
 * @returns {boolean|void} `false` si la note n'existe plus.
 */
function renderNote(opts = {}) {
  const n = curNote();
  if (!n) return false;
  const sy = window.scrollY;
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; Notes</button><div class="grow"></div><button class="btn icon-btn pin-btn" id="pinBtn" type="button" aria-pressed="${!!n.pinned}" aria-label="Épingler en tête de liste">${PIN_ICON}</button><button class="btn" id="shareBtn" type="button" aria-expanded="false">Partager</button></header>
  <div class="sharebox" id="shareBox" hidden>
    <button class="btn primary" type="button" data-share="inkline">Fichier Inkline<small>modifiable dans Inkline</small></button>
    <button class="btn" type="button" data-share="png">Image<small>PNG</small></button>
    <button class="btn" type="button" data-share="pdf">PDF<small>A4</small></button>
    <div class="status" id="shareMsg"></div>
  </div>
  <textarea class="title-in" id="titleIn" rows="1" placeholder="Titre de la note"></textarea>
  ${folderSelectHtml(n)}
  <div class="blocks" id="blocks"></div>
  <div class="addbar"><button class="btn" data-add="text" type="button">+ Texte</button><button class="btn" data-add="staff" type="button">+ Portée</button><button class="btn" data-add="rhythm" type="button">+ Rythme</button><button class="btn" data-add="grid" type="button">+ Grille</button></div>
  <div class="notefoot"><button class="btn ghost danger" id="delNote" type="button">Supprimer la note</button></div>`;

  bindTitle(n);
  bindArrangement(n);
  app.querySelector('#back').onclick = backToList;
  bindShare(n);

  const dn = /** @type {HTMLButtonElement} */ (app.querySelector('#delNote'));
  dn.onclick = () =>
    confirmTap(dn, 'Toucher encore pour supprimer', () => {
      delete state.notes[n.id];
      flushSave(state.notes);
      backToList();
    });
  app.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = () => addBlock(n, btn.dataset.add);
  });

  const bl = app.querySelector('#blocks');
  n.blocks.forEach((b, bi) => bl.appendChild(blockEl(n, b, bi)));
  // Les SVG ont besoin de la largeur réelle : on les dessine après le layout.
  requestAnimationFrame(() => {
    n.blocks.forEach((b) => redrawBlock(b.id));
    app.querySelectorAll('.block textarea').forEach(autosize);
  });
  updateActive();
  if (opts.keepScroll) window.scrollTo(0, sy);
  if (opts.focusTitle) /** @type {HTMLElement} */ (app.querySelector('#titleIn')).focus();
}

registerScreen('note', renderNote);

/**
 * Branche le champ titre.
 * @param {module:model~Note} n
 */
function bindTitle(n) {
  const ti = /** @type {HTMLTextAreaElement} */ (app.querySelector('#titleIn'));
  ti.value = n.title;
  autosize(ti);
  ti.addEventListener('focus', () => {
    pushSnapshot(n);
    setActive(null);
  });
  ti.addEventListener('input', () => {
    n.title = ti.value.replace(/\n/g, ' ');
    autosize(ti);
    touch(n);
  });
  ti.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ti.blur();
    }
  });
}

/**
 * Branche le sélecteur de dossier et l'épingle. Ces changements ne modifient
 * pas la date de la note ({@link module:ui/state.saveArrangement|saveArrangement}).
 * @param {module:model~Note} n
 */
function bindArrangement(n) {
  const pin = app.querySelector('#pinBtn');
  pin.onclick = () => {
    if (n.pinned) delete n.pinned;
    else n.pinned = true;
    pin.setAttribute('aria-pressed', String(!!n.pinned));
    saveArrangement(n);
  };

  const assign = (id) => {
    if (id) n.folder = id;
    else delete n.folder;
    saveArrangement(n);
    app.querySelector('.note-folder').outerHTML = folderSelectHtml(n);
    bindArrangementSelect(n, assign);
  };
  bindArrangementSelect(n, assign);
}

/**
 * Branche le `<select>` de dossier (recréé après chaque changement, pour la pastille de couleur).
 * @param {module:model~Note} n
 * @param {function(string)} assign
 */
function bindArrangementSelect(n, assign) {
  const sel = /** @type {HTMLSelectElement} */ (app.querySelector('#folderSel'));
  sel.onchange = () => {
    if (sel.value !== NEW_FOLDER) {
      assign(sel.value);
      return;
    }
    // « + Nouveau dossier… » : on remet l'ancienne valeur, l'éditeur décidera.
    sel.value = n.folder && state.folders[n.folder] ? n.folder : '';
    openFolderSheet(null, (f) => {
      if (f) assign(f.id);
    });
  };
}

/**
 * Branche le panneau « Partager » d'une note.
 *
 * Le fichier est généré au clic, puis {@link module:export.shareOrDownload|shareOrDownload}
 * ouvre le menu de partage d'Android ou télécharge le fichier. L'appel à
 * `navigator.share` doit suivre de près le geste de l'utilisateur (quelques
 * secondes) : la génération d'image est assez rapide pour ça.
 *
 * @param {module:model~Note} n
 */
function bindShare(n) {
  const btn = app.querySelector('#shareBtn');
  const box = /** @type {HTMLElement} */ (app.querySelector('#shareBox'));
  const msg = app.querySelector('#shareMsg');
  btn.onclick = () => {
    box.hidden = !box.hidden;
    btn.setAttribute('aria-expanded', String(!box.hidden));
    msg.textContent = '';
    if (!box.hidden) setActive(null);
  };
  box.querySelectorAll('[data-share]').forEach((b) => {
    b.onclick = async () => {
      const kind = b.dataset.share;
      const name = slug(n.title);
      const title = n.title || 'Note Inkline';
      msg.textContent = kind === 'inkline' ? '' : 'Préparation…';
      box.querySelectorAll('button').forEach((x) => {
        x.disabled = true;
      });
      try {
        let res;
        if (kind === 'inkline') {
          // .inkline d'abord ; si Android refuse ce type, variante .txt (même contenu).
          res = await shareOrDownload(
            noteToInkline(n),
            [
              { name: name + '.inkline', type: 'application/json' },
              { name: name + '.inkline.txt', type: 'text/plain' },
            ],
            title,
          );
        } else if (kind === 'png') {
          res = await shareOrDownload(
            await noteToPng(n),
            [{ name: name + '.png', type: 'image/png' }],
            title,
          );
        } else {
          res = await shareOrDownload(
            await noteToPdf(n),
            [{ name: name + '.pdf', type: 'application/pdf' }],
            title,
          );
        }
        msg.textContent =
          res === 'downloaded'
            ? 'Fichier enregistré dans tes téléchargements.'
            : res === 'shared'
              ? 'Envoyé.'
              : '';
      } catch (e) {
        msg.textContent = "L'export a échoué. Réessaie ; si ça persiste, exporte le fichier Inkline.";
      } finally {
        box.querySelectorAll('button').forEach((x) => {
          x.disabled = false;
        });
      }
    };
  });
}

/**
 * Ajoute un bloc en fin de note et l'active.
 * @param {module:model~Note} n
 * @param {'text'|'staff'|'rhythm'|'grid'} kind
 */
function addBlock(n, kind) {
  pushSnapshot(n);
  const b =
    kind === 'grid' ? newGridBlock() : kind === 'text' ? newTextBlock() : newStaffBlock(kind === 'rhythm');
  n.blocks.push(b);
  touch(n);
  state.activeId = b.id;
  state.sel = kind === 'grid' ? 0 : null; // une grille s'ouvre sur sa 1re mesure
  renderScreen({ keepScroll: true });
  const el = app.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (kind === 'text') {
      const t = el.querySelector('textarea');
      if (t) t.focus();
    }
  }
}

/**
 * Crée l'élément DOM d'un bloc et branche ses outils.
 * @param {module:model~Note} n
 * @param {module:model~Block} b
 * @param {number} bi Position du bloc dans la note.
 * @returns {HTMLDivElement}
 */
function blockEl(n, b, bi) {
  const el = document.createElement('div');
  el.className = 'block ' + (b.type === 'text' ? 'text' : b.type === 'grid' ? 'gridblk' : 'staff');
  el.dataset.block = b.id;
  if (b.type === 'text') {
    el.innerHTML =
      `<textarea rows="1" placeholder="${bi === 0 ? 'Écrivez ici…' : 'Texte'}" id="t_${esc(b.id)}"></textarea>` +
      toolsHtml();
    const t = el.querySelector('textarea');
    t.value = b.text;
    t.addEventListener('focus', () => {
      pushSnapshot(n);
      setActive(b.id);
    });
    t.addEventListener('input', () => {
      b.text = t.value;
      autosize(t);
      touch(n);
    });
  } else {
    blockKind(b.type).build(n, b, el);
  }

  el.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.onclick = () => {
      const i = n.blocks.indexOf(b);
      const tool = btn.dataset.tool;
      if (tool === 'del') {
        confirmTap(
          /** @type {HTMLButtonElement} */ (btn),
          'Confirmer',
          () => {
            pushSnapshot(n);
            if (audio.isPlaying(b.id)) audio.stop();
            n.blocks.splice(i, 1);
            state.activeId = null;
            state.sel = null;
            touch(n);
            renderScreen({ keepScroll: true });
          },
          3000,
        );
        return;
      }
      const j = tool === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= n.blocks.length) return;
      pushSnapshot(n);
      n.blocks.splice(i, 1);
      n.blocks.splice(j, 0, b);
      touch(n);
      renderScreen({ keepScroll: true });
      const nel = app.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
      if (nel) nel.scrollIntoView({ block: 'nearest' });
    };
  });
  return el;
}
