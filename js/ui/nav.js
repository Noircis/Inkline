/**
 * @module ui/nav
 * @description
 * **Navigation between screens**: home (`list`), note (`note`), settings (`options`).
 *
 * ## Screen registry
 *
 * Each screen module registers at load time with
 * {@link module:ui/nav.registerScreen|registerScreen}; navigation then calls
 * the screen by name. This module therefore imports **no** screen: this is
 * what removed the circular imports from before 2.0 (the list view imported
 * the note, which imported the list…). Dependencies always go from screens
 * to `nav`, never the other way.
 *
 * ## Android back button
 *
 * Home is the root screen; note, settings and practice are "sub-screens".
 * Entering a sub-screen adds an entry to the browser history
 * (`history.pushState`) that remembers the screen. Android's back button
 * then fires a `popstate` event (listened to in `main.js`) that shows again
 * the screen stored in the previous entry (or home), instead of closing the
 * app.
 *
 * - {@link module:ui/nav.go|go} opens a top-level sub-screen; going from one
 *   sub-screen to another **replaces** the entry (`replaceState`).
 * - {@link module:ui/nav.goChild|goChild} opens a **child** screen (Rhythm in
 *   Practice): new entry, back returns to the parent.
 */

import { state } from './state.js';

/**
 * Screen render options.
 * @typedef {Object} RenderOptions
 * @property {boolean} [keepScroll] Keep the scroll position (re-render after a change).
 * @property {boolean} [focusTitle] Note screen: put the cursor in the title.
 */

/**
 * Screen render function. Returns `false` if the screen cannot be shown (a
 * note that disappeared, for example): we then fall back to home.
 * @typedef {function(RenderOptions): (boolean|void)} ScreenRenderer
 */

/** @type {Object.<string, ScreenRenderer>} */
const screens = {};

/**
 * Screen names.
 * @typedef {'list'|'note'|'options'|'training'|'rhythm'|'gen'|'genPlay'} ScreenName
 */

/**
 * Registers a screen.
 * @param {ScreenName} name
 * @param {ScreenRenderer} fn
 */
export function registerScreen(name, fn) {
  screens[name] = fn;
}

/**
 * Redraws the current screen (`state.view`).
 * @param {RenderOptions} [opts={}]
 */
export function renderScreen(opts = {}) {
  const fn = screens[state.view.name];
  if (fn && fn(opts) !== false) return;
  state.view = { name: 'list', id: null };
  screens.list(opts);
}

/**
 * To be called when entering a top-level sub-screen.
 * @param {ScreenName} name
 * @param {string|null} id
 */
function enterSubView(name, id) {
  const entry = { inkline: 1, view: name, id };
  if (history.state && history.state.inkline) history.replaceState(entry, '');
  else history.pushState(entry, '');
}

/**
 * Shows a screen (without touching history).
 * @param {ScreenName} name
 * @param {string|null} id
 * @param {RenderOptions} opts
 */
function show(name, id, opts) {
  state.view = { name, id };
  state.activeId = null;
  state.sel = null;
  renderScreen(opts);
  window.scrollTo(0, 0);
}

/**
 * Opens a top-level sub-screen: history, state, render, back to top of page.
 * @param {ScreenName} name
 * @param {string|null} [id=null] Note to show (`note` screen).
 * @param {RenderOptions} [opts={}]
 */
export function go(name, id = null, opts = {}) {
  if (name !== 'list') enterSubView(name, id);
  show(name, id, opts);
}

/**
 * Opens a child screen of the current sub-screen: back will return to the parent.
 * @param {ScreenName} name
 */
export function goChild(name) {
  history.pushState({ inkline: 1, view: name, id: null }, '');
  show(name, null, {});
}

/**
 * Android back button (`popstate`): shows again the screen stored in the
 * history entry we return to, or home.
 * @param {*} entry `history.state` after going back.
 */
export function onHistoryBack(entry) {
  if (entry && entry.inkline && entry.view) show(entry.view, entry.id || null, {});
  else if (state.view.name !== 'list') showList();
}

/**
 * Opens a note.
 * @param {string} id
 * @param {boolean} [focusTitle] Put the cursor in the title.
 */
export function openNote(id, focusTitle) {
  go('note', id, { focusTitle });
}

/**
 * Shows home (without touching history).
 */
function showList() {
  state.view = { name: 'list', id: null };
  renderScreen();
  window.scrollTo(0, 0);
}

/**
 * A screen's "back" button: go back in history if an entry was added (the
 * `popstate` will show the previous screen), otherwise show home directly.
 */
export function backToList() {
  if (history.state && history.state.inkline) history.back();
  else showList();
}
