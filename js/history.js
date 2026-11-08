/**
 * @module history
 * @description
 * Annulation (« ↶ ») par **instantanés** : patron *Memento*.
 *
 * Avant chaque modification, l'interface appelle {@link module:history.pushSnapshot|pushSnapshot}
 * qui empile une copie sérialisée (JSON) du titre et des blocs de la note.
 * Annuler dépile le dernier instantané et le réapplique.
 *
 * ## Pourquoi des instantanés plutôt que des commandes inverses ?
 *
 * Un patron *Command* (chaque action sait s'annuler) consommerait moins de
 * mémoire, mais chaque nouvelle fonctionnalité devrait écrire son inverse :
 * source de bugs. Une note pèse quelques Ko ; 80 instantanés par note
 * restent négligeables. La pile est limitée à 80 entrées (les plus anciennes
 * sont oubliées) et n'est pas persistée : elle repart à zéro à chaque lancement.
 */

/** Profondeur maximale de la pile, par note. */
const MAX_DEPTH = 80;

// piles d'instantanés JSON, par id de note
/** @type {Object.<string, string[]>} */
const stacks = {};

/**
 * Empile l'état actuel d'une note.
 * @param {module:model~Note} n
 */
export function pushSnapshot(n) {
  const h = stacks[n.id] || (stacks[n.id] = []);
  h.push(JSON.stringify({ t: n.title, b: n.blocks }));
  if (h.length > MAX_DEPTH) h.shift();
}

/**
 * Restaure le dernier instantané d'une note (modifie la note sur place).
 * @param {module:model~Note} n
 * @returns {boolean} `false` s'il n'y avait rien à annuler.
 */
export function popSnapshot(n) {
  const h = stacks[n.id];
  if (!h || !h.length) return false;
  const s = JSON.parse(h.pop());
  n.title = s.t;
  n.blocks = s.b;
  return true;
}

/**
 * Oublie le dernier instantané sans le restaurer : pour une action commencée
 * puis refusée (par exemple un triolet qui traverserait une barre), annulée à
 * la main par l'appelant.
 * @param {module:model~Note} n
 */
export function discardSnapshot(n) {
  const h = stacks[n.id];
  if (h && h.length) h.pop();
}
