// Practice notebook (2.16): programs, items, sessions, tempo history, backup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeProgram,
  sanitizePrograms,
  sanitizeSession,
  sanitizeSessions,
  newProgram,
  newItem,
  duplicateProgram,
  moveItem,
  putSession,
  newSession,
  recordVisit,
  sessionSeconds,
  worthKeeping,
  sortedSessions,
  sortedPrograms,
  lastPlayed,
  tempoHistory,
  setEntryTempo,
  clock,
  minutesOf,
  curvePoints,
  ITEMS_MAX,
  SESSIONS_MAX,
} from '../js/practice.js';
import { backupJson, importFile } from '../js/storage.js';

const staff = {
  id: 'b1',
  type: 'staff',
  clef: 'rhythm',
  time: '7/8',
  groups: [2, 3, 2],
  tempo: 90,
  items: [{ d: 'q' }],
};

test('items: each kind needs its fields; durations and metronome validated', () => {
  assert.equal(newItem({ kind: 'text', text: '  Scales  ' }).text, 'Scales');
  assert.equal(newItem({ kind: 'text', text: '   ' }), null);
  assert.equal(newItem({ kind: 'note' }), null);
  assert.equal(newItem({ kind: 'note', note: 'n1' }).note, 'n1');
  assert.equal(newItem({ kind: 'block', note: 'n1' }), null);
  assert.equal(newItem({ kind: 'block', note: 'n1', block: 'b1' }).block, 'b1');
  assert.equal(newItem({ kind: 'gong' }), null);
  const ex = newItem({ kind: 'exercise', staff, title: 'Exercise 4 · 7/8' });
  assert.equal(ex.staff.time, '7/8');
  assert.deepEqual(ex.staff.groups, [2, 3, 2]); // odd grouping kept (2.16)
  assert.equal(newItem({ kind: 'text', text: 'x', minutes: 10 }).minutes, 10);
  assert.equal('minutes' in newItem({ kind: 'text', text: 'x', minutes: 0 }), false);
  assert.equal('minutes' in newItem({ kind: 'text', text: 'x', minutes: 999 }), false);
  const m = newItem({ kind: 'text', text: 'x', metro: { tempo: 999, flash: true } }).metro;
  assert.equal(m.tempo, 400);
  assert.equal('flash' in m, false); // musical settings only
});

test('programs: validation, unique item ids, duplicate, move', () => {
  assert.equal(sanitizeProgram({ id: 'bad id!' }), null);
  const p = sanitizeProgram({
    id: 'p1',
    name: '  Routine\n sax ',
    created: 5,
    updated: 1,
    items: [{ id: 'i1', kind: 'text', text: 'a' }, { id: 'i1', kind: 'text', text: 'b' }, { kind: 'nope' }],
  });
  assert.equal(p.name, 'Routine sax');
  assert.equal(p.updated, 5);
  assert.equal(p.items.length, 2);
  assert.notEqual(p.items[0].id, p.items[1].id);
  const big = sanitizeProgram({
    id: 'p2',
    items: Array.from({ length: 99 }, () => ({ kind: 'text', text: 'x' })),
  });
  assert.equal(big.items.length, ITEMS_MAX);
  const copy = duplicateProgram(p, 'Copy');
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.name, 'Copy');
  assert.notEqual(copy.items[0].id, p.items[0].id);
  assert.equal(copy.items[1].text, 'b');
  const [a, b] = p.items;
  assert.deepEqual(moveItem(p.items, 0, 1), [b, a]);
  assert.deepEqual(moveItem(p.items, 1, 0), [b, a]);
  assert.deepEqual(moveItem(p.items, 5, 0), [a, b]);
  assert.deepEqual(Object.keys(sanitizePrograms([p, { id: 'x' }, null])), ['p1', 'x']);
  assert.equal(newProgram('  My   program ').name, 'My program');
});

test('sessions: visits add up, the last tempo counts, short sessions are not kept', () => {
  const p = sanitizeProgram({ id: 'p1', name: 'Sax', items: [{ id: 'i1', kind: 'text', text: 'a' }] });
  let s = newSession(p, 1000);
  assert.equal(s.program, 'p1');
  assert.equal(worthKeeping(s), false);
  s = recordVisit(s, { item: 'i1', label: 'a', seconds: 20, tempo: 120 }, 2000);
  s = recordVisit(s, { item: 'i2', label: 'b', seconds: 5 }, 3000);
  s = recordVisit(s, { item: 'i1', label: 'a', seconds: 40.4 }, 4000);
  assert.equal(s.items.length, 2);
  assert.equal(s.items[0].seconds, 60);
  assert.equal(s.items[0].tempo, 120); // kept when the metronome did not play
  s = recordVisit(s, { item: 'i1', label: 'a', seconds: 1, tempo: 126.4 }, 5000);
  assert.equal(s.items[0].tempo, 126);
  assert.equal(s.end, 5000);
  assert.equal(sessionSeconds(s), 66);
  assert.equal(worthKeeping(s), true);
  const fixed = setEntryTempo(s, 'i2', 999);
  assert.equal(fixed.items[1].tempo, 400);
  assert.equal('tempo' in setEntryTempo(s, 'i1', null).items[0], false);
});

test('sessions: validation, order, limit, last played, tempo history', () => {
  assert.equal(sanitizeSession({ id: 's1', program: 'p1' }), null); // no start
  const s = sanitizeSession({
    id: 's1',
    program: 'p1',
    start: 10,
    end: 5,
    items: [{ item: 'i1', label: 'x', seconds: -3, tempo: 5 }, { item: '??' }],
  });
  assert.equal(s.end, 10);
  assert.deepEqual(s.items, [{ item: 'i1', label: 'x', seconds: 0 }]);
  const all = sanitizeSessions([
    { id: 'a', program: 'p1', start: 100, items: [{ item: 'i1', label: 'x', seconds: 60, tempo: 100 }] },
    { id: 'b', program: 'p2', start: 300, items: [] },
    { id: 'c', program: 'p1', start: 200, items: [{ item: 'i1', label: 'x', seconds: 60, tempo: 112 }] },
  ]);
  assert.deepEqual(
    sortedSessions(all).map((x) => x.id),
    ['b', 'c', 'a'],
  );
  assert.deepEqual(
    sortedSessions(all, 'p1').map((x) => x.id),
    ['c', 'a'],
  );
  assert.deepEqual(lastPlayed(all), { p1: 200, p2: 300 });
  assert.deepEqual(
    tempoHistory(all, 'i1').map((x) => x.tempo),
    [100, 112],
  );
  const programs = {
    p1: { id: 'p1', created: 1 },
    p2: { id: 'p2', created: 2 },
    p3: { id: 'p3', created: 3 },
  };
  assert.deepEqual(
    sortedPrograms(programs, all).map((p) => p.id),
    ['p2', 'p1', 'p3'],
  );
  // Beyond the limit, the oldest goes.
  const many = {};
  for (let i = 0; i < SESSIONS_MAX; i++) many['s' + i] = { id: 's' + i, start: 1000 + i };
  putSession(many, { id: 'new', start: 1 });
  assert.equal(Object.keys(many).length, SESSIONS_MAX);
  assert.equal(many.new, undefined); // it was the oldest itself
});

test('display: clock, minutes, curve points', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(65.9), '1:05');
  assert.equal(clock(3723), '1:02:03');
  assert.equal(minutesOf(0), 0);
  assert.equal(minutesOf(10), 1);
  assert.equal(minutesOf(2050), 34);
  const c = curvePoints([{ tempo: 100 }, { tempo: 120 }], 200, 100, 10);
  assert.deepEqual(c, {
    points: [
      { x: 10, y: 90 },
      { x: 190, y: 10 },
    ],
    lo: 100,
    hi: 120,
  });
  const one = curvePoints([{ tempo: 92 }], 200, 100, 10);
  assert.equal(one.lo, 90);
  assert.equal(one.hi, 100);
  assert.deepEqual(
    [curvePoints([{ tempo: 120 }], 1, 1, 0).lo, curvePoints([{ tempo: 120 }], 1, 1, 0).hi],
    [110, 130],
  );
  assert.equal(one.points[0].x, 100);
  assert.deepEqual(curvePoints([], 1, 1, 0).points, []);
});

test('backup v3: programs and sessions saved and merged', () => {
  const p = sanitizeProgram({
    id: 'p1',
    name: 'Sax',
    created: 1,
    updated: 50,
    items: [{ id: 'i1', kind: 'text', text: 'a' }],
  });
  const s = sanitizeSession({
    id: 's1',
    program: 'p1',
    start: 10,
    items: [{ item: 'i1', label: 'a', seconds: 60 }],
  });
  const json = backupJson({}, {}, { programs: { p1: p }, sessions: { s1: s } });
  const back = { programs: {}, sessions: {} };
  const r = importFile({}, json, {}, back);
  assert.equal(r.kind, 'backup');
  assert.deepEqual(back.programs.p1, p);
  assert.deepEqual(back.sessions.s1, s);
  // A newer program here is kept; a session here is not doubled.
  const here = { programs: { p1: { ...p, name: 'Newer', updated: 99 } }, sessions: { s1: s } };
  importFile({}, json, {}, here);
  assert.equal(here.programs.p1.name, 'Newer');
  assert.equal(Object.keys(here.sessions).length, 1);
  // An older backup (v2) has no practice notebook: nothing changes.
  const v2 = JSON.stringify({ app: 'carnet-portees', version: 2, notes: { a: { id: 'a', blocks: [] } } });
  const none = { programs: {}, sessions: {} };
  importFile({}, v2, {}, none);
  assert.deepEqual(none, { programs: {}, sessions: {} });
});
