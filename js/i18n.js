/**
 * @module i18n
 * @description
 * **Langue de l'interface** (2.9) : anglais ou français.
 *
 * Tous les textes visibles passent par {@link t} avec une clé
 * (`t('home.newNote')`), cherchée dans le dictionnaire de la langue courante
 * ({@link module:locales/en|locales/en}, {@link module:locales/fr|locales/fr}).
 * Un test vérifie que les deux dictionnaires ont exactement les mêmes clés.
 *
 * ## Choix de la langue
 *
 * Une appli web ne voit pas la langue du système, seulement celle du
 * navigateur (`navigator.languages`) ; sur Android, elle suit celle du
 * téléphone. Réglage « Langue » dans Options : `auto` (français si le
 * navigateur est en français, anglais sinon), `en` ou `fr`.
 *
 * Tant que {@link initLang} n'a pas été appelé (tests unitaires du moteur),
 * la langue est le français, celle des versions précédentes.
 *
 * ## Paramètres et pluriels
 *
 * `t('home.count', { n: 3 })` remplace `{n}` dans le texte. Une entrée peut
 * être un objet `{ one, other }` : `one` sert pour 0 et 1 en français, pour
 * 1 seulement en anglais (« 0 note », mais « 0 notes »), selon
 * `Intl.PluralRules`.
 *
 * Les textes statiques de `index.html` portent `data-i18n="clé"` (contenu)
 * ou `data-i18n-attr="aria-label:clé;placeholder:clé"` (attributs), traduits
 * au démarrage par {@link translateDom}.
 */

import en from './locales/en.js';
import fr from './locales/fr.js';

/** Langues disponibles. */
export const LANGS = Object.freeze(['en', 'fr']);

/** @type {Object.<string, Object>} */
const DICTS = { en, fr };

/** Langue courante. */
let cur = 'fr';
/** Règles de pluriel de la langue courante. */
let plural = new Intl.PluralRules('fr');

/**
 * Langue déduite des langues préférées du navigateur : français si la
 * première langue reconnue est le français, anglais sinon.
 * @param {ReadonlyArray.<string>} [langs]
 * @returns {'en'|'fr'}
 */
export function detectLang(langs = []) {
  for (const l of langs) {
    const base = String(l).toLowerCase().split('-')[0];
    if (base === 'fr') return 'fr';
    if (base === 'en') return 'en';
  }
  return 'en';
}

/**
 * Fixe la langue de l'interface.
 * @param {string} pref `auto`, `en` ou `fr`.
 * @param {ReadonlyArray.<string>} [langs] Langues du navigateur (pour `auto`).
 * @returns {'en'|'fr'} Langue retenue.
 */
export function initLang(pref, langs = []) {
  cur = LANGS.includes(pref) ? /** @type {'en'|'fr'} */ (pref) : detectLang(langs);
  plural = new Intl.PluralRules(cur);
  if (typeof document !== 'undefined') document.documentElement.lang = cur;
  return /** @type {'en'|'fr'} */ (cur);
}

/**
 * Langue courante.
 * @returns {'en'|'fr'}
 */
export const lang = () => /** @type {'en'|'fr'} */ (cur);

/**
 * Locale complète pour les dates et les nombres (`Intl`).
 * @returns {string}
 */
export const locale = () => (cur === 'fr' ? 'fr-FR' : 'en-US');

/**
 * Cherche une clé (`a.b.c`) dans un dictionnaire.
 * @param {Object} dict
 * @param {string} key
 * @returns {*}
 */
function lookup(dict, key) {
  let v = dict;
  for (const part of key.split('.')) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[part];
  }
  return v;
}

/**
 * Texte traduit.
 * @param {string} key Clé, par exemple `'home.newNote'`.
 * @param {Object.<string, (string|number)>} [params] Valeurs pour `{nom}` ;
 *   `n` choisit le pluriel.
 * @returns {string} Le texte, ou la clé elle-même si elle manque (visible en
 *   test, jamais vide à l'écran).
 */
export function t(key, params) {
  let v = lookup(DICTS[cur], key);
  if (v === undefined) v = lookup(DICTS.fr, key);
  if (v === undefined) return key;
  if (typeof v === 'object') {
    const n = params && typeof params.n === 'number' ? params.n : 0;
    v = v[plural.select(n)] ?? v.other;
  }
  if (!params) return v;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/**
 * Traduit les textes statiques d'un morceau de page (`data-i18n`,
 * `data-i18n-attr`). Le texte français reste dans le HTML comme valeur de
 * secours.
 * @param {ParentNode} root
 */
export function translateDom(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(/** @type {HTMLElement} */ (el).dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    /** @type {HTMLElement} */ (el).dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/**
 * Toutes les clés d'un dictionnaire (pour les tests).
 * @param {Object} dict
 * @param {string} [prefix]
 * @returns {Array.<string>}
 */
export function keysOf(dict, prefix = '') {
  return Object.entries(dict).flatMap(([k, v]) =>
    v && typeof v === 'object' && !('other' in v) ? keysOf(v, prefix + k + '.') : [prefix + k],
  );
}

/** Dictionnaires (pour les tests). */
export const DICTIONARIES = DICTS;
