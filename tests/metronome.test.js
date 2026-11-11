// Tests for the metronome (2.11): settings, cycle sounds, jazz modes, tap tempo, presets.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  METRO_DEFAULTS,
  cycleEvents,
  sanitizeMetro,
  withMeter,
  beatLevels,
  beatUnit,
  subdivsFor,
  canTwoFour,
  swingApplies,
  tapTempo,
  tempoMarking,
  sanitizePresets,
  applyPreset,
  presetPart,
  cleanPresetName,
} from '../js/metronome.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const S = (patch = {}) => sanitizeMetro({ ...METRO_DEFAULTS, ...patch });
const times = (c, kind) => c.events.filter((e) => !kind || e.kind === kind).map((e) => e.t);

test('4/4 at 120: four clicks, the first strong', () => {
  const c = cycleEvents(S());
  close(c.duration, 2);
  assert.deepEqual(
    c.events.map((e) => e.kind),
    ['strong', 'normal', 'normal', 'normal'],
  );
  times(c).forEach((x, i) => close(x, i * 0.5));
  assert.deepEqual(
    c.marks.map((m) => m.beat),
    [0, 1, 2, 3],
  );
});

test('tempo unit: quarter, dotted quarter, eighth', () => {
  assert.equal(beatUnit('4/4'), 'q');
  assert.equal(beatUnit('6/8'), 'q.');
  assert.equal(beatUnit('7/8:2+2+3'), '8');
  close(cycleEvents(S({ meter: '6/8', tempo: 60 })).duration, 2); // two dotted quarters at 60
  const odd = cycleEvents(S({ meter: '7/8:2+2+3', tempo: 240 })); // eighth = 0.25 s
  close(odd.duration, 1.75);
  assert.deepEqual(
    odd.marks.map((m) => m.t),
    [0, 0.5, 1],
  );
});

test('accents: muted beats are silent but still marked', () => {
  const c = cycleEvents(S({ accents: [2, 0, 1, 0] }));
  assert.equal(c.events.length, 2);
  assert.equal(c.marks.length, 4);
  assert.deepEqual(
    c.marks.map((m) => m.level),
    [2, 0, 1, 0],
  );
});

test('subdivisions in simple time', () => {
  const at = (subdiv) => times(cycleEvents(S({ subdiv, tempo: 60 })), 'sub').slice(0, 3);
  assert.deepEqual(at('8'), [0.5, 1.5, 2.5]);
  const tri = at('3');
  close(tri[0], 1 / 3);
  close(tri[1], 2 / 3);
  assert.deepEqual(at('16'), [0.25, 0.5, 0.75]);
  assert.deepEqual(at('8.16'), [0.75, 1.75, 2.75]);
  assert.equal(times(cycleEvents(S({ subdiv: '8', subVol: 0 })), 'sub').length, 0);
});

test('subdivisions in compound and odd time: eighths and sixteenths only', () => {
  assert.deepEqual(subdivsFor('6/8'), ['none', '8', '16']);
  const c = cycleEvents(S({ meter: '6/8', tempo: 60, subdiv: '8' })); // eighth = 1/3 s
  const sub = times(c, 'sub');
  assert.equal(sub.length, 4);
  close(sub[0], 1 / 3);
  // A triplet subdivision is not kept in 6/8.
  assert.equal(S({ meter: '6/8', subdiv: '3' }).subdiv, 'none');
});

test('swing moves the offbeat eighth, only for eighths in simple time', () => {
  const c = cycleEvents(S({ tempo: 60, subdiv: '8', swing: 67 }));
  close(times(c, 'sub')[0], 0.67);
  assert.ok(swingApplies(S({ subdiv: '8' })));
  assert.ok(!swingApplies(S({ subdiv: '16' })));
  assert.ok(!swingApplies(S({ meter: '6/8', subdiv: '8' })));
});

test('jazz 2 and 4: only beats 2 and 4, even x/4 only', () => {
  assert.deepEqual(beatLevels(S({ jazz: '24' })), [0, 2, 0, 2]);
  assert.ok(canTwoFour('4/4') && canTwoFour('2/4'));
  assert.ok(!canTwoFour('3/4') && !canTwoFour('6/8'));
  assert.equal(S({ meter: '3/4', jazz: '24' }).jazz, 'off');
  // Own accents are kept underneath and come back when the mode is off.
  const s = S({ accents: [2, 1, 0, 1], jazz: '24' });
  assert.deepEqual(beatLevels({ ...s, jazz: 'off' }), [2, 1, 0, 1]);
});

test('jazz once per bar, and every other bar', () => {
  assert.deepEqual(beatLevels(S({ jazz: 'once' })), [2, 0, 0, 0]);
  assert.deepEqual(beatLevels(S({ jazz: 'once', onceBeat: 3 })), [0, 0, 0, 2]);
  const one = cycleEvents(S({ jazz: 'once' }));
  assert.equal(one.events.length, 1);
  const two = cycleEvents(S({ jazz: 'once', twoBars: true, subdiv: '8' }));
  close(two.duration, 4);
  assert.equal(two.marks.length, 8);
  assert.equal(times(two, 'strong').length, 1);
  // The silent bar is fully silent, subdivisions included.
  assert.ok(two.events.every((e) => e.t < 2));
  // twoBars alone (without "once") changes nothing.
  close(cycleEvents(S({ twoBars: true })).duration, 2);
});

test('tap tempo: last 4 taps, reset after 2 s', () => {
  let r = tapTempo([], 0);
  assert.equal(r.bpm, null);
  r = tapTempo(r.taps, 500);
  assert.equal(r.bpm, 120);
  r = tapTempo(r.taps, 1000);
  r = tapTempo(r.taps, 1500);
  r = tapTempo(r.taps, 2100); // 4 taps kept: 500, 1000, 1500, 2100
  assert.deepEqual(r.taps, [500, 1000, 1500, 2100]);
  assert.equal(r.bpm, Math.round(60000 / (1600 / 3)));
  r = tapTempo(r.taps, 5000); // pause: new series
  assert.deepEqual(r.taps, [5000]);
  assert.equal(r.bpm, null);
  assert.equal(tapTempo([0], 10).bpm, 400); // bounded
});

test('tempo markings', () => {
  assert.equal(tempoMarking(30), 'Grave');
  assert.equal(tempoMarking(60), 'Largo');
  assert.equal(tempoMarking(120), 'Allegro');
  assert.equal(tempoMarking(240), 'Prestissimo');
});

test('sanitize: garbage in, defaults out; tempo bounded', () => {
  assert.deepEqual(sanitizeMetro(null), sanitizeMetro(METRO_DEFAULTS));
  const s = sanitizeMetro({
    tempo: 9999,
    meter: '13/8',
    accents: [5, 'x'],
    subdiv: '<b>',
    subVol: 7,
    swing: 10,
    sound: 'gong',
    jazz: 'bebop',
    onceBeat: 12,
    vibrate: 'yes',
  });
  assert.equal(s.tempo, 400);
  assert.equal(s.meter, '4/4');
  assert.deepEqual(s.accents, [2, 1, 1, 1]);
  assert.equal(s.subdiv, 'none');
  assert.equal(s.subVol, 1);
  assert.equal(s.swing, 50);
  assert.equal(s.sound, 'click');
  assert.equal(s.jazz, 'off');
  assert.equal(s.onceBeat, 0);
  assert.equal(s.vibrate, false);
  assert.equal(sanitizeMetro({ tempo: 3 }).tempo, 20);
});

test('time signature change: accents reset, compatible settings kept', () => {
  const s = withMeter(S({ accents: [2, 0, 0, 0], subdiv: '3', jazz: 'once', onceBeat: 3 }), '3/4');
  assert.deepEqual(s.accents, [2, 1, 1]);
  assert.equal(s.subdiv, '3');
  assert.equal(s.onceBeat, 2);
  assert.equal(withMeter(S({ subdiv: '3' }), '6/8').subdiv, 'none');
});

test('presets: validation, loading keeps the display options', () => {
  const list = sanitizePresets([
    { id: 'a1', name: '  Donna   Lee ', s: { tempo: 240, jazz: '24', vibrate: true } },
    { id: 'a1', name: 'duplicate', s: {} },
    { id: 'BAD!', name: 'x', s: {} },
    { id: 'b2', name: '   ', s: {} },
    'junk',
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Donna Lee');
  assert.equal(list[0].s.vibrate, undefined); // display options are not stored
  const now = S({ flash: true, tempo: 80 });
  const loaded = applyPreset(now, list[0]);
  assert.equal(loaded.tempo, 240);
  assert.equal(loaded.jazz, '24');
  assert.equal(loaded.flash, true);
  assert.equal(sanitizePresets('nope'), undefined);
  assert.equal(cleanPresetName('x'.repeat(80)).length, 40);
  assert.deepEqual(Object.keys(presetPart(now)).sort(), [
    'accents',
    'jazz',
    'meter',
    'onceBeat',
    'sound',
    'subVol',
    'subdiv',
    'swing',
    'tempo',
    'twoBars',
  ]);
});
