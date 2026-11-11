/**
 * @module export
 * @description
 * **Sharing a note**: `.inkline` file, PNG image or PDF.
 *
 * ## Rendering a note as an image
 *
 * 1. {@link module:export~noteToSvg|noteToSvg} lays out the whole note in **a single SVG**:
 *    title, date, text blocks (line wrapping computed with
 *    `CanvasRenderingContext2D.measureText`), staves ({@link module:render-staff}),
 *    charts ({@link module:grid.gridSvg|gridSvg}). Always in the light theme, for printing.
 * 2. **Fonts are embedded** in the SVG as base64 (`data:` URI): an SVG image
 *    shown through `<img>` is not allowed to load external files.
 *    `css/fonts.css` is read again to know which ones.
 * 3. The SVG is loaded into an `Image`, drawn on a `<canvas>` at ×2
 *    (sharpness on high-density screens), then exported as PNG or JPEG.
 * 4. For PDF, the image is cut into A4 pages, preferably between two
 *    blocks, then assembled by {@link module:pdf.buildPdf|buildPdf}.
 *
 * ## Sending
 *
 * {@link module:export.shareOrDownload|shareOrDownload} opens Android's share
 * menu (*Web Share* API) when the browser accepts it for this file type, and
 * downloads the file otherwise.
 */

import { t, locale } from './i18n.js';
import { esc } from './util.js';
import { staffSvg } from './render-staff.js';
import { gridSvg, keyLabel } from './grid.js';
import { noteFileJson } from './storage.js';
import { buildPdf, A4 } from './pdf.js';

/** Logical width of the image (px); the final image is twice as wide. */
const W = 720;
/** Inner margin (px). */
const PAD = 40;
/** Canvas supersampling factor. */
const SCALE = 2;

/** Fixed light palette of the export (independent of the phone's theme). */
const C = { ink: '#151A25', muted: '#5B6477', line: '#8D96A9', paper: '#FFFFFF' };

/** Styles of the SVG classes produced by render-staff and gridSvg. */
const SVG_CSS = `
.l{stroke:${C.line};stroke-width:1}.bar{stroke:${C.ink};stroke-width:1.2}.f{fill:${C.ink}}.s{stroke:${C.ink};fill:none}
.h{fill:${C.paper};stroke:${C.ink};stroke-width:1.6}.t{fill:${C.ink};font-family:"Bricolage Grotesque",sans-serif;font-weight:700}
.clef,.simg{fill:${C.ink};font-family:"Noto Music",serif}.simg{font-size:28px}
.chord{fill:${C.ink};font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:14px}
.mnum{fill:${C.muted};font-size:10px;font-family:"Instrument Sans",sans-serif}
.tup{fill:${C.ink};font-family:"Instrument Sans",sans-serif;font-style:italic;font-weight:700;font-size:12px}
.chg,.chm{fill:${C.ink};font-family:"Bricolage Grotesque",sans-serif;font-weight:600}.chm{fill:${C.line};font-weight:400}
.secl{fill:${C.paper};font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:11px}
.volt{fill:${C.ink};font-family:"Instrument Sans",sans-serif;font-weight:600;font-size:10px}
.ttl{fill:${C.ink};font-family:"Bricolage Grotesque",sans-serif;font-weight:700;font-size:30px}
.txt{fill:${C.ink};font-family:"Instrument Sans",sans-serif;font-size:16px}
.cap{fill:${C.muted};font-family:"Instrument Sans",sans-serif;font-size:12px;font-weight:600;letter-spacing:.06em}
.foot{fill:${C.muted};font-family:"Instrument Sans",sans-serif;font-size:11px}`;

// @font-face rules with base64 fonts (computed only once).
/** @type {Promise<string>|null} */
let fontCssPromise = null;

/**
 * An `@font-face` rule found in a stylesheet.
 * @typedef {Object} FontFaceRule
 * @property {string} rule Full text of the rule, with `unicode-range` removed
 *   (useless in the image, and the font must cover every character).
 * @property {string} url Address of the font file, as written in the CSS.
 */

/**
 * Extracts the `@font-face` rules of a stylesheet.
 *
 * Pure function, tested on the real `css/fonts.css`: CSS syntax allows
 * spaces, line breaks and quotes, and reformatting the file (Prettier) must
 * not break image export.
 *
 * @param {string} css
 * @returns {FontFaceRule[]}
 */
export function parseFontFaces(css) {
  const rules = css.match(/@font-face\s*\{[^}]*\}/g) || [];
  return rules
    .map((rule) => {
      const m = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(rule);
      return m ? { rule: rule.replace(/unicode-range\s*:[^;}]*;?/, ''), url: m[1] } : null;
    })
    .filter(Boolean);
}

/**
 * Reads `css/fonts.css` and replaces each font's address with the
 * base64-encoded file. Computed only once per session.
 * @returns {Promise<string>} Self-contained `@font-face` rules, to insert into the SVG.
 */
function embeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const cssUrl = new URL('../css/fonts.css', import.meta.url);
      const faces = parseFontFaces(await (await fetch(cssUrl)).text());
      const out = await Promise.all(
        faces.map(async ({ rule, url }) => {
          const buf = new Uint8Array(await (await fetch(new URL(url, cssUrl))).arrayBuffer());
          // Bytes → base64 conversion in chunks (String.fromCharCode refuses very long arrays).
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000)
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          return rule.replace(/url\([^)]*\)/, `url(data:font/woff2;base64,${btoa(bin)})`);
        }),
      );
      return out.join('\n');
    })().catch(() => '');
  }
  return fontCssPromise;
}

/**
 * Splits a paragraph into lines that fit in `maxW` pixels.
 * Greedy word-by-word algorithm; a word longer than the line is left as is.
 * @param {CanvasRenderingContext2D} ctx Context with the right font.
 * @param {string} text
 * @param {number} maxW
 * @returns {string[]}
 */
function wrap(ctx, text, maxW) {
  const lines = [];
  text.split('\n').forEach((para) => {
    let line = '';
    para
      .split(/\s+/)
      .filter(Boolean)
      .forEach((word) => {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else line = test;
      });
    lines.push(line);
  });
  return lines;
}

/**
 * Caption shown above a staff or a chart.
 * @param {module:model~Block} b
 * @returns {string}
 */
function caption(b) {
  if (b.type === 'grid')
    return `${t('grid.kind').toUpperCase()} · ${keyLabel(b.key).toUpperCase()} · ${b.time} · ${b.style.toUpperCase()} · TEMPO ${b.tempo}`;
  const kind = (
    b.clef === 'rhythm'
      ? t('staff.rhythm')
      : b.clef === 'bass'
        ? t('export.bassClef')
        : t('export.trebleClef')
  ).toUpperCase();
  return `${kind} · ${b.time} · TEMPO ${b.tempo}${b.swing ? ' · SWING' : ''}`;
}

/**
 * Lays out a note as a self-contained SVG.
 *
 * @param {module:model~Note} note
 * @returns {Promise<{svg: string, width: number, height: number, breaks: number[]}>}
 *   `breaks`: y positions (px) of the gaps between blocks, where a page break looks good.
 */
async function noteToSvg(note) {
  if (document.fonts) {
    await Promise.all(
      ['700 30px "Bricolage Grotesque"', '16px "Instrument Sans"'].map((f) =>
        document.fonts.load(f).catch(() => {}),
      ),
    );
  }
  const ctx = document.createElement('canvas').getContext('2d');
  const CW = W - 2 * PAD;
  let y = PAD;
  let body = '';
  const breaks = [];

  // Title (on several lines if needed) and date.
  ctx.font = '700 30px "Bricolage Grotesque", sans-serif';
  wrap(ctx, note.title || t('list.untitled'), CW).forEach((l) => {
    y += 34;
    body += `<text class="ttl" x="${PAD}" y="${y}">${esc(l)}</text>`;
  });
  const date = t('export.created', {
    date: new Date(note.created || note.updated).toLocaleDateString(locale(), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  });
  y += 24;
  body += `<text class="foot" x="${PAD}" y="${y}">${esc(date)}</text>`;
  y += 12;

  ctx.font = '16px "Instrument Sans", sans-serif';
  note.blocks.forEach((b) => {
    if (b.type === 'text') {
      if (!b.text.trim()) return;
      breaks.push(y);
      y += 14;
      wrap(ctx, b.text, CW).forEach((l) => {
        y += 24;
        body += `<text class="txt" x="${PAD}" y="${y}" xml:space="preserve">${esc(l)}</text>`;
      });
      y += 6;
    } else if (b.type === 'staff') {
      breaks.push(y);
      y += 30;
      body += `<text class="cap" x="${PAD}" y="${y}">${esc(caption(b))}</text>`;
      // The band of each staff line reserves ~20 px at the top for chord
      // symbols: it is placed right under the caption without overlap.
      const { svg, L } = staffSvg(b, CW);
      body += `<g transform="translate(${PAD},${y + 4})">${svg}</g>`;
      y += L.height - 6;
    } else if (b.type === 'grid') {
      breaks.push(y);
      y += 30;
      body += `<text class="cap" x="${PAD}" y="${y}">${esc(caption(b))}</text>`;
      // Empty measures at the end of a chart (created while typing) are not exported.
      const measures = b.measures.slice();
      while (
        measures.length > 1 &&
        !measures[measures.length - 1].ch.length &&
        !measures[measures.length - 2].fin
      )
        measures.pop();
      const g = gridSvg({ ...b, measures }, CW);
      body += `<g transform="translate(${PAD},${y + 12})">${g.svg}</g>`;
      y += 12 + g.height;
    }
  });
  y += 30;
  body += `<text class="foot" x="${W - PAD}" y="${y}" text-anchor="end">Inkline</text>`;
  const height = Math.ceil(y + PAD - 10);
  breaks.push(height);

  const fonts = await embeddedFontCss();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}">` +
    `<style>${fonts}${SVG_CSS}</style><rect width="100%" height="100%" fill="${C.paper}"/>${body}</svg>`;
  return { svg, width: W, height, breaks };
}

/**
 * Rasterizes an SVG onto a canvas (×{@link SCALE}).
 * @param {string} svg
 * @param {number} w Logical width.
 * @param {number} h Logical height.
 * @returns {Promise<HTMLCanvasElement>}
 */
async function rasterize(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Embedded fonts are sometimes applied just after decoding:
    // a short delay avoids a first image with fallback fonts.
    await new Promise((r) => setTimeout(r, 60));
    const canvas = document.createElement('canvas');
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} type
 * @param {number} [quality]
 * @returns {Promise<Blob>}
 */
const toBlob = (canvas, type, quality) =>
  new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('export impossible'))), type, quality),
  );

/**
 * PNG image of the note.
 * @param {module:model~Note} note
 * @returns {Promise<Blob>}
 */
export async function noteToPng(note) {
  const { svg, width, height } = await noteToSvg(note);
  return toBlob(await rasterize(svg, width, height), 'image/png');
}

/**
 * Chooses where to cut pages: each page is filled as much as possible by
 * cutting at the last gap between blocks that fits; if a block is taller
 * than a page, it is cut in the middle (nothing better is possible).
 *
 * @param {number[]} breaks Possible cuts (increasing, the last = total height).
 * @param {number} pageH Height of a page in logical px.
 * @returns {number[]} End y of each page.
 */
export function paginate(breaks, pageH) {
  const total = breaks[breaks.length - 1];
  const ends = [];
  let start = 0;
  while (start < total - 1) {
    const limit = start + pageH;
    if (limit >= total) {
      ends.push(total);
      break;
    }
    const candidates = breaks.filter((b) => b > start + pageH * 0.3 && b <= limit);
    const end = candidates.length ? candidates[candidates.length - 1] : limit;
    ends.push(end);
    start = end;
  }
  return ends;
}

/**
 * A4 PDF of the note (one JPEG image per page).
 * @param {module:model~Note} note
 * @returns {Promise<Blob>}
 */
export async function noteToPdf(note) {
  const { svg, width, height, breaks } = await noteToSvg(note);
  const canvas = await rasterize(svg, width, height);
  const pageH = Math.floor((A4.h / A4.w) * width); // height of an A4 page in logical px
  const pages = [];
  let start = 0;
  for (const end of paginate(breaks, pageH)) {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.round((end - start) * SCALE);
    const sctx = slice.getContext('2d');
    sctx.fillStyle = C.paper;
    sctx.fillRect(0, 0, slice.width, slice.height);
    sctx.drawImage(canvas, 0, -start * SCALE);
    const jpeg = new Uint8Array(await (await toBlob(slice, 'image/jpeg', 0.92)).arrayBuffer());
    pages.push({ jpeg, width: slice.width, height: slice.height });
    start = end;
  }
  return new Blob([buildPdf(pages)], { type: 'application/pdf' });
}

/**
 * `.inkline` file of the note.
 * @param {module:model~Note} note
 * @returns {Blob}
 */
export function noteToInkline(note) {
  return new Blob([noteFileJson(note)], { type: 'application/json' });
}

/**
 * Readable file name from the title ("Blues en F" → "blues-en-f").
 * @param {string} title
 * @returns {string}
 */
export function slug(title) {
  const s = (title || 'note')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return s.slice(0, 50) || 'note';
}

/**
 * Downloads a Blob through a temporary link.
 * @param {Blob} blob
 * @param {string} name
 */
export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/**
 * Opens the phone's share menu with the file, or downloads it.
 *
 * Chrome Android only shares certain types (images, PDF, text…). An
 * `.inkline` (JSON) is not one of them: several name/type variants are
 * therefore tried, from the cleanest to the most compatible, before falling
 * back to a download.
 *
 * @param {Blob} blob
 * @param {Array.<{name: string, type: string}>} variants Names and types to try, in order.
 * @param {string} title Title offered to the receiving app.
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
export async function shareOrDownload(blob, variants, title) {
  if (navigator.canShare && navigator.share) {
    for (const v of variants) {
      const file = new File([blob], v.name, { type: v.type });
      if (!navigator.canShare({ files: [file] })) continue;
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled'; // the user closed the menu
        break; // other refusal (activation expired…): download
      }
    }
  }
  download(blob, variants[0].name);
  return 'downloaded';
}
