/**
 * @module ui/nav
 * @description
 * **Navigation entre écrans** : accueil (`list`), note (`note`), options (`options`).
 *
 * ## Registre d'écrans
 *
 * Chaque module d'écran s'enregistre au chargement avec
 * {@link module:ui/nav.registerScreen|registerScreen} ; la navigation appelle
 * ensuite l'écran par son nom. Ce module n'importe donc **aucun** écran : c'est
 * ce qui supprime les imports circulaires d'avant la 2.0 (la vue liste
 * importait la note, qui importait la liste…). Les dépendances vont toujours
 * des écrans vers `nav`, jamais l'inverse.
 *
 * ## Bouton retour d'Android
 *
 * L'accueil est l'écran racine ; note, options et entraînement sont des
 * « sous-écrans ». En entrant dans un sous-écran, on ajoute une entrée à
 * l'historique du navigateur (`history.pushState`) qui mémorise l'écran. Le
 * bouton retour d'Android déclenche alors un événement `popstate` (écouté dans
 * `main.js`) qui réaffiche l'écran mémorisé dans l'entrée précédente (ou
 * l'accueil), au lieu de fermer l'app.
 *
 * - {@link module:ui/nav.go|go} ouvre un sous-écran de premier niveau ;
 *   passer d'un sous-écran à un autre **remplace** l'entrée (`replaceState`).
 * - {@link module:ui/nav.goChild|goChild} ouvre un écran **enfant** (Rythme
 *   dans Entraînement) : nouvelle entrée, le retour revient au parent.
 */

import { state } from './state.js';

/**
 * Options de rendu d'un écran.
 * @typedef {Object} RenderOptions
 * @property {boolean} [keepScroll] Conserver la position de défilement (re-rendu après une modification).
 * @property {boolean} [focusTitle] Écran note : placer le curseur dans le titre.
 */

/**
 * Fonction de rendu d'un écran. Renvoie `false` si l'écran ne peut pas
 * s'afficher (note disparue, par exemple) : on retombe alors sur l'accueil.
 * @typedef {function(RenderOptions): (boolean|void)} ScreenRenderer
 */

/** @type {Object.<string, ScreenRenderer>} */
const screens = {};

/**
 * Noms d'écrans.
 * @typedef {'list'|'note'|'options'|'training'|'rhythm'|'gen'|'genPlay'} ScreenName
 */

/**
 * Enregistre un écran.
 * @param {ScreenName} name
 * @param {ScreenRenderer} fn
 */
export function registerScreen(name, fn) {
  screens[name] = fn;
}

/**
 * Redessine l'écran courant (`state.view`).
 * @param {RenderOptions} [opts={}]
 */
export function renderScreen(opts = {}) {
  const fn = screens[state.view.name];
  if (fn && fn(opts) !== false) return;
  state.view = { name: 'list', id: null };
  screens.list(opts);
}

/**
 * À appeler en entrant dans un sous-écran de premier niveau.
 * @param {ScreenName} name
 * @param {string|null} id
 */
function enterSubView(name, id) {
  const entry = { inkline: 1, view: name, id };
  if (history.state && history.state.inkline) history.replaceState(entry, '');
  else history.pushState(entry, '');
}

/**
 * Affiche un écran (sans toucher à l'historique).
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
 * Ouvre un sous-écran de premier niveau : historique, état, rendu, retour en haut de page.
 * @param {ScreenName} name
 * @param {string|null} [id=null] Note à afficher (écran `note`).
 * @param {RenderOptions} [opts={}]
 */
export function go(name, id = null, opts = {}) {
  if (name !== 'list') enterSubView(name, id);
  show(name, id, opts);
}

/**
 * Ouvre un écran enfant du sous-écran courant : le retour ramènera au parent.
 * @param {ScreenName} name
 */
export function goChild(name) {
  history.pushState({ inkline: 1, view: name, id: null }, '');
  show(name, null, {});
}

/**
 * Bouton retour d'Android (`popstate`) : réaffiche l'écran mémorisé dans
 * l'entrée d'historique où l'on revient, ou l'accueil.
 * @param {*} entry `history.state` après le retour.
 */
export function onHistoryBack(entry) {
  if (entry && entry.inkline && entry.view) show(entry.view, entry.id || null, {});
  else if (state.view.name !== 'list') showList();
}

/**
 * Ouvre une note.
 * @param {string} id
 * @param {boolean} [focusTitle] Placer le curseur dans le titre.
 */
export function openNote(id, focusTitle) {
  go('note', id, { focusTitle });
}

/**
 * Affiche l'accueil (sans toucher à l'historique).
 */
function showList() {
  state.view = { name: 'list', id: null };
  renderScreen();
  window.scrollTo(0, 0);
}

/**
 * Bouton « retour » d'un écran : on recule dans l'historique si on y a ajouté
 * une entrée (le `popstate` affichera l'écran précédent), sinon on affiche
 * directement l'accueil.
 */
export function backToList() {
  if (history.state && history.state.inkline) history.back();
  else showList();
}
