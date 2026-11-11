// Helpers shared by the interface tests.
//
// The tests tap the staff like a user (clicks at coordinates),
// but compute those coordinates with the app's own layout engine:
// they do not depend on exact pixels.

/**
 * Fills local storage before the first load (a notebook from an old
 * version, for example). Applies only once per context.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Object.<string, *>} entries localStorage keys → values (JSON).
 */
export async function seedStorage(context, entries) {
  await context.addInitScript((data) => {
    if (localStorage.getItem('__seeded')) return;
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    localStorage.setItem('__seeded', '1');
  }, entries);
}

/** Opens the app and waits for home. */
export async function openApp(page) {
  await page.goto('./');
  await page.locator('#newNote').waitFor();
}

/** Creates an empty note and adds a block to it (`staff`, `rhythm`, `grid`, `text`). */
export async function newNoteWith(page, kind) {
  await page.click('#newNote');
  await page.click(`[data-add=${kind}]`);
  await page.locator('.block.active').waitFor();
}

/**
 * Screen coordinates of a target on the active staff, computed by the app's
 * layout engine.
 * @param {import('@playwright/test').Page} page
 * @param {{t: 'append'|'insert'|'item', s?: number, i?: number}} what
 */
export async function staffPoint(page, what) {
  return page.evaluate(async (w) => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { layout, geom, yOfStep } = await import('/js/layout.js');
    const b = blockById(state.activeId);
    const wrap = document.querySelector(`[data-staff="${b.id}"]`);
    const r = wrap.getBoundingClientRect();
    const L = layout(b, wrap._W, true, state.mode === 'write' ? state.cursor : null);
    const at = (sys, x) => ({ x: r.left + x, y: r.top + yOfStep(L, geom(L, sys), w.s ?? 4) });
    if (w.t === 'append') return at(L.appendSys, L.appendX + 10);
    if (w.t === 'insert') return at(L.insertSys, L.insertX);
    return at(L.pos[w.i].sys, L.pos[w.i].x);
  }, what);
}

/** Taps the active staff (add zone, insertion zone or a note). */
export async function tapStaff(page, what) {
  const p = await staffPoint(page, what);
  await page.mouse.click(p.x, p.y);
}

/**
 * Drags on the staff with the mouse: presses on `from`, goes through each
 * position of `through` (pitches `s`, computed with the layout at the start
 * of the gesture, like the app), then releases.
 * @param {import('@playwright/test').Page} page
 * @param {{t: 'append'|'insert'|'item', s?: number, i?: number}} from
 * @param {Array.<number>} through
 * @param {function(): Promise<void>} [during] Called before releasing.
 */
export async function dragStaff(page, from, through, during) {
  const start = await staffPoint(page, from);
  const points = [];
  for (const s of through) points.push(await staffPoint(page, { ...from, s }));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const p of points) await page.mouse.move(p.x, p.y, { steps: 4 });
  if (during) await during();
  await page.mouse.up();
}

/** Taps a button of the staff palette. */
export async function pal(page, selector) {
  await page.click(`#palette ${selector}`);
}

/**
 * State of the active staff, in compact notation: "q", "h.", "r8", "8³"
 * (triplet), "~" (tie), "+" (automatic piece).
 */
export async function staffState(page) {
  return page.evaluate(async () => {
    const { state, blockById } = await import('/js/ui/state.js');
    const { qlen } = await import('/js/model.js');
    const b = blockById(state.activeId);
    return {
      items: b.items
        .map(
          (i) =>
            (i.r ? 'r' : '') +
            i.d +
            (i.dot ? '.' : '') +
            (i.tup ? '³' : '') +
            (i.tie ? '~' : '') +
            (i.auto ? '+' : ''),
        )
        .join(' '),
      total: Math.round(b.items.reduce((t, i) => t + qlen(i), 0) * 1000) / 1000,
      mode: state.mode,
      cursor: state.cursor,
      sel: state.sel,
      steps: b.items.map((i) => (i.r ? null : (i.s ?? null))),
      info: document.getElementById('palInfo').textContent,
    };
  });
}

/** Notebook content as stored in IndexedDB. */
export async function storedNotes(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const q = indexedDB.open('inkline');
        q.onsuccess = () => {
          const db = q.result;
          const t = db.transaction(['notes', 'folders']);
          const a = t.objectStore('notes').getAll();
          const f = t.objectStore('folders').getAll();
          t.oncomplete = () => {
            db.close();
            resolve({ notes: a.result, folders: f.result });
          };
        };
      }),
  );
}

/** JavaScript errors of the page (to check empty at the end of a test). */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
