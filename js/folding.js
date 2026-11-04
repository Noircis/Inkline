/**
 * @module folding
 * @description
 * **Règle d'affichage réduit** des blocs longs (2.2), sous forme de fonction
 * pure testable sous Node. L'interface correspondante est dans
 * {@link module:ui/fold|ui/fold}.
 */

/** Nombre de lignes à partir duquel un bloc peut être réduit. */
export const FOLD_MIN_LINES = 5;

/** Nombre de lignes affichées quand un bloc est réduit. */
export const FOLD_PREVIEW_LINES = 3;

/**
 * Le bloc doit-il s'afficher réduit ? Dans l'ordre :
 * 1. un bloc en cours d'édition est toujours affiché en entier ;
 * 2. un bloc de moins de {@link FOLD_MIN_LINES} lignes n'est jamais réduit ;
 * 3. le choix manuel mémorisé sur le bloc (`fold`) ;
 * 4. sinon, l'option « Réduire automatiquement les blocs longs ».
 *
 * @param {{fold: (string|undefined)}} b Le bloc (seul son champ `fold` est lu).
 * @param {number} lines Nombre total de lignes du bloc.
 * @param {boolean} active Le bloc est en cours d'édition.
 * @param {boolean} autoFold Option de réduction automatique.
 * @returns {boolean}
 */
export function shouldFold(b, lines, active, autoFold) {
  if (active || lines < FOLD_MIN_LINES) return false;
  if (b.fold === 'closed') return true;
  if (b.fold === 'open') return false;
  return autoFold;
}
