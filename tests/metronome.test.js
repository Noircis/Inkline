// Tests for the metronome (2.11, free time signatures 2.12): settings, groups, levels,
// cycle sounds, jazz modes, tap tempo, presets.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METRO_DEFAULTS,
  SHORTCUTS,
  cycleEvents,
  sanitizeMetro,
  withMeter,
  withGroups,
  withSubdiv,
  withUnit,
  withShortcut,
  cutOrJoin,
  defaultGroups,
  defaultLevels,
  groupChoices,
  pulseLevels,
  subdivsFor,
  canTwoFour,
  canCountGroups,
  swingApplies,
  unitGlyph,
  meterLabel,
  shortcutIndex,
  toggleLevel,
  tapTempo,
  tempoMarking,
  sanitizePresets,
  applyPreset,
  presetPart,
  cleanPresetName,
} from '../js/metronome.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const S = (patch = {}) => sanitizeMetro({ ...METRO_DEFAULTS, ...patch });
const M = (num, den, patch = {}) => sanitizeMetro({ ...withMeter(S(), num, den), ...patch });
const times = (c, kind) => c.events.filter((e) => !kind || e.kind === kind).map((e) => e.t);

test('4/4 at 120: four clicks, the first at full level', () => {
  const c = cycleEvents(S());
  close(c.duration, 2);
  assert.deepEqual(
    c.events.map((e) => e.level),
    [4, 3, 3, 3],
  );
  times(c).forEach((x, i) => close(x, i * 0.5));
});

test('default groups', () => {
  assert.deepEqual(defaultGroups(4, 4), [1, 1, 1, 1]);
  assert.deepEqual(defaultGroups(7, 8), [2, 2, 3]);
  assert.deepEqual(defaultGroups(6, 8), [3, 3]);
  assert.deepEqual(defaultGroups(12, 8), [3, 3, 3, 3]);
  assert.deepEqual(defaultGroups(8, 8), [2, 2, 2, 2]);
  assert.deepEqual(defaultGroups(3, 8), [3]);
  assert.deepEqual(defaultGroups(15, 16), [4, 4, 4, 3]);
  assert.deepEqual(defaultGroups(13, 16), [4, 4, 3, 2]);
  assert.deepEqual(defaultGroups(6, 16), [3, 3]);
  assert.deepEqual(defaultGroups(14, 16), [4, 4, 4, 2]);
  for (let n = 1; n <= 32; n++)
    for (const d of [8, 16])
      assert.equal(
        defaultGroups(n, d).reduce((a, b) => a + b, 0),
        n,
        `${n}/${d}`,
      );
});

test('default levels: group heads at 4', () => {
  assert.deepEqual(defaultLevels([2, 2, 3], 8), [4, 2, 4, 2, 4, 2, 2]);
  assert.deepEqual(defaultLevels([1, 1, 1], 4), [4, 3, 3]);
});

test('any time signature: 15/16 has 15 pulses, the tempo counts sixteenths', () => {
  const s = M(15, 16, { tempo: 240 });
  assert.equal(s.levels.length, 15);
  const c = cycleEvents(s);
  close(c.duration, 15 * 0.25);
  assert.equal(c.marks.length, 15);
  assert.equal(unitGlyph(s), '\u{1D161}');
  assert.equal(meterLabel(s), '15/16 4+4+4+3');
  assert.equal(M(32, 2).num, 32);
  assert.equal(sanitizeMetro({ num: 33, den: 4 }).num, 4);
  assert.equal(sanitizeMetro({ num: 4, den: 3 }).den, 4);
});

test('tempo counting groups (equal groups that are a note value)', () => {
  const s = withShortcut(
    S(),
    SHORTCUTS.findIndex((x) => x.num === 6 && x.den === 8),
  );
  assert.equal(s.unit, 'group');
  assert.equal(unitGlyph(s), '♩.');
  close(cycleEvents({ ...s, tempo: 60 }).duration, 2); // two dotted quarters at 60
  assert.ok(!canCountGroups(M(7, 8))); // uneven groups
  assert.ok(canCountGroups(M(8, 8))); // 4 × 2 eighths = quarters
  assert.equal(sanitizeMetro({ ...M(7, 8), unit: 'group' }).unit, 'pulse');
  // Changing what the tempo counts keeps the speed.
  const p = withUnit({ ...s, tempo: 80 }, 'pulse');
  assert.equal(p.tempo, 240);
  assert.equal(withUnit(p, 'group').tempo, 80);
});

test('cut and join groups', () => {
  assert.deepEqual(cutOrJoin([4, 4, 4, 3], 2), [2, 2, 4, 4, 3]);
  assert.deepEqual(cutOrJoin([2, 2, 4, 4, 3], 2), [4, 4, 4, 3]);
  assert.deepEqual(cutOrJoin([2, 2, 3], 4), [2, 5]);
  const s = withGroups(M(7, 8), [3, 4]);
  assert.deepEqual(s.levels, [4, 2, 2, 4, 2, 2, 2]);
  assert.deepEqual(withGroups(M(7, 8), [3, 3]).groups, [2, 2, 3]); // wrong sum: default
});

test('group choices: default, rotations, even groups', () => {
  assert.deepEqual(
    groupChoices(7, 8).map((g) => g.join('+')),
    ['2+2+3', '2+3+2', '3+2+2'],
  );
  assert.ok(groupChoices(12, 8).some((g) => g.join() === '4,4,4'));
  assert.deepEqual(groupChoices(4, 4), [[1, 1, 1, 1]]);
});

test('levels: 0 to 4, a muted cell remembers its level', () => {
  assert.equal(toggleLevel(3), -3);
  assert.equal(toggleLevel(-3), 3);
  assert.equal(toggleLevel(0), 3);
  const c = cycleEvents(S({ levels: [4, -2, 1, 0] }));
  assert.deepEqual(
    c.events.map((e) => e.level),
    [4, 1],
  );
  assert.equal(c.marks.length, 4);
  assert.deepEqual(sanitizeMetro({ levels: [9, 1, 1, 1] }).levels, [4, 3, 3, 3]);
});

test('subdivisions in /4, one level per click; none in /8 and /16', () => {
  const s = withSubdiv(S({ tempo: 60 }), '16');
  assert.equal(s.subLevels.length, 12);
  assert.deepEqual(times(cycleEvents(s), 'sub').slice(0, 3), [0.25, 0.5, 0.75]);
  const muted = { ...s, subLevels: s.subLevels.map((v, i) => (i % 3 === 1 ? v : -v)) };
  assert.deepEqual(times(cycleEvents(muted), 'sub'), [0.5, 1.5, 2.5, 3.5]); // only the "and"
  const tri = times(cycleEvents(withSubdiv(S({ tempo: 60 }), '3')), 'sub');
  close(tri[1], 2 / 3);
  assert.deepEqual(times(cycleEvents(withSubdiv(S({ tempo: 60 }), '8.16')), 'sub').slice(0, 2), [0.75, 1.75]);
  assert.deepEqual(subdivsFor(8), ['none']);
  assert.equal(withSubdiv(M(7, 8), '16').subdiv, 'none');
});

test('swing moves the offbeat eighth, only for eighths in /4', () => {
  const c = cycleEvents({ ...withSubdiv(S({ tempo: 60 }), '8'), swing: 67 });
  close(times(c, 'sub')[0], 0.67);
  assert.ok(swingApplies(withSubdiv(S(), '8')));
  assert.ok(!swingApplies(withSubdiv(S(), '16')));
});

test('jazz 2 and 4: even number of beats in /2 or /4 only', () => {
  assert.deepEqual(pulseLevels(S({ jazz: '24' })), [0, 4, 0, 4]);
  assert.deepEqual(pulseLevels(M(6, 4, { jazz: '24' })), [0, 4, 0, 4, 0, 4]);
  assert.ok(!canTwoFour(M(3, 4)) && !canTwoFour(M(7, 4)) && !canTwoFour(M(6, 8)));
  assert.equal(M(7, 4, { jazz: '24' }).jazz, 'off');
  // Own levels stay underneath.
  const s = S({ levels: [4, 3, -3, 3], jazz: '24' });
  assert.deepEqual(pulseLevels({ ...s, jazz: 'off' }), [4, 3, 0, 3]);
});

test('jazz once per bar, and every other bar', () => {
  assert.deepEqual(pulseLevels(S({ jazz: 'once', onceBeat: 3 })), [0, 0, 0, 4]);
  const two = cycleEvents(withSubdiv(S({ jazz: 'once', twoBars: true }), '8'));
  close(two.duration, 4);
  assert.equal(two.marks.length, 8);
  assert.ok(two.events.every((e) => e.t < 2)); // the silent bar is fully silent
  close(cycleEvents(S({ twoBars: true })).duration, 2);
});

test('shortcuts fill the time signature and the groups', () => {
  const k = SHORTCUTS.findIndex((x) => x.num === 7 && x.den === 8 && x.groups.join() === '3,2,2');
  const s = withShortcut(S(), k);
  assert.deepEqual([s.num, s.den, s.groups], [7, 8, [3, 2, 2]]);
  assert.equal(shortcutIndex(s), k);
  assert.equal(shortcutIndex(M(15, 16)), -1);
});

test('2.11 settings are converted', () => {
  const s = sanitizeMetro({ tempo: 100, meter: '7/8:3+2+2', accents: [2, 0, 1], subdiv: '8', subVol: 0.5 });
  assert.deepEqual([s.num, s.den, s.groups], [7, 8, [3, 2, 2]]);
  assert.deepEqual(s.levels, [4, 2, 2, -3, 2, 3, 2]);
  assert.equal(s.subdiv, 'none'); // no subdivision in /8 any more
  const c = sanitizeMetro({ tempo: 60, meter: '6/8', accents: [2, 1] });
  assert.equal(c.unit, 'group'); // 2.11 counted dotted quarters in 6/8
  const q = sanitizeMetro({ meter: '4/4', accents: [2, 1, 1, 0], subdiv: '16', subVol: 1 });
  assert.deepEqual(q.levels, [4, 3, 3, -3]);
  assert.deepEqual(q.subLevels, Array(12).fill(4));
});

test('tap tempo: last 4 taps, reset after 2 s', () => {
  let r = tapTempo([], 0);
  assert.equal(r.bpm, null);
  r = tapTempo(r.taps, 500);
  assert.equal(r.bpm, 120);
  r = tapTempo(r.taps, 1000);
  r = tapTempo(r.taps, 1500);
  r = tapTempo(r.taps, 2100);
  assert.deepEqual(r.taps, [500, 1000, 1500, 2100]);
  r = tapTempo(r.taps, 5000);
  assert.deepEqual(r.taps, [5000]);
  assert.equal(tapTempo([0], 10).bpm, 400);
});

test('tempo markings', () => {
  assert.equal(tempoMarking(30), 'Grave');
  assert.equal(tempoMarking(120), 'Allegro');
  assert.equal(tempoMarking(240), 'Prestissimo');
});

test('sanitize: garbage in, defaults out', () => {
  assert.deepEqual(sanitizeMetro(null), sanitizeMetro(METRO_DEFAULTS));
  const s = sanitizeMetro({
    tempo: 9999,
    num: 'x',
    groups: [5],
    levels: [5, 'x'],
    subdiv: '<b>',
    subLevels: [1],
    swing: 10,
    sound: 'gong',
    jazz: 'bebop',
    onceBeat: 12,
    vibrate: 'yes',
  });
  assert.equal(s.tempo, 400);
  assert.deepEqual([s.num, s.den, s.groups], [4, 4, [1, 1, 1, 1]]);
  assert.deepEqual(s.levels, [4, 3, 3, 3]);
  assert.equal(s.subdiv, 'none');
  assert.deepEqual(s.subLevels, []);
  assert.equal(s.swing, 50);
  assert.equal(s.sound, 'click');
  assert.equal(s.jazz, 'off');
  assert.equal(s.onceBeat, 0);
  assert.equal(s.vibrate, false);
});

test('presets: validation, loading keeps the display options', () => {
  const list = sanitizePresets([
    { id: 'a1', name: '  Take   Five ', s: { tempo: 170, num: 5, den: 4, vibrate: true } },
    { id: 'a1', name: 'duplicate', s: {} },
    { id: 'BAD!', name: 'x', s: {} },
    { id: 'b2', name: '   ', s: {} },
    'junk',
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Take Five');
  assert.equal(list[0].s.vibrate, undefined);
  const loaded = applyPreset(S({ flash: true }), list[0]);
  assert.deepEqual([loaded.tempo, loaded.num, loaded.flash], [170, 5, true]);
  assert.equal(sanitizePresets('nope'), undefined);
  assert.equal(cleanPresetName('x'.repeat(80)).length, 40);
  assert.ok(!('vibrate' in presetPart(S())));
});
