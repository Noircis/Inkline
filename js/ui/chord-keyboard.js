/**
 * @module ui/chord-keyboard
 * @description
 * **Clavier d'accords** à l'écran (2.8.5), à la place du clavier du
 * téléphone : plus de majuscules ni de « b » à taper pour ♭.
 *
 * ```
 *  C   D   E   F   G   A   B   ♭   ♯       ← fondamentale (ou basse après /)
 *  7  −7  Δ7  ø7  °7 7alt  6  −6   +       ← couleur, en un toucher
 * sus4 7sus4 9 −9  Δ9 7♭9 7♯9  13   ⋯      ← ⋯ : pavé détaillé
 *  /  N.C.  %   ␣   ⌫   ⌨   Suivant →
 * ```
 *
 * Ce module ne fait que l'affichage et les touchers ; l'effet de chaque
 * touche est décrit dans {@link module:chord-keys|chord-keys}.
 *
 * Deux usages : la grille (une mesure, plusieurs cases, `%`, `N.C.`, `␣`) et
 * l'accord au-dessus d'une note (une seule case, « OK »). La touche `⌨`
 * repasse au champ texte (clavier du téléphone ou de l'ordinateur), pour
 * coller un accord ou écrire au clavier physique.
 */

import { esc } from '../util.js';
import { chordHtml } from '../chords.js';
import { splitChord } from '../chord-keys.js';

/** Fondamentales. */
const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * Couleurs en un toucher : `[libellé, qualité enregistrée]`.
 * Libellés comme à l'affichage, valeurs en notation iReal.
 */
const COLORS = [
  [
    ['7', '7'],
    ['−7', '-7'],
    ['Δ7', '^7'],
    ['ø7', 'h7'],
    ['°7', 'o7'],
    ['7alt', '7alt'],
    ['6', '6'],
    ['−6', '-6'],
    ['+', '+'],
  ],
  [
    ['sus4', 'sus4'],
    ['7sus4', '7sus4'],
    ['9', '9'],
    ['−9', '-9'],
    ['Δ9', '^9'],
    ['7♭9', '7b9'],
    ['7♯9', '7#9'],
    ['13', '13'],
  ],
];

/** Pavé détaillé : morceaux ajoutés un par un. */
const DETAIL = [
  [
    ['−', '-'],
    ['Δ', '^'],
    ['ø', 'h'],
    ['°', 'o'],
    ['+', '+'],
    ['sus', 'sus'],
    ['add', 'add'],
    ['alt', 'alt'],
  ],
  [
    ['2', '2'],
    ['4', '4'],
    ['5', '5'],
    ['6', '6'],
    ['7', '7'],
    ['9', '9'],
    ['11', '11'],
    ['13', '13'],
  ],
  [
    ['♭5', 'b5'],
    ['♯5', '#5'],
    ['♭9', 'b9'],
    ['♯9', '#9'],
    ['♯11', '#11'],
    ['♭13', 'b13'],
  ],
];

/**
 * Options d'un clavier.
 * @typedef {Object} KeyboardOptions
 * @property {'grid'|'staff'} mode Grille (plusieurs cases, `%`, `N.C.`, `␣`) ou note.
 * @property {function(module:chord-keys~ChordKey): void} onKey Touche d'accord.
 * @property {function(): void} onNext « Suivant » (grille) ou « OK » (note).
 * @property {function(): void} onText Touche `⌨` : passer au champ texte.
 * @property {function(): void} [onUndo] Annuler (grille).
 */

/**
 * HTML d'une touche.
 * @param {string} label
 * @param {string} attrs Attributs `data-*`.
 * @param {string} [cls='']
 * @param {string} [aria='']
 */
const key = (label, attrs, cls = '', aria = '') =>
  `<button type="button" class="ck-k${cls ? ' ' + cls : ''}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;

/**
 * Monte un clavier d'accords dans `root` (une seule fois).
 * @param {HTMLElement} root
 * @param {KeyboardOptions} opt
 * @returns {{show: function(Array.<string>): void}} `show(cases)` met à jour
 *   l'aperçu et l'état des touches.
 */
export function mountChordKeyboard(root, opt) {
  const grid = opt.mode === 'grid';
  let detail = false;

  const rows = () => {
    const colorRows = detail
      ? DETAIL.map(
          (r, k) =>
            r.map(([l, v]) => key(esc(l), `data-ck="add" data-v="${esc(v)}"`)).join('') +
            (k === 0 ? key('⋯', 'data-ck="more"', 'ck-more on', 'Couleurs courantes') : ''),
        )
      : COLORS.map(
          (r, k) =>
            r.map(([l, v]) => key(esc(l), `data-ck="qual" data-v="${esc(v)}"`, 'ck-q')).join('') +
            (k === 1 ? key('⋯', 'data-ck="more"', 'ck-more', 'Pavé détaillé') : ''),
        );
    const bottom = [
      key('/', 'data-ck="slash"', '', 'Basse'),
      grid ? key('N.C.', 'data-ck="nc"', '', 'Sans accord') : '',
      grid
        ? key('<span class="mus">&#x1D10E;</span>', 'data-ck="sim"', '', 'Répéter la mesure précédente')
        : '',
      grid ? key('␣', 'data-ck="space"', '', 'Accord suivant dans la mesure') : '',
      key('⌫', 'data-ck="back"', '', 'Effacer'),
      key('⌨', 'data-ck="text"', '', 'Saisir au clavier'),
      grid && opt.onUndo ? key('↶', 'data-ck="undo"', '', 'Annuler') : '',
      key(grid ? 'Suivant →' : 'OK', 'data-ck="next"', 'ck-next', grid ? 'Mesure suivante' : 'Valider'),
    ].join('');
    return (
      `<div class="ck-row ck-roots">${ROOTS.map((r) => key(r, `data-ck="root" data-v="${r}"`)).join('')}` +
      key('♭', 'data-ck="acc" data-v="b"', 'ck-acc', 'Bémol') +
      key('♯', 'data-ck="acc" data-v="#"', 'ck-acc', 'Dièse') +
      '</div>' +
      colorRows.map((r) => `<div class="ck-row">${r}</div>`).join('') +
      `<div class="ck-row ck-bottom">${bottom}</div>`
    );
  };

  root.innerHTML = `<div class="ck-field" aria-live="polite"></div><div class="ck-keys"></div>`;
  const field = /** @type {HTMLElement} */ (root.querySelector('.ck-field'));
  const keys = /** @type {HTMLElement} */ (root.querySelector('.ck-keys'));
  let last = [];

  const render = () => {
    keys.innerHTML = rows();
    show(last);
  };

  /**
   * Aperçu de la mesure (ou de l'accord) et état des touches de couleur.
   * @param {Array.<string>} slots
   */
  function show(slots) {
    last = slots;
    const parts = slots.length ? slots : [''];
    field.innerHTML =
      parts
        .map((c, k) => {
          const cur = k === parts.length - 1 ? ' cur' : '';
          if (c === '' && k === parts.length - 1) return `<span class="ck-slot${cur}"></span>`;
          const p = splitChord(c);
          // Basse en attente (« C/ ») : on montre l'accord puis la barre.
          const html =
            p && p.slash && !p.bass ? chordHtml(p.root + p.q) + '<span class="cb">/</span>' : chordHtml(c);
          return `<span class="ck-slot${cur}">${html}</span>`;
        })
        .join('') + '<span class="ck-caret" aria-hidden="true"></span>';
    const p = splitChord(parts[parts.length - 1]);
    keys.querySelectorAll('[data-ck="qual"]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!p && p.q === /** @type {HTMLElement} */ (b).dataset.v));
    });
  }

  // pointerdown + preventDefault : le toucher ne retire pas le focus (pas de
  // clavier qui se ferme, pas de défilement parasite).
  keys.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('.ck-k')) e.preventDefault();
  });
  keys.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('[data-ck]'));
    if (!b) return;
    const t = b.dataset.ck;
    if (t === 'more') {
      detail = !detail;
      render();
    } else if (t === 'next') opt.onNext();
    else if (t === 'text') opt.onText();
    else if (t === 'undo') opt.onUndo && opt.onUndo();
    else opt.onKey(/** @type {any} */ ({ t, v: b.dataset.v }));
  });

  render();
  return { show };
}
