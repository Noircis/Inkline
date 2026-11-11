/**
 * @module ui/icons
 * @description
 * SVG pictograms of the interface, as strings to insert into HTML. They are
 * colored with `currentColor` (they take the text color). The equivalent
 * Unicode characters (⚙, 📌) are not used: Android shows them as colored
 * emoji. Pure module (no DOM), usable in Node.
 */

/** Pin icon (SVG, colored with currentColor). */
export const PIN_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.5 2.5 21.5 8.5 19.4 9.3 15.9 12.8 16.3 17.6 14.6 19.3 10.4 15.1 4.6 20.9 3.1 20.9 3.1 19.4 8.9 13.6 4.7 9.4 6.4 7.7 11.2 8.1 14.7 4.6Z"/></svg>';

/** Gear icon (SVG: the ⚙ character would show as a colored emoji on Android). */
export const GEAR =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M19.84 10.41 L22.42 10.74 L22.42 13.26 L19.84 13.59 L18.67 16.42 L20.26 18.48 L18.48 20.26 L16.42 18.67 L13.59 19.84 L13.26 22.42 L10.74 22.42 L10.41 19.84 L7.58 18.67 L5.52 20.26 L3.74 18.48 L5.33 16.42 L4.16 13.59 L1.58 13.26 L1.58 10.74 L4.16 10.41 L5.33 7.58 L3.74 5.52 L5.52 3.74 L7.58 5.33 L10.41 4.16 L10.74 1.58 L13.26 1.58 L13.59 4.16 L16.42 5.33 L18.48 3.74 L20.26 5.52 L18.67 7.58 Z M15.4 12 A3.4 3.4 0 1 0 8.6 12 A3.4 3.4 0 1 0 15.4 12 Z"/></svg>';

/** Magnifier of the search field. */
export const LOUPE =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM15.4 15.4 20 20"/></svg>';

/** Metronome (Practice button on the home screen). */
export const METRONOME =
  '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round" d="M9.2 3h5.6l4.2 18H5L9.2 3zM6.6 15h10.8M12 15l5.5-9.5"/></svg>';
