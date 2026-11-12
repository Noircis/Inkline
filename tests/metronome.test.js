// Tests for the metronome (2.11, free time signatures 2.12): settings, groups, levels,
// cycle sounds, jazz modes, tap tempo, presets; polyrhythm, blocks and notes (2.15).
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
  planBar,
  rampTempo,
  rampBars,
  rampSteps,
  gapShare,
  streams,
  chunkEvents,
  cycleBars,
  polyHits,
  polyRatio,
  withPoly,
  fromBlock,
  sameAsStored,
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
  // Quintuplets to septuplets (2.15.1): n − 1 clicks evenly spread.
  for (const n of [5, 6, 7]) {
    const sub = times(cycleEvents(withSubdiv(S({ tempo: 60 }), String(n))), 'sub');
    assert.equal(sub.length, 4 * (n - 1));
    sub.slice(0, n - 1).forEach((x, k) => close(x, (k + 1) / n));
    assert.equal(withSubdiv(S(), String(n)).subLevels.length, 4 * (n - 1));
  }
  assert.equal(withSubdiv(M(6, 8), '5').subdiv, 'none'); // /8: no subdivision
  // The old dotted eighth (8.16) comes back as eighths swung at 75 %, levels kept.
  const old = sanitizeMetro({ subdiv: '8.16', subLevels: [1, 2, 3, 4], swing: 50 });
  assert.equal(old.subdiv, '8');
  assert.equal(old.swing, 75);
  assert.deepEqual(old.subLevels, [1, 2, 3, 4]);
  assert.deepEqual(times(cycleEvents({ ...old, tempo: 60 }), 'sub').slice(0, 2), [0.75, 1.75]);
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

test('jazz once per bar; every other bar is now a silence of 1 + 1', () => {
  assert.deepEqual(pulseLevels(S({ jazz: 'once', onceBeat: 3 })), [0, 0, 0, 4]);
  const two = cycleEvents(withSubdiv(S({ jazz: 'once', gap: { mode: 'bars', on: 1, off: 1 } }), '8'));
  close(two.duration, 4);
  assert.equal(two.marks.length, 8);
  assert.ok(two.events.every((e) => e.t < 2)); // the silent bar is fully silent
  assert.ok(two.marks.slice(4).every((m) => m.silent));
  // 2.13 "every other bar" becomes 1 bar with click, 1 without.
  assert.deepEqual(
    [
      sanitizeMetro({ jazz: 'once', twoBars: true }).gap.mode,
      sanitizeMetro({ jazz: 'once', twoBars: true }).gap.on,
    ],
    ['bars', 1],
  );
  assert.equal(sanitizeMetro({ twoBars: true }).gap.mode, 'off');
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

// ---------- 2.14: silences and tempo ramp ----------

test('silences by whole bars: a cycle of on + off bars', () => {
  const s = S({ gap: { mode: 'bars', on: 2, off: 2 } });
  const c = cycleEvents(s);
  close(c.duration, 8);
  assert.equal(c.marks.length, 16);
  assert.ok(c.events.every((e) => e.t < 4));
  assert.deepEqual(
    c.marks.map((m) => m.silent),
    [...Array(8).fill(false), ...Array(8).fill(true)],
  );
  assert.ok(!streams(s)); // a plain loop, playable screen locked without any script
});

test('random silences: the share asked for, reproducible from the seed', () => {
  const s = S({ gap: { mode: 'random', pct: 30 } });
  assert.ok(streams(s));
  let muted = 0;
  for (let i = 0; i < 2000; i++) muted += planBar(s, i, 0, 7).mute.filter(Boolean).length;
  const share = muted / 8000;
  assert.ok(share > 0.27 && share < 0.33, String(share));
  assert.deepEqual(planBar(s, 12, 0, 7), planBar(s, 12, 0, 7));
  assert.notDeepEqual(
    Array.from({ length: 20 }, (_, i) => planBar(s, i, 0, 7).mute),
    Array.from({ length: 20 }, (_, i) => planBar(s, i, 0, 8).mute),
  );
});

test('growing silences: from one share to another over the minutes chosen', () => {
  const s = S({ gap: { mode: 'grow', from: 0, to: 80, minutes: 5 } });
  close(gapShare(s, 0), 0);
  close(gapShare(s, 150), 0.4);
  close(gapShare(s, 300), 0.8);
  close(gapShare(s, 9999), 0.8);
  assert.equal(planBar(s, 0, 0, 1).mute, null);
});

test('a silenced pulse takes its subdivisions with it', () => {
  const s = withSubdiv(S({ tempo: 60 }), '16');
  const c = chunkEvents(s, [{ tempo: 60, mute: [false, true, false, true] }]);
  assert.ok(c.events.every((e) => !(e.t >= 1 && e.t < 2) && !(e.t >= 3 && e.t < 4)));
  assert.equal(c.events.length, 8); // 2 pulses × (1 + 3 subdivisions)
});

test('tempo ramp: steps, target, end', () => {
  const s = S({ tempo: 80, ramp: { on: true, to: 140, step: 4, every: 4, end: 'stay' } });
  assert.equal(rampSteps(s), 15);
  assert.equal(rampBars(s), 64);
  assert.deepEqual(
    [0, 3, 4, 8, 59, 60, 63, 64, 500].map((i) => rampTempo(s, i)),
    [80, 80, 84, 88, 136, 140, 140, 140, 140],
  );
  assert.equal(rampTempo({ ...s, ramp: { ...s.ramp, end: 'stop' } }, 64), null);
  assert.equal(planBar({ ...s, ramp: { ...s.ramp, end: 'stop' } }, 64, 0, 0), null);
  assert.equal(rampTempo({ ...s, ramp: { ...s.ramp, end: 'loop' } }, 68), 84);
  // The last step never goes past the target; a slower target ramps down.
  const odd = S({ tempo: 100, ramp: { on: true, to: 110, step: 4, every: 1 } });
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((i) => rampTempo(odd, i)),
    [100, 104, 108, 110, 110],
  );
  const down = S({ tempo: 120, ramp: { on: true, to: 100, step: 10, every: 2 } });
  assert.deepEqual(
    [0, 2, 4, 6].map((i) => rampTempo(down, i)),
    [120, 110, 100, 100],
  );
  // Bars of a ramp get shorter as the tempo goes up.
  const ch = chunkEvents(s, [planBar(s, 0, 0, 0), planBar(s, 60, 0, 0)]);
  close(ch.duration, 4 * (60 / 80) + 4 * (60 / 140));
  assert.equal(ch.marks[4].tempo, 140);
});

test('silences and ramp: validation and presets', () => {
  const s = sanitizeMetro({
    gap: { mode: 'grow', from: 60, to: 30, minutes: 7, on: 0, pct: 33 },
    ramp: { on: 'yes', to: 999, step: 50, every: 0, end: 'later' },
  });
  assert.deepEqual(s.gap, { mode: 'grow', on: 2, off: 2, pct: 30, from: 60, to: 70, minutes: 5 });
  assert.deepEqual(s.ramp, { on: false, to: 400, step: 4, every: 4, end: 'stay' });
  const p = presetPart(S({ gap: { mode: 'bars', on: 1, off: 3 }, ramp: { on: true, to: 160 } }));
  assert.equal(p.gap.off, 3);
  assert.equal(p.ramp.to, 160);
});

// ---------- Polyrhythm (2.15) ----------

test('polyrhythm: hits spread evenly over the bars', () => {
  const s = withPoly(S(), { on: true, n: 3, bars: 2 });
  assert.deepEqual(
    polyHits(s, 0).map((h) => h.hit),
    [0, 1],
  );
  close(polyHits(s, 0)[1].f, 2 / 3);
  assert.deepEqual(polyHits(s, 1), [{ hit: 2, f: 1 / 3 }]);
  assert.deepEqual(polyHits(s, 2), polyHits(s, 0)); // next group of two bars
  assert.deepEqual(polyHits(S(), 0), []); // off
  assert.equal(polyRatio(s), '3:8');
  assert.equal(polyRatio(withPoly(S(), { n: 3 })), '3:4');
});

test('polyrhythm: cycle length, sounds, a hit on a silenced pulse is silent', () => {
  const s = withPoly(S({ tempo: 60 }), { on: true, n: 3 });
  assert.equal(cycleBars(s), 1);
  const c = cycleEvents(s);
  assert.equal(c.duration, 4);
  const poly = c.events.filter((e) => e.kind === 'poly');
  assert.deepEqual(
    poly.map((e) => e.level),
    [4, 3, 3],
  );
  poly.forEach((e, k) => close(e.t, (4 * k) / 3));
  assert.equal(c.polys.length, 3);
  // Two bars over a cycle of 2 + 1 silence bars: 6 bars.
  assert.equal(cycleBars(withPoly(S({ gap: { mode: 'bars', on: 2, off: 1 } }), { on: true, bars: 2 })), 6);
  // Bar silenced by the silences: the hits are silent too, but still marked.
  const g = withPoly(S({ gap: { mode: 'bars', on: 1, off: 1 } }), { on: true, n: 3 });
  const cg = cycleEvents(g);
  assert.equal(cg.events.filter((e) => e.kind === 'poly').length, 3);
  assert.deepEqual(
    cg.polys.map((m) => m.silent),
    [false, false, false, true, true, true],
  );
  // A muted hit keeps its level for later.
  const m = withPoly(s, { levels: [4, -3, 3] });
  assert.equal(cycleEvents(m).events.filter((e) => e.kind === 'poly').length, 2);
});

test('polyrhythm: validation, levels reset when the hits change, kept in presets', () => {
  const s = sanitizeMetro({ poly: { on: true, n: 99, bars: 0, sound: 'gong', levels: [1] } });
  assert.deepEqual(s.poly, { on: true, n: 3, bars: 1, sound: 'wood', levels: [4, 3, 3] });
  const p = withPoly(withPoly(S(), { levels: [4, -2, 1] }), { n: 4 });
  assert.deepEqual(p.poly.levels, [4, 3, 3, 3]);
  assert.deepEqual(withPoly(p, { sound: 'rim' }).poly.levels, [4, 3, 3, 3]);
  const part = presetPart(withPoly(S(), { on: true, n: 5 }));
  assert.equal(part.poly.n, 5);
  assert.equal(applyPreset(S(), { s: part }).poly.on, true);
});

// ---------- Blocks and notes (2.15) ----------

test('fromBlock: time signature, tempo converted, swing', () => {
  const st = fromBlock(S(), { type: 'staff', time: '4/4', tempo: 100, swing: false });
  assert.equal(st.tempo, 100);
  assert.equal(st.subdiv, 'none');
  const six = fromBlock(S(), { type: 'staff', time: '6/8', tempo: 90, swing: false });
  assert.equal(meterLabel(six), '6/8');
  assert.equal(six.unit, 'group');
  assert.equal(six.tempo, 60);
  const sw = fromBlock(S(), { type: 'staff', time: '3/4', tempo: 150, swing: true });
  assert.equal(sw.num, 3);
  assert.equal(sw.subdiv, '8');
  assert.equal(sw.swing, 67);
  const chart = fromBlock(S(), { type: 'grid', time: '4/4', tempo: 200, style: 'Up Tempo Swing' });
  assert.equal(chart.subdiv, '8');
  const bossa = fromBlock(S({ subdiv: '8', swing: 67 }), {
    type: 'grid',
    time: '4/4',
    tempo: 140,
    style: 'Bossa Nova',
  });
  assert.equal(bossa.swing, 50);
  // The rest of the settings stays.
  assert.equal(fromBlock(S({ sound: 'rim' }), { type: 'staff', time: '2/4', tempo: 80 }).sound, 'rim');
});

test('sameAsStored: compares the musical part only', () => {
  const s = S({ tempo: 90 });
  assert.equal(sameAsStored(s, presetPart(s)), true);
  assert.equal(sameAsStored({ ...s, flash: true }, presetPart(s)), true);
  assert.equal(sameAsStored(S({ tempo: 91 }), presetPart(s)), false);
  assert.equal(sameAsStored(s, undefined), false);
});
