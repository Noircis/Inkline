/**
 * @module lang-init
 * @description
 * Sets the **interface language** at startup (2.9), before anything else.
 *
 * This module is the first one imported by {@link module:main|main}: in
 * JavaScript, imported modules run in `import` order, and some screens build
 * their labels as soon as they load (chord keyboards, palettes). The
 * language must therefore be known before them.
 *
 * Stored setting (`meta.lang`, Settings): `auto`, `en` or `fr`. With `auto`,
 * the browser language decides ({@link module:i18n.detectLang|detectLang}).
 * The fixed texts of `index.html` are translated here too.
 */

import { initLang, translateDom } from './i18n.js';
import { getMeta } from './storage.js';

initLang(
  getMeta().lang || 'auto',
  typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [],
);
if (typeof document !== 'undefined') translateDom(document);
