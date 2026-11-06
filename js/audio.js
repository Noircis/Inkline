/**
 * @module audio
 * @description
 * Lecture audio avec la **Web Audio API** : un petit synthétiseur et un
 * séquenceur.
 *
 * ## Séquencement
 *
 * Toutes les notes d'un morceau sont **programmées d'avance** sur l'horloge
 * audio (`AudioContext.currentTime`), qui est précise à l'échantillon près et
 * insensible aux ralentissements du thread principal. Les `setTimeout` ne
 * servent qu'au surlignage visuel (léger décalage possible, invisible à
 * l'oreille) et à la détection de fin.
 *
 * Un seul morceau joue à la fois : lancer une lecture arrête la précédente,
 * relancer le même bloc l'arrête (bouton bascule).
 *
 * ## Synthèse
 *
 * - **Mélodie** ({@link tone}) : dent de scie + triangle → filtre passe-bas
 *   dont la coupure suit une petite enveloppe (attaque brillante qui
 *   s'adoucit) → gain avec enveloppe attaque / déclin / relâchement.
 * - **Accords** ({@link pad}) : triangle + sinus à l'octave, plus doux.
 * - **Percussion** ({@link perc}) : sinus dont la fréquence chute très vite
 *   (effet « clave »), accentué sur le premier temps.
 *
 * Les navigateurs n'autorisent le son qu'après une interaction de
 * l'utilisateur : le contexte est créé (ou réveillé) au premier appel.
 */

import { staffEvents } from './rhythm.js';
import { resolveMidis } from './pitch.js';
import { mlen, beatUnit } from './model.js';
import { gridPlayOrder, slotDurations } from './grid.js';
import { chordTones } from './chords.js';

/** @type {AudioContext|null} */
let ac = null;

/**
 * Lecture en cours.
 * @typedef {Object} Playback
 * @property {string} id Bloc joué.
 * @property {number[]} timers `setTimeout` à annuler à l'arrêt.
 * @property {AudioScheduledSourceNode[]} nodes Oscillateurs à couper à l'arrêt.
 * @property {function()} onEnd Rappel de fin (appelé aussi en cas d'arrêt).
 */

/** @type {Playback|null} */
let current = null;

/**
 * Contexte audio, créé à la demande et réveillé s'il est suspendu.
 * @returns {AudioContext|null} `null` si la Web Audio API est absente.
 */
function audioContext() {
  if (!ac) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}

/** Fréquence (Hz) d'un numéro MIDI (la 4 = 69 = 440 Hz). */
const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Joue une note mélodique.
 * @param {number} t Instant de début (secondes, horloge audio).
 * @param {number} dur Durée (s).
 * @param {number|null} midi
 * @param {AudioScheduledSourceNode[]} [nodes] Collecteur pour pouvoir couper.
 */
function tone(t, dur, midi, nodes) {
  const c = audioContext();
  if (!c || midi == null) return;
  const f = freq(midi);
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  const g1 = c.createGain();
  o1.type = 'sawtooth';
  o2.type = 'triangle';
  o1.frequency.value = f;
  o2.frequency.value = f;
  g1.gain.value = 0.35; // la dent de scie est dosée pour ne pas être agressive
  lp.type = 'lowpass';
  lp.Q.value = 0.8;
  lp.frequency.setValueAtTime(f * 1.5, t);
  lp.frequency.linearRampToValueAtTime(f * 4, t + 0.05);
  lp.frequency.setTargetAtTime(f * 2.2, t + 0.06, 0.15);
  const v = 0.16;
  const end = t + Math.max(0.06, dur * 0.94); // léger détaché entre les notes
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.025);
  g.gain.setTargetAtTime(v * 0.75, t + 0.04, 0.12);
  g.gain.setTargetAtTime(0, end, 0.025);
  o1.connect(g1);
  g1.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  o1.start(t);
  o2.start(t);
  o1.stop(end + 0.2);
  o2.stop(end + 0.2);
  if (nodes) nodes.push(o1, o2);
}

/**
 * Joue une note d'accord (son de nappe).
 * @param {number} t
 * @param {number} dur
 * @param {number} midi
 * @param {AudioScheduledSourceNode[]} nodes
 */
export function pad(t, dur, midi, nodes) {
  const c = audioContext();
  if (!c) return;
  const f = freq(midi);
  const o = c.createOscillator();
  const o2 = c.createOscillator();
  const lp = c.createBiquadFilter();
  const g = c.createGain();
  o.type = 'triangle';
  o2.type = 'sine';
  o.frequency.value = f;
  o2.frequency.value = f * 2;
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(4000, f * 3);
  const end = t + Math.max(0.1, dur * 0.92);
  const v = 0.075;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.02);
  g.gain.setTargetAtTime(v * 0.55, t + 0.05, 0.25);
  g.gain.setTargetAtTime(0, end, 0.05);
  o.connect(lp);
  o2.connect(lp);
  lp.connect(g);
  g.connect(c.destination);
  o.start(t);
  o2.start(t);
  o.stop(end + 0.3);
  o2.stop(end + 0.3);
  nodes.push(o, o2);
}

/**
 * Joue un coup de percussion.
 * @param {number} t
 * @param {boolean} accent Premier temps (plus aigu, plus fort).
 * @param {AudioScheduledSourceNode[]} [nodes]
 */
function perc(t, accent, nodes) {
  const c = audioContext();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(accent ? 1250 : 950, t);
  o.frequency.exponentialRampToValueAtTime(accent ? 700 : 520, t + 0.06);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.35, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.13);
  if (nodes) nodes.push(o);
}

/**
 * Clic de métronome : bref et aigu (onde triangle), pour se distinguer du
 * « tic » plus grave des lignes rythmiques ({@link perc}).
 * @param {number} t Instant audio (s).
 * @param {boolean} accent Clic accentué (plus aigu et plus fort).
 * @param {AudioScheduledSourceNode[]} [nodes]
 */
function click(t, accent, nodes) {
  const c = audioContext();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(accent ? 2600 : 1900, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.55 : 0.3, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + 0.06);
  if (nodes) nodes.push(o);
}

/**
 * Fait entendre un élément de portée isolé (retour sonore à la saisie).
 * @param {module:model~StaffBlock} b
 * @param {number} i
 */
export function previewItem(b, i) {
  const it = b.items[i];
  if (!it || it.r) return;
  const c = audioContext();
  if (!c) return;
  if (b.clef === 'rhythm') perc(c.currentTime + 0.01, false);
  else tone(c.currentTime + 0.01, 0.38, resolveMidis(b)[i]);
}

/**
 * Le bloc `id` est-il en cours de lecture ?
 * @param {string} id
 * @returns {boolean}
 */
export function isPlaying(id) {
  return !!current && current.id === id;
}

/**
 * Arrête la lecture en cours (s'il y en a une) et appelle son rappel de fin.
 */
export function stop() {
  if (!current) return;
  const p = current;
  current = null;
  p.timers.forEach(clearTimeout);
  p.nodes.forEach((n) => {
    try {
      n.stop();
    } catch (e) {
      /* déjà arrêté */
    }
  });
  p.onEnd();
}

/**
 * Rappels de lecture.
 * @typedef {Object} PlayCallbacks
 * @property {function(number)} onStep Élément (ou mesure) qui commence.
 * @property {function()} onEnd Fin ou arrêt.
 */

/**
 * Prépare une lecture : arrête la précédente, ou bascule (arrêt) si c'est le même bloc.
 * @param {string} id
 * @param {PlayCallbacks} cb
 * @returns {{c: AudioContext, p: Playback}|null} `null` si on vient d'arrêter ce bloc.
 */
function begin(id, cb) {
  const was = isPlaying(id);
  stop();
  if (was) return null;
  const c = audioContext();
  if (!c) return null;
  current = { id, timers: [], nodes: [], onEnd: cb.onEnd };
  return { c, p: current };
}

/**
 * Programme un rappel visuel à un instant de l'horloge audio.
 * @param {Playback} p
 * @param {AudioContext} c
 * @param {number} t Instant audio (s).
 * @param {function()} fn
 */
function at(p, c, t, fn) {
  p.timers.push(setTimeout(fn, Math.max(0, (t - c.currentTime) * 1000)));
}

/**
 * Options de lecture d'une portée (utilisées par l'entraînement).
 * @typedef {Object} PlayOptions
 * @property {boolean} [countIn] Une mesure de décompte (tous les temps) avant de commencer.
 * @property {?Array.<boolean>} [beats] Métronome : temps de la mesure qui cliquent
 *   (`[true, false, true, false]` = 1 et 3). Absent : pas de métronome.
 * @property {boolean} [accent] Accentuer le clic du premier temps.
 * @property {boolean} [mute] Ne pas jouer le rythme lui-même (métronome seul) ;
 *   le surlignage suit quand même la lecture.
 */

/** Décompte : tous les temps cliquent. */
const EVERY_BEAT = Array(16).fill(true);

/**
 * Programme les clics de métronome de `measures` mesures à partir de `t0`.
 * @param {Playback} p
 * @param {number} t0 Instant audio du début (s).
 * @param {number} measures Nombre de mesures.
 * @param {string} time Chiffrage.
 * @param {number} spq Secondes par noire.
 * @param {Array.<boolean>} beats Temps qui cliquent.
 * @param {boolean} accent
 */
function metronome(p, t0, measures, time, spq, beats, accent) {
  const beat = beatUnit(time);
  const perMeasure = Math.round(mlen(time) / beat);
  for (let m = 0; m < measures; m++)
    for (let k = 0; k < perMeasure; k++)
      if (beats[k]) click(t0 + (m * perMeasure + k) * beat * spq, accent && k === 0, p.nodes);
}

/**
 * Joue une portée (bascule lecture/arrêt).
 *
 * Les événements viennent de {@link module:rhythm.staffEvents|staffEvents} (reprises,
 * liaisons, triolets et swing déjà résolus) ; il ne reste qu'à convertir les
 * noires en secondes : `secondes = noires × 60 / tempo`.
 *
 * Avec des {@link PlayOptions} (entraînement) : mesure de décompte, métronome
 * sur les temps choisis, rythme coupé.
 *
 * @param {module:model~StaffBlock} b
 * @param {PlayCallbacks} cb
 * @param {PlayOptions} [opt={}]
 */
export function playStaff(b, cb, opt = {}) {
  if (!b.items.length) {
    stop();
    return;
  }
  const r = begin(b.id, cb);
  if (!r) return;
  const { c, p } = r;
  const spq = 60 / (b.tempo || 120); // secondes par noire
  const start = c.currentTime + 0.12; // petite marge pour que la 1re note ne soit pas tronquée
  const bar = mlen(b.time) * spq; // durée d'une mesure (s)
  if (opt.countIn) metronome(p, start, 1, b.time, spq, EVERY_BEAT, !!opt.accent);
  const t0 = opt.countIn ? start + bar : start;
  const { events, total } = staffEvents(b);
  if (opt.beats)
    metronome(p, t0, Math.ceil(total / mlen(b.time) - 1e-9), b.time, spq, opt.beats, !!opt.accent);
  events.forEach((ev) => {
    const ts = t0 + ev.start * spq;
    if (!ev.rest && !ev.held && !opt.mute) {
      if (b.clef === 'rhythm') perc(ts, ev.downbeat, p.nodes);
      else tone(ts, (ev.end - ev.start) * spq, ev.midi, p.nodes);
    }
    at(p, c, ts, () => cb.onStep(ev.i));
  });
  at(p, c, t0 + total * spq + 0.15, stop);
}

/**
 * Joue une grille (bascule lecture/arrêt) : basse + accords en nappe, et un
 * « charleston » sur les temps 2 et 4 pour les styles swing.
 *
 * Chaque mesure suit {@link module:grid.gridPlayOrder|gridPlayOrder} ; à l'intérieur, les
 * cases se partagent la mesure selon {@link module:grid.slotDurations|slotDurations}.
 * Une mesure vide prolonge le dernier accord, `%` rejoue la mesure précédente.
 *
 * @param {module:model~GridBlock} b
 * @param {PlayCallbacks} cb
 */
export function playGrid(b, cb) {
  if (!b.measures.length) {
    stop();
    return;
  }
  const r = begin(b.id, cb);
  if (!r) return;
  const { c, p } = r;
  const spq = 60 / (b.tempo || 120);
  const ML = mlen(b.time);
  const swingy = /swing|waltz|blues|gospel|ballad/i.test(b.style);
  const t0 = c.currentTime + 0.15;
  let q = 0;
  let last = null; // dernier accord joué (pour les cases vides et les mesures vides)
  let prevCh = [];
  gridPlayOrder(b.measures).forEach((i) => {
    let ch = b.measures[i].ch;
    if (ch.length === 1 && ch[0] === '%') ch = prevCh;
    else if (!ch.length) ch = last ? [last] : [];
    prevCh = ch;
    const durs = slotDurations(Math.max(1, ch.length), b.time);
    let qq = q;
    ch.forEach((x, k) => {
      const d = durs[k];
      if (x === 'n') last = null;
      else {
        const cc = x === '' ? last : x;
        const tn = cc && chordTones(cc);
        if (tn) {
          last = cc;
          const ts = t0 + qq * spq;
          tone(ts, Math.min(d * spq, spq * 2), tn.bass, p.nodes);
          tn.notes.forEach((nm) => pad(ts, d * spq, nm, p.nodes));
        }
      }
      qq += d;
    });
    if (swingy && !b.time.endsWith('/8'))
      for (let bt = 1; bt < ML; bt += 2) perc(t0 + (q + bt) * spq, false, p.nodes);
    at(p, c, t0 + q * spq, () => cb.onStep(i));
    q += ML;
  });
  at(p, c, t0 + q * spq + 0.2, stop);
}
