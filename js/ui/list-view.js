/**
 * @module ui/list-view
 * @description
 * Les **trois affichages** de la liste des notes, au choix dans les Options :
 *
 * | Mode      | Clé      | Contenu                                                  |
 * |-----------|----------|----------------------------------------------------------|
 * | Cartes    | `cards`  | grande carte : titre, date, résumé, début du texte, 1re ligne de portée |
 * | Mosaïque  | `mosaic` | carrés, 2 par ligne : titre + aperçu adapté au contenu   |
 * | Liste     | `list`   | une ligne par note : titre, dates, résumé                |
 *
 * ## Aperçu de la mosaïque
 *
 * Une portée entière réduite à ~170 px serait illisible. L'aperçu dépend donc
 * du contenu de la note, par ordre de priorité :
 * 1. une **portée** : ses premières mesures, dessinées sur une largeur
 *    réduite (moins de mesures par ligne) puis mises à l'échelle : c'est un zoom ;
 * 2. une **grille** : ses premiers accords, en texte ;
 * 3. sinon le **début du texte**.
 *
 * Les vignettes SVG sont dessinées après la mise en page (dans un
 * `requestAnimationFrame`), quand la largeur réelle des cartes est connue.
 */

import { esc } from '../util.js';
import { staffSvg } from '../render-staff.js';
import { chordParts } from '../chords.js';
import { folderOf, catsOf } from '../folders.js';
import { PIN_ICON } from './icons.js';

/**
 * Options d'affichage de la liste.
 * @typedef {Object} ListOptions
 * @property {Object.<string, module:folders~Folder>} [folders] Dossiers (pour les étiquettes).
 * @property {boolean} [showFolder] Afficher le dossier de chaque note (inutile
 *   quand la liste montre un seul dossier).
 */

/** Modes d'affichage, dans l'ordre du sélecteur. */
export const LIST_VIEWS = [
  { key: 'cards', label: 'Cartes' },
  { key: 'mosaic', label: 'Mosaïque' },
  { key: 'list', label: 'Liste' },
];

/** Largeur (px) à laquelle la portée est dessinée avant réduction, en mosaïque. */
const MOSAIC_STAFF_W = 260;

/**
 * Date courte (« 4 nov. »).
 * @param {number} ts
 * @returns {string}
 */
function shortDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  } catch (e) {
    return '';
  }
}

/**
 * Date relative pour une modification récente (« aujourd'hui », « hier »),
 * date courte au-delà.
 * @param {number} ts
 * @param {number} [now=Date.now()]
 * @returns {string}
 */
export function relativeDate(ts, now = Date.now()) {
  const day = (t) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const diff = Math.round((day(now) - day(ts)) / 86400000);
  if (diff <= 0) return 'aujourd’hui';
  if (diff === 1) return 'hier';
  return shortDate(ts);
}

/**
 * Résumé du contenu d'une note (« 1 portée · 2 grilles »).
 * @param {module:model~Note} n
 * @returns {string}
 */
export function noteSummary(n) {
  const st = n.blocks.filter((b) => b.type === 'staff');
  const r = st.filter((b) => b.clef === 'rhythm').length;
  const p = st.length - r;
  const gr = n.blocks.filter((b) => b.type === 'grid').length;
  const parts = [];
  if (p) parts.push(p + (p > 1 ? ' portées' : ' portée'));
  if (r) parts.push(r + (r > 1 ? ' rythmes' : ' rythme'));
  if (gr) parts.push(gr + (gr > 1 ? ' grilles' : ' grille'));
  return parts.join(' · ');
}

/** Premier texte non vide d'une note (ou chaîne vide). */
const firstText = (n) => ((n.blocks.find((b) => b.type === 'text' && b.text.trim()) || {}).text || '').trim();

/** Première portée non vide d'une note. */
const firstStaff = (n) => n.blocks.find((b) => b.type === 'staff' && b.items.length);

/**
 * Premiers accords d'une note (grilles d'abord, sinon accords chiffrés des portées),
 * mis en forme comme dans la grille (qualité en exposant).
 * @param {module:model~Note} n
 * @param {number} max
 * @returns {string} Fragment HTML (échappé), vide s'il n'y a pas d'accord.
 */
function chordsPreview(n, max) {
  const out = [];
  const push = (c) => {
    if (out.length >= max || !c || c === 'n' || c === '%') return;
    const p = chordParts(c);
    if (p)
      out.push(
        `<span class="pc">${esc(p.root)}${p.quality ? `<sup>${esc(p.quality)}</sup>` : ''}${esc(p.bass)}</span>`,
      );
  };
  n.blocks.forEach((b) => {
    if (b.type === 'grid') b.measures.forEach((m) => m.ch.forEach(push));
  });
  if (!out.length)
    n.blocks.forEach((b) => {
      if (b.type === 'staff') b.items.forEach((it) => push(it.c));
    });
  return out.join(' ');
}

/**
 * Étiquette de dossier (pastille + nom), ou chaîne vide.
 * @param {module:model~Note} n
 * @param {ListOptions} opt
 * @returns {string}
 */
function folderTag(n, opt) {
  const f = opt.showFolder && opt.folders ? folderOf(n, opt.folders) : null;
  return f
    ? `<span class="ftag"><span class="fdot fc-${f.color}" aria-hidden="true"></span>${esc(f.name)}${catLabel(n, opt.folders)}</span>`
    : '';
}

/**
 * HTML d'une note selon le mode.
 * @param {module:model~Note} n
 * @param {string} mode
 * @param {ListOptions} [opt={}]
 * @returns {string}
 */
function itemHtml(n, mode, opt = {}) {
  const pin = n.pinned
    ? `<span class="pin" title="Épinglée">${PIN_ICON}<span class="sr">Épinglée</span></span>`
    : '';
  const title = pin + esc(n.title || 'Sans titre');
  const tag = folderTag(n, opt);
  const sum = noteSummary(n);
  const txt = firstText(n);
  if (mode === 'list') {
    const sub = ['créée le ' + shortDate(n.created || n.updated), sum].filter(Boolean).join(' · ');
    return `<span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${tag}${esc(sub)}</span></span><span class="row-date">${esc(relativeDate(n.updated))}</span>`;
  }
  if (mode === 'mosaic') {
    // Aperçu : portée (dessinée plus tard) > accords > texte.
    let preview = '';
    if (firstStaff(n)) preview = '<div class="mz-thumb"></div>';
    else {
      const ch = chordsPreview(n, 10);
      preview = ch
        ? `<div class="mz-chords">${ch}</div>`
        : txt
          ? `<p class="mz-text">${esc(txt)}</p>`
          : '<p class="mz-text mz-empty">Note vide</p>';
    }
    return `<h3>${title}</h3>${preview}<div class="mz-foot">${tag}<span>${esc(shortDate(n.updated))}</span>${sum ? `<span>${esc(sum)}</span>` : ''}</div>`;
  }
  return `<h3>${title}</h3><div class="meta">${tag}<span>${esc(shortDate(n.updated))}</span>${sum ? `<span>${esc(sum)}</span>` : ''}</div>${txt ? `<p class="snip">${esc(txt.split('\n')[0])}</p>` : ''}<div class="thumb"></div>`;
}

/**
 * Catégories d'une note à la suite de son dossier (« › Technique, Son »), 2.8.6.
 * @param {module:model~Note} n
 * @param {Object.<string, module:folders~Folder>} folders
 * @returns {string}
 */
function catLabel(n, folders) {
  const cats = catsOf(n, folders);
  return cats.length ? ` › ${esc(cats.map((c) => c.name).join(', '))}` : '';
}

/**
 * Construit la liste des notes dans `container`.
 *
 * @param {HTMLElement} container
 * @param {module:model~Note[]} notes Notes déjà triées.
 * @param {'cards'|'mosaic'|'list'} mode
 * @param {function(string)} onOpen Appelé avec l'id de la note touchée.
 * @param {ListOptions} [opt={}]
 */
export function renderNoteList(container, notes, mode, onOpen, opt = {}) {
  const wrap = document.createElement('div');
  wrap.className = mode === 'mosaic' ? 'mosaic' : mode === 'list' ? 'rows' : 'list';
  notes.forEach((n) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = mode === 'mosaic' ? 'mz' : mode === 'list' ? 'row' : 'card';
    btn.innerHTML = itemHtml(n, mode, opt);
    btn.onclick = () => onOpen(n.id);
    wrap.appendChild(btn);
  });
  container.appendChild(wrap);

  if (mode === 'list') return;
  // Vignettes SVG, une fois la largeur réelle connue.
  requestAnimationFrame(() => {
    [...wrap.children].forEach((el, k) => {
      const st = firstStaff(notes[k]);
      const th = el.querySelector(mode === 'mosaic' ? '.mz-thumb' : '.thumb');
      if (!st || !th) return;
      // Mosaïque : dessin sur une largeur fixe réduite, puis mise à l'échelle par CSS (zoom sur le début).
      th.innerHTML = staffSvg(st, mode === 'mosaic' ? MOSAIC_STAFF_W : th.clientWidth || 300, {
        maxSystems: 1,
      }).svg;
    });
  });
}
