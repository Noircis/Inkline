/**
 * @module ui/measure-select
 * @description
 * **Sélection de mesures à l'appui long** (2.8.4), commune aux portées, aux
 * lignes rythmiques, aux grilles et aux écrans d'entraînement.
 *
 * 1. **Appui long** (450 ms sans bouger de plus de 10 px) sur une mesure : un
 *    cadre apparaît autour d'elle, le téléphone vibre brièvement.
 * 2. Sans lever le doigt, **glisser** étend la sélection jusqu'à la mesure
 *    sous le doigt (dans les deux sens, sur plusieurs lignes). La page ne
 *    défile pas pendant ce glisser.
 * 3. En levant le doigt, une **barre contextuelle** apparaît au-dessus de la
 *    sélection : « Jouer d'ici » pour une seule mesure (jusqu'à la fin),
 *    « Boucle » pour plusieurs (le passage en boucle). Les deux commencent par
 *    une mesure de décompte.
 *
 * Un toucher ailleurs efface la sélection (et arrête la lecture qu'elle a
 * lancée), comme ✕. Il n'y a qu'une sélection à la fois dans l'appli.
 *
 * Chaque zone (portée, grille…) se branche avec {@link bindMeasureSelect} en
 * fournissant un petit objet {@link SelectTarget} : comment trouver la mesure
 * sous le doigt, où dessiner le cadre, comment jouer. Après chaque
 * redessin de la zone, elle appelle {@link refreshMeasureSelect} (le cadre
 * vit dans la zone, un redessin l'efface).
 *
 * ## Pourquoi tant de précautions sur le geste
 *
 * - Le navigateur envoie un `click` en levant le doigt, même après un appui
 *   long : on l'avale, sinon une grille ouvrirait le clavier.
 * - Android ouvre un menu (ou sélectionne du texte) sur un appui long : on
 *   l'empêche (`contextmenu`, CSS `-webkit-touch-callout`).
 * - Pour glisser sans faire défiler la page, on annule les `touchmove` une
 *   fois la sélection armée (seulement à ce moment-là : avant, le doigt peut
 *   encore servir à faire défiler).
 */

import * as audio from '../audio.js';
import { geom } from '../layout.js';

/** Durée de l'appui long (ms). */
export const LONG_PRESS_MS = 450;
/** Déplacement toléré pendant l'appui long (px). */
const SLOP = 10;

/**
 * Ce qu'une zone fournit pour être sélectionnable.
 * @typedef {Object} SelectTarget
 * @property {function(number, number): ?number} measureAt Mesure (index
 *   d'écriture) sous un point de la fenêtre, `null` si aucune.
 * @property {function(number, number): Array.<{x: number, y: number, w: number, h: number}>} boxes
 *   Rectangles (dans la zone) qui couvrent les mesures `a` à `b`, un par ligne.
 * @property {function(number, number, boolean, function()): void} play
 *   Lance la lecture de `a` à `b` (boucle ou non), avec décompte ; le dernier
 *   argument est à appeler à la fin de la lecture.
 * @property {function(): string} playId Identifiant de lecture (pour savoir si elle tourne).
 * @property {function(PointerEvent): boolean} [skip] Vrai si le geste ne doit
 *   pas servir à sélectionner (zone de glisser de note, par exemple).
 */

/**
 * Sélection courante.
 * @type {?{wrap: HTMLElement, t: SelectTarget, a: number, b: number, anchor: number, mine: boolean}}
 */
let cur = null;
/** Avaler le prochain `click` (celui qui suit l'appui long). */
let swallowClick = false;
/** Barre contextuelle (créée au premier usage). */
let bar = null;

/**
 * Efface la sélection (cadre et barre) ; arrête la lecture si c'est elle
 * qui l'a lancée.
 */
export function clearMeasureSelect() {
  if (!cur) return;
  const { wrap, t, mine } = cur;
  cur = null;
  wrap.querySelectorAll('.msel-box').forEach((x) => x.remove());
  if (bar) bar.hidden = true;
  if (mine && audio.isPlaying(t.playId())) audio.stop();
}

/**
 * Sélection courante (pour les tests et les écrans).
 * @returns {?{a: number, b: number}}
 */
export function measureSelection() {
  return cur && { a: cur.a, b: cur.b };
}

/**
 * Redessine le cadre et replace la barre, après un redessin de la zone.
 * @param {HTMLElement} wrap
 */
export function refreshMeasureSelect(wrap) {
  if (!cur || cur.wrap !== wrap) return;
  drawBoxes();
  placeBar();
}

/** Dessine le cadre autour des mesures sélectionnées. */
function drawBoxes() {
  const { wrap, t, a, b } = cur;
  wrap.querySelectorAll('.msel-box').forEach((x) => x.remove());
  const boxes = t.boxes(a, b);
  if (!boxes.length) {
    clearMeasureSelect(); // la mesure n'existe plus (bloc modifié)
    return;
  }
  boxes.forEach(({ x, y, w, h }) => {
    const d = document.createElement('div');
    d.className = 'msel-box';
    d.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    wrap.appendChild(d);
  });
}

/** Crée la barre contextuelle. */
function makeBar() {
  bar = document.createElement('div');
  bar.className = 'msel-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Mesures sélectionnées');
  bar.innerHTML =
    '<button type="button" class="btn primary" data-msel="go"></button><button type="button" class="btn ghost" data-msel="close" aria-label="Fermer la sélection">&#10005;</button>';
  bar.hidden = true;
  document.body.appendChild(bar);
  bar.querySelector('[data-msel=close]').addEventListener('click', clearMeasureSelect);
  bar.querySelector('[data-msel=go]').addEventListener('click', () => {
    if (!cur) return;
    const { t, a, b } = cur;
    if (cur.mine && audio.isPlaying(t.playId())) {
      audio.stop();
      return;
    }
    audio.stop();
    cur.mine = true;
    // Une mesure : jusqu'à la fin ; plusieurs : le passage en boucle.
    t.play(a, a === b ? Infinity : b, a !== b, updateBar);
    updateBar();
  });
}

/** Libellé du bouton de la barre. */
function updateBar() {
  if (!bar || !cur) return;
  const go = bar.querySelector('[data-msel=go]');
  const on = cur.mine && audio.isPlaying(cur.t.playId());
  go.classList.toggle('on', on);
  go.innerHTML = on ? '&#9632; Stop' : cur.a === cur.b ? '&#9654; Jouer d’ici' : '&#128257; Boucle';
}

/** Place la barre au-dessus de la sélection (en dessous s'il n'y a pas la place). */
function placeBar() {
  if (!bar) makeBar();
  if (!cur) return;
  updateBar();
  bar.hidden = false;
  const boxes = [...cur.wrap.querySelectorAll('.msel-box')].map((x) => x.getBoundingClientRect());
  if (!boxes.length) return;
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  const bw = bar.offsetWidth || 200;
  const bh = bar.offsetHeight || 44;
  let top = first.top - bh - 8;
  if (top < 64) top = last.bottom + 8; // sous l'en-tête : on passe en dessous
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, first.left + first.width / 2 - bw / 2));
  bar.style.left = `${left + window.scrollX}px`;
  bar.style.top = `${top + window.scrollY}px`;
}

/**
 * Rend une zone sélectionnable à l'appui long.
 * @param {HTMLElement} wrap Élément de la zone (doit être en `position: relative`).
 * @param {SelectTarget} t
 */
export function bindMeasureSelect(wrap, t) {
  wrap.classList.add('msel-zone');
  /** Appui en attente : position de départ et minuterie. */
  let press = null;
  /** Glisser de sélection en cours. */
  let armed = false;

  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };

  wrap.addEventListener('pointerdown', (e) => {
    cancel();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (t.skip && t.skip(e)) return;
    const m = t.measureAt(e.clientX, e.clientY);
    if (m == null) return;
    const id = e.pointerId;
    press = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        if (!wrap.isConnected) return;
        // Armé : nouvelle sélection, la lecture en cours s'arrête.
        clearMeasureSelect();
        audio.stop();
        cur = { wrap, t, a: m, b: m, anchor: m, mine: false };
        armed = true;
        swallowClick = true;
        try {
          navigator.vibrate?.(15);
        } catch {
          /* pas de vibreur */
        }
        try {
          wrap.setPointerCapture(id);
        } catch {
          /* doigt déjà levé */
        }
        drawBoxes();
        if (bar) bar.hidden = true;
      }, LONG_PRESS_MS),
    };
  });

  wrap.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
    if (!armed || !cur) return;
    const m = t.measureAt(e.clientX, e.clientY);
    if (m == null) return;
    const a = Math.min(cur.anchor, m);
    const b = Math.max(cur.anchor, m);
    if (a !== cur.a || b !== cur.b) {
      cur.a = a;
      cur.b = b;
      drawBoxes();
    }
  });

  const end = () => {
    cancel();
    if (!armed) return;
    armed = false;
    if (cur && cur.wrap === wrap) placeBar();
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // Glisser de sélection : le doigt sélectionne, la page ne défile pas.
  wrap.addEventListener(
    'touchmove',
    (e) => {
      if (armed) e.preventDefault();
    },
    { passive: false },
  );
  // Pas de menu du navigateur sur un appui long.
  wrap.addEventListener('contextmenu', (e) => {
    if (press || armed || (cur && cur.wrap === wrap)) e.preventDefault();
  });
}

// Le `click` qui suit l'appui long est avalé ; un toucher ailleurs que dans la
// barre efface la sélection. (Écoute en phase de capture, avant les zones.)
document.addEventListener(
  'pointerdown',
  () => {
    // Nouveau toucher : le `click` d'un ancien appui long (qui n'est pas
    // toujours envoyé, par exemple après un glisser) ne doit plus être avalé.
    swallowClick = false;
  },
  true,
);
document.addEventListener(
  'click',
  (e) => {
    if (swallowClick) {
      swallowClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (cur && !(bar && bar.contains(/** @type {Node} */ (e.target)))) clearMeasureSelect();
  },
  true,
);
// La zone a disparu (autre écran, note refermée…) : on efface la sélection.
new MutationObserver(() => {
  if (cur && !cur.wrap.isConnected) clearMeasureSelect();
}).observe(document.body, { childList: true, subtree: true });
window.addEventListener('resize', () => cur && refreshMeasureSelect(cur.wrap));

/**
 * {@link SelectTarget} pour une portée dessinée par
 * {@link module:render-staff.staffSvg|staffSvg} : les mesures sont retrouvées
 * dans la mise en page ({@link module:layout~Layout|Layout}, `mrects`).
 *
 * @param {HTMLElement} wrap Conteneur du SVG.
 * @param {function(): ?module:layout~Layout} getLayout Mise en page telle que dessinée.
 * @param {Omit<SelectTarget, 'measureAt'|'boxes'>} rest `play`, `playId`, `skip`.
 * @returns {SelectTarget}
 */
export function staffTarget(wrap, getLayout, rest) {
  /**
   * Repère du SVG à l'écran : il peut être décalé dans la zone (marges) et
   * agrandi par le CSS (exercices aléatoires).
   */
  const frame = () => {
    const svg = wrap.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const w = Number(svg.getAttribute('width')) || r.width;
    return { r, k: r.width / w };
  };
  return {
    ...rest,
    measureAt(cx, cy) {
      const L = getLayout();
      const f = frame();
      if (!L || !f || !L.mrects.length) return null;
      const x = (cx - f.r.left) / f.k;
      const y = (cy - f.r.top) / f.k;
      const si = Math.max(0, Math.min(L.systems.length - 1, Math.floor(y / L.SH)));
      const on = L.mrects.map((m, k) => ({ ...m, k })).filter((m) => m.sys === si);
      if (!on.length) return null; // ligne vide (zone d'ajout)
      const hit = on.find((m) => x >= m.x0 && x < m.x1);
      if (hit) return hit.k;
      return x < on[0].x0 ? on[0].k : on[on.length - 1].k;
    },
    boxes(a, b) {
      const L = getLayout();
      const f = frame();
      if (!L || !f || b >= L.mrects.length) return [];
      const w = wrap.getBoundingClientRect();
      const ox = f.r.left - w.left;
      const oy = f.r.top - w.top;
      const out = [];
      for (let k = a; k <= b; k++) {
        const m = L.mrects[k];
        const last = out[out.length - 1];
        if (last && last.sys === m.sys) last.x1 = m.x1;
        else out.push({ sys: m.sys, x0: m.x0, x1: m.x1 });
      }
      return out.map(({ sys, x0, x1 }) => {
        const g = geom(L, sys);
        const top = g.staffTop - 12;
        const h = Math.max(32, g.staffBottom - g.staffTop + 24);
        const y0 = g.staffTop === g.staffBottom ? g.staffTop - h / 2 : top;
        return { x: ox + (x0 - 2) * f.k, y: oy + y0 * f.k, w: (x1 - x0 + 4) * f.k, h: h * f.k };
      });
    },
  };
}
