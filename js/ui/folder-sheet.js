/**
 * @module ui/folder-sheet
 * @description
 * **Éditeur de dossier** : un panneau qui monte du bas de l'écran (bottom
 * sheet), pour créer, renommer, recolorer ou supprimer un dossier. Il est
 * ouvert depuis la barre de dossiers de l'accueil, le sélecteur « Dossier »
 * d'une note et la section Dossiers des Options.
 *
 * Supprimer un dossier ne supprime **aucune** note : elles redeviennent
 * « non classées » ({@link module:folders.deleteFolder|deleteFolder}).
 *
 * Depuis la 2.8.6, le module ouvre aussi le panneau des **catégories** d'un
 * dossier ({@link openCategoriesSheet}) et le panneau **Ranger la note**
 * ({@link openArrangeSheet}) : dossier et catégories d'une note.
 */

import { state, app } from './state.js';
import { esc, uid } from '../util.js';
import {
  FOLDER_COLORS,
  FOLDER_NAME_MAX,
  CAT_NAME_MAX,
  MAX_CATS,
  newFolder,
  cleanFolderName,
  deleteFolder,
  sortedFolders,
  addCategory,
  deleteCategory,
  countByCategory,
  fileNote,
} from '../folders.js';
import { flushSave, saveFolders } from '../storage.js';
import { confirmTap } from './common.js';

/**
 * HTML du panneau.
 * @param {boolean} editing Modification (sinon création).
 * @param {string} color Couleur cochée.
 * @returns {string}
 */
function sheetHtml(editing, color) {
  return `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="fsTitle" novalidate>
    <h2 id="fsTitle">${editing ? 'Modifier le dossier' : 'Nouveau dossier'}</h2>
    <label class="fs-lbl" for="fsName">Nom</label>
    <input id="fsName" type="text" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="Harmonie, Répertoire, Cours de piano…">
    <div class="fs-lbl" id="fsColorLbl">Couleur</div>
    <div class="swatches" role="radiogroup" aria-labelledby="fsColorLbl">${FOLDER_COLORS.map(
      (c) =>
        `<button type="button" role="radio" class="swatch fc-${c.key}" data-color="${c.key}" aria-checked="${c.key === color}" aria-label="${esc(c.label)}"></button>`,
    ).join('')}</div>
    <div class="sheet-actions">
      ${editing ? '<button class="btn ghost danger" id="fsDel" type="button">Supprimer</button>' : ''}
      <div class="grow"></div>
      <button class="btn" id="fsCancel" type="button">Annuler</button>
      <button class="btn primary" id="fsSave" type="submit">${editing ? 'Enregistrer' : 'Créer'}</button>
    </div>
    <p class="fs-msg" id="fsMsg" role="status"></p>
  </form>`;
}

/**
 * Branche la suppression en deux temps : les notes du dossier passent dans
 * « Non classées », aucune n'est supprimée.
 * @param {HTMLElement} back Fond du panneau.
 * @param {module:folders~Folder} folder
 * @param {function((module:folders~Folder|null))} close
 */
function bindDelete(back, folder, close) {
  const del = /** @type {HTMLButtonElement} */ (back.querySelector('#fsDel'));
  const count = Object.values(state.notes).filter((n) => n.folder === folder.id).length;
  const armed = count ? `Supprimer (${count} note${count > 1 ? 's' : ''} → Non classées)` : 'Confirmer';
  del.addEventListener('click', () =>
    confirmTap(del, armed, () => {
      deleteFolder(folder.id, state.notes, state.folders);
      saveFolders(state.folders);
      flushSave(state.notes);
      close(null);
    }),
  );
}

/**
 * Ouvre l'éditeur.
 *
 * @param {module:folders~Folder|null} folder Dossier à modifier, ou `null` pour en créer un.
 * @param {function((module:folders~Folder|null))} [onDone] Appelé à la fermeture avec
 *   le dossier enregistré, ou `null` (annulé ou supprimé).
 */
export function openFolderSheet(folder, onDone = () => {}) {
  closeFolderSheet();
  const editing = !!folder;
  let picked = editing ? folder.color : FOLDER_COLORS[(Object.keys(state.folders).length + 5) % 8].key;
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.id = 'folderSheet';
  back.innerHTML = sheetHtml(editing, picked);
  app.appendChild(back);

  const name = /** @type {HTMLInputElement} */ (back.querySelector('#fsName'));
  name.value = editing ? folder.name : '';
  const close = (result) => {
    back.remove();
    onDone(result);
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) close(null); // toucher hors du panneau = annuler
  });
  back.querySelector('#fsCancel').addEventListener('click', () => close(null));
  back.querySelectorAll('[data-color]').forEach((b) => {
    b.addEventListener('click', () => {
      picked = /** @type {HTMLElement} */ (b).dataset.color;
      back.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
  });
  back.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const clean = cleanFolderName(name.value);
    if (!clean) {
      back.querySelector('#fsMsg').textContent = 'Donne un nom au dossier.';
      name.focus();
      return;
    }
    const f = editing ? folder : newFolder(clean, picked);
    f.name = clean;
    f.color = picked;
    state.folders[f.id] = f;
    saveFolders(state.folders);
    close(f);
  });
  if (editing) bindDelete(back, folder, close);

  // Sur la création, le clavier s'ouvre directement ; en modification, on
  // évite qu'il cache le panneau (on modifie souvent seulement la couleur).
  if (!editing) requestAnimationFrame(() => name.focus());
}

/** Ferme l'éditeur s'il est ouvert (sans rappel). */
function closeFolderSheet() {
  const el = document.getElementById('folderSheet');
  if (el) el.remove();
}

// ---------- Catégories (2.8.6) ----------

/**
 * Ouvre le panneau **Catégories** d'un dossier : ajouter, renommer, changer
 * l'ordre (↑ ↓), supprimer. On travaille sur une copie : rien ne change avant
 * « Enregistrer ». Supprimer une catégorie ne supprime aucune note : elle
 * est seulement retirée des notes qui l'avaient.
 *
 * @param {module:folders~Folder} folder
 * @param {function(boolean)} [onDone] Appelé à la fermeture (`true` si enregistré).
 * @param {{focusNew: (boolean|undefined)}} [opt] `focusNew` : clavier ouvert sur « Nouvelle catégorie ».
 */
export function openCategoriesSheet(folder, onDone = () => {}, opt = {}) {
  closeFolderSheet();
  /** Copie de travail : `{id, name}`, `id` absent pour une catégorie nouvelle. */
  const work = (folder.cats || []).map((c) => ({ ...c }));
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.id = 'folderSheet';
  app.appendChild(back);
  const close = (saved) => {
    back.remove();
    onDone(saved);
  };
  const counts = countByCategory(
    Object.values(state.notes).filter((n) => n.folder === folder.id),
    folder,
  );

  const render = () => {
    back.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="csTitle" novalidate>
      <h2 id="csTitle">Catégories de « ${esc(folder.name)} »</h2>
      <ul class="cat-list">${work
        .map(
          (c, k) => `<li class="cat-row" data-k="${k}">
          <input type="text" class="cat-name" maxlength="${CAT_NAME_MAX}" value="${esc(c.name)}" aria-label="Nom de la catégorie ${k + 1}">
          <span class="cat-n" title="Notes">${c.id ? counts[c.id] || 0 : 0}</span>
          <button type="button" class="btn ghost small" data-move="-1" aria-label="Monter"${k ? '' : ' disabled'}>&#8593;</button>
          <button type="button" class="btn ghost small" data-move="1" aria-label="Descendre"${k < work.length - 1 ? '' : ' disabled'}>&#8595;</button>
          <button type="button" class="btn ghost small danger" data-del aria-label="Supprimer">&#10005;</button>
        </li>`,
        )
        .join('')}</ul>
      <div class="cat-add"><input type="text" id="csNew" maxlength="${CAT_NAME_MAX}" autocomplete="off" placeholder="Nouvelle catégorie" enterkeyhint="done"><button type="button" class="btn" id="csAdd">Ajouter</button></div>
      <p class="hint">Une note peut avoir plusieurs catégories. Supprimer une catégorie ne supprime aucune note.</p>
      <div class="sheet-actions">
        <div class="grow"></div>
        <button class="btn" id="csCancel" type="button">Annuler</button>
        <button class="btn primary" type="submit">Enregistrer</button>
      </div>
    </form>`;
    const rows = back.querySelectorAll('.cat-row');
    rows.forEach((row) => {
      const k = Number(/** @type {HTMLElement} */ (row).dataset.k);
      const input = /** @type {HTMLInputElement} */ (row.querySelector('.cat-name'));
      input.addEventListener('input', () => (work[k].name = input.value));
      row.querySelectorAll('[data-move]').forEach((b) =>
        b.addEventListener('click', () => {
          const j = k + Number(/** @type {HTMLElement} */ (b).dataset.move);
          [work[k], work[j]] = [work[j], work[k]];
          render();
        }),
      );
      const del = /** @type {HTMLButtonElement} */ (row.querySelector('[data-del]'));
      const n = work[k].id ? counts[work[k].id] || 0 : 0;
      del.addEventListener('click', () =>
        confirmTap(del, n ? `Retirer de ${n} note${n > 1 ? 's' : ''}` : 'Confirmer', () => {
          work.splice(k, 1);
          render();
        }),
      );
    });
    const add = () => {
      const input = /** @type {HTMLInputElement} */ (back.querySelector('#csNew'));
      const name = cleanFolderName(input.value, CAT_NAME_MAX);
      if (!name) return;
      if (work.length >= MAX_CATS) return;
      if (!work.some((c) => c.name.localeCompare(name, 'fr', { sensitivity: 'base' }) === 0))
        work.push({ name });
      render();
      /** @type {HTMLInputElement} */ (back.querySelector('#csNew')).focus();
    };
    back.querySelector('#csAdd').addEventListener('click', add);
    back.querySelector('#csNew').addEventListener('keydown', (e) => {
      if (/** @type {KeyboardEvent} */ (e).key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    back.querySelector('#csCancel').addEventListener('click', () => close(false));
    back.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      // Catégories supprimées : retirées des notes ; puis ordre et noms.
      const kept = new Set(work.map((c) => c.id).filter(Boolean));
      (folder.cats || [])
        .filter((c) => !kept.has(c.id))
        .forEach((c) => deleteCategory(folder, c.id, state.notes));
      folder.cats = [];
      work.forEach((c) => {
        const name = cleanFolderName(c.name, CAT_NAME_MAX);
        if (!name) return; // nom effacé : catégorie ignorée (les notes la perdent)
        folder.cats.push({ id: c.id || uid(), name });
      });
      // Une catégorie vidée de son nom disparaît aussi des notes.
      const ids = new Set(folder.cats.map((c) => c.id));
      Object.values(state.notes).forEach((n) => {
        if (n.folder !== folder.id || !n.cats) return;
        n.cats = n.cats.filter((id) => ids.has(id));
        if (!n.cats.length) delete n.cats;
      });
      if (!folder.cats.length) delete folder.cats;
      saveFolders(state.folders);
      flushSave(state.notes);
      close(true);
    });
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) close(false);
  });
  render();
  if (opt.focusNew)
    requestAnimationFrame(() => /** @type {HTMLElement} */ (back.querySelector('#csNew'))?.focus());
}

/**
 * Ouvre le panneau **Ranger la note** : son dossier (un seul) et, dans ce
 * dossier, ses catégories (autant qu'on veut). Chaque choix s'applique tout
 * de suite ; changer de dossier efface les catégories.
 *
 * @param {module:model~Note} note
 * @param {function()} onChange Après chaque changement (enregistrement compris).
 */
export function openArrangeSheet(note, onChange) {
  closeFolderSheet();
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.id = 'folderSheet';
  app.appendChild(back);
  const close = () => back.remove();

  const render = () => {
    const folders = sortedFolders(state.folders);
    const cur = note.folder && state.folders[note.folder] ? note.folder : null;
    const mine = new Set(note.cats || []);
    const radio = (id, label, dot) =>
      `<button type="button" class="ar-folder" role="radio" data-folder="${esc(id)}" aria-checked="${(id || null) === cur}">${dot}<span>${label}</span></button>`;
    let list = radio('', 'Non classée', '<span class="fdot none" aria-hidden="true"></span>');
    folders.forEach((f) => {
      list += radio(f.id, esc(f.name), `<span class="fdot fc-${f.color}" aria-hidden="true"></span>`);
      if (f.id !== cur) return;
      list += `<div class="ar-cats" role="group" aria-label="Catégories de ${esc(f.name)}">${(f.cats || [])
        .map(
          (c) =>
            `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${mine.has(c.id)}">${esc(c.name)}</button>`,
        )
        .join(
          '',
        )}<span class="ar-new"><input type="text" id="arNew" maxlength="${CAT_NAME_MAX}" autocomplete="off" placeholder="+ Nouvelle catégorie" enterkeyhint="done" aria-label="Nouvelle catégorie"></span></div>`;
    });
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="arTitle">
      <div class="ar-head"><h2 id="arTitle">Ranger la note</h2><button type="button" class="btn primary" id="arDone">Fini</button></div>
      <div class="ar-list" role="radiogroup" aria-labelledby="arTitle">${list}</div>
      <button type="button" class="btn ghost" id="arNewFolder">+ Nouveau dossier</button>
    </div>`;
    back.querySelectorAll('[data-folder]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = /** @type {HTMLElement} */ (b).dataset.folder || null;
        if (id === (note.folder || null)) return;
        fileNote(note, id);
        onChange();
        render();
      }),
    );
    back.querySelectorAll('[data-cat]').forEach((b) =>
      b.addEventListener('click', () => {
        const id = /** @type {HTMLElement} */ (b).dataset.cat;
        const set = new Set(note.cats || []);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        fileNote(note, note.folder, [...set]);
        onChange();
        b.setAttribute('aria-pressed', String(set.has(id)));
      }),
    );
    const input = /** @type {?HTMLInputElement} */ (back.querySelector('#arNew'));
    if (input)
      input.addEventListener('keydown', (e) => {
        if (/** @type {KeyboardEvent} */ (e).key !== 'Enter') return;
        e.preventDefault();
        const f = state.folders[note.folder];
        const c = f && addCategory(f, input.value);
        if (!c) return;
        saveFolders(state.folders);
        fileNote(note, f.id, [...(note.cats || []), c.id]);
        onChange();
        render();
      });
    back.querySelector('#arDone').addEventListener('click', close);
    back.querySelector('#arNewFolder').addEventListener('click', () =>
      openFolderSheet(null, (f) => {
        if (f) {
          fileNote(note, f.id);
          onChange();
        }
        openArrangeSheet(note, onChange);
      }),
    );
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  render();
}
