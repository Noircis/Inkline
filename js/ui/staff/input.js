/**
 * @module ui/staff/input
 * @description
 * **Taps on the staff** and **input modes** (2.5), modeled on MuseScore's
 * "N" mode:
 *
 * - **Write**: the palette sets the next note; tapping a note puts the
 *   insertion cursor before it; the blue zone inserts a note.
 * - **Edit**: tapping a note selects it; the palette changes it; tapping
 *   higher or lower moves it.
 *
 * **Dragging** (2.8.2): fingers are not always precise. In the insertion zone
 * (Write) or on the selected note (Edit), the note follows the finger as long
 * as it stays down: you hear it change pitch, and a bubble above the finger
 * shows its name. It is placed when the finger lifts. Elsewhere, nothing
 * changes: the page can be scrolled from the staff.
 *
 * After any insertion, the staff is fitted back into measures
 * ({@link module:ui/staff/shared.refit|refit}): a note that overflows is
 * split at the barline and tied.
 *
 * **Chords** (2.17): with the palette's "+♪" on, a tap adds a note to the
 * target note (the one before the cursor, or the selected one) at the tapped
 * pitch, or removes the note already there.
 *
 * **Several staves** (2.17): a tap on another staff of the block makes it the
 * staff being edited; a tap on a clef opens the staff menu
 * ({@link module:ui/staff/part-menu|ui/staff/part-menu}).
 */

import { t } from '../../i18n.js';
import { state, touch } from '../state.js';
import { chainStart, chainEnd } from '../../measure-fit.js';
import { layout, geom, stepFromY, bandAt, INSERT_GAP } from '../../layout.js';
import { pushSnapshot, discardSnapshot } from '../../history.js';
import { pitchName } from '../../pitch.js';
import * as audio from '../../audio.js';
import { setActive } from '../blocks.js';
import {
  hooks,
  clampCursor,
  refit,
  flash,
  insertIndex,
  activePart,
  activeStaff,
  targetIndex,
} from './shared.js';
import { closeChord } from './chord.js';
import { openPartMenu } from './part-menu.js';
import { partView } from '../../parts.js';
import { toggleHead, moveHeads, copyHeads } from '../../noteheads.js';

/** Width (px) of the clef zone, at the start of each line: a tap there opens the staff menu. */
const CLEF_ZONE = 30;

/**
 * Item to insert, built from the input settings.
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g Geometry of the tapped line.
 * @param {number} y Y of the tap (pitch of the note).
 * @param {number} at Insertion index.
 * @returns {module:model~StaffItem}
 */
function newItem(b, L, g, y, at) {
  const inp = state.input;
  /** @type {module:model~StaffItem} */
  const it = { d: inp.d };
  if (inp.dot) it.dot = true;
  if (inp.tup) it.tup = 3;
  const prev = b.items[at - 1];
  // A tie starting from the previous note was aimed at the old neighbor:
  // it no longer makes sense if another note is inserted between the two.
  if (prev && prev.tie && !(inp.tie && !inp.rest)) delete prev.tie;
  if (inp.rest) {
    it.r = true;
  } else if (inp.tie && prev && !prev.r) {
    // Tied note: same pitch(es) as the previous one, the tapped position is ignored.
    prev.tie = true;
    if (!L.rh) copyHeads(prev, it);
  } else if (!L.rh) {
    it.s = stepFromY(g, y);
    if (inp.acc != null) it.a = inp.acc;
  }
  if (inp.rs) it.rs = true;
  return it;
}

/**
 * Inserts a note (or a rest) with the input settings, at position `at`, then
 * fits the staff back into measures. A triplet that would cross a barline is
 * refused (message in the palette).
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g
 * @param {number} y
 * @param {number} at
 * @returns {number} Index of the inserted note (first piece), -1 if refused.
 */
function insertNote(n, b, L, g, y, at) {
  const before = b.items.map((it) => ({ ...it }));
  const cursorBefore = state.cursor;
  pushSnapshot(n);
  const it = newItem(b, L, g, y, at);
  b.items.splice(at, 0, it);
  // The cursor stays right after the inserted note: you can keep going.
  if (state.cursor != null) state.cursor = at + 1;
  const res = refit(b);
  const idx = res.startOf[at];
  if (it.tup && res.tupCross.has(idx)) {
    b.items = before;
    state.cursor = cursorBefore;
    discardSnapshot(n);
    flash(t('hint.tripletBar'));
    return -1;
  }
  // "Single use" settings consumed; triplet and rest stay on.
  const inp = state.input;
  inp.acc = null;
  inp.rs = false;
  inp.tie = false;
  touch(n);
  audio.previewItem(b, idx);
  return idx;
}

/**
 * Puts note `h` (and the notes tied to it) at position `s`, without undo or
 * save. A chord moves as a whole. A tie joins two notes of the same pitch:
 * moving a note breaks the tie coming into it, and drags along the notes tied
 * to it.
 * @param {module:model~StaffBlock} b
 * @param {number} h Index of the note.
 * @param {number} s New position of its own note.
 */
function setStep(b, h, s) {
  moveHeads(b.items[h], s);
  const prev = b.items[h - 1];
  if (prev && prev.tie) delete prev.tie;
  for (let k = h; b.items[k] && b.items[k].tie && b.items[k + 1] && !b.items[k + 1].r; k++)
    copyHeads(b.items[k], b.items[k + 1]);
}

/**
 * Where a tap lands: line, staff, item touched, insertion zones. Redoes the
 * layout with the same width, staff and cursor as the render.
 * @param {module:model~StaffBlock} block The whole block.
 * @param {HTMLElement} wrap
 * @param {number} cx X in the window.
 * @param {number} cy Y in the window.
 */
function hitTest(block, wrap, cx, cy) {
  const r = wrap.getBoundingClientRect();
  const x = cx - r.left;
  const y = cy - r.top;
  const write = state.mode === 'write';
  const ka = activePart(block);
  const b = partView(block, ka);
  const L = layout(block, wrap._W || wrap.clientWidth, true, write ? state.cursor : null, ka);
  const { sys: si, k } = bandAt(L, y);
  const g = geom(L, si);
  const mine = k === ka;
  const hit = mine
    ? b.items.findIndex((it, i) => L.pos[i].sys === si && x >= L.pos[i].x0 && x < L.pos[i].x1)
    : -1;
  const half = INSERT_GAP / 2 + 2;
  const inAppend =
    mine &&
    L.appendX != null &&
    si === L.appendSys &&
    (L.appendGap ? Math.abs(x - L.appendX) <= half : x >= L.appendX - 14);
  const inInsert = mine && L.insertX != null && si === L.insertSys && Math.abs(x - L.insertX) <= half;
  const onClef = x < L.left + CLEF_ZONE;
  return { x, y, top: r.top, L, g, k, mine, onClef, hit, inAppend, inInsert };
}

/**
 * Chord mode (2.17): a tap adds a note at the tapped pitch to the target note
 * (every piece of it, when it is split at a barline), or removes the note
 * already there. A tap on another note makes it the target.
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b The staff being edited.
 * @param {ReturnType<hitTest>} ht
 */
function stackTap(n, b, ht) {
  const target = targetIndex(b);
  if (ht.hit >= 0 && chainStart(b.items, ht.hit) !== target) {
    const h = chainStart(b.items, ht.hit);
    if (state.mode === 'edit') state.sel = h;
    else state.cursor = chainEnd(b.items, h) + 1 < b.items.length ? chainEnd(b.items, h) + 1 : null;
    audio.previewItem(b, h);
    return;
  }
  if (target < 0) return;
  const first = b.items[target];
  if (ht.L.rh || first.r) {
    flash(t(ht.L.rh ? 'hint.stackRhythm' : 'hint.stackRest'));
    return;
  }
  const s = stepFromY(ht.g, ht.y);
  pushSnapshot(n);
  const acc = state.input.acc;
  let done = null;
  for (let i = target; i <= chainEnd(b.items, target); i++) done = toggleHead(b.items[i], s, acc) ?? done;
  if (done === 'added' || done === 'removed') {
    state.input.acc = null;
    touch(n);
    audio.previewItem(b, target);
  } else {
    discardSnapshot(n);
    flash(t(done === 'full' ? 'hint.stackFull' : 'hint.stackLast'));
  }
}

/**
 * Handles a tap on the staff.
 *
 * 1. Activates the block if it was not active (and closes any keyboard).
 * 2. Redoes the layout with the same width and cursor as the render, then
 *    converts the coordinates: line = `floor(y / lineHeight)`, item = the one
 *    whose interval `[x0, x1)` contains x, pitch =
 *    {@link module:layout.stepFromY|stepFromY}.
 * 3. **Write mode**:
 *    - **blue zone** (at the cursor, or at the end of the staff): inserts a
 *      note with the input settings, at the tapped pitch;
 *    - **a note**: puts the cursor just before it (nothing is changed);
 *    - **end of staff**, when the cursor is in the middle: brings the cursor
 *      back there.
 * 4. **Edit mode**:
 *    - **the note already selected**: moves it to the tapped pitch;
 *    - **another note**: selects it;
 *    - elsewhere: deselects.
 *
 * A note split by a barline is handled as a whole: it is selected, or the
 * cursor placed, always on its first piece.
 *
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} b
 * @param {MouseEvent} e
 */
function staffTap(n, block, e) {
  const wasActive = state.activeId === block.id;
  if (!wasActive) {
    setActive(block.id);
    const ae = /** @type {HTMLElement} */ (document.activeElement);
    if (ae && ae.blur && ae !== document.body) ae.blur();
  }
  const wrap = /** @type {HTMLElement} */ (e.currentTarget);
  const ht = hitTest(block, wrap, e.clientX, e.clientY);
  const { y, L, g, hit, inAppend, inInsert } = ht;

  // Another staff of the block, or a clef: change the staff being edited.
  if (!ht.mine || (ht.onClef && wasActive)) {
    if (!ht.mine) selectPart(block, ht.k);
    if (ht.onClef && wasActive) openPartMenu(block, ht.k);
    hooks.redraw(block.id);
    return;
  }
  const b = partView(block, ht.k);
  clampCursor(b);

  if (state.input.stack) {
    stackTap(n, b, ht);
  } else if (state.mode === 'write') {
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
  hooks.redraw(block.id);
}

/**
 * Makes staff `k` the one being edited: the cursor goes to its end, nothing
 * is selected.
 * @param {module:model~StaffBlock} block
 * @param {number} k
 */
export function selectPart(block, k) {
  if (state.part === k) return;
  closeChord();
  state.part = k;
  state.cursor = null;
  state.sel = null;
}

/**
 * Zones where a drag can start, laid as invisible overlays on the staff
 * (`touch-action: none`). The browser decides to scroll the page as soon as
 * the finger touches the screen, before our handlers even run: it must
 * therefore be told in advance where the finger is used to place a note.
 * Everywhere else, the page scrolls as before.
 *
 * Same zones as {@link hitTest}: the insertion zone and the add zone (Write),
 * the selected note (Edit), over the full height of the line.
 *
 * Only on the staff being edited, and not in chord mode (a tap there adds a
 * note to the chord).
 *
 * @param {module:model~StaffBlock} block The whole block.
 * @param {number} W Render width.
 * @returns {string} HTML of the overlays (empty if none).
 */
export function dragZonesHtml(block, W) {
  if (state.activeId !== block.id || state.input.stack) return '';
  const ka = activePart(block);
  const b = partView(block, ka);
  if (b.clef === 'rhythm') return '';
  const write = state.mode === 'write';
  const L = layout(block, W, true, write ? state.cursor : null, ka);
  const band = L.parts[ka];
  const zone = (sys, x0, x1) =>
    `<div class="drag-zone" style="left:${Math.max(0, x0)}px;top:${sys * L.SH + band.off}px;width:${Math.max(0, Math.min(W, x1) - Math.max(0, x0))}px;height:${band.H}px"></div>`;
  const half = INSERT_GAP / 2 + 2;
  if (write) {
    if (L.insertX != null) return zone(L.insertSys, L.insertX - half, L.insertX + half);
    if (L.appendX != null && state.cursor == null)
      return L.appendGap
        ? zone(L.appendSys, L.appendX - half, L.appendX + half)
        : zone(L.appendSys, L.appendX - 14, W);
    return '';
  }
  const h = state.sel;
  if (h == null || !b.items[h] || b.items[h].r) return '';
  let out = '';
  for (let i = h; i <= chainEnd(b.items, h); i++)
    if (L.pos[i]) out += zone(L.pos[i].sys, L.pos[i].x0, L.pos[i].x1);
  return out;
}

/** Bubble showing the note name during a drag (created on first use). */
let tip = null;

/**
 * Shows (or hides, with empty `text`) the bubble above the finger.
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
  tip.style.top = `${cy - 44}px`; // above the finger, which hides the note
}

/**
 * Wires touch on a staff's area: note dragging (2.8.2) and simple taps
 * ({@link staffTap}).
 *
 * A drag starts on `pointerdown`:
 * - **Write**, in the insertion zone (or the add zone at the end of the
 *   staff): the note is inserted right away, at the finger's pitch;
 * - **Edit**, on the note already selected: it goes to the finger's pitch.
 *
 * Then, as long as the finger stays down, the note follows (`pointermove`);
 * it is placed when the finger lifts. The whole gesture counts as a single
 * undo. During the gesture, page scrolling is blocked (`touchmove`
 * cancelled); everywhere else on the staff, the page scrolls normally.
 *
 * The vertical reference is frozen at the start of the gesture: if the staff
 * grows (very high note), the note does not run away under the finger.
 *
 * A tap that does not start a drag stays a simple `click` ({@link staffTap}):
 * place the cursor, select, deselect.
 *
 * @param {module:model~Note} n
 * @param {module:model~StaffBlock} block The whole block.
 * @param {HTMLElement} wrap
 */
export function bindStaffInput(n, block, wrap) {
  /** The staff being edited, seen as a block (it may change between gestures). */
  let b = block;
  /** Gesture in progress. */
  let drag = null;
  /** The `click` following a gesture must not be handled a second time. */
  let consumed = false;

  wrap.addEventListener('pointerdown', (e) => {
    consumed = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Inactive or collapsed block: the first tap activates it (see staffTap / fold).
    if (state.activeId !== block.id || wrap.closest('.folded')) return;
    // Chord mode: taps only (see staffTap).
    if (state.input.stack) return;
    b = partView(block, activePart(block));
    clampCursor(b);
    const ht = hitTest(block, wrap, e.clientX, e.clientY);
    // Another staff, or a clef: handled by the tap (see staffTap).
    if (!ht.mine || ht.onClef) return;
    let h;
    let movable;
    if (state.mode === 'write') {
      const at = ht.inInsert
        ? state.cursor
        : ht.hit < 0 && ht.inAppend && state.cursor == null
          ? b.items.length
          : null;
      if (at == null) return;
      const tie = state.input.tie && !state.input.rest;
      h = insertNote(n, b, ht.L, ht.g, ht.y, at);
      consumed = true;
      hooks.redraw(block.id);
      if (h < 0) return;
      // Rest, tied note (pitch imposed), rhythm line: nothing to drag.
      movable = !b.items[h].r && !ht.L.rh && !tie;
      drag = { h, g: ht.g, top: ht.top, id: e.pointerId, s: b.items[h].s, start: b.items[h].s, fresh: true };
    } else {
      if (ht.hit < 0) return;
      h = chainStart(b.items, ht.hit);
      if (state.sel !== h || b.items[h].r || ht.L.rh) return;
      movable = true;
      consumed = true;
      pushSnapshot(n);
      drag = { h, g: ht.g, top: ht.top, id: e.pointerId, s: b.items[h].s, start: b.items[h].s, fresh: false };
      moveTo(stepFromY(ht.g, ht.y));
      audio.previewItem(b, h);
    }
    if (!movable) {
      drag = null;
      return;
    }
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    showTip(pitchName(b.clef, drag.s, b.items[h].a, b.ks), e.clientX, e.clientY);
  });

  /**
   * Puts the gesture's note at position `s` and redraws.
   * @param {number} s
   * @returns {boolean} The pitch changed.
   */
  function moveTo(s) {
    if (s === drag.s) return false;
    drag.s = s;
    setStep(b, drag.h, s);
    drag.s = b.items[drag.h].s; // a chord may stop at the edge of the staff
    hooks.redraw(block.id);
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
    else if (!drag.fresh) discardSnapshot(n); // touched without changing anything
    drag = null;
    showTip('');
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // During a drag, the finger moves the note, not the page.
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
    staffTap(n, block, /** @type {MouseEvent} */ (e));
  });
}

/**
 * Changes mode. Switching to Edit selects the note just before the cursor;
 * returning to Write puts the cursor just after the note that was selected:
 * you pick up where you left off.
 * @param {'write'|'edit'} mode
 */
export function setMode(mode) {
  const a = activeStaff();
  if (!a || state.mode === mode) return;
  const { b } = a;
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
