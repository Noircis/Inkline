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
 * L'accueil est l'écran racine ; note et options sont des « sous-écrans ».
 * En entrant dans un sous-écran, on ajoute UNE entrée à l'historique du
 * navigateur (`history.pushState`). Le bouton retour d'Android déclenche alors
 * un événement `popstate` (écouté dans `main.js`) qui ramène à l'accueil, au
 * lieu de fermer l'app. Passer d'un sous-écran à un autre remplace l'entrée
 * (`replaceState`) : l'historique ne fait jamais plus d'un niveau.
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
 * Enregistre un écran.
 * @param {'list'|'note'|'options'} name
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
 * À appeler en entrant dans un sous-écran (note, options).
 */
export function enterSubView() {
  if (history.state && history.state.inkline) history.replaceState({ inkline: 1 }, '');
  else history.pushState({ inkline: 1 }, '');
}

/**
 * Ouvre un écran : historique, état, rendu, retour en haut de page.
 * @param {'list'|'note'|'options'} name
 * @param {string|null} [id=null] Note à afficher (écran `note`).
 * @param {RenderOptions} [opts={}]
 */
export function go(name, id = null, opts = {}) {
  if (name !== 'list') enterSubView();
  state.view = { name, id };
  state.activeId = null;
  state.sel = null;
  renderScreen(opts);
  window.scrollTo(0, 0);
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
export function showList() {
  state.view = { name: 'list', id: null };
  renderScreen();
  window.scrollTo(0, 0);
}

/**
 * Retour à l'accueil depuis un sous-écran : on recule dans l'historique si
 * on y a ajouté une entrée (le `popstate` affichera l'accueil), sinon on
 * affiche directement l'accueil.
 */
export function backToList() {
  if (history.state && history.state.inkline) history.back();
  else showList();
}
