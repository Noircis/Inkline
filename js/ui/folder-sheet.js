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
 */

import { state, app } from './state.js';
import { esc } from '../util.js';
import { FOLDER_COLORS, FOLDER_NAME_MAX, newFolder, cleanFolderName, deleteFolder } from '../folders.js';
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
