/**
 * @module ui/note
 * @description
 * **Note screen**: title, filing (folder, pin), blocks, add bar, sharing,
 * deletion.
 *
 * Rendering is done with template strings and `innerHTML`, then event
 * handlers are wired to the created elements. Text blocks are handled here;
 * staff and chart blocks are delegated, through the registry of
 * {@link module:ui/blocks|ui/blocks}, to {@link module:ui/staff/index|ui/staff}
 * and {@link module:ui/grid-ui|ui/grid-ui}.
 */

import { t } from '../i18n.js';
import { state, app, curNote, touch, saveArrangement } from './state.js';
import { esc } from '../util.js';
import { newTextBlock, newStaffBlock, newGridBlock } from '../model.js';
import { folderOf, catsOf } from '../folders.js';
import { flushSave } from '../storage.js';
import { noteToInkline, noteToPng, noteToPdf, shareOrDownload, slug } from '../export.js';
import { pushSnapshot } from '../history.js';
import * as audio from '../audio.js';
import { registerScreen, backToList, renderScreen } from './nav.js';
import { toolsHtml, autosize, confirmTap, metroButton } from './common.js';
import { PIN_ICON } from './icons.js';
import { blockKind, redrawBlock, setActive, updateActive } from './blocks.js';
import { openArrangeSheet } from './folder-sheet.js';

/**
 * Filing button of a note (2.8.6): "● Saxophone › Technique, Son".
 * It opens the File note panel ({@link module:ui/folder-sheet.openArrangeSheet|openArrangeSheet}).
 * @param {module:model~Note} n
 * @returns {string}
 */
function folderButtonHtml(n) {
  const f = folderOf(n, state.folders);
  const cats = catsOf(n, state.folders);
  const label = f
    ? esc(f.name) +
      (cats.length ? ` <span class="nf-cats">› ${esc(cats.map((c) => c.name).join(', '))}</span>` : '')
    : esc(t('note.unfiled'));
  return `<button type="button" class="note-folder" id="folderBtn" aria-haspopup="dialog"><span class="fdot ${f ? 'fc-' + f.color : 'none'}" aria-hidden="true"></span><span class="sr">${esc(t('note.filing'))}</span><span class="nf-name">${label}</span><span class="nf-chev" aria-hidden="true">&#9662;</span></button>`;
}

/**
 * Note screen.
 * @param {module:ui/nav~RenderOptions} [opts={}]
 * @returns {boolean|void} `false` if the note no longer exists.
 */
function renderNote(opts = {}) {
  const n = curNote();
  if (!n) return false;
  const sy = window.scrollY;
  app.innerHTML = `<header class="top"><button class="btn ghost" id="back" type="button">&#8249; ${esc(t('note.back'))}</button><div class="grow"></div>${metroButton()}<button class="btn icon-btn pin-btn" id="pinBtn" type="button" aria-pressed="${!!n.pinned}" aria-label="${esc(t('note.pin'))}">${PIN_ICON}</button><button class="btn" id="shareBtn" type="button" aria-expanded="false">${esc(t('note.share'))}</button></header>
  <div class="sharebox" id="shareBox" hidden>
    <button class="btn primary" type="button" data-share="inkline">${esc(t('note.shareInkline'))}<small>${esc(t('note.shareInklineSub'))}</small></button>
    <button class="btn" type="button" data-share="png">${esc(t('note.shareImage'))}<small>PNG</small></button>
    <button class="btn" type="button" data-share="pdf">PDF<small>A4</small></button>
    <div class="status" id="shareMsg"></div>
  </div>
  <textarea class="title-in" id="titleIn" rows="1" placeholder="${esc(t('note.titlePlaceholder'))}"></textarea>
  ${folderButtonHtml(n)}
  <div class="blocks" id="blocks"></div>
  <div class="addbar"><button class="btn" data-add="text" type="button">${esc(t('note.addText'))}</button><button class="btn" data-add="staff" type="button">${esc(t('note.addStaff'))}</button><button class="btn" data-add="rhythm" type="button">${esc(t('note.addRhythm'))}</button><button class="btn" data-add="grid" type="button">${esc(t('note.addGrid'))}</button></div>
  <div class="notefoot"><button class="btn ghost danger" id="delNote" type="button">${esc(t('note.delete'))}</button></div>`;

  bindTitle(n);
  bindArrangement(n);
  app.querySelector('#back').onclick = backToList;
  bindShare(n);

  const dn = /** @type {HTMLButtonElement} */ (app.querySelector('#delNote'));
  dn.onclick = () =>
    confirmTap(dn, t('note.deleteConfirm'), () => {
      delete state.notes[n.id];
      flushSave(state.notes);
      backToList();
    });
  app.querySelectorAll('[data-add]').forEach((btn) => {
    btn.onclick = () => addBlock(n, btn.dataset.add);
  });

  const bl = app.querySelector('#blocks');
  n.blocks.forEach((b, bi) => bl.appendChild(blockEl(n, b, bi)));
  // SVGs need the real width: they are drawn after layout.
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
 * Wires the title field.
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
 * Wires the folder picker and the pin. These changes do not touch the note's
 * date ({@link module:ui/state.saveArrangement|saveArrangement}).
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

  const refresh = () => {
    app.querySelector('#folderBtn').outerHTML = folderButtonHtml(n);
    bindFolderButton();
  };
  const bindFolderButton = () =>
    app.querySelector('#folderBtn').addEventListener('click', () =>
      openArrangeSheet(n, () => {
        saveArrangement(n);
        refresh();
      }),
    );
  bindFolderButton();
}

/**
 * Wires a note's "Share" panel.
 *
 * The file is generated on tap, then {@link module:export.shareOrDownload|shareOrDownload}
 * opens Android's share menu or downloads the file. The call to
 * `navigator.share` must closely follow the user's gesture (a few seconds):
 * image generation is fast enough for that.
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
      const title = n.title || t('note.defaultTitle');
      msg.textContent = kind === 'inkline' ? '' : t('note.preparing');
      box.querySelectorAll('button').forEach((x) => {
        x.disabled = true;
      });
      try {
        let res;
        if (kind === 'inkline') {
          // .inkline first; if Android refuses that type, a .txt variant (same content).
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
          res === 'downloaded' ? t('note.downloaded') : res === 'shared' ? t('note.sent') : '';
      } catch (e) {
        msg.textContent = t('note.exportFailed');
      } finally {
        box.querySelectorAll('button').forEach((x) => {
          x.disabled = false;
        });
      }
    };
  });
}

/**
 * Adds a block at the end of the note and activates it.
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
  state.sel = kind === 'grid' ? 0 : null; // a chart opens on its first measure
  renderScreen({ keepScroll: true });
  const el = app.querySelector(`[data-block="${CSS.escape(b.id)}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (kind === 'text') {
      const ta = el.querySelector('textarea');
      if (ta) ta.focus();
    }
  }
}

/**
 * Creates a block's DOM element and wires its tools.
 * @param {module:model~Note} n
 * @param {module:model~Block} b
 * @param {number} bi Position of the block in the note.
 * @returns {HTMLDivElement}
 */
function blockEl(n, b, bi) {
  const el = document.createElement('div');
  el.className = 'block ' + (b.type === 'text' ? 'text' : b.type === 'grid' ? 'gridblk' : 'staff');
  el.dataset.block = b.id;
  if (b.type === 'text') {
    el.innerHTML =
      `<textarea rows="1" placeholder="${esc(bi === 0 ? t('note.writeHere') : t('note.text'))}" id="t_${esc(b.id)}"></textarea>` +
      toolsHtml();
    const ta = el.querySelector('textarea');
    ta.value = b.text;
    ta.addEventListener('focus', () => {
      pushSnapshot(n);
      setActive(b.id);
    });
    ta.addEventListener('input', () => {
      b.text = ta.value;
      autosize(ta);
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
          t('common.confirm'),
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
