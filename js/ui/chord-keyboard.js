/**
 * @module ui/chord-keyboard
 * @description
 * On-screen **chord keyboard** (2.8.5), instead of the phone keyboard: no
 * more capitals or "b" to type for ♭.
 *
 * ```
 *  C   D   E   F   G   A   B   ♭   ♯       ← root (or bass after /)
 *  7  −7  Δ7  ø7  °7 7alt  6  −6   +       ← quality, in one tap
 * sus4 7sus4 9 −9  Δ9 7♭9 7♯9  13   ⋯      ← ⋯: detailed pad
 *  /  N.C.  %   ␣   ⌫   ⌨   Next →
 * ```
 *
 * This module only handles display and taps; the effect of each key is
 * described in {@link module:chord-keys|chord-keys}.
 *
 * Two uses: the chart (one measure, several slots, `%`, `N.C.`, `␣`) and the
 * chord above a note (a single slot, "OK"). The `⌨` key switches to the text
 * field (phone or computer keyboard), to paste a chord or type on a physical
 * keyboard.
 */

import { t } from '../i18n.js';
import { esc } from '../util.js';
import { chordHtml } from '../chords.js';
import { splitChord } from '../chord-keys.js';

/** Roots. */
const ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/**
 * One-tap qualities: `[label, stored quality]`.
 * Labels as displayed, values in iReal notation.
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

/** Detailed pad: pieces added one by one. */
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
 * Keyboard options.
 * @typedef {Object} KeyboardOptions
 * @property {'grid'|'staff'} mode Chart (several slots, `%`, `N.C.`, `␣`) or note.
 * @property {function(module:chord-keys~ChordKey): void} onKey Chord key.
 * @property {function(): void} onNext "Next" (chart) or "OK" (note).
 * @property {function(): void} onText `⌨` key: switch to the text field.
 * @property {function(): void} [onUndo] Undo (chart).
 */

/**
 * HTML of a key.
 * @param {string} label
 * @param {string} attrs `data-*` attributes.
 * @param {string} [cls='']
 * @param {string} [aria='']
 */
const key = (label, attrs, cls = '', aria = '') =>
  `<button type="button" class="ck-k${cls ? ' ' + cls : ''}" ${attrs}${aria ? ` aria-label="${esc(aria)}"` : ''}>${label}</button>`;

/**
 * Mounts a chord keyboard in `root` (once).
 * @param {HTMLElement} root
 * @param {KeyboardOptions} opt
 * @returns {{show: function(Array.<string>): void}} `show(slots)` updates the
 *   preview and the key states.
 */
export function mountChordKeyboard(root, opt) {
  const grid = opt.mode === 'grid';
  let detail = false;

  const rows = () => {
    const colorRows = detail
      ? DETAIL.map(
          (r, k) =>
            r.map(([l, v]) => key(esc(l), `data-ck="add" data-v="${esc(v)}"`)).join('') +
            (k === 0 ? key('⋯', 'data-ck="more"', 'ck-more on', t('ck.common')) : ''),
        )
      : COLORS.map(
          (r, k) =>
            r.map(([l, v]) => key(esc(l), `data-ck="qual" data-v="${esc(v)}"`, 'ck-q')).join('') +
            (k === 1 ? key('⋯', 'data-ck="more"', 'ck-more', t('ck.detail')) : ''),
        );
    const bottom = [
      key('/', 'data-ck="slash"', '', t('ck.bass')),
      grid ? key('N.C.', 'data-ck="nc"', '', t('ck.noChord')) : '',
      grid ? key('<span class="mus">&#x1D10E;</span>', 'data-ck="sim"', '', t('grid.simile')) : '',
      grid ? key('␣', 'data-ck="space"', '', t('ck.space')) : '',
      key('⌫', 'data-ck="back"', '', t('ck.erase')),
      key('⌨', 'data-ck="text"', '', t('ck.text')),
      grid && opt.onUndo ? key('↶', 'data-ck="undo"', '', t('common.undo')) : '',
      key(
        esc(grid ? t('ck.next') : t('common.ok')),
        'data-ck="next"',
        'ck-next',
        grid ? t('grid.nextMeasure') : t('ck.validate'),
      ),
    ].join('');
    return (
      `<div class="ck-row ck-roots">${ROOTS.map((r) => key(r, `data-ck="root" data-v="${r}"`)).join('')}` +
      key('♭', 'data-ck="acc" data-v="b"', 'ck-acc', t('acc.flat')) +
      key('♯', 'data-ck="acc" data-v="#"', 'ck-acc', t('acc.sharp')) +
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
   * Preview of the measure (or chord) and state of the quality keys.
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
          // Pending bass ("C/"): show the chord, then the slash.
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

  // pointerdown + preventDefault: the tap does not take the focus away (no
  // keyboard closing, no stray scrolling).
  keys.addEventListener('pointerdown', (e) => {
    if (/** @type {Element} */ (e.target).closest('.ck-k')) e.preventDefault();
  });
  keys.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (/** @type {Element} */ (e.target).closest('[data-ck]'));
    if (!b) return;
    const kind = b.dataset.ck;
    if (kind === 'more') {
      detail = !detail;
      render();
    } else if (kind === 'next') opt.onNext();
    else if (kind === 'text') opt.onText();
    else if (kind === 'undo') opt.onUndo && opt.onUndo();
    else opt.onKey(/** @type {any} */ ({ t: kind, v: b.dataset.v }));
  });

  render();
  return { show };
}
