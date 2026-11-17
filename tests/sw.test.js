// The service worker caches every module: a file missing from its list would break the app offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Every `.js` file under `dir`, as `./js/…` paths. */
function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith('.js') ? ['./' + relative('.', p).split('\\').join('/')] : [];
  });
}

test('sw.js: every module of js/ is in the offline cache', () => {
  const sw = readFileSync('sw.js', 'utf8');
  const missing = jsFiles('js').filter((f) => !sw.includes(`'${f}'`));
  assert.deepEqual(missing, []);
});
