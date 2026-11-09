/**
 * @module ui/common
 * @description
 * Petits outils d'interface partagés par les écrans et les blocs : version,
 * lecture de fichier, boutons à confirmation, bouton de lecture audio, espace
 * réservé aux palettes. Ce module ne dépend d'aucun écran.
 */

import { state } from './state.js';
import * as audio from '../audio.js';

/** Version affichée dans les Options (à garder alignée sur CHANGELOG.md). */
export const APP_VERSION = '2.8.1';

/** HTML des outils d'un bloc actif. */
export function toolsHtml() {
  return '<div class="tools"><button type="button" data-tool="up" aria-label="Monter">&#8593;</button><button type="button" data-tool="down" aria-label="Descendre">&#8595;</button><button type="button" data-tool="del">Supprimer</button></div>';
}

/**
 * Ajuste la hauteur d'un `<textarea>` à son contenu (pas d'ascenseur interne).
 * @param {HTMLTextAreaElement} t
 */
export function autosize(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

/**
 * Lit le fichier choisi dans un `<input type=file>` et passe son texte à `fn`.
 * @param {Event} e
 * @param {function(string)} fn
 */
export function readFile(e, fn) {
  const input = /** @type {HTMLInputElement} */ (e.target);
  const f = input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => fn(String(r.result));
  r.readAsText(f);
  input.value = ''; // pour pouvoir rechoisir le même fichier
}

/**
 * Action destructrice en deux temps : le premier toucher « arme » le bouton
 * (nouveau libellé, style d'alerte), le second exécute. Sans second toucher,
 * le bouton revient à son état initial. Les boîtes `confirm()` natives sont
 * peu pratiques sur mobile.
 *
 * @param {HTMLButtonElement} btn
 * @param {string} armedLabel Libellé une fois armé.
 * @param {function()} action
 * @param {number} [delay=3500] Durée (ms) pendant laquelle le bouton reste armé.
 * @returns {boolean} `true` si l'action a été exécutée.
 */
export function confirmTap(btn, armedLabel, action, delay = 3500) {
  if (btn.dataset.armed) {
    action();
    return true;
  }
  const label = btn.textContent;
  btn.dataset.armed = '1';
  btn.textContent = armedLabel;
  btn.classList.add('confirm');
  setTimeout(() => {
    if (btn.isConnected && btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = label;
      btn.classList.remove('confirm');
    }
  }, delay);
  return false;
}

/**
 * Réserve en bas de page la hauteur de la palette ouverte (variable CSS
 * `--pal-h`), pour que le contenu ne passe pas dessous.
 */
export function syncPaletteSpace() {
  const pal = document.getElementById('palette');
  const gpal = document.getElementById('gpal');
  const h = !pal.hidden ? pal.offsetHeight : !gpal.hidden ? gpal.offsetHeight : 0;
  document.documentElement.style.setProperty('--pal-h', h + 'px');
}

/**
 * Met à jour le bouton Écouter/Stop d'un bloc.
 * @param {string} id
 */
export function updatePlayBtn(id) {
  const btn = document.querySelector(`[data-play="${CSS.escape(id)}"]`);
  if (!btn) return;
  const on = audio.isPlaying(id);
  btn.classList.toggle('on', on);
  btn.innerHTML = on ? '&#9632; Stop' : '&#9654; Écouter';
}

/**
 * Rappels de lecture communs aux portées et aux grilles : surlignage de
 * l'élément joué, puis remise à zéro à la fin.
 * @param {string} id Bloc joué.
 * @param {function(string)} redraw Fonction de redessin du bloc.
 * @returns {module:audio~PlayCallbacks}
 */
export function playCallbacks(id, redraw) {
  return {
    onStep: (i) => {
      state.playIdx = i;
      redraw(id);
    },
    onEnd: () => {
      state.playIdx = null;
      redraw(id);
      updatePlayBtn(id);
    },
  };
}
