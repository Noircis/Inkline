/**
 * @module ui/practice/hub
 * @description
 * **Practice home** (`training` screen, 2.16): the user's programs (open one
 * to edit it, ▶ to practise it), the rhythm exercises, and the history.
 *
 * Nothing on this screen asks for anything: no streak, no goal, no reminder.
 * "Played Tuesday" is information, not a reproach.
 */

import { t } from '../../i18n.js';
import { esc } from '../../util.js';
import { state, app } from '../state.js';
import * as audio from '../../audio.js';
import { registerScreen, goChild, backToList } from '../nav.js';
import { hideAllPalettes } from '../blocks.js';
import { header } from '../drill-kit.js';
import { sortedPrograms, lastPlayed, newProgram } from '../../practice.js';
import { saveProgram, relDay } from './shared.js';

/**
 * Second line of a program row: its items, when it was last played.
 * @param {module:practice~Program} p
 * @param {Object.<string, number>} last
 * @returns {string}
 */
function programInfo(p, last) {
  const items = t('practice.itemsN', { n: p.items.length });
  return last[p.id] ? `${items} · ${t('practice.playedOn', { day: relDay(last[p.id]) })}` : items;
}

/**
 * The programs section.
 * @returns {string}
 */
function programsHtml() {
  const last = lastPlayed(state.sessions);
  const rows = sortedPrograms(state.programs, state.sessions)
    .map(
      (p) =>
        `<div class="opt-row prog-row"><button type="button" class="prog-open" data-open="${esc(p.id)}"><span>${esc(p.name || t('practice.unnamed'))}<small>${esc(programInfo(p, last))}</small></span></button><button type="button" class="playbtn round" data-start="${esc(p.id)}" aria-label="${esc(t('practice.startNamed', { name: p.name }))}"${p.items.length ? '' : ' disabled'}>&#9654;</button></div>`,
    )
    .join('');
  const empty = rows ? '' : `<p class="opt-note prog-empty">${esc(t('practice.emptyHint'))}</p>`;
  return `<section class="opt">
    <h2 class="eyebrow">${esc(t('practice.programs'))}</h2>
    <div class="opt-group">${rows}${empty}<button type="button" class="opt-row" id="newProgram"><span>${esc(t('practice.newProgram'))}</span><span class="opt-chev" aria-hidden="true">+</span></button></div>
  </section>`;
}

/**
 * Practice home screen.
 */
function renderHub() {
  audio.stop();
  hideAllPalettes();
  const sessions = Object.keys(state.sessions).length;
  app.innerHTML = `${header(t('note.back'), t('home.training'))}
  ${programsHtml()}
  <section class="opt">
    <h2 class="eyebrow">${esc(t('practice.exercises'))}</h2>
    <div class="opt-group">
      <button class="opt-row" type="button" id="goPlacements"><span>${esc(t('train.placements'))}<small>${esc(t('train.placementsHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
      <button class="opt-row" type="button" id="goExercises"><span>${esc(t('train.exercises'))}<small>${esc(t('train.exercisesHint'))}</small></span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>
  <section class="opt">
    <div class="opt-group">
      <button class="opt-row" type="button" id="goHistory"><span>${esc(t('practice.history'))}${sessions ? `<small>${esc(t('practice.sessionsN', { n: sessions }))}</small>` : ''}</span><span class="opt-chev" aria-hidden="true">&#8250;</span></button>
    </div>
  </section>`;
  app.querySelector('#back').addEventListener('click', backToList);
  app.querySelector('#goPlacements').addEventListener('click', () => goChild('rhythm'));
  app.querySelector('#goExercises').addEventListener('click', () => goChild('gen'));
  app.querySelector('#goHistory').addEventListener('click', () => goChild('history'));
  app.querySelector('#newProgram').addEventListener('click', () => {
    const p = newProgram(t('practice.defaultName'));
    saveProgram(p);
    goChild('program', p.id);
  });
  app
    .querySelectorAll('[data-open]')
    .forEach((b) =>
      b.addEventListener('click', () => goChild('program', /** @type {HTMLElement} */ (b).dataset.open)),
    );
  app
    .querySelectorAll('[data-start]')
    .forEach((b) =>
      b.addEventListener('click', () => goChild('session', /** @type {HTMLElement} */ (b).dataset.start)),
    );
}

registerScreen('training', renderHub);
