# Inkline

Music notebook for Android phones: text, staves, rhythm lines and chord charts in a single note, entered with a finger and playable.

Progressive web app (PWA) with **no framework and no build step**: native ES modules served as is, installable and usable offline. The interface is in English or French (2.9).

## Getting started

```bash
npm install        # development tools only (JSDoc, Prettier, ESLint, Playwright…)
npm test           # unit tests (node:test)
npm run test:e2e   # interface tests in a real browser (Playwright)
npm run lint       # code analysis (ESLint)
npm run format     # automatic formatting (Prettier)
npm run check      # format + lint + tests: run before every commit
npm run docs       # generates the documentation in docs/
npm run dev        # live preview on http://localhost:5500 (automatic reload)
```

The first time on a computer, before `npm run test:e2e`: `npx playwright install chromium` (downloads the test browser).

The app itself needs no installation: any static HTTPS server will do (GitHub Pages, for example).

## Development environment

The project is set up for **Visual Studio Code** (`.vscode/` folder, shared in the repository): on opening, VS Code suggests the recommended extensions, **ESLint** (errors underlined live) and **Prettier** (formatting on every save, with the project settings).

**Live preview**: `npm run dev` (in the VS Code terminal), then open `http://localhost:5500/`. Every save reloads the page.

- Inside VS Code: Ctrl+Shift+P › "Simple Browser: Show" › `http://localhost:5500/`, then drag the tab next to the code.
- The development server (`scripts/dev.mjs`, no dependencies) disables the service worker: no cached version to purge.
- The "Live Server" extension does not fit: it injects a script into the page, which the Content Security Policy blocks.
- To simulate a phone: Chrome developer tools (F12) › phone/tablet icon.
- To debug on a real Android phone (USB debugging on): `chrome://inspect` in Chrome on the computer.

## Tests and continuous integration

- **Unit tests** (`tests/*.test.js`, `npm test`): the pure modules (rhythm, layout, fitting into measures, chords, iReal, storage, translations…), including a randomized test of measure fitting.
- **Interface tests** (`tests/e2e/*.spec.js`, `npm run test:e2e`): Playwright drives a real Chromium in phone format and replays the important flows (staff input, modes, measure fitting, folders, categories, search, backup, collapsed blocks, sharing, practice, measure selection, chord keyboard, English interface, offline). Tap coordinates are computed by the app's layout engine: the tests do not depend on pixels. The server starts on its own (`scripts/dev.mjs --static`).
- **Continuous integration** (`.github/workflows/check.yml`): on every push, GitHub runs `npm run check` then the interface tests. Results are in the repository's **Actions** tab, and as a green check or red cross next to each commit. On failure, screenshots and traces are attached to the report.

## Code conventions

- **Formatting**: Prettier (`.prettierrc.json`), lines of 110 characters at most. Don't format by hand: `npm run format`.
- **Analysis**: ESLint (`eslint.config.js`), recommended rules + unused variables, `===`, `const`.
- **Exports**: a module only exports what is used elsewhere or tested; the rest is private and shows up in the docs as an inner member (`~`).
- **Comments**: JSDoc in English on every module and function; algorithms are explained at the top of the function.
- **Interface texts**: never written in the code; always `t('key')` from `js/i18n.js`, with the text in `js/locales/en.js` and `js/locales/fr.js` (a test checks both have the same keys).
- **Long functions**: split into named steps (for example `render-staff`: one function per drawing layer).

## Tree

```
index.html            palette markup, CSP, loading of js/main.js
css/*.css             stylesheets by area (order and theme: see css/base.css)
css/fonts.css         declaration of the hosted fonts
fonts/                woff2 fonts (SIL OFL license)
sw.js                 service worker (offline)
manifest.webmanifest  name, icons, "standalone" mode
icon-*.png, apple-touch-icon.png, inkline-icon*.svg   icons (any, maskable, iOS, SVG source)
js/
  main.js             entry point
  util.js             helpers (uid, mod, escaping…)
  model.js            data types (@typedef) and factories
  pitch.js            staff position ↔ MIDI pitch, accidentals, ties
  rhythm.js           measures, triplets, beams, repeats, swing, sound events
  layout.js           staff layout (line breaking, justification)
  render-staff.js     SVG rendering of a staff
  chords.js           chord symbol parsing, voicings
  grid.js             chord charts: input, durations, playback order, HTML rendering
  ireal.js            iReal Pro import/export (irealb://)
  audio.js            Web Audio synth and sequencer
  storage.js          notebook saving, migration, backup/restore, .inkline files
  db.js               thin layer over IndexedDB (open, read, write in a transaction)
  sanitize.js         validation of imported data (allowlist)
  folders.js          folders and categories: model, selection, counters, deletion
  search.js           search (titles, texts, chords) and sort
  folding.js          collapsed display rule for long blocks
  placements.js       rhythm practice: time signatures, writing placements, series
  exercise.js         random rhythm exercises (reproducible draw by number)
  metronome.js        metronome: any time signature, groups, levels, jazz modes, subdivisions, cycle sounds, presets
  metro-clock.js      metronome timing: beats of a looping cycle, seamless swaps
  metro-engine.js     metronome audio: pre-rendered looping cycle (plays with the screen locked)
  transpose.js        transposing instruments: rewriting a staff for another instrument
  chord-keys.js       chord keyboard: effect of each key
  i18n.js             interface language: t('key'), plurals, detection
  lang-init.js        sets the language at startup (imported first)
  locales/en.js       English texts
  locales/fr.js       French texts (same keys, checked by the tests)
  measure-fit.js      fitting into measures: automatic ties at barlines, compensation with rests
  export.js           sharing a note: .inkline, PNG, PDF
  pdf.js              minimal PDF generator (JPEG images)
  history.js          undo (snapshots)
  ui/
    state.js          interface state
    nav.js            screen registry, navigation, Android back button
    blocks.js         musical block registry, active block, undo
    common.js         version, small shared interface helpers
    icons.js          SVG pictograms
    home.js           home: search, folder bar, categories, sort, list
    note.js           note screen: title, filing, pin, blocks, sharing
    folder-sheet.js   folder editor, categories panel, File note panel
    fold.js           collapsed long blocks: button, fade, tap
    training.js       Practice and Placements screens
    exercises.js      random exercise screens (settings, playback)
    drill-kit.js      shared practice pieces (settings, metronome, playback)
    metronome.js      metronome sheet (any screen), mini-bar, presets, lights, vibration, flash
    measure-select.js measure selection by long press (play from here, loop)
    chord-keyboard.js on-screen chord keyboard (chart, note chord)
    staff/            staff block: index (registration), view (header, drawing),
                      input (taps, modes), palette, bars, chord, shared (common base)
    grid-ui.js        chart block: input, palette, iReal panel
    options.js        Settings screen: language, display, folders, backup, import, iReal, about
    list-view.js      list displays: Cards, Mosaic, List
tests/                unit tests of the pure modules
tests/e2e/            interface tests (Playwright)
docs/                 generated documentation (npm run docs)
```

## Architecture

The code is split into two layers:

- **Pure modules** (`model`, `pitch`, `rhythm`, `layout`, `render-staff`, `chords`, `grid`, `ireal`, `folders`, `search`, `folding`, `placements`, `exercise`, `transpose`, `chord-keys`, `measure-fit`, `i18n`, `metronome`, `metro-clock`): no DOM, no side effects, tested under Node. They hold all the musical and organizational logic.
- **Interface** (`ui/*`, `audio`, `storage`, `main`): wires the logic to the browser.

Screens (`ui/home`, `ui/note`, `ui/options`…) and musical blocks (`ui/staff`, `ui/grid-ui`) **register** at load time with two registries, `ui/nav` and `ui/blocks`, which then call them by name. These registries import no screen: the import graph has no cycle (see the `main` module).

Rendering follows an _immediate mode_ model: the state is changed, then the affected part of the screen is regenerated (template strings → `innerHTML`, SVG as a string). No virtual DOM, no reactivity: at this scale it is the simplest, and fast enough.

The layout engine (`layout`) is used **both** by rendering and by hit testing: what you see and what you touch are computed by the same function.

## Languages

Every visible text goes through `t('key', params)` (`js/i18n.js`). The language is set at startup by `js/lang-init.js`, the first module imported by `main`: `auto` (French if the browser is in French, English otherwise), `en` or `fr`, chosen in Settings › Language. Plurals use `Intl.PluralRules`; static texts of `index.html` carry `data-i18n` attributes. Before the language is set (engine unit tests), the default is French.

## Security

The app has no server and no account: the only untrusted input is **imported files** (received note, backup, iReal link). Three independent layers:

1. **Validation** (`sanitize`): all imported or loaded data is rebuilt field by field from an allowlist (types, enumerations, bounds, lengths); invalid ids are regenerated.
2. **Escaping**: every value inserted into HTML or SVG goes through `esc()`; CSS selectors through `CSS.escape()`.
3. **Content Security Policy** (`index.html`): only the app's `.js` files can run; no third-party origin is contacted.

`tests/security-export.test.js` checks that a booby-trapped file is neutralized.

## Data

See the `model` module for the details of the types. In short:

- a note = a list of blocks (text, staff, chart);
- a pitch is stored as a **position on the staff** (what you touch), converted to MIDI on demand;
- durations are in **quarter notes** (dot ×1.5, triplet ×2/3);
- optional fields are absent rather than `false`.

The format is backward compatible: a note created in 1.0 opens in the latest version. Each note carries a creation date (`created`) and a modification date (`updated`); for notes from before 1.7.0, the creation date was initialized with the modification date.

The metronome settings and presets (2.11) are also metadata (`metro`, `metroPresets`).

Since 2.0, a note can carry `folder` (folder id) and `pinned`; since 2.8.6, `cats` (ids of categories of its folder). Folders `{ id, name, color, created, cats }` are stored separately; a note without a folder, or whose folder disappeared, is "unfiled".

A shared note is an `.inkline` file: JSON `{ app: 'inkline', kind: 'note', version: 1, note }`, **without** `folder`, `cats` or `pinned` (filing stays at home).

A backup is JSON `{ app, version: 2, exported, notes, folders }`; `version: 1` backups (no folders) can still be imported.

## Storage

Since 2.1, the notebook is stored in **IndexedDB** (database `inkline`, stores `notes` and `folders`, one entry per note and per folder). The metadata (display, selected folder, sorts, language, last backup date) stay in `localStorage` (key `inkline-meta`).

- **Migration**: on the first launch of 2.1, the `localStorage` notebook (keys `carnet-portees-v1` and `inkline-folders`) is copied in one transaction, only if the database is empty. The old copy is kept, frozen at the migration date.
- **Writes**: only the changed note is written; after a bulk operation, a comparison with the last written version (JSON) detects every change and deletion.
- **Fallback**: if IndexedDB is unavailable, the app works as before with `localStorage`. Settings show the storage in use (About).
- **Tests**: `tests/storage-idb.test.js` uses `fake-indexeddb`, an in-memory IndexedDB implementation for Node.

## Publishing a new version

1. Update `APP_VERSION` in `js/ui/common.js`, `version` in `package.json` and `CACHE` in `sw.js`.
2. Add the matching entry in `CHANGELOG.md` (in English since 2.9.1).
3. `npm run check`, `npm run test:e2e`, then `npm run docs`.
4. Push to the branch published by GitHub Pages.

On the phone, the new version shows up on the **second** opening of the app (the service worker's _stale-while-revalidate_ strategy).
