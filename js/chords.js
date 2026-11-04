/**
 * @module chords
 * @description
 * Analyse des **accords chiffrés** saisis en texte libre (`Cm7`, `Bb7alt`,
 * `F#m7b5`, `Ebmaj9/G`…).
 *
 * L'utilisateur peut écrire les qualités de plusieurs façons (`maj7`, `Δ`, `^7`,
 * `M7` ; `m7`, `-7`, `min7` ; `m7b5`, `ø` ; `dim7`, `°7`, `o7`). Ce module :
 *
 * - **découpe** un accord en fondamentale / qualité / basse ({@link module:chords.CHORD_RE|CHORD_RE}) ;
 * - le **met en forme** pour l'affichage avec la qualité en exposant
 *   ({@link module:chords.chordHtml|chordHtml}) ;
 * - en déduit les **notes à jouer** ({@link module:chords.chordTones|chordTones}).
 *
 * La conversion vers et depuis la notation iReal Pro est dans {@link module:ireal|ireal}.
 */

import { esc, mod } from './util.js';

/**
 * Découpage d'un accord : `[1]` lettre, `[2]` altération, `[3]` qualité, `[4]` basse.
 *
 * @example
 * CHORD_RE.exec('Bbm7/F')  // ['Bbm7/F', 'B', 'b', 'm7', 'F']
 * @type {RegExp}
 */
export const CHORD_RE = /^([A-G])([b#♭♯]?)([^/]*)(?:\/([A-G][b#♭♯]?))?$/;

/** Classe de hauteur (0 = do … 11 = si) de chaque lettre. */
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Classe de hauteur d'un nom de note (`'Bb'` → 10, `'F#'` → 6).
 * @param {string} s Lettre + altération éventuelle.
 * @returns {number}
 */
export function pitchClass(s) {
  const acc = s.slice(1);
  return LETTER_PC[s[0]] + (/[b♭]/.test(acc) ? -1 : /[#♯]/.test(acc) ? 1 : 0);
}

/**
 * Indique si une case de grille est valide : accord reconnu, case vide
 * (prolongation), *no chord* ou répétition de mesure.
 * @param {string} c
 * @returns {boolean}
 */
export function chordOk(c) {
  return c === '' || c === 'n' || c === '%' || CHORD_RE.test(c);
}

/**
 * Normalise la qualité pour l'affichage façon « real book » :
 * majeur 7 → Δ, mineur → –, demi-diminué → ø, diminué → °, augmenté → +,
 * et b/# → ♭/♯.
 * @param {string} q Qualité brute.
 * @returns {string}
 */
function prettyQuality(q) {
  return q
    .replace(/^(maj|Maj|MA|M(?=7|9|13|$)|\^)7?/, 'Δ')
    .replace(/^(min|mi|m(?!aj)|-)/, '–')
    .replace(/^–(maj|Maj|Δ|\^)7?/, '–Δ')
    .replace(/^(–7b5|m7b5|ø7?|h7?)/, 'ø')
    .replace(/^(dim|o|°)/, '°')
    .replace(/^aug/, '+')
    .replace(/b/g, '♭')
    .replace(/#/g, '♯');
}

/**
 * Parties d'affichage d'un accord.
 * @typedef {Object} ChordParts
 * @property {string} root Fondamentale avec altération (« B♭ »).
 * @property {string} quality Qualité mise en forme (« –7 », « Δ », « 7♭9 »), à afficher en exposant.
 * @property {string} bass Basse (« /F ») ou chaîne vide.
 */

/**
 * Découpe un accord pour l'affichage (utilisé par le HTML de la grille et
 * par l'export en image).
 * @param {string} c
 * @returns {ChordParts|null} `null` si l'accord n'est pas reconnu.
 */
export function chordParts(c) {
  const m = CHORD_RE.exec(c);
  if (!m) return null;
  const sym = (x) => x.replace('b', '♭').replace('#', '♯');
  return { root: m[1] + sym(m[2]), quality: prettyQuality(m[3]), bass: m[4] ? '/' + sym(m[4]) : '' };
}

/**
 * HTML d'affichage d'une case de grille : fondamentale en gros, qualité en
 * exposant, basse en petit. Une case invalide est rendue telle quelle avec la
 * classe `bad` (soulignée en rouge par le CSS).
 *
 * @param {string} c Contenu de la case.
 * @returns {string} Fragment HTML (déjà échappé).
 */
export function chordHtml(c) {
  if (c === '') return '<span class="slash">/</span>';
  if (c === 'n') return '<span class="nc">N.C.</span>';
  const p = chordParts(c);
  if (!p) return `<span class="bad">${esc(c)}</span>`;
  return `<span class="cr">${esc(p.root)}</span>${p.quality ? `<sup>${esc(p.quality)}</sup>` : ''}${p.bass ? `<span class="cb">${esc(p.bass)}</span>` : ''}`;
}

/**
 * Voicing jouable d'un accord.
 * @typedef {Object} ChordVoicing
 * @property {number} bass Note MIDI de basse (entre mi 2 et ré♯ 3).
 * @property {number[]} notes Notes MIDI de l'accord (entre mi 3 et do 5).
 */

/**
 * Déduit les notes d'un accord à partir de sa qualité.
 *
 * ## Analyse de la qualité
 *
 * On détecte d'abord la famille (majeur 7, mineur, demi-diminué, diminué),
 * puis les ajouts dans le reste de la chaîne :
 *
 * | Indice        | Effet                              |
 * |---------------|------------------------------------|
 * | 7, 9, 11, 13  | septième mineure (ou majeure si maj) |
 * | 6 (sans 7)    | sixte à la place de la septième    |
 * | sus           | quarte à la place de la tierce     |
 * | b5 / #5, +    | quinte diminuée / augmentée        |
 * | b9 / #9 / 9   | neuvième                           |
 * | #11, 13, b13  | extensions                         |
 * | alt           | ♭9 + ♯9 + ♯5                       |
 *
 * ## Voicing
 *
 * La fondamentale n'est jouée qu'à la basse. Les autres intervalles sont
 * repliés dans une tessiture fixe (MIDI 52 à 72) : on obtient des voicings
 * serrés, et des enchaînements avec peu de mouvement, sans algorithme de
 * conduite des voix. La quinte, la note la moins utile, est omise dès
 * qu'il y a deux extensions.
 *
 * @param {string} c Accord.
 * @returns {ChordVoicing|null} `null` si l'accord n'est pas reconnu.
 */
export function chordTones(c) {
  const m = CHORD_RE.exec(c);
  if (!m) return null;
  const root = pitchClass(m[1] + m[2]);
  const q = m[3].replace(/\s/g, '');
  const isMaj = /^(maj|Maj|MA|M(?=7|9|13|$)|\^|Δ|∆)/.test(q);
  const isHalf = /^(ø|h|m7b5|-7b5|mi7b5|min7b5)/.test(q);
  const isDim = /^(dim|o|°)/.test(q);
  const isMin = !isMaj && !isHalf && !isDim && /^(min|mi|m|-)/.test(q);
  const body = q.replace(/^(maj|Maj|MA|M|\^|Δ|∆|min|mi|m|-|ø|h|dim|o|°)/, '');
  const minMaj = isMin && /^(maj|Maj|\^|Δ)/.test(body);

  let third = isMin || isHalf || isDim ? 3 : 4;
  let fifth = 7;
  let sev = null;
  const ext = [];
  const hasExt = /(7|9|11|13)/.test(body);
  if (isMaj || minMaj) sev = 11;
  else if (isHalf) sev = 10;
  else if (isDim) sev = /7/.test(body) ? 9 : null; // septième diminuée = 9 demi-tons
  else if (hasExt) sev = 10;
  if (/(^|[^1b#])6/.test(body) && !/7/.test(body)) sev = 9;
  if (/sus/.test(body)) third = 5;
  if (isHalf || isDim || /b5/.test(body)) fifth = 6;
  if (/\+|aug|#5/.test(q)) fifth = 8;
  if (/b9/.test(body)) ext.push(13);
  else if (/#9/.test(body)) ext.push(15);
  else if (/9/.test(body)) ext.push(14);
  if (/#11/.test(body)) ext.push(18);
  if (/13/.test(body)) ext.push(/b13/.test(body) ? 20 : 21);
  if (/alt/.test(body)) { ext.push(13, 15); fifth = 8; }

  const iv = [third, sev, ...ext];
  if (ext.length < 2 || sev == null) iv.push(fifth);
  const bass = m[4] ? pitchClass(m[4]) : root;
  return {
    bass: 40 + mod(bass - 4, 12),
    notes: iv.filter((x) => x != null).map((x) => {
      let n = 48 + root + x;
      while (n < 52) n += 12;
      while (n > 72) n -= 12;
      return n;
    }),
  };
}
