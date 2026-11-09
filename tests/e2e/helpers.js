// Outils communs aux tests d'interface.
//
// Les tests touchent la portée comme un utilisateur (clics à des coordonnées),
// mais calculent ces coordonnées avec le moteur de mise en page de l'appli
// elle-même : ils ne dépendent pas des pixels exacts.

/**
 * Remplit le stockage local avant le premier chargement (carnet d'une
 * ancienne version, par exemple). Ne s'applique qu'une fois par contexte.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Object.<string, *>} entries Clés localStorage → valeurs (JSON).
 */
export async function seedStorage(context, entries) {
  await context.addInitScript((data) => {
    if (localStorage.getItem('__seeded')) return;
    Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
    localStorage.setItem('__seeded', '1');
  }, entries);
}

/** Ouvre l'appli et attend l'accueil. */
export async function openApp(page) {
  await page.goto('./');
  await page.locator('#newNote').waitFor();
}

/** Crée une note vide et y ajoute un bloc (`staff`, `rhythm`, `grid`, `text`). */
export async function newNoteWith(page, kind) {
  await page.click('#newNote');
  await page.click(`[data-add=${kind}]`);
  await page.locator('.block.active').waitFor();
}

/**
 * Coordonnées écran d'une cible sur la portée active, calculées par le
 * moteur de mise en page de l'appli.
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

/** Touche la portée active (zone d'ajout, zone d'insertion ou une note). */
export async function tapStaff(page, what) {
  const p = await staffPoint(page, what);
  await page.mouse.click(p.x, p.y);
}

/**
 * Glisse sur la portée avec la souris : appuie sur `from`, passe par chaque
 * position de `through` (des hauteurs `s`, calculées avec la mise en page du
 * début du geste, comme l'appli), puis relâche.
 * @param {import('@playwright/test').Page} page
 * @param {{t: 'append'|'insert'|'item', s?: number, i?: number}} from
 * @param {Array.<number>} through
 * @param {function(): Promise<void>} [during] Appelé avant de relâcher.
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

/** Touche un bouton de la palette de portée. */
export async function pal(page, selector) {
  await page.click(`#palette ${selector}`);
}

/**
 * État de la portée active, en écriture compacte : « q », « h. », « r8 »,
 * « 8³ » (triolet), « ~ » (liaison), « + » (morceau automatique).
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

/** Contenu du carnet tel qu'enregistré dans IndexedDB. */
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

/** Erreurs JavaScript de la page (à vérifier vides en fin de test). */
export function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
