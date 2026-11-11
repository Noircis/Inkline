// Tests de la langue de l'interface (2.9) : dictionnaires complets, clés
// utilisées présentes, pluriels, détection, et aucune variable `t` qui
// masquerait la fonction de traduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { t, initLang, detectLang, lang, keysOf, DICTIONARIES } from '../js/i18n.js';
import { pitchName } from '../js/pitch.js';
import { startLabel, meterOf } from '../js/placements.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const jsFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
const SOURCES = jsFiles(path.join(ROOT, 'js')).filter((f) => !f.includes(`${path.sep}locales${path.sep}`));

test('les deux dictionnaires ont exactement les mêmes clés, et aucun texte vide', () => {
  const en = keysOf(DICTIONARIES.en).sort();
  const fr = keysOf(DICTIONARIES.fr).sort();
  assert.deepEqual(en, fr);
  for (const lng of ['en', 'fr']) {
    initLang(lng);
    for (const k of en) {
      assert.ok(t(k, { n: 1 }).trim(), `${lng} ${k}`);
      assert.ok(t(k, { n: 2 }).trim(), `${lng} ${k}`);
    }
  }
  initLang('fr');
});

test('chaque clé utilisée dans le code (t("…"), data-i18n) existe', () => {
  const known = new Set(keysOf(DICTIONARIES.fr));
  const used = new Set();
  for (const f of SOURCES) {
    const src = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // Clé complète seulement (`'sort.' + key` est vérifié plus bas).
    for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9.]+[a-zA-Z0-9])'/g)) used.add(m[1]);
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g))
    m[1].split(';').forEach((p) => used.add(p.split(':')[1]));
  const missing = [...used].filter((k) => !known.has(k));
  assert.deepEqual(missing, []);
  // Clés construites (préfixe + valeur) : vérifiées à part.
  for (const k of ['sort.updated', 'listView.mosaic', 'color.teal', 'instr.Bb8', 'dur.16', 'rest.8', 'sub.3'])
    assert.ok(known.has(k), k);
});

test('aucune variable locale « t » dans un module qui traduit (elle masquerait t())', () => {
  const bad = [];
  for (const f of SOURCES) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/import \{[^}]*\bt\b[^}]*\} from '[./]+i18n\.js'/.test(src)) continue;
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/^import .*$/gm, '');
    if (
      /(const|let|var)\s+t\b|\(t\)\s*=>|\(t,\s*\w+\)\s*=>|\{\s*t\s*[,}]|for \(let t\b|function\s*\w*\s*\([^)]*\bt\b/.test(
        code,
      )
    )
      bad.push(path.relative(ROOT, f));
  }
  assert.deepEqual(bad, []);
});

test('pluriels et paramètres', () => {
  initLang('fr');
  assert.equal(t('home.noteCount', { n: 0 }), '0 note');
  assert.equal(t('home.noteCount', { n: 1 }), '1 note');
  assert.equal(t('home.noteCount', { n: 3 }), '3 notes');
  assert.equal(t('grid.endingN', { n: 1 }), '1re fin');
  assert.equal(t('grid.endingN', { n: 2 }), '2e fin');
  initLang('en');
  assert.equal(t('home.noteCount', { n: 0 }), '0 notes');
  assert.equal(t('home.noteCount', { n: 1 }), '1 note');
  assert.equal(t('train.bars', { n: 4 }), '4 bars');
  assert.equal(t('home.noResult', { q: 'Bb7' }), 'No note contains “Bb7”.');
  assert.equal(t('pas.une.cle'), 'pas.une.cle'); // clé absente : visible, jamais vide
  initLang('fr');
});

test('détection de la langue', () => {
  assert.equal(detectLang(['fr-FR', 'en-US']), 'fr');
  assert.equal(detectLang(['fr']), 'fr');
  assert.equal(detectLang(['en-GB', 'fr-FR']), 'en');
  assert.equal(detectLang(['de-DE', 'fr-FR']), 'fr'); // première langue connue
  assert.equal(detectLang(['de-DE', 'es']), 'en'); // aucune : anglais
  assert.equal(detectLang([]), 'en');
  assert.equal(initLang('auto', ['fr-CA']), 'fr');
  assert.equal(initLang('en', ['fr-FR']), 'en'); // le choix manuel l'emporte
  assert.equal(lang(), 'en');
  initLang('fr');
});

test('noms de notes et comptage selon la langue', () => {
  initLang('fr');
  assert.equal(pitchName('treble', 4, -1), 'Si♭ 4');
  assert.equal(startLabel(3), '2 et');
  initLang('en');
  assert.equal(pitchName('treble', 4, -1), 'B♭4');
  assert.equal(pitchName('treble', 11), 'B5');
  assert.equal(startLabel(3), '2 and');
  assert.equal(startLabel(4, meterOf('6/8')), 'beat 2, eighth 2');
  initLang('fr');
});
