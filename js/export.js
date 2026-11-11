/**
 * @module export
 * @description
 * **Partage d'une note** : fichier `.inkline`, image PNG ou PDF.
 *
 * ## Rendu d'une note en image
 *
 * 1. {@link module:export~noteToSvg|noteToSvg} compose la note entière dans **un seul SVG** :
 *    titre, date, blocs texte (retour à la ligne calculé avec
 *    `CanvasRenderingContext2D.measureText`), portées ({@link module:render-staff}),
 *    grilles ({@link module:grid.gridSvg|gridSvg}). Toujours en thème clair, pour l'impression.
 * 2. Les **polices sont embarquées** dans le SVG en base64 (`data:` URI) :
 *    une image SVG affichée par `<img>` n'a pas le droit de charger des
 *    fichiers externes. On relit `css/fonts.css` pour savoir lesquelles.
 * 3. Le SVG est chargé dans un `Image`, dessiné sur un `<canvas>` à ×2
 *    (netteté sur écran haute densité), puis exporté en PNG ou en JPEG.
 * 4. Pour le PDF, l'image est découpée en pages A4, de préférence entre
 *    deux blocs, puis assemblée par {@link module:pdf.buildPdf|buildPdf}.
 *
 * ## Envoi
 *
 * {@link module:export.shareOrDownload|shareOrDownload} ouvre le menu de
 * partage d'Android (API *Web Share*) quand le navigateur l'accepte pour ce
 * type de fichier, et télécharge le fichier sinon.
 */

import { t, locale } from './i18n.js';
import { esc } from './util.js';
import { staffSvg } from './render-staff.js';
import { gridSvg, keyLabel } from './grid.js';
import { noteFileJson } from './storage.js';
import { buildPdf, A4 } from './pdf.js';

/** Largeur logique de l'image (px) ; l'image finale fait le double. */
const W = 720;
/** Marge intérieure (px). */
const PAD = 40;
/** Facteur de suréchantillonnage du canvas. */
const SCALE = 2;

/** Palette claire fixe de l'export (indépendante du thème du téléphone). */
const C = { ink: '#151A25', muted: '#5B6477', line: '#8D96A9', paper: '#FFFFFF' };

/** Styles des classes SVG produites par render-staff et gridSvg. */
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

// Règles @font-face avec polices en base64 (calculées une seule fois).
/** @type {Promise<string>|null} */
let fontCssPromise = null;

/**
 * Une règle `@font-face` trouvée dans une feuille de style.
 * @typedef {Object} FontFaceRule
 * @property {string} rule Texte complet de la règle, `unicode-range` retiré
 *   (inutile dans l'image, et la police doit couvrir tous les caractères).
 * @property {string} url Adresse du fichier de police, telle qu'écrite dans le CSS.
 */

/**
 * Extrait les règles `@font-face` d'une feuille de style.
 *
 * Fonction pure, testée sur le vrai `css/fonts.css` : la syntaxe CSS
 * autorise espaces, retours à la ligne et guillemets, et un reformatage du
 * fichier (Prettier) ne doit pas casser l'export des images.
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
 * Lit `css/fonts.css` et remplace l'adresse de chaque police par le fichier encodé en base64.
 * Calculé une seule fois par session.
 * @returns {Promise<string>} Règles `@font-face` autonomes, à insérer dans le SVG.
 */
function embeddedFontCss() {
  if (!fontCssPromise) {
    fontCssPromise = (async () => {
      const cssUrl = new URL('../css/fonts.css', import.meta.url);
      const faces = parseFontFaces(await (await fetch(cssUrl)).text());
      const out = await Promise.all(
        faces.map(async ({ rule, url }) => {
          const buf = new Uint8Array(await (await fetch(new URL(url, cssUrl))).arrayBuffer());
          // Conversion octets → base64 par paquets (String.fromCharCode refuse les très longs tableaux).
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
 * Coupe un paragraphe en lignes qui tiennent dans `maxW` pixels.
 * Algorithme glouton mot à mot ; un mot plus long que la ligne est laissé tel quel.
 * @param {CanvasRenderingContext2D} ctx Contexte avec la bonne police.
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
 * Légende affichée au-dessus d'une portée ou d'une grille.
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
 * Compose une note en un SVG autonome.
 *
 * @param {module:model~Note} note
 * @returns {Promise<{svg: string, width: number, height: number, breaks: number[]}>}
 *   `breaks` : ordonnées (px) des espaces entre blocs, où une coupure de page est élégante.
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

  // Titre (sur plusieurs lignes si besoin) et date.
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
      // La bande de chaque ligne de portée réserve ~20 px en haut pour les
      // accords chiffrés : on la place juste sous la légende sans chevauchement.
      const { svg, L } = staffSvg(b, CW);
      body += `<g transform="translate(${PAD},${y + 4})">${svg}</g>`;
      y += L.height - 6;
    } else if (b.type === 'grid') {
      breaks.push(y);
      y += 30;
      body += `<text class="cap" x="${PAD}" y="${y}">${esc(caption(b))}</text>`;
      // Les mesures vides en fin de grille (créées pendant la saisie) ne sont pas exportées.
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
 * Rasterise un SVG sur un canvas (×{@link SCALE}).
 * @param {string} svg
 * @param {number} w Largeur logique.
 * @param {number} h Hauteur logique.
 * @returns {Promise<HTMLCanvasElement>}
 */
async function rasterize(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Les polices embarquées sont parfois appliquées juste après le décodage :
    // un court délai évite une première image avec des polices de secours.
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
 * Image PNG de la note.
 * @param {module:model~Note} note
 * @returns {Promise<Blob>}
 */
export async function noteToPng(note) {
  const { svg, width, height } = await noteToSvg(note);
  return toBlob(await rasterize(svg, width, height), 'image/png');
}

/**
 * Choisit où couper les pages : on remplit chaque page au maximum en coupant
 * au dernier espace entre blocs qui tient ; si un bloc est plus haut qu'une
 * page, on coupe en plein milieu (rien de mieux possible).
 *
 * @param {number[]} breaks Coupures possibles (croissantes, la dernière = hauteur totale).
 * @param {number} pageH Hauteur d'une page en px logiques.
 * @returns {number[]} Ordonnées de fin de chaque page.
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
 * PDF A4 de la note (une image JPEG par page).
 * @param {module:model~Note} note
 * @returns {Promise<Blob>}
 */
export async function noteToPdf(note) {
  const { svg, width, height, breaks } = await noteToSvg(note);
  const canvas = await rasterize(svg, width, height);
  const pageH = Math.floor((A4.h / A4.w) * width); // hauteur d'une page A4 en px logiques
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
 * Fichier `.inkline` de la note.
 * @param {module:model~Note} note
 * @returns {Blob}
 */
export function noteToInkline(note) {
  return new Blob([noteFileJson(note)], { type: 'application/json' });
}

/**
 * Nom de fichier lisible à partir du titre (« Blues en F » → « blues-en-f »).
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
 * Télécharge un Blob via un lien temporaire.
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
 * Ouvre le menu de partage du téléphone avec le fichier, ou le télécharge.
 *
 * Chrome Android n'accepte de partager que certains types (images, PDF,
 * texte…). Un `.inkline` (JSON) n'en fait pas partie : on tente donc
 * plusieurs variantes de nom/type, du plus propre au plus compatible,
 * puis on se replie sur le téléchargement.
 *
 * @param {Blob} blob
 * @param {Array.<{name: string, type: string}>} variants Noms et types à essayer, dans l'ordre.
 * @param {string} title Titre proposé à l'app destinataire.
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
        if (e && e.name === 'AbortError') return 'cancelled'; // l'utilisateur a fermé le menu
        break; // autre refus (activation expirée…) : on télécharge
      }
    }
  }
  download(blob, variants[0].name);
  return 'downloaded';
}
