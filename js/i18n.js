/**
 * @module i18n
 * @description
 * **Interface language** (2.9): English or French.
 *
 * Every visible text goes through {@link t} with a key
 * (`t('home.newNote')`), looked up in the dictionary of the current language
 * ({@link module:locales/en|locales/en}, {@link module:locales/fr|locales/fr}).
 * A test checks that both dictionaries have exactly the same keys.
 *
 * ## Choosing the language
 *
 * A web app cannot see the system language, only the browser's
 * (`navigator.languages`); on Android, it follows the phone's language.
 * "Language" setting in Settings: `auto` (French if the browser is in
 * French, English otherwise), `en` or `fr`.
 *
 * Until {@link initLang} has been called (engine unit tests), the language
 * is French, the language of earlier versions.
 *
 * ## Parameters and plurals
 *
 * `t('home.count', { n: 3 })` replaces `{n}` in the text. An entry can be an
 * object `{ one, other }`: `one` is used for 0 and 1 in French, for 1 only
 * in English ("0 note" in French, but "0 notes"), following
 * `Intl.PluralRules`.
 *
 * The static texts of `index.html` carry `data-i18n="key"` (content) or
 * `data-i18n-attr="aria-label:key;placeholder:key"` (attributes), translated
 * at startup by {@link translateDom}.
 */

import en from './locales/en.js';
import fr from './locales/fr.js';

/** Available languages. */
export const LANGS = Object.freeze(['en', 'fr']);

/** @type {Object.<string, Object>} */
const DICTS = { en, fr };

/** Current language. */
let cur = 'fr';
/** Plural rules of the current language. */
let plural = new Intl.PluralRules('fr');

/**
 * Language deduced from the browser's preferred languages: French if the
 * first recognized language is French, English otherwise.
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
 * Sets the interface language.
 * @param {string} pref `auto`, `en` or `fr`.
 * @param {ReadonlyArray.<string>} [langs] Browser languages (for `auto`).
 * @returns {'en'|'fr'} Language chosen.
 */
export function initLang(pref, langs = []) {
  cur = LANGS.includes(pref) ? /** @type {'en'|'fr'} */ (pref) : detectLang(langs);
  plural = new Intl.PluralRules(cur);
  if (typeof document !== 'undefined') document.documentElement.lang = cur;
  return /** @type {'en'|'fr'} */ (cur);
}

/**
 * Current language.
 * @returns {'en'|'fr'}
 */
export const lang = () => /** @type {'en'|'fr'} */ (cur);

/**
 * Full locale for dates and numbers (`Intl`).
 * @returns {string}
 */
export const locale = () => (cur === 'fr' ? 'fr-FR' : 'en-US');

/**
 * Looks up a key (`a.b.c`) in a dictionary.
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
 * Translated text.
 * @param {string} key Key, for example `'home.newNote'`.
 * @param {Object.<string, (string|number)>} [params] Values for `{name}`;
 *   `n` picks the plural.
 * @returns {string} The text, or the key itself if it is missing (visible in
 *   tests, never empty on screen).
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
 * Translates the static texts of a piece of the page (`data-i18n`,
 * `data-i18n-attr`). The French text stays in the HTML as a fallback.
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
 * All the keys of a dictionary (for tests).
 * @param {Object} dict
 * @param {string} [prefix]
 * @returns {Array.<string>}
 */
export function keysOf(dict, prefix = '') {
  return Object.entries(dict).flatMap(([k, v]) =>
    v && typeof v === 'object' && !('other' in v) ? keysOf(v, prefix + k + '.') : [prefix + k],
  );
}

/** Dictionaries (for tests). */
export const DICTIONARIES = DICTS;
