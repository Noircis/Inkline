/**
 * @module search
 * @description
 * **Recherche et tri** des notes de l'accueil (depuis la 2.0). Fonctions pures.
 *
 * ## Recherche
 *
 * La requête est découpée en mots ; une note correspond si **chaque mot**
 * apparaît quelque part dans son titre, ses blocs texte ou ses **accords**
 * (grilles et accords chiffrés des portées). Taper « bb7alt » retrouve donc
 * toutes les notes contenant cet accord, et « blues f » une note intitulée
 * « Blues en F ».
 *
 * La comparaison ignore la casse et les accents, et confond `♭`/`b`,
 * `♯`/`#` : « reponse » trouve « réponse », « B♭7 » trouve « Bb7 ».
 *
 * ## Tri
 *
 * Trois ordres ({@link module:search.SORT_MODES|SORT_MODES}) ; dans tous les
 * cas, les notes **épinglées** passent en tête.
 */

/**
 * Ordres de tri proposés sur l'accueil.
 * @type {Array.<{key: string, label: string}>}
 */
export const SORT_MODES = [
  { key: 'updated', label: 'Modifiées récemment' },
  { key: 'created', label: 'Créées récemment' },
  { key: 'title', label: 'Titre (A → Z)' },
];

/** Clés de tri valides. */
export const SORT_KEYS = SORT_MODES.map((m) => m.key);

/**
 * Forme normalisée d'un texte pour la comparaison : minuscules, sans accents,
 * signes ♭ ♯ remplacés par b et #.
 * @param {string} s
 * @returns {string}
 */
export function normalize(s) {
  return String(s || '')
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Tout le texte cherchable d'une note, normalisé : titre, textes, accords.
 * @param {module:model~Note} note
 * @returns {string}
 */
export function searchableText(note) {
  const parts = [note.title];
  note.blocks.forEach((b) => {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'grid') b.measures.forEach((m) => parts.push(m.ch.join(' ')));
    else if (b.type === 'staff') b.items.forEach((it) => it.c && parts.push(it.c));
  });
  return normalize(parts.join('\n'));
}

/**
 * La note correspond-elle à la requête ? Une requête vide correspond à tout.
 * @param {module:model~Note} note
 * @param {string} query
 * @returns {boolean}
 */
export function matchNote(note, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchableText(note);
  return words.every((w) => text.includes(w));
}

/**
 * Trie des notes (nouveau tableau), épinglées d'abord.
 * - `updated` : dernière modification, la plus récente d'abord ;
 * - `created` : création, la plus récente d'abord ;
 * - `title` : ordre alphabétique français, notes sans titre à la fin.
 * @param {module:model~Note[]} notes
 * @param {string} mode Une clé de {@link SORT_MODES}.
 * @returns {module:model~Note[]}
 */
export function sortNotes(notes, mode) {
  const byMode = {
    updated: (a, b) => b.updated - a.updated,
    created: (a, b) => (b.created || b.updated) - (a.created || a.updated),
    title: (a, b) => {
      if (!a.title !== !b.title) return a.title ? -1 : 1; // sans titre à la fin
      return (
        a.title.localeCompare(b.title, 'fr', { sensitivity: 'base', numeric: true }) || b.updated - a.updated
      );
    },
  };
  const cmp = byMode[mode] || byMode.updated;
  return notes.slice().sort((a, b) => !!b.pinned - !!a.pinned || cmp(a, b));
}
