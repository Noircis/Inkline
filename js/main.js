/**
 * @module main
 * @description
 * **Point d'entrée** d'Inkline, chargé par `index.html` via
 * `<script type="module" src="js/main.js">`.
 *
 * Responsabilités :
 * 1. charger le carnet (IndexedDB, de façon asynchrone) ;
 * 2. afficher le premier écran ;
 * 3. brancher les écouteurs globaux (mise en arrière-plan, redimensionnement,
 *    clavier virtuel) ;
 * 4. gérer le bouton retour d'Android (historique) ;
 * 5. enregistrer le service worker (fonctionnement hors ligne).
 *
 * ## Graphe des modules
 *
 * ```
 * main
 *  ├─ lang-init ───── i18n ── locales/en, locales/fr   (importé en premier)
 *  ├─ ui/home ─────┬─ ui/list-view       (affichages de la liste)
 *  │               ├─ ui/folder-sheet    (éditeur de dossier)
 *  │               └─ ui/options         (rappel de sauvegarde)
 *  ├─ ui/note ─────── export ── pdf
 *  ├─ ui/options ──── ireal
 *  ├─ ui/training, ui/exercises ── ui/drill-kit, exercise ── placements
 *  ├─ ui/staff/* ──── render-staff ── layout ── rhythm ── pitch ── model ── util
 *  ├─ ui/grid-ui ──── grid ── chords
 *  │
 *  │  socle commun à tous les écrans (n'importe aucun écran) :
 *  ├─ ui/nav         registre des écrans, navigation, bouton retour
 *  ├─ ui/blocks      registre des blocs musicaux, bloc actif, annulation
 *  ├─ ui/common      version, petits outils d'interface
 *  ├─ ui/state       état de l'interface
 *  ├─ storage ─────── sanitize ── folders
 *  ├─ search, folders
 *  ├─ audio (rhythm, grid, chords)
 *  └─ history
 * ```
 *
 * Les écrans (`home`, `note`, `options`) et les blocs (`ui/staff`,
 * `grid-ui`) **s'enregistrent** auprès de `ui/nav` et `ui/blocks` au
 * chargement : la navigation les appelle par leur nom, sans les importer.
 * Le graphe d'imports est ainsi sans cycle. C'est pourquoi `main` importe
 * chaque écran et chaque bloc : ces imports les enregistrent.
 *
 * Les modules hors de `ui/` (sauf `audio`, `storage`, `export` et `main`)
 * sont purs, sans DOM, et testés sous Node (`npm test`).
 */

// En premier : la langue doit être fixée avant que les écrans fabriquent leurs libellés.
import './lang-init.js';
import { state, app } from './ui/state.js';
import { loadAll, flushSave, requestPersistence, getMeta, setMeta } from './storage.js';
import { renderScreen, onHistoryBack } from './ui/nav.js';
import { redrawStaff } from './ui/staff/index.js';
// Imports pour leur effet : chaque module s'enregistre auprès de ui/nav ou ui/blocks.
import './ui/grid-ui.js';
import './ui/home.js';
import './ui/note.js';
import './ui/options.js';
import './ui/training.js';
import './ui/exercises.js';

// Chargement asynchrone (IndexedDB) : `await` au niveau du module. Le reste
// de ce fichier, dont le premier rendu, ne s'exécute qu'une fois le carnet
// chargé. Les modules importés plus haut, eux, sont déjà évalués : ils n'ont
// fait que s'enregistrer, sans rien afficher.
const loaded = await loadAll();
state.notes = loaded.notes;
state.folders = loaded.folders;
// Une note qui référence un dossier disparu redevient non classée.
Object.values(state.notes).forEach((n) => {
  if (n.folder && !state.folders[n.folder]) delete n.folder;
});
// loadAll valide les notes et complète les champs manquants (date de
// création des notes d'avant la 1.7.0). On réécrit tout de suite le résultat
// pour figer ces valeurs : sinon elles seraient recalculées à chaque lancement.
flushSave(state.notes);
if (!getMeta().firstUse) setMeta({ firstUse: Date.now() }); // point de départ du rappel de sauvegarde
if (getMeta().dataVersion !== 2) setMeta({ dataVersion: 2 }); // format 2.0 (dossiers) en place
// Au démarrage on est toujours sur la liste : une entrée d'historique laissée
// par une session précédente (rechargement de la page) est neutralisée.
if (history.state && history.state.inkline) history.replaceState(null, '');
renderScreen();

// Bouton retour d'Android (ou du navigateur) : vers l'écran précédent.
window.addEventListener('popstate', (e) => onHistoryBack(e.state));
requestPersistence();

// Polices web chargées après le premier rendu : les largeurs de texte des SVG
// changent, on redessine une fois.
if (document.fonts && document.fonts.ready)
  document.fonts.ready.then(() => renderScreen({ keepScroll: true }));

// Android peut tuer l'app en arrière-plan : on écrit tout de suite.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave(state.notes, true);
});

// Redimensionnement / rotation : les portées dépendent de la largeur.
// L'ouverture du clavier virtuel change seulement la hauteur : on ne
// redessine que si la largeur a changé (sinon le champ de recherche perdrait
// le focus et le clavier se refermerait aussitôt).
let resizeTimer = null;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view.name !== 'note') {
      if (window.innerWidth === lastWidth || document.getElementById('folderSheet')) return;
      lastWidth = window.innerWidth;
      renderScreen({ keepScroll: true });
      return;
    }
    app.querySelectorAll('[data-staff]').forEach((w) => {
      const el = /** @type {HTMLElement} */ (w);
      if (el.clientWidth !== el._W) redrawStaff(el.dataset.staff);
    });
  }, 150);
});

// Clavier virtuel : par défaut Chrome Android ne redimensionne que le
// « visual viewport », et un élément `position: fixed; bottom: 0` passe sous le
// clavier. On remonte les palettes de la hauteur du clavier. (Dans l'app
// installée, `interactive-widget=resizes-content` règle déjà le problème et
// ce décalage vaut 0.)
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fix = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    ['palette', 'gpal'].forEach((id) => {
      document.getElementById(id).style.bottom = kb + 'px';
    });
  };
  vv.addEventListener('resize', fix);
  vv.addEventListener('scroll', fix);
}

// Hors ligne : uniquement servi en http(s) (pas en file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* hors ligne indisponible, l'app marche quand même */
  });
}
