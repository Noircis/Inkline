/**
 * @module ui/staff/part-menu
 * @description
 * **Staff menu** of a block with one or more staves (2.17), opened by a tap
 * on a clef: the staff's clef (treble, bass, rhythm), move it up or down, add
 * a staff under it, remove it. It shows as a panel under the block header,
 * like the instrument question.
 *
 * The menu acts on the staff being edited (`state.part`); the tap on a clef
 * makes that staff the one being edited first.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app, curNote, touch } from '../state.js';
import { pushSnapshot } from '../../history.js';
import { partsOf, partView, addPart, removePart, movePart, setPartClef, PARTS_MAX } from '../../parts.js';
import { confirmTap } from '../common.js';
import { hooks, activePart } from './shared.js';

/** Clefs offered, in menu order. */
const CLEFS = ['treble', 'bass', 'rhythm'];

/** Block whose menu is open, or `null`. */
let openId = null;

/**
 * Element of a staff block, by id.
 * @param {string} id
 * @returns {?HTMLElement}
 */
const blockEl = (id) => app.querySelector(`[data-block="${CSS.escape(id)}"]`);

/**
 * Opens the menu of the staff being edited of a block.
 * @param {module:model~StaffBlock} block
 */
export function openPartMenu(block) {
  if (openId && openId !== block.id) closePartMenu();
  openId = block.id;
  renderPartMenu(block);
}

/** Closes the menu, if it is open. */
export function closePartMenu() {
  if (!openId) return;
  blockEl(openId)?.querySelector('.part-menu')?.remove();
  openId = null;
}

/**
 * Adds a staff under the staff being edited and makes it the one being
 * edited (the "+ Staff" button of the block's tools, and the menu).
 * @param {module:model~StaffBlock} block
 * @returns {boolean} Added (`false` when the block already has {@link module:parts.PARTS_MAX|PARTS_MAX} staves).
 */
export function addStaffTo(block) {
  const n = curNote();
  if (!n || partsOf(block).length >= PARTS_MAX) return false;
  pushSnapshot(n);
  const k = addPart(block, activePart(block));
  state.part = k;
  state.cursor = null;
  state.sel = null;
  touch(n);
  return true;
}

/**
 * Draws the menu (again) under the block header.
 * @param {module:model~StaffBlock} block
 */
function renderPartMenu(block) {
  const el = blockEl(block.id);
  if (!el) return;
  el.querySelector('.part-menu')?.remove();
  const parts = partsOf(block);
  const k = activePart(block);
  const clef = parts[k].clef;
  const clefs = CLEFS.map(
    (c) =>
      `<button type="button" role="radio" class="chip" data-pm-clef="${c}" aria-checked="${c === clef}" aria-pressed="${c === clef}">${esc(t('parts.clef.' + c))}</button>`,
  ).join('');
  const menu = document.createElement('div');
  menu.className = 'part-menu';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', t('parts.menu'));
  menu.innerHTML = `<div class="pm-head"><b>${esc(t('parts.staffN', { n: k + 1, count: parts.length }))}</b><span class="grow"></span><button type="button" class="btn icon-btn" data-pm="close" aria-label="${esc(t('common.close'))}">&#x2715;</button></div>
<div class="pm-clefs" role="radiogroup" aria-label="${esc(t('staff.clef'))}">${clefs}</div>
<div class="pm-acts">
<button type="button" class="btn" data-pm="up"${k > 0 ? '' : ' disabled'}>&#8593; ${esc(t('common.moveUp'))}</button>
<button type="button" class="btn" data-pm="down"${k < parts.length - 1 ? '' : ' disabled'}>&#8595; ${esc(t('common.moveDown'))}</button>
<button type="button" class="btn" data-pm="add"${parts.length < PARTS_MAX ? '' : ' disabled'}>+ ${esc(t('parts.addBelow'))}</button>
<button type="button" class="btn" data-pm="del"${parts.length > 1 ? '' : ' disabled'}>${esc(t('parts.remove'))}</button>
</div>`;
  el.querySelector('.shead').after(menu);
  menu.addEventListener('click', (e) => onMenuClick(block, /** @type {HTMLElement} */ (e.target)));
}

/**
 * Applies a change to the block, with undo and save, then redraws the staff
 * and the menu.
 * @param {module:model~StaffBlock} block
 * @param {function()} change
 */
function apply(block, change) {
  const n = curNote();
  if (!n) return;
  pushSnapshot(n);
  change();
  state.cursor = null;
  state.sel = null;
  touch(n);
  hooks.redraw(block.id);
  if (openId === block.id) renderPartMenu(block);
}

/**
 * A button of the menu.
 * @param {module:model~StaffBlock} block
 * @param {HTMLElement} target
 */
function onMenuClick(block, target) {
  const btn = /** @type {?HTMLButtonElement} */ (target.closest('button'));
  if (!btn || btn.disabled) return;
  const k = activePart(block);
  if (btn.dataset.pmClef) {
    const clef = /** @type {'treble'|'bass'|'rhythm'} */ (btn.dataset.pmClef);
    if (clef !== partsOf(block)[k].clef) apply(block, () => setPartClef(partView(block, k), clef));
    return;
  }
  switch (btn.dataset.pm) {
    case 'close':
      closePartMenu();
      break;
    case 'up':
    case 'down':
      apply(block, () => (state.part = movePart(block, k, btn.dataset.pm === 'up' ? -1 : 1)));
      break;
    case 'add':
      if (addStaffTo(block)) {
        hooks.redraw(block.id);
        renderPartMenu(block);
      }
      break;
    case 'del': {
      const remove = () =>
        apply(block, () => {
          removePart(block, k);
          state.part = Math.max(0, k - 1);
        });
      // A staff with notes asks for a second tap.
      if (partsOf(block)[k].items.length) confirmTap(btn, t('common.confirm'), remove, 3000);
      else remove();
      break;
    }
  }
}
