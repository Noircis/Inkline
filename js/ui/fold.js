/**
 * @module ui/fold
 * @description
 * **Blocs longs réduits** (depuis la 2.2) : une portée, une ligne rythmique ou
 * une grille de {@link module:ui/fold.FOLD_MIN_LINES|FOLD_MIN_LINES} lignes ou
 * plus peut n'afficher que ses
 * {@link module:ui/fold.FOLD_PREVIEW_LINES|FOLD_PREVIEW_LINES} premières
 * lignes, avec un bouton « Afficher tout ».
 *
 * ## Qui décide si un bloc est réduit ?
 *
 * La règle est la fonction pure {@link module:folding.shouldFold|shouldFold} :
 *
 * Dans l'ordre :
 * 1. **un bloc en cours d'édition est toujours affiché en entier** : les
 *    notes s'ajoutent à la fin, qui serait cachée ;
 * 2. un bloc trop court n'est jamais réduit (il n'y aurait rien à cacher) ;
 * 3. le **choix manuel** mémorisé sur le bloc (`fold: 'open'` ou `'closed'`) ;
 * 4. sinon, l'option **« Réduire automatiquement les blocs longs »** des
 *    Options (`meta.autoFold`).
 *
 * Toucher un bloc réduit l'active (il s'affiche donc en entier le temps de
 * l'édition) sans enregistrer de choix : avec l'option automatique, il se
 * réduit de nouveau quand on passe à autre chose.
 *
 * Réduire n'est pas modifier : la date de la note ne change pas
 * ({@link module:ui/state.saveArrangement|saveArrangement}), et un fichier
 * `.inkline` partagé ne transporte pas cet état.
 */

import { state, curNote, saveArrangement } from './state.js';
import { getMeta } from '../storage.js';
import { setActive, redrawBlock } from './blocks.js';
import { shouldFold, FOLD_MIN_LINES, FOLD_PREVIEW_LINES } from '../folding.js';

export { FOLD_MIN_LINES, FOLD_PREVIEW_LINES };

/**
 * Le bloc affiché doit-il être réduit ? Voir {@link module:folding.shouldFold|shouldFold}.
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {number} lines Nombre total de lignes du bloc à la largeur actuelle.
 * @returns {boolean}
 */
export function isFolded(b, lines) {
  return shouldFold(b, lines, state.activeId === b.id, !!getMeta().autoFold);
}

/**
 * Met à jour l'apparence « réduit » d'un bloc après son dessin : classe CSS
 * (fondu en bas), bouton « Afficher tout » / « Réduire ».
 *
 * @param {HTMLElement} wrap Zone de dessin du bloc (`.staff-wrap`, `.gridwrap`).
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {number} lines Nombre total de lignes.
 * @param {boolean} folded Résultat de {@link isFolded}.
 */
export function applyFold(wrap, b, lines, folded) {
  const blockEl = wrap.closest('.block');
  if (blockEl) blockEl.classList.toggle('folded', folded);
  let bar = /** @type {HTMLButtonElement|null} */ (
    wrap.nextElementSibling && wrap.nextElementSibling.classList.contains('foldbtn')
      ? wrap.nextElementSibling
      : null
  );
  if (lines < FOLD_MIN_LINES) {
    if (bar) bar.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'foldbtn';
    wrap.after(bar);
    bar.addEventListener('click', () => toggleFold(b, wrap));
  }
  bar.setAttribute('aria-expanded', String(!folded));
  bar.textContent = folded ? `Afficher tout · ${lines} lignes ▾` : 'Réduire ▴';
}

/**
 * Bouton « Afficher tout » / « Réduire » : mémorise le choix sur le bloc.
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 * @param {HTMLElement} wrap
 */
function toggleFold(b, wrap) {
  const folded = wrap.closest('.block').classList.contains('folded');
  b.fold = folded ? 'open' : 'closed';
  const n = curNote();
  if (n) saveArrangement(n);
  // Un bloc actif est toujours affiché en entier : pour le réduire, on le désactive.
  if (!folded && state.activeId === b.id) setActive(null);
  redrawBlock(b.id);
  // Après une réduction, on ramène le haut du bloc à l'écran (le contenu a raccourci).
  if (!folded) wrap.closest('.block').scrollIntoView({ block: 'nearest' });
}

/**
 * Intercepte les touchers sur un bloc réduit : au lieu d'agir sur la musique
 * (poser une note, choisir une mesure), le toucher active le bloc, qui
 * s'affiche alors en entier. Écouteur en phase de **capture** : il passe
 * avant ceux de la portée ou de la grille et peut les court-circuiter.
 *
 * @param {HTMLElement} wrap
 * @param {module:model~StaffBlock|module:model~GridBlock} b
 */
export function guardFoldedTaps(wrap, b) {
  wrap.addEventListener(
    'click',
    (e) => {
      if (!wrap.closest('.block').classList.contains('folded')) return;
      e.stopPropagation();
      e.preventDefault();
      setActive(b.id);
    },
    { capture: true },
  );
}
