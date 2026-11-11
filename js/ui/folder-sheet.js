/**
 * @module ui/folder-sheet
 * @description
 * **Folder editor**: a panel that slides up from the bottom of the screen
 * (bottom sheet), to create, rename, recolor or delete a folder. It is
 * opened from the folder bar of the home screen, the "Folder" picker of a
 * note and the Folders section of Settings.
 *
 * Deleting a folder deletes **no** note: they become "Unfiled" again
 * ({@link module:folders.deleteFolder|deleteFolder}).
 *
 * Since 2.8.6, the module also opens a folder's **categories** panel
 * ({@link openCategoriesSheet}) and the **File note** panel
 * ({@link openArrangeSheet}): folder and categories of a note.
 */

import { t } from '../i18n.js';
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
 * HTML of the panel.
 * @param {boolean} editing Editing (otherwise creating).
 * @param {string} color Checked color.
 * @returns {string}
 */
function sheetHtml(editing, color) {
  return `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="fsTitle" novalidate>
    <h2 id="fsTitle">${esc(editing ? t('folder.edit') : t('home.newFolder'))}</h2>
    <label class="fs-lbl" for="fsName">${esc(t('folder.name'))}</label>
    <input id="fsName" type="text" maxlength="${FOLDER_NAME_MAX}" autocomplete="off" placeholder="${esc(t('folder.namePlaceholder'))}">
    <div class="fs-lbl" id="fsColorLbl">${esc(t('folder.color'))}</div>
    <div class="swatches" role="radiogroup" aria-labelledby="fsColorLbl">${FOLDER_COLORS.map(
      (c) =>
        `<button type="button" role="radio" class="swatch fc-${c.key}" data-color="${c.key}" aria-checked="${c.key === color}" aria-label="${esc(t('color.' + c.key))}"></button>`,
    ).join('')}</div>
    <div class="sheet-actions">
      ${editing ? `<button class="btn ghost danger" id="fsDel" type="button">${esc(t('common.delete'))}</button>` : ''}
      <div class="grow"></div>
      <button class="btn" id="fsCancel" type="button">${esc(t('common.cancel'))}</button>
      <button class="btn primary" id="fsSave" type="submit">${esc(editing ? t('common.save') : t('folder.create'))}</button>
    </div>
    <p class="fs-msg" id="fsMsg" role="status"></p>
  </form>`;
}

/**
 * Wires the two-step deletion: the folder's notes move to "Unfiled", none is
 * deleted.
 * @param {HTMLElement} back Panel backdrop.
 * @param {module:folders~Folder} folder
 * @param {function((module:folders~Folder|null))} close
 */
function bindDelete(back, folder, close) {
  const del = /** @type {HTMLButtonElement} */ (back.querySelector('#fsDel'));
  const count = Object.values(state.notes).filter((n) => n.folder === folder.id).length;
  const armed = count ? t('folder.deleteArmed', { n: count }) : t('common.confirm');
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
 * Opens the editor.
 *
 * @param {module:folders~Folder|null} folder Folder to edit, or `null` to create one.
 * @param {function((module:folders~Folder|null))} [onDone] Called on close with the
 *   saved folder, or `null` (cancelled or deleted).
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
    if (e.target === back) close(null); // tap outside the panel = cancel
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
      back.querySelector('#fsMsg').textContent = t('folder.needName');
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

  // When creating, the keyboard opens right away; when editing, keep it
  // from hiding the panel (often only the color is changed).
  if (!editing) requestAnimationFrame(() => name.focus());
}

/** Closes the editor if it is open (no callback). */
function closeFolderSheet() {
  const el = document.getElementById('folderSheet');
  if (el) el.remove();
}

// ---------- Categories (2.8.6) ----------

/**
 * Opens a folder's **Categories** panel: add, rename, reorder (↑ ↓), delete.
 * Work is done on a copy: nothing changes before "Save". Deleting a category
 * deletes no note: it is only removed from the notes that had it.
 *
 * @param {module:folders~Folder} folder
 * @param {function(boolean)} [onDone] Called on close (`true` if saved).
 * @param {{focusNew: (boolean|undefined)}} [opt] `focusNew`: keyboard open on "New category".
 */
export function openCategoriesSheet(folder, onDone = () => {}, opt = {}) {
  closeFolderSheet();
  /** Working copy: `{id, name}`, `id` missing for a new category. */
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
      <h2 id="csTitle">${esc(t('cats.title', { name: folder.name }))}</h2>
      <ul class="cat-list">${work
        .map(
          (c, k) => `<li class="cat-row" data-k="${k}">
          <input type="text" class="cat-name" maxlength="${CAT_NAME_MAX}" value="${esc(c.name)}" aria-label="${esc(t('cats.nameN', { n: k + 1 }))}">
          <span class="cat-n" title="${esc(t('note.back'))}">${c.id ? counts[c.id] || 0 : 0}</span>
          <button type="button" class="btn ghost small" data-move="-1" aria-label="${esc(t('common.moveUp'))}"${k ? '' : ' disabled'}>&#8593;</button>
          <button type="button" class="btn ghost small" data-move="1" aria-label="${esc(t('common.moveDown'))}"${k < work.length - 1 ? '' : ' disabled'}>&#8595;</button>
          <button type="button" class="btn ghost small danger" data-del aria-label="${esc(t('common.delete'))}">&#10005;</button>
        </li>`,
        )
        .join('')}</ul>
      <div class="cat-add"><input type="text" id="csNew" maxlength="${CAT_NAME_MAX}" autocomplete="off" placeholder="${esc(t('cats.new'))}" enterkeyhint="done"><button type="button" class="btn" id="csAdd">${esc(t('common.add'))}</button></div>
      <p class="hint">${esc(t('cats.hint'))}</p>
      <div class="sheet-actions">
        <div class="grow"></div>
        <button class="btn" id="csCancel" type="button">${esc(t('common.cancel'))}</button>
        <button class="btn primary" type="submit">${esc(t('common.save'))}</button>
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
        confirmTap(del, n ? t('cats.removeFrom', { n }) : t('common.confirm'), () => {
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
      const pending = /** @type {HTMLInputElement} */ (back.querySelector('#csNew'));
      // The keyboard's ✓ key in "New category" submits the form
      // (on Android it does not always arrive as an Enter key):
      // it adds the category instead of saving and closing.
      const submitter = /** @type {SubmitEvent} */ (e).submitter;
      if (!submitter && document.activeElement === pending && pending.value.trim()) {
        add();
        return;
      }
      // A name typed but not added yet is never lost.
      const extra = cleanFolderName(pending.value, CAT_NAME_MAX);
      if (
        extra &&
        work.length < MAX_CATS &&
        !work.some((c) => c.name.localeCompare(extra, 'fr', { sensitivity: 'base' }) === 0)
      )
        work.push({ name: extra });
      // Deleted categories: removed from notes; then order and names.
      const kept = new Set(work.map((c) => c.id).filter(Boolean));
      (folder.cats || [])
        .filter((c) => !kept.has(c.id))
        .forEach((c) => deleteCategory(folder, c.id, state.notes));
      folder.cats = [];
      work.forEach((c) => {
        const name = cleanFolderName(c.name, CAT_NAME_MAX);
        if (!name) return; // name erased: category ignored (notes lose it)
        folder.cats.push({ id: c.id || uid(), name });
      });
      // A category whose name was erased also disappears from notes.
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
 * Opens the **File note** panel: its folder (only one) and, in that folder,
 * its categories (as many as wanted). Each choice applies at once; changing
 * the folder clears the categories.
 *
 * @param {module:model~Note} note
 * @param {function()} onChange After each change (save included).
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
    let list = radio('', esc(t('note.unfiled')), '<span class="fdot none" aria-hidden="true"></span>');
    folders.forEach((f) => {
      list += radio(f.id, esc(f.name), `<span class="fdot fc-${f.color}" aria-hidden="true"></span>`);
      if (f.id !== cur) return;
      list += `<div class="ar-cats" role="group" aria-label="${esc(t('cats.title', { name: f.name }))}">${(
        f.cats || []
      )
        .map(
          (c) =>
            `<button type="button" class="chip" data-cat="${esc(c.id)}" aria-pressed="${mine.has(c.id)}">${esc(c.name)}</button>`,
        )
        .join(
          '',
        )}<form class="ar-new" id="arNewForm"><input type="text" id="arNew" maxlength="${CAT_NAME_MAX}" autocomplete="off" placeholder="${esc(t('cats.new'))}" enterkeyhint="done" aria-label="${esc(t('cats.new'))}"><button type="submit" class="btn small">${esc(t('common.add'))}</button></form></div>`;
    });
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="arTitle">
      <div class="ar-head"><h2 id="arTitle">${esc(t('arrange.title'))}</h2><button type="button" class="btn primary" id="arDone">${esc(t('common.finish'))}</button></div>
      <div class="ar-list" role="radiogroup" aria-labelledby="arTitle">${list}</div>
      <button type="button" class="btn ghost" id="arNewFolder">+ ${esc(t('home.newFolder'))}</button>
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
    /** Creates the typed category and checks it on the note. */
    const addTyped = () => {
      const f = state.folders[note.folder];
      const c = f && input && addCategory(f, input.value);
      if (!c) return false;
      saveFolders(state.folders);
      fileNote(note, f.id, [...(note.cats || []), c.id]);
      onChange();
      return true;
    };
    // "Add" button or the keyboard's ✓ key (form submission: more
    // reliable on Android than an Enter key).
    back.querySelector('#arNewForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (addTyped()) render();
    });
    back.querySelector('#arDone').addEventListener('click', () => {
      addTyped(); // a name typed but not added is not lost
      close();
    });
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
