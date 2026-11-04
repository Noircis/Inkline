/**
 * @module main
 * @description
 * **Point d'entrée** d'Inkline, chargé par `index.html` via
 * `<script type="module" src="js/main.js">`.
 *
 * Responsabilités :
 * 1. charger le carnet depuis le stockage ;
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
 *  └─ ui/views ──┬─ ui/staff-ui ── render-staff ── layout ── rhythm ── pitch ── model ── util
 *                ├─ ui/grid-ui ─── grid ── chords
 *                │                 ireal
 *                ├─ audio (rhythm, grid, chords)
 *                ├─ storage, history
 *                └─ ui/state
 * ```
 *
 * Les modules hors de `ui/` (et hors `audio`/`storage`) sont purs et testés sous Node.
 */

import { state, app } from './ui/state.js';
import { loadNotes, flushSave, requestPersistence, getMeta, setMeta } from './storage.js';
import { render, showList } from './ui/views.js';
import { redrawStaff } from './ui/staff-ui.js';

state.notes = loadNotes();
// loadNotes valide les notes et complète les champs manquants (date de
// création des notes d'avant la 1.7.0). On réécrit tout de suite le résultat
// pour figer ces valeurs : sinon elles seraient recalculées à chaque lancement.
flushSave(state.notes);
if (!getMeta().firstUse) setMeta({ firstUse: Date.now() }); // point de départ du rappel de sauvegarde
// Au démarrage on est toujours sur la liste : une entrée d'historique laissée
// par une session précédente (rechargement de la page) est neutralisée.
if (history.state && history.state.inkline) history.replaceState(null, '');
render();

// Bouton retour d'Android (ou du navigateur) : d'un sous-écran vers la liste.
window.addEventListener('popstate', () => { if (state.view.name !== 'list') showList(); });
requestPersistence();

// Polices web chargées après le premier rendu : les largeurs de texte des SVG
// changent, on redessine une fois.
if (document.fonts && document.fonts.ready) document.fonts.ready.then(render);

// Android peut tuer l'app en arrière-plan : on écrit tout de suite.
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(state.notes); });

// Redimensionnement / rotation : les portées dépendent de la largeur.
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view.name !== 'note') { render(); return; }
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
    ['palette', 'gpal'].forEach((id) => { document.getElementById(id).style.bottom = kb + 'px'; });
  };
  vv.addEventListener('resize', fix);
  vv.addEventListener('scroll', fix);
}

// Hors ligne : uniquement servi en http(s) (pas en file://).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors ligne indisponible, l'app marche quand même */ });
}
