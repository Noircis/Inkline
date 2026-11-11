/**
 * @module lang-init
 * @description
 * Fixe la **langue de l'interface** au démarrage (2.9), avant tout le reste.
 *
 * Ce module est le premier importé par {@link module:main|main} : en
 * JavaScript, les modules importés s'exécutent dans l'ordre des `import`, et
 * certains écrans fabriquent leurs libellés dès leur chargement (claviers
 * d'accords, palettes). La langue doit donc être connue avant eux.
 *
 * Réglage enregistré (`meta.lang`, Options) : `auto`, `en` ou `fr`. En `auto`,
 * la langue du navigateur décide ({@link module:i18n.detectLang|detectLang}).
 * Les textes fixes de `index.html` sont traduits ici aussi.
 */

import { initLang, translateDom } from './i18n.js';
import { getMeta } from './storage.js';

initLang(
  getMeta().lang || 'auto',
  typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [],
);
if (typeof document !== 'undefined') translateDom(document);
