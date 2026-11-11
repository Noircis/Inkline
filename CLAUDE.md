# CLAUDE.md

Guidance for Claude Code when working in this repository. The README is the full reference (tree, data
format, storage, security); this file is the short version plus the rules that are easy to miss.

## What Inkline is

A music notebook PWA for Android phones: a note is a list of blocks (text, staff, rhythm line, chord chart),
entered with a finger and playable. **No framework, no build step, no runtime dependencies**: native ES
modules served as is (`index.html` → `js/main.js`), offline via `sw.js`, data in IndexedDB. `node_modules`
holds dev tools only (ESLint, Prettier, JSDoc, Playwright, fake-indexeddb).

## Running locally

```bash
npm install                      # dev tools only
npm run dev                      # http://localhost:5500/ — live reload, service worker disabled
npm test                         # unit tests (node:test, pure modules)
npx playwright install chromium  # once per machine, before e2e
npm run test:e2e                 # Playwright, phone viewport 390×844, locale fr-FR, port 5610
npm run check                    # prettier --check + eslint + unit tests — run before every commit
npm run format                   # Prettier write
npm run docs                     # regenerate JSDoc into docs/
```

- `scripts/dev.mjs` is a zero-dependency Node server. `--static` serves as in production (service worker on,
  no reload) — that is what Playwright uses. `--port=NNNN` changes the port.
- Do not use the VS Code "Live Server" extension: it injects an inline script that the CSP blocks.
- CI (`.github/workflows/check.yml`, Node 22) runs `npm run check` then `npm run test:e2e` on every push.

## Architecture

Two layers:

- **Pure modules** (`js/*.js` except `audio`, `storage`, `db`, `export`, `pdf`, `main`): no DOM, no side
  effects, tested under Node. All musical/organizational logic lives here — `model` (types/factories),
  `pitch`, `rhythm`, `layout`, `render-staff` (SVG as string), `chords`, `grid`, `ireal`, `measure-fit`,
  `transpose`, `folders`, `search`, `folding`, `placements`, `exercise`, `chord-keys`, `i18n`, `sanitize`.
- **Interface / browser glue**: `js/ui/**`, `audio` (Web Audio synth), `storage` + `db` (IndexedDB with
  localStorage fallback), `export` + `pdf`, `main`.

Key patterns:

- **Registries, no import cycles.** Screens call `registerScreen(name, fn)` (`ui/nav.js`); block types call
  `registerBlockKind(type, { build, redraw, showPalette })` (`ui/blocks.js`). Navigation/blocks dispatch by
  name. `main.js` imports every screen and block module purely for this side effect. `ui/nav`, `ui/blocks`,
  `ui/common`, `ui/state` must never import a screen. A new screen/block = register it + import it in
  `main.js`.
- **Immediate-mode rendering.** Mutate `state` (`ui/state.js`), then regenerate the affected part (template
  strings → `innerHTML`, SVG strings). No virtual DOM, no reactivity.
- **One layout engine for drawing and hit testing.** `layout.js` computes positions used both by
  `render-staff` and by tap handling (`ui/staff/input.js`); e2e tests also compute tap coordinates from it.
  Never duplicate geometry.
- `lang-init.js` must stay the **first** import of `main.js` (language set before labels are built).

Main files by size/importance: `render-staff.js`, `storage.js`, `ui/grid-ui.js`, `audio.js`, `rhythm.js`,
`ireal.js`, `measure-fit.js`, `model.js`, `ui/staff/*` (index, view, input, palette, bars, chord, shared).

## Data model essentials

- Pitch stored as **staff position**, converted to MIDI on demand (`pitch.js`).
- Durations in **quarter notes** (dot ×1.5, triplet ×2/3).
- Optional fields are **absent** rather than `false`.
- Format is backward compatible back to 1.0 — never break loading of old notes; migrations go in `storage.js`
  / `sanitize.js`.
- Notes may carry `folder`, `pinned`, `cats`; shared `.inkline` files strip those. Backups are
  `{ app, version: 2, exported, notes, folders }` (v1 still importable).

## Code conventions

- **Formatting**: Prettier — 110 cols, single quotes, trailing commas, arrow parens always. Don't hand-format.
- **ESLint**: recommended + `no-unused-vars` (prefix unused args with `_`), `eqeqeq` (smart), `prefer-const`,
  `no-var`. Empty `catch {}` allowed.
- **Exports**: export only what is used elsewhere or tested; everything else stays module-private.
- **Comments/JSDoc in English** on every module and function (`@module` header with `@description`);
  explain algorithms at the top of the function. Long functions are split into named steps.
- **No UI strings in code.** Always `t('key', params)` from `js/i18n.js`; add the text to **both**
  `js/locales/en.js` and `js/locales/fr.js` (a test enforces identical keys). Static HTML uses `data-i18n`.
- **Security**: every value interpolated into HTML/SVG goes through `esc()` (`util.js`); selectors through
  `CSS.escape()`. Imported data is rebuilt field-by-field from an allowlist in `sanitize.js`. CSP is
  `script-src 'self'`: no inline scripts, no third-party origins, no CDNs.
- CSS is split by area in `css/` (order and theme tokens documented in `css/base.css`).
- **Language**: code, comments, CHANGELOG entries and commit messages are in English since 2.9.1 (older
  CHANGELOG entries stay in French).

## Tests

- Unit: `tests/*.test.js` with `node:test` + `node:assert/strict`, importing pure modules directly.
  IndexedDB tests use `fake-indexeddb`. New pure logic should come with a unit test.
- E2E: `tests/e2e/*.spec.js`, shared helpers in `tests/e2e/helpers.js` (`openApp`, `newNoteWith`,
  `seedStorage`…). Default locale is `fr-FR`; `english.spec.js` covers the English UI.

## Releasing a version

1. Bump the version in **three** places: `APP_VERSION` in `js/ui/common.js`, `version` in `package.json`,
   `CACHE` in `sw.js`.
2. Add a `CHANGELOG.md` entry (Keep a Changelog format, English).
3. `npm run check`, `npm run test:e2e`, `npm run docs` (`docs/` is generated but committed).
4. Push to the GitHub Pages branch. Users get the new version on the second launch (stale-while-revalidate).
