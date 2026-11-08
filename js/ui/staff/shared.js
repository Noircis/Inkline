/**
 * @module ui/staff/shared
 * @description
 * **Socle commun** des modules du bloc portée : état propre à la portée
 * (accord en cours de saisie, message ponctuel) et opérations partagées
 * (remise en mesure, position d'insertion, note visée, modification de la
 * sélection).
 *
 * ## Découpage du bloc portée
 *
 * ```
 * staff/index     enregistre le type de bloc auprès de ui/blocks
 *  ├─ view        en-tête du bloc et dessin de la portée
 *  │   └─ input   toucher sur la portée, modes Écrire / Modifier
 *  └─ palette     palette du bas d'écran
 *      ├─ bars    sous-menu des barres
 *      └─ chord   saisie d'un accord chiffré
 * tous ──▶ shared (ce module)
 * ```
 *
 * ## Crochets (hooks)
 *
 * Presque tout doit pouvoir **redessiner la portée** et **rafraîchir la
 * palette**, mais ces deux fonctions vivent dans `view` et `palette`, qui
 * importent eux-mêmes ce module. Pour éviter un import circulaire, elles sont
 * enregistrées dans {@link module:ui/staff/shared.hooks|hooks} au chargement
 * de leur module, et appelées à travers lui : une inversion de dépendance,
 * l'équivalent d'un pointeur de fonction fixé à l'initialisation en C++.
 */

import { state, curNote, blockById, touch } from '../state.js';
import { qlen } from '../../model.js';
import { normalizeStaff, chainStart, chainEnd, singleValue } from '../../measure-fit.js';
import { pushSnapshot } from '../../history.js';

/**
 * Fonctions fournies par d'autres modules du bloc portée : `redraw` (par
 * `view`) et `refreshPalette` (par `palette`).
 * @type {{redraw: function(string), refreshPalette: function()}}
 */
export const hooks = {
  redraw: () => {},
  refreshPalette: () => {},
};

/**
 * État propre au bloc portée : `chordTarget`, la note dont on saisit l'accord
 * (surlignée en mode Écrire) ; `notice`, message ponctuel de la ligne d'aide
 * (refus d'une action).
 * @type {{chordTarget: ?{b: module:model~StaffBlock, i: number}, notice: string}}
 */
export const staffUi = { chordTarget: null, notice: '' };

let noticeTimer = null;

/**
 * Affiche un message dans la ligne d'aide de la palette pendant quelques secondes.
 * @param {string} text
 */
export function flash(text) {
  staffUi.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    staffUi.notice = '';
    hooks.refreshPalette();
  }, 3500);
  hooks.refreshPalette();
}

/**
 * Bloc portée actif et sa note (ou `null`).
 * @returns {?{n: module:model~Note, b: module:model~StaffBlock}}
 */
export function activeStaff() {
  const n = curNote();
  const b = /** @type {module:model~StaffBlock} */ (blockById(state.activeId));
  return n && b && b.type === 'staff' ? { n, b } : null;
}

/**
 * Garde le curseur d'insertion et la sélection dans les bornes (après une
 * suppression ou une annulation, par exemple). Curseur `null` = fin de portée.
 * @param {module:model~StaffBlock} b
 */
export function clampCursor(b) {
  if (state.cursor != null && (state.cursor < 0 || state.cursor >= b.items.length)) state.cursor = null;
  if (state.sel != null && !b.items[state.sel]) state.sel = null;
}

/**
 * Remet la portée en mesure après une modification (liaisons automatiques aux
 * barres, voir {@link module:measure-fit|measure-fit}) et recale la sélection
 * et le curseur sur les nouveaux index.
 * @param {module:model~StaffBlock} b
 * @returns {{startOf: number[], tupCross: Set.<number>}}
 */
export function refit(b) {
  const res = normalizeStaff(b.items, b.time);
  if (state.sel != null) state.sel = res.startOf[state.sel] ?? null;
  if (state.cursor != null) {
    const c = res.startOf[state.cursor];
    state.cursor = c == null || c >= res.items.length ? null : c;
  }
  b.items = res.items;
  return res;
}

/**
 * Position d'insertion effective : index de l'élément devant lequel la
 * prochaine note arrivera (`items.length` = à la fin).
 * @param {module:model~StaffBlock} b
 * @returns {number}
 */
export function insertIndex(b) {
  return state.cursor != null ? state.cursor : b.items.length;
}

/**
 * Note logique à laquelle s'appliquent les barres et l'accord chiffré : la
 * note sélectionnée en mode Modifier, la note juste avant le curseur en mode
 * Écrire (à défaut, la dernière ou la première). Renvoie son premier morceau.
 * @param {module:model~StaffBlock} b
 * @returns {number} -1 si la portée est vide.
 */
export function targetIndex(b) {
  if (!b.items.length) return -1;
  if (state.mode === 'edit') return state.sel != null ? state.sel : b.items.length - 1;
  return chainStart(b.items, Math.max(0, insertIndex(b) - 1));
}

/**
 * Valeur (durée écrite) de la note logique qui contient `i` : celle de
 * l'élément s'il est seul, sinon la valeur unique équivalente à la somme de
 * ses morceaux (une ronde coupée en blanche⁀blanche vaut une ronde), à défaut
 * celle du premier morceau.
 * @param {module:model~StaffBlock} b
 * @param {number} i
 * @returns {{d: string, dot: boolean, tup: boolean}}
 */
export function logicalValue(b, i) {
  const a = chainStart(b.items, i);
  const z = chainEnd(b.items, i);
  const first = b.items[a];
  if (a === z) return { d: first.d, dot: !!first.dot, tup: !!first.tup };
  let len = 0;
  for (let k = a; k <= z; k++) len += qlen(b.items[k]);
  const one = singleValue(len, true);
  return one ? { ...one, tup: false } : { d: first.d, dot: !!first.dot, tup: false };
}

/**
 * Mode Modifier : applique `fn` à la note sélectionnée, puis remet en mesure,
 * enregistre et redessine (avec annulation possible).
 * @param {function(module:model~StaffItem, module:model~StaffBlock)} fn
 * @returns {boolean} `false` hors mode Modifier ou sans sélection (le bouton
 *   règle alors la saisie).
 */
export function withSel(fn) {
  if (state.mode !== 'edit') return false;
  const a = activeStaff();
  if (!a || state.sel == null || !a.b.items[state.sel]) return false;
  pushSnapshot(a.n);
  fn(a.b.items[state.sel], a.b);
  refit(a.b);
  touch(a.n);
  hooks.redraw(a.b.id);
  return true;
}
