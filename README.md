# Inkline

Carnet de notes musicales pour téléphone Android : du texte, des portées, des lignes rythmiques et des grilles d'accords dans une même note, saisis au doigt et écoutables.

Application web progressive (PWA) **sans framework ni étape de build** : des modules ES natifs servis tels quels, installables et utilisables hors ligne.

## Démarrage

```bash
npm install        # uniquement pour les outils de dev (JSDoc)
npm test           # tests unitaires (node:test, aucune dépendance)
npm run docs       # génère la documentation dans docs/
npm run serve      # sert l'app sur http://localhost:8080
```

L'app elle-même n'a besoin d'aucune installation : n'importe quel serveur statique HTTPS convient (GitHub Pages, par exemple).

## Arborescence

```
index.html            balisage des palettes, chargement de js/main.js
css/app.css           feuille de style unique (thème clair/sombre par jetons)
sw.js                 service worker (hors ligne)
manifest.webmanifest  nom, icônes, mode « standalone »
js/
  main.js             point d'entrée
  util.js             utilitaires (uid, mod, échappement…)
  model.js            types de données (@typedef) et fabriques
  pitch.js            position sur la portée ↔ hauteur MIDI, altérations, liaisons
  rhythm.js           mesures, triolets, ligatures, reprises, swing, événements sonores
  layout.js           mise en page d'une portée (coupure de lignes, justification)
  render-staff.js     rendu SVG d'une portée
  chords.js           analyse des accords chiffrés, voicings
  grid.js             grilles d'accords : saisie, durées, ordre de lecture, rendu HTML
  ireal.js            import/export iReal Pro (irealb://)
  audio.js            synthé et séquenceur Web Audio
  storage.js          localStorage, sauvegarde/restauration JSON
  history.js          annulation (instantanés)
  ui/
    state.js          état de l'interface
    views.js          écrans liste et note, gestion des blocs
    staff-ui.js       bloc portée : toucher, palette
    grid-ui.js        bloc grille : saisie, palette, panneau iReal
tests/                tests unitaires des modules purs
docs/                 documentation générée (npm run docs)
```

## Architecture

Le code est séparé en deux couches :

- **Modules purs** (`model`, `pitch`, `rhythm`, `layout`, `render-staff`, `chords`, `grid`, `ireal`) : pas de DOM, pas d'effet de bord, testés sous Node. Ils contiennent toute la logique musicale.
- **Interface** (`ui/*`, `audio`, `storage`, `main`) : branche la logique sur le navigateur.

Le rendu suit un modèle *immediate mode* : l'état est modifié, puis la partie concernée de l'écran est régénérée (template strings → `innerHTML`, SVG en chaîne). Pas de DOM virtuel ni de réactivité : à cette échelle, c'est le plus simple, et c'est assez rapide.

Le moteur de mise en page (`layout`) est utilisé **à la fois** par le rendu et par le hit-testing : ce que l'on voit et ce que l'on touche sont calculés par la même fonction.

## Données

Voir le module `model` pour le détail des types. En bref :

- une note = une liste de blocs (texte, portée, grille) ;
- une hauteur est stockée en **position sur la portée** (ce que l'on touche), convertie en MIDI à la demande ;
- les durées sont en **noires** (point ×1.5, triolet ×2/3) ;
- les champs optionnels sont absents plutôt que `false`.

Le format est rétrocompatible : une note créée en 1.0 s'ouvre en 1.4.

## Publier une nouvelle version

1. Mettre à jour `APP_VERSION` dans `js/ui/views.js`, `version` dans `package.json` et `CACHE` dans `sw.js`.
2. Ajouter l'entrée correspondante dans `CHANGELOG.md`.
3. `npm test`, puis `npm run docs`.
4. Pousser sur la branche publiée par GitHub Pages.

Sur le téléphone, la nouvelle version s'affiche à la **deuxième** ouverture de l'app (stratégie *stale-while-revalidate* du service worker).
