/**
 * @module pdf
 * @description
 * Générateur de **PDF minimal**, écrit à la main, sans bibliothèque.
 *
 * Chaque page contient une seule image JPEG pleine largeur. C'est tout ce
 * dont l'export a besoin : la note est déjà dessinée en image par
 * {@link module:export|export}. Le texte n'est pas sélectionnable, mais le
 * fichier fait ~30 lignes de code au lieu d'une dépendance de 300 Ko.
 *
 * ## Structure d'un PDF
 *
 * Un PDF est un fichier texte (avec des blocs binaires) composé d'**objets**
 * numérotés qui se référencent (`3 0 R` = « l'objet n° 3 ») :
 *
 * ```
 * %PDF-1.4
 * 1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj      racine
 * 2 0 obj << /Type /Pages /Kids [...] /Count n >> endobj liste des pages
 * pour chaque page :
 *   << /Type /Page /MediaBox [...] /Resources << /XObject << /Im0 … >> >> /Contents … >>
 *   flux de contenu : « q a 0 0 d e f cm /Im0 Do Q »  (place et dessine l'image)
 *   image : << /Subtype /Image /Filter /DCTDecode … >> stream <octets JPEG> endstream
 * xref        table des positions (en octets) de chaque objet
 * trailer     << /Size … /Root 1 0 R >>  puis startxref <position de xref>
 * ```
 *
 * Le filtre `DCTDecode` signifie « ce flux est un JPEG » : on recopie les
 * octets produits par le navigateur sans aucun décodage. C'est ce qui rend
 * ce générateur si court.
 *
 * L'origine des coordonnées PDF est **en bas à gauche**, en points (1/72 de
 * pouce) ; une page A4 mesure 595.28 × 841.89 points.
 */

/** Dimensions d'une page A4 en points. */
export const A4 = { w: 595.28, h: 841.89 };

/**
 * Une page à produire.
 * @typedef {Object} PdfPage
 * @property {Uint8Array} jpeg Octets d'une image JPEG.
 * @property {number} width Largeur de l'image en pixels.
 * @property {number} height Hauteur de l'image en pixels.
 */

/**
 * Construit un PDF A4 où chaque page affiche une image JPEG en pleine largeur,
 * alignée en haut.
 *
 * @param {PdfPage[]} pages
 * @returns {Uint8Array} Le fichier PDF.
 */
export function buildPdf(pages) {
  const enc = new TextEncoder();
  /** @type {Uint8Array[]} */
  const chunks = [];
  const offsets = []; // position en octets du début de chaque objet (index = numéro - 1)
  let pos = 0;
  const put = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (num, body) => { offsets[num - 1] = pos; put(`${num} 0 obj\n`); body(); put('\nendobj\n'); };

  // En-tête ; la 2e ligne (octets > 127) signale aux outils que le fichier contient du binaire.
  put('%PDF-1.4\n%âãÏÓ\n');

  // Numérotation : 1 catalogue, 2 arbre des pages, puis 3 objets par page.
  const pageNums = pages.map((_, k) => 3 + k * 3);
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => put(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`));

  pages.forEach((p, k) => {
    const pageN = pageNums[k];
    const contentN = pageN + 1;
    const imageN = pageN + 2;
    // Image mise à l'échelle sur la largeur de la page, collée en haut.
    const dw = A4.w;
    const dh = (p.height * A4.w) / p.width;
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} 0 ${(A4.h - dh).toFixed(2)} cm /Im0 Do Q`;
    obj(pageN, () => put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 ${imageN} 0 R >> >> /Contents ${contentN} 0 R >>`));
    obj(contentN, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imageN, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      put(p.jpeg);
      put('\nendstream');
    });
  });

  // Table des références croisées : chaque entrée fait exactement 20 octets.
  const xref = pos;
  const n = offsets.length + 1;
  put(`xref\n0 ${n}\n0000000000 65535 f \n`);
  offsets.forEach((o) => put(`${String(o).padStart(10, '0')} 00000 n \n`));
  put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  chunks.forEach((c) => { out.set(c, at); at += c.length; });
  return out;
}
