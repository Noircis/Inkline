/**
 * @module render-staff
 * @description
 * Rendu d'une portée en **SVG**, sous forme de chaîne de caractères.
 *
 * Le rendu part de la mise en page ({@link module:layout.layout|layout}) et dessine
 * par couches, dans cet ordre (l'ordre SVG est l'ordre de peinture) :
 *
 * 1. fond de la zone d'ajout (si le bloc est en édition) ;
 * 2. lignes de portée, clé, chiffrage, numéros de mesure ;
 * 3. barres de mesure et débuts de reprise ;
 * 4. éléments : surlignage, accord chiffré, tête, altération, point, hampe, crochets ;
 * 5. ligatures ;
 * 6. liaisons de prolongation ;
 * 7. crochets de triolet ;
 * 8. curseur d'ajout.
 *
 * ## Conventions graphiques
 *
 * - Les couleurs ne sont jamais écrites en dur : chaque forme reçoit une
 *   classe CSS (`f` = remplie, `s` = trait, `h` = tête creuse, `l` = ligne de
 *   portée…) dont la couleur vient des variables du thème. Le SVG suit donc
 *   automatiquement le mode clair/sombre.
 * - Les têtes sont des ellipses tournées, les hampes des lignes, les
 *   ligatures des polygones (pour gérer la pente), les silences et les
 *   altérations des chemins de Bézier dessinés à la main.
 * - Les clés utilisent les glyphes Unicode du bloc « Musical Symbols »
 *   (U+1D11E clé de sol, U+1D122 clé de fa) avec la police Noto Music.
 *
 * ## Sens des hampes
 *
 * Note isolée : hampe vers le haut si la tête est sous la 3e ligne (`s < 4`),
 * sinon vers le bas. Groupe ligaturé : un seul sens pour tout le groupe,
 * d'après la position moyenne. Ligne rythmique : toujours vers le haut.
 */

import { esc, mod } from './util.js';
import { layout, geom, yOfStep, HALF_SPACE, KEY_ACC_W, INSERT_GAP } from './layout.js';
import { beamGroups, tupletGroups } from './rhythm.js';

/** Remplace `b` et `#` par les vrais signes ♭ et ♯ dans un accord chiffré. */
const fmtChord = (c) => c.replace(/([A-G])b/g, '$1♭').replace(/#/g, '♯');

/** Longueur standard d'une hampe (px), un peu plus d'une octave. */
const STEM = 34;

/** Décalage horizontal (px) de la hampe par rapport au centre de la tête. */
const STEM_DX = 5.6;

/**
 * Dessine un silence.
 * @param {module:model~DurationCode} d
 * @param {number} x Centre.
 * @param {module:layout~SystemGeom} g
 * @param {boolean} rh Ligne rythmique.
 * @returns {string} Fragment SVG.
 */
function restSvg(d, x, g, rh) {
  const m = g.mid;
  // Pause : rectangle sous la 4e ligne. Demi-pause : posée sur la 3e ligne.
  if (d === 'w') {
    const y = rh ? m : g.staffTop + 10;
    return `<rect class="f" x="${x - 6}" y="${y}" width="12" height="5"/>`;
  }
  if (d === 'h') return `<rect class="f" x="${x - 6}" y="${m - 5}" width="12" height="5"/>`;
  // Soupir : zigzag en trait épais terminé par un crochet.
  if (d === 'q')
    return `<path class="s" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" d="M${x - 2} ${m - 15} L${x + 4} ${m - 8} L${x - 1} ${m - 2} L${x + 4} ${m + 4} C${x - 2} ${m + 1} ${x - 4} ${m + 8} ${x + 1} ${m + 12}"/>`;
  // Demi-soupir (et quart de soupir) : un (deux) point(s) avec crochet, sur une tige oblique.
  let s = `<circle class="f" cx="${x - 3}" cy="${m - 5}" r="2.6"/><path class="s" stroke-width="1.6" stroke-linecap="round" d="M${x - 3} ${m - 3} Q${x + 1} ${m - 2} ${x + 4} ${m - 7} L${x - 1} ${m + (d === '16' ? 14 : 10)}"/>`;
  if (d === '16')
    s += `<circle class="f" cx="${x - 5}" cy="${m + 2}" r="2.6"/><path class="s" stroke-width="1.6" stroke-linecap="round" d="M${x - 5} ${m + 4} Q${x - 1} ${m + 5} ${x + 2} ${m + 1}"/>`;
  return s;
}

/**
 * Dessine une altération à gauche d'une tête.
 * @param {number} a Bémol, bécarre, dièse.
 * @param {number} x Centre de l'altération.
 * @param {number} y Ordonnée de la tête.
 * @returns {string}
 */
function accSvg(a, x, y) {
  if (a === 1)
    return `<path class="s" stroke-width="1.2" d="M${x - 2.5} ${y - 9}V${y + 10}M${x + 2.5} ${y - 10}V${y + 9}"/><path class="s" stroke-width="2.6" d="M${x - 5} ${y - 2}L${x + 5} ${y - 4.5}M${x - 5} ${y + 4.5}L${x + 5} ${y + 2}"/>`;
  if (a === 0)
    return `<path class="s" stroke-width="1.2" d="M${x - 3} ${y - 10}V${y + 4}M${x + 3} ${y - 4}V${y + 10}"/><path class="s" stroke-width="2.4" d="M${x - 3} ${y - 1.5}L${x + 3} ${y - 3.5}M${x - 3} ${y + 3.5}L${x + 3} ${y + 1.5}"/>`;
  return `<path class="s" stroke-width="1.3" d="M${x - 3} ${y - 13}V${y + 5}"/><path class="s" stroke-width="1.9" d="M${x - 3} ${y + 5}C${x + 6} ${y - 1} ${x + 5} ${y - 6} ${x - 3} ${y - 1}"/>`;
}

/**
 * Positions (`s`, clé de sol) des altérations de l'armure, dans l'ordre où
 * on les écrit. En clé de fa, tout est deux positions plus bas.
 */
const KEY_POS = {
  sharp: [8, 5, 9, 6, 3, 7, 4], // fa5 do5 sol5 ré5 la4 mi5 si4
  flat: [4, 7, 3, 6, 2, 5, 1], // si4 mi5 la4 ré5 sol4 do5 fa4
};

/** Abscisse de la première altération de l'armure (juste après la clé). */
const KEY_X = 36;

/**
 * Dessine l'armure d'une ligne.
 * @param {module:model~StaffBlock} b
 * @param {module:layout~Layout} L
 * @param {module:layout~SystemGeom} g
 * @returns {string}
 */
function keySigSvg(b, L, g) {
  const ks = b.ks || 0;
  if (!ks || b.clef === 'rhythm') return '';
  const shift = b.clef === 'bass' ? -2 : 0;
  const list = (ks > 0 ? KEY_POS.sharp : KEY_POS.flat).slice(0, Math.abs(ks));
  return list
    .map((s, k) => accSvg(ks > 0 ? 1 : -1, KEY_X + k * KEY_ACC_W, yOfStep(L, g, s + shift)))
    .join('');
}

/**
 * Dessine une barre de mesure.
 * @param {string} type `'single'`, `'double'`, `'final'`, `'rep'` (fin de reprise).
 * @param {number} x Abscisse de la barre (bord droit pour les barres composées).
 * @param {module:layout~SystemGeom} g
 * @param {boolean} rh
 * @param {boolean} start `true` pour un début de reprise `‖:` (x = bord gauche).
 * @returns {string}
 */
function barSvg(type, x, g, rh, start) {
  const y1 = rh ? g.line - 10 : g.staffTop;
  const y2 = rh ? g.line + 10 : g.staffBottom;
  const h = y2 - y1;
  const thin = (xx) => `<line class="bar" x1="${xx}" x2="${xx}" y1="${y1}" y2="${y2}"/>`;
  const thick = (xx) => `<rect class="f" x="${xx}" y="${y1}" width="4" height="${h}"/>`;
  // Points de reprise : dans les 2e et 3e interlignes.
  const dots = (xx) =>
    (rh ? [g.line - 5, g.line + 5] : [g.staffTop + 15, g.staffTop + 25])
      .map((y) => `<circle class="f" cx="${xx}" cy="${y}" r="2"/>`)
      .join('');
  if (start) return thick(x) + thin(x + 7) + dots(x + 12);
  if (type === 'double') return thin(x - 4) + thin(x);
  if (type === 'final') return thin(x - 6) + thick(x - 3);
  if (type === 'rep') return dots(x - 12) + thin(x - 7) + thick(x - 3);
  return thin(x);
}

/**
 * Dessine une liaison de prolongation : un croissant rempli (deux courbes de
 * Bézier quadratiques de flèches différentes), plus élégant qu'un simple trait.
 *
 * @param {number} x1 Début.
 * @param {number} x2 Fin.
 * @param {number} y Ordonnée des têtes.
 * @param {number} dir `1` = liaison sous les têtes (courbe vers le bas), `-1` = au-dessus.
 * @returns {string}
 */
function tieSvg(x1, x2, y, dir) {
  if (x2 - x1 < 4) return '';
  const xm = (x1 + x2) / 2;
  const h = Math.max(4, Math.min(9, (x2 - x1) * 0.15)); // flèche proportionnelle à la longueur
  const y0 = y + dir * 6; // départ légèrement décollé de la tête
  return `<path class="f" d="M${x1} ${y0} Q${xm} ${y0 + dir * h * 2} ${x2} ${y0} Q${xm} ${y0 + dir * (h * 2 - 2.6)} ${x1} ${y0} Z"/>`;
}

/**
 * Options de rendu.
 * @typedef {Object} StaffSvgOptions
 * @property {number|null} [sel] Index de l'élément sélectionné (surligné).
 * @property {number|null} [selEnd] Dernier élément surligné (note coupée en plusieurs morceaux) ; par défaut `sel`.
 * @property {number|null} [play] Index de l'élément en cours de lecture.
 * @property {boolean} [cursor] Afficher la zone et le curseur d'ajout (bloc en édition, mode Écrire).
 * @property {?number} [insertAt] Curseur d'insertion devant cet élément (avec `cursor`) ; absent : en fin de portée.
 * @property {number} [maxSystems] Limiter le nombre de lignes (vignettes de la liste).
 */

/** Épaisseur d'une ligature (px). */
const BEAM_THICKNESS = 4.6;

/** Écart vertical entre la ligature principale et la secondaire (doubles croches). */
const BEAM_GAP = 7.4;

/** Pente maximale d'une ligature (pour rester lisible). */
const MAX_BEAM_SLOPE = 0.22;

/** Longueur minimale d'une hampe sous une ligature (px). */
const MIN_BEAMED_STEM = 27;

/**
 * Données partagées par les fonctions de dessin d'une portée.
 *
 * Les tables `stemUp`, `beamOf` et `tops` sont remplies au fil des couches :
 * ligatures d'abord, puis éléments ; liaisons et triolets les lisent ensuite.
 *
 * @typedef {Object} RenderContext
 * @property {module:model~StaffBlock} b Bloc dessiné.
 * @property {module:model~StaffItem[]} items Ses éléments.
 * @property {module:layout~Layout} L Mise en page.
 * @property {number} W Largeur en px.
 * @property {number} sysCount Nombre de lignes dessinées.
 * @property {StaffSvgOptions} opt Options de rendu.
 * @property {Object.<number, {sx: number, y1: number, y2: number}>} beamStem Hampe imposée par la ligature.
 * @property {Object.<number, boolean>} stemUp Sens de hampe de chaque note (`true` = vers le haut).
 * @property {Object.<number, number>} beamOf Groupe de ligature de chaque note.
 * @property {Object.<number, number>} tops Point le plus haut de chaque élément (pour placer les triolets).
 */

/**
 * L'élément `i` est-il sur une ligne dessinée ?
 * @param {RenderContext} ctx
 * @param {number} i
 * @returns {boolean}
 */
function isVisible(ctx, i) {
  return !!ctx.L.pos[i] && ctx.L.pos[i].sys < ctx.sysCount;
}

/**
 * Couche 2 : lignes de portée, clé, chiffrage (1re ligne) ou numéro de mesure (lignes suivantes).
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawStaffLines(ctx) {
  const { L, b, W } = ctx;
  let out = '';
  for (let sys = 0; sys < ctx.sysCount; sys++) {
    const g = geom(L, sys);
    const system = L.systems[sys];
    // Après une barre de fin, les lignes s'arrêtent à la barre (convention de gravure).
    const xEnd = L.ended && sys === L.systems.length - 1 ? system.end : W;
    if (L.rh) {
      out += `<line class="l" x1="0" x2="${xEnd}" y1="${g.line}" y2="${g.line}"/>`;
      // « Clé » de percussion : deux barres verticales.
      out += `<rect class="f" x="9" y="${g.line - 10}" width="3.2" height="20"/><rect class="f" x="15" y="${g.line - 10}" width="3.2" height="20"/>`;
    } else {
      for (let k = 0; k < 5; k++) {
        const y = g.staffTop + k * 10;
        out += `<line class="l" x1="0" x2="${xEnd}" y1="${y}" y2="${y}"/>`;
      }
      out += `<line class="bar" x1="0.6" x2="0.6" y1="${g.staffTop}" y2="${g.staffBottom}"/>`;
      out +=
        b.clef === 'bass'
          ? `<text class="clef" x="4" y="${g.staffTop + 30}" font-size="38">\u{1D122}</text>`
          : `<text class="clef" x="3" y="${g.staffTop + 30}" font-size="38">\u{1D11E}</text>`;
      out += keySigSvg(b, L, g);
    }
    if (sys === 0) {
      const [num, den] = b.time.split('/').map(esc);
      const tx = 46 + L.ksw;
      out += L.rh
        ? `<text class="t" x="34" y="${g.line - 3}" font-size="15" text-anchor="middle">${num}</text><text class="t" x="34" y="${g.line + 14}" font-size="15" text-anchor="middle">${den}</text>`
        : `<text class="t" x="${tx}" y="${g.staffTop + 17}" font-size="21" text-anchor="middle">${num}</text><text class="t" x="${tx}" y="${g.staffTop + 37}" font-size="21" text-anchor="middle">${den}</text>`;
    } else if (system.ms.length) {
      out += `<text class="mnum" x="2" y="${L.rh ? g.line - 16 : g.staffTop - 8}">${system.firstMeasure}</text>`;
    }
  }
  return out;
}

/**
 * Couche 3 : barres de fin de mesure et débuts de reprise.
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawBars(ctx) {
  const { L } = ctx;
  let out = '';
  L.bars.forEach((bar) => {
    if (bar.sys < ctx.sysCount) out += barSvg(bar.type, bar.x, geom(L, bar.sys), L.rh, false);
  });
  L.starts.forEach((start) => {
    if (start.sys < ctx.sysCount) out += barSvg('rs', start.x, geom(L, start.sys), L.rh, true);
  });
  return out;
}

/**
 * Groupes de ligature, découpés en plus par ligne : une ligature ne traverse
 * pas un retour à la ligne.
 * @param {RenderContext} ctx
 * @returns {number[][]}
 */
function beamGroupsBySystem(ctx) {
  const { L } = ctx;
  const groups = [];
  beamGroups(ctx.items, ctx.b.time, ctx.b.groups).forEach((group) => {
    let cur = [];
    group.forEach((i) => {
      if (cur.length && L.pos[i].sys !== L.pos[cur[0]].sys) {
        if (cur.length >= 2) groups.push(cur);
        cur = [];
      }
      cur.push(i);
    });
    if (cur.length >= 2) groups.push(cur);
  });
  return groups;
}

/**
 * Couche 5 : ligatures. Remplit aussi `beamStem`, `stemUp` et `beamOf`,
 * car la ligature impose le sens et la longueur des hampes de son groupe.
 *
 * Calcul de la ligature d'un groupe :
 * 1. sens commun des hampes, d'après la position moyenne des têtes ;
 * 2. pente naturelle de l'extrémité de la 1re hampe à celle de la dernière,
 *    bornée à ±{@link MAX_BEAM_SLOPE} ;
 * 3. décalage de toute la ligature pour qu'aucune hampe ne fasse moins de
 *    {@link MIN_BEAMED_STEM} px ;
 * 4. ligature secondaire pour les doubles croches : continue entre doubles
 *    croches voisines, sinon demi-ligature vers l'intérieur du groupe.
 *
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawBeams(ctx) {
  const { L, items } = ctx;
  let out = '';
  beamGroupsBySystem(ctx).forEach((group, groupIndex) => {
    const sys = L.pos[group[0]].sys;
    if (sys >= ctx.sysCount) return;
    const g = geom(L, sys);
    const avgStep = group.reduce((acc, i) => acc + (L.rh ? 0 : items[i].s), 0) / group.length;
    const up = L.rh || avgStep < 4;
    const points = group.map((i) => ({
      i,
      y: yOfStep(L, g, L.rh ? 4 : items[i].s),
      sx: L.pos[i].x + (up ? STEM_DX : -STEM_DX),
    }));
    const first = points[0];
    const last = points[points.length - 1];

    const end0 = up ? first.y - (STEM - 2) : first.y + (STEM - 2);
    const end1 = up ? last.y - (STEM - 2) : last.y + (STEM - 2);
    let slope = last.sx > first.sx ? (end1 - end0) / (last.sx - first.sx) : 0;
    slope = Math.max(-MAX_BEAM_SLOPE, Math.min(MAX_BEAM_SLOPE, slope));
    const naturalY = (x) => end0 + slope * (x - first.sx);

    let shift = 0;
    points.forEach((p) => {
      const missing = up ? naturalY(p.sx) - (p.y - MIN_BEAMED_STEM) : p.y + MIN_BEAMED_STEM - naturalY(p.sx);
      if (missing > shift) shift = missing;
    });
    const beamY = (x) => naturalY(x) + (up ? -shift : shift);

    const dir = up ? 1 : -1;
    const beamPolygon = (x1, x2, offset) => {
      const a = beamY(x1) + offset * dir;
      const c = beamY(x2) + offset * dir;
      return `<polygon class="f" points="${x1},${a} ${x2},${c} ${x2},${c + BEAM_THICKNESS * dir} ${x1},${a + BEAM_THICKNESS * dir}"/>`;
    };
    out += beamPolygon(first.sx - (up ? 0.8 : 0), last.sx + (up ? 0 : 0.8), 0);

    for (let k = 0; k < points.length; k++) {
      if (items[points[k].i].d !== '16') continue;
      let j = k;
      while (j + 1 < points.length && items[points[j + 1].i].d === '16') j++;
      if (j > k) {
        out += beamPolygon(points[k].sx, points[j].sx, BEAM_GAP);
      } else {
        const x = points[k].sx;
        out += k === points.length - 1 ? beamPolygon(x - 8, x, BEAM_GAP) : beamPolygon(x, x + 8, BEAM_GAP);
      }
      k = j;
    }

    points.forEach((p) => {
      ctx.beamStem[p.i] = { sx: p.sx, y1: p.y + (up ? -1 : 1), y2: beamY(p.sx) };
      ctx.stemUp[p.i] = up;
      ctx.beamOf[p.i] = groupIndex;
    });
  });
  return out;
}

/**
 * Lignes supplémentaires d'une tête hors portée (sous la portée pour s ≤ -2,
 * au-dessus pour s ≥ 10).
 * @param {RenderContext} ctx
 * @param {module:layout~SystemGeom} g
 * @param {number} x Centre de la tête.
 * @param {number} step Position de la tête.
 * @returns {string}
 */
function ledgerLines(ctx, g, x, step) {
  let out = '';
  const line = (k) => {
    const ly = yOfStep(ctx.L, g, k);
    out += `<line class="s" stroke-width="1.2" x1="${x - 10}" x2="${x + 10}" y1="${ly}" y2="${ly}"/>`;
  };
  for (let k = -2; k >= step; k -= 2) line(k);
  for (let k = 10; k <= step; k += 2) line(k);
  return out;
}

/**
 * Hampe (et crochets) d'une note non ligaturée.
 * Hampe vers le haut si la tête est sous la 3e ligne ; elle atteint au
 * moins la ligne du milieu (règle de gravure).
 * @param {RenderContext} ctx
 * @param {module:model~StaffItem} it
 * @param {number} i
 * @param {module:layout~SystemGeom} g
 * @param {number} x Centre de la tête.
 * @param {number} y Ordonnée de la tête.
 * @param {number} step Position de la tête.
 * @returns {{svg: string, top: number|null}} `top` : extrémité haute de la hampe si elle monte.
 */
function freeStem(ctx, it, i, g, x, y, step) {
  const rh = ctx.L.rh;
  const up = rh || step < 4;
  ctx.stemUp[i] = up;
  const sx = x + (up ? STEM_DX : -STEM_DX);
  let ey = up ? y - STEM : y + STEM;
  if (!rh) {
    if (up && ey > g.mid) ey = g.mid;
    if (!up && ey < g.mid) ey = g.mid;
  }
  let svg = `<line class="s" stroke-width="1.3" x1="${sx}" x2="${sx}" y1="${y + (up ? -1 : 1)}" y2="${ey}"/>`;
  const flagCount = it.d === '8' ? 1 : it.d === '16' ? 2 : 0;
  for (let k = 0; k < flagCount; k++) {
    const o = k * 7;
    svg += up
      ? `<path class="s" stroke-width="2" stroke-linecap="round" d="M${sx} ${ey + o} C${sx} ${ey + o + 7} ${sx + 9} ${ey + o + 11} ${sx + 7} ${ey + o + 22}"/>`
      : `<path class="s" stroke-width="2" stroke-linecap="round" d="M${sx} ${ey - o} C${sx} ${ey - o - 7} ${sx + 9} ${ey - o - 11} ${sx + 7} ${ey - o - 22}"/>`;
  }
  return { svg, top: up ? ey : null };
}

/**
 * Dessin d'une note : lignes supplémentaires, tête, altération, point, hampe.
 * Renseigne `tops[i]`.
 * @param {RenderContext} ctx
 * @param {module:model~StaffItem} it
 * @param {number} i
 * @param {module:layout~SystemGeom} g
 * @param {number} x
 * @returns {string}
 */
function drawNote(ctx, it, i, g, x) {
  const rh = ctx.L.rh;
  const step = rh ? 4 : it.s;
  const y = yOfStep(ctx.L, g, step);
  let out = rh ? '' : ledgerLines(ctx, g, x, step);

  // Tête : creuse pour ronde et blanche, pleine sinon.
  const whole = it.d === 'w';
  const hollow = whole || it.d === 'h';
  const rx = whole ? 7.6 : 6.2;
  const ry = whole ? 4.8 : 4.5;
  out += `<ellipse class="${hollow ? 'h' : 'f'}" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${whole ? -8 : -22} ${x} ${y})"${hollow ? ' stroke-width="' + (whole ? 2.4 : 1.8) + '"' : ''}/>`;
  if (it.a != null && !rh) out += accSvg(it.a, x - 15, y);

  // Point : dans l'interligne au-dessus si la tête est sur une ligne.
  if (it.dot) {
    const dy = rh || mod(step, 2) === 0 ? y - HALF_SPACE : y;
    out += `<circle class="f" cx="${x + (whole ? 13 : 11)}" cy="${dy}" r="1.9"/>`;
  }

  let top = y - 6;
  if (whole) {
    ctx.stemUp[i] = step < 4; // pas de hampe, mais le sens sert aux liaisons
  } else if (ctx.beamStem[i]) {
    const st = ctx.beamStem[i];
    out += `<line class="s" stroke-width="1.3" x1="${st.sx}" x2="${st.sx}" y1="${st.y1}" y2="${st.y2}"/>`;
    if (ctx.stemUp[i]) top = st.y2;
  } else {
    const stem = freeStem(ctx, it, i, g, x, y, step);
    out += stem.svg;
    if (stem.top != null) top = stem.top;
  }
  ctx.tops[i] = top;
  return out;
}

/**
 * Couche 4 : éléments (surlignage, accord chiffré, note ou silence).
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawItems(ctx) {
  const { L, opt } = ctx;
  let out = '';
  ctx.items.forEach((it, i) => {
    if (!isVisible(ctx, i)) return;
    const p = L.pos[i];
    const g = geom(L, p.sys);
    // Une note coupée par une barre (morceaux automatiques) est surlignée en entier.
    const selected = opt.sel != null && i >= opt.sel && i <= (opt.selEnd ?? opt.sel);
    const cls = 'it' + (selected ? ' sel' : '') + (opt.play === i ? ' play' : '');
    let s = `<g class="${cls}">`;
    if (selected) {
      const top = L.rh ? g.line - 26 : g.staffTop - 14;
      s += `<rect class="selbg" x="${p.x0}" y="${top}" width="${p.x1 - p.x0}" height="${L.rh ? 52 : 68}" rx="4"/>`;
    }
    if (it.c) s += `<text class="chord" x="${p.x - 6}" y="${g.chordY}">${esc(fmtChord(it.c))}</text>`;
    if (it.r) {
      s += restSvg(it.d, p.x, g, L.rh);
      if (it.dot) s += `<circle class="f" cx="${p.x + 10}" cy="${g.mid - 5}" r="1.9"/>`;
      ctx.tops[i] = L.rh ? g.line - 16 : g.staffTop;
    } else {
      s += drawNote(ctx, it, i, g, p.x);
    }
    out += s + '</g>';
  });
  return out;
}

/**
 * Couche 6 : liaisons de prolongation.
 *
 * Une liaison va de la tête liée à la tête suivante, du côté opposé à la
 * hampe. Si la note suivante est sur la ligne d'après, on dessine deux
 * demi-liaisons : jusqu'au bout de la ligne, puis depuis le début de la
 * suivante. Sans note suivante, une courte liaison « en attente ».
 *
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawTies(ctx) {
  const { L, items } = ctx;
  let out = '';
  items.forEach((it, i) => {
    if (!it.tie || it.r || !isVisible(ctx, i)) return;
    const p = L.pos[i];
    const y = yOfStep(L, geom(L, p.sys), L.rh ? 4 : it.s);
    const dir = L.rh || ctx.stemUp[i] ? 1 : -1;
    const next = items[i + 1];
    const q = L.pos[i + 1];
    if (!next || next.r || !q) {
      out += tieSvg(p.x + 7, p.x + 22, y, dir);
    } else if (q.sys === p.sys) {
      out += tieSvg(p.x + 7, q.x - 7, y, dir);
    } else {
      out += tieSvg(p.x + 7, Math.max(p.x + 20, L.systems[p.sys].end - 2), y, dir);
      if (q.sys < ctx.sysCount) {
        const nextY = yOfStep(L, geom(L, q.sys), L.rh ? 4 : next.s);
        out += tieSvg(L.systems[q.sys].start - 10, q.x - 7, nextY, dir);
      }
    }
  });
  return out;
}

/**
 * Couche 7 : triolets. Un « 3 » au-dessus du groupe ; si le groupe n'est pas
 * exactement une ligature hampes en haut, on ajoute un crochet horizontal
 * avec deux petits retours vers le bas.
 * @param {RenderContext} ctx
 * @returns {string}
 */
function drawTuplets(ctx) {
  const { L } = ctx;
  let out = '';
  tupletGroups(ctx.items, ctx.b.time).forEach((tg) => {
    const shown = tg.idx.filter((i) => isVisible(ctx, i));
    if (!shown.length) return;
    const sys = L.pos[shown[0]].sys;
    const onLine = shown.filter((i) => L.pos[i].sys === sys); // seule la 1re ligne du groupe porte le chiffre
    const g = geom(L, sys);
    const x0 = L.pos[onLine[0]].x - 8;
    const x1 = L.pos[onLine[onLine.length - 1]].x + 8;
    const minTop = Math.min(...onLine.map((i) => ctx.tops[i] ?? g.staffTop), L.rh ? g.line - 30 : g.staffTop);
    const y = Math.max(g.top + 26, minTop - 8);
    const xm = (x0 + x1) / 2;
    const singleBeam =
      onLine.length >= 2 &&
      onLine.every(
        (i) => ctx.beamOf[i] !== undefined && ctx.beamOf[i] === ctx.beamOf[onLine[0]] && ctx.stemUp[i],
      );
    if (!singleBeam) {
      out += `<path class="s" stroke-width="1.1" d="M${x0} ${y + 5} V${y} H${xm - 7} M${xm + 7} ${y} H${x1} V${y + 5}"/>`;
    }
    out += `<text class="tup" x="${xm}" y="${y + 4}" text-anchor="middle">3</text>`;
  });
  return out;
}

/**
 * Couches 1 et 8 : fond de la zone d'ajout et curseur pointillé.
 * @param {RenderContext} ctx
 * @returns {{background: string, cursor: string}}
 */
function drawAppendZone(ctx) {
  const { L, W } = ctx;
  if (!ctx.opt.cursor) return { background: '', cursor: '' };
  if (L.insertX != null && L.insertSys < ctx.sysCount) {
    // Curseur d'insertion au milieu de la portée : zone étroite dans le trou ouvert.
    const g = geom(L, L.insertSys);
    const y1 = L.rh ? g.line - 18 : g.staffTop - 10;
    const y2 = L.rh ? g.line + 18 : g.staffBottom + 10;
    const half = INSERT_GAP / 2;
    return {
      background: `<rect class="cursorbg" x="${L.insertX - half}" y="${y1}" width="${INSERT_GAP}" height="${y2 - y1}" rx="4"/>`,
      cursor: `<line class="cursor" x1="${L.insertX}" x2="${L.insertX}" y1="${y1}" y2="${y2}"/>`,
    };
  }
  if (L.appendX == null || L.appendSys >= ctx.sysCount) return { background: '', cursor: '' };
  const g = geom(L, L.appendSys);
  const y1 = L.rh ? g.line - 18 : g.staffTop - 10;
  const y2 = L.rh ? g.line + 18 : g.staffBottom + 10;
  return {
    background: `<rect class="cursorbg" x="${L.appendX - 6}" y="${y1}" width="${Math.max(30, W - L.appendX + 6)}" height="${y2 - y1}" rx="4"/>`,
    cursor: `<line class="cursor" x1="${L.appendX}" x2="${L.appendX}" y1="${y1}" y2="${y2}"/>`,
  };
}

/**
 * Rend une portée complète en SVG.
 *
 * Les couches sont calculées dans l'ordre des dépendances (les ligatures
 * avant les notes, qui en reçoivent leurs hampes ; les notes avant les
 * liaisons et triolets, qui ont besoin du sens des hampes et des points
 * hauts), puis assemblées dans l'ordre de peinture décrit en tête de module.
 *
 * @param {module:model~StaffBlock} b
 * @param {number} W Largeur en px.
 * @param {StaffSvgOptions} [opt]
 * @returns {{svg: string, L: module:layout~Layout}} Le SVG et la mise
 *   en page utilisée (réutilisée par l'appelant pour le hit-testing).
 */
export function staffSvg(b, W, opt = {}) {
  const L = layout(b, W, !!opt.cursor, opt.cursor ? (opt.insertAt ?? null) : null);
  const sysCount = opt.maxSystems ? Math.min(opt.maxSystems, L.systems.length) : L.systems.length;
  const height = sysCount * L.SH;
  /** @type {RenderContext} */
  const ctx = { b, items: b.items, L, W, sysCount, opt, beamStem: {}, stemUp: {}, beamOf: {}, tops: {} };

  const staff = drawStaffLines(ctx);
  const bars = drawBars(ctx);
  const beams = drawBeams(ctx);
  const items = drawItems(ctx);
  const ties = drawTies(ctx);
  const tuplets = drawTuplets(ctx);
  const zone = drawAppendZone(ctx);

  const svg =
    `<svg width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portée">` +
    zone.background +
    staff +
    bars +
    items +
    beams +
    ties +
    tuplets +
    zone.cursor +
    '</svg>';
  return { svg, L };
}
