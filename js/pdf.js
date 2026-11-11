/**
 * @module pdf
 * @description
 * **Minimal PDF** generator, written by hand, with no library.
 *
 * Each page holds a single full-width JPEG image. That is all the export
 * needs: the note is already drawn as an image by {@link module:export|export}.
 * The text cannot be selected, but the file takes ~30 lines of code instead
 * of a 300 KB dependency.
 *
 * ## Structure of a PDF
 *
 * A PDF is a text file (with binary blocks) made of numbered **objects** that
 * reference each other (`3 0 R` = "object number 3"):
 *
 * ```
 * %PDF-1.4
 * 1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj      root
 * 2 0 obj << /Type /Pages /Kids [...] /Count n >> endobj page list
 * for each page:
 *   << /Type /Page /MediaBox [...] /Resources << /XObject << /Im0 … >> >> /Contents … >>
 *   content stream: "q a 0 0 d e f cm /Im0 Do Q"  (places and draws the image)
 *   image: << /Subtype /Image /Filter /DCTDecode … >> stream <JPEG bytes> endstream
 * xref        table of the positions (in bytes) of each object
 * trailer     << /Size … /Root 1 0 R >>  then startxref <position of xref>
 * ```
 *
 * The `DCTDecode` filter means "this stream is a JPEG": the bytes produced by
 * the browser are copied without any decoding. That is what makes this
 * generator so short.
 *
 * The origin of PDF coordinates is **at the bottom left**, in points (1/72
 * inch); an A4 page measures 595.28 × 841.89 points.
 */

/** Dimensions of an A4 page in points. */
export const A4 = { w: 595.28, h: 841.89 };

/**
 * A page to produce.
 * @typedef {Object} PdfPage
 * @property {Uint8Array} jpeg Bytes of a JPEG image.
 * @property {number} width Image width in pixels.
 * @property {number} height Image height in pixels.
 */

/**
 * Builds an A4 PDF where each page shows a full-width JPEG image, aligned at
 * the top.
 *
 * @param {PdfPage[]} pages
 * @returns {Uint8Array} The PDF file.
 */
export function buildPdf(pages) {
  const enc = new TextEncoder();
  /** @type {Uint8Array[]} */
  const chunks = [];
  const offsets = []; // byte position of the start of each object (index = number - 1)
  let pos = 0;
  const put = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    pos += b.length;
  };
  const obj = (num, body) => {
    offsets[num - 1] = pos;
    put(`${num} 0 obj\n`);
    body();
    put('\nendobj\n');
  };

  // Header; the 2nd line (bytes > 127) tells tools that the file contains binary data.
  put('%PDF-1.4\n%âãÏÓ\n');

  // Numbering: 1 catalog, 2 page tree, then 3 objects per page.
  const pageNums = pages.map((_, k) => 3 + k * 3);
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () =>
    put(`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`),
  );

  pages.forEach((p, k) => {
    const pageN = pageNums[k];
    const contentN = pageN + 1;
    const imageN = pageN + 2;
    // Image scaled to the page width, stuck to the top.
    const dw = A4.w;
    const dh = (p.height * A4.w) / p.width;
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} 0 ${(A4.h - dh).toFixed(2)} cm /Im0 Do Q`;
    obj(pageN, () =>
      put(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /XObject << /Im0 ${imageN} 0 R >> >> /Contents ${contentN} 0 R >>`,
      ),
    );
    obj(contentN, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imageN, () => {
      put(
        `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      put(p.jpeg);
      put('\nendstream');
    });
  });

  // Cross-reference table: each entry is exactly 20 bytes.
  const xref = pos;
  const n = offsets.length + 1;
  put(`xref\n0 ${n}\n0000000000 65535 f \n`);
  offsets.forEach((o) => put(`${String(o).padStart(10, '0')} 00000 n \n`));
  put(`trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let at = 0;
  chunks.forEach((c) => {
    out.set(c, at);
    at += c.length;
  });
  return out;
}
