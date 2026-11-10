# Inkline

Carnet de notes musicales pour téléphone Android : du texte, des portées, des lignes rythmiques et des grilles d'accords dans une même note, saisis au doigt et écoutables.

Application web progressive (PWA) **sans framework ni étape de build** : des modules ES natifs servis tels quels, installables et utilisables hors ligne.

## Démarrage

```bash
npm install        # outils de développement uniquement (JSDoc, Prettier, ESLint, Playwright…)
npm test           # tests unitaires (node:test)
npm run test:e2e   # tests d'interface dans un vrai navigateur (Playwright)
npm run lint       # analyse du code (ESLint)
npm run format     # formatage automatique (Prettier)
npm run check      # format + lint + tests : à lancer avant chaque commit
npm run docs       # génère la documentation dans docs/
npm run dev        # aperçu en direct sur http://localhost:5500 (rechargement automatique)
```

La première fois sur un ordinateur, avant `npm run test:e2e` : `npx playwright install chromium` (télécharge le navigateur des tests).

L'app elle-même n'a besoin d'aucune installation : n'importe quel serveur statique HTTPS convient (GitHub Pages, par exemple).

## Environnement de développement

Le projet est réglé pour **Visual Studio Code** (dossier `.vscode/`, partagé dans le dépôt) : à l'ouverture, VS Code propose les extensions conseillées, **ESLint** (erreurs soulignées en direct) et **Prettier** (formatage à chaque enregistrement, avec les réglages du projet).

**Aperçu en direct** : `npm run dev` (dans le terminal de VS Code, Ctrl+ù), puis ouvrir `http://localhost:5500/`. Chaque enregistrement recharge la page.

- Dans VS Code même : Ctrl+Maj+P › « Simple Browser: Show » › `http://localhost:5500/`, puis glisser l'onglet à côté du code.
- Le serveur de développement (`scripts/dev.mjs`, sans dépendance) neutralise le service worker : pas de version en cache à purger.
- L'extension « Live Server » ne convient pas : elle injecte un script dans la page, que la Content Security Policy bloque.
- Pour simuler un téléphone : outils de développement de Chrome (F12) › icône téléphone/tablette.
- Pour déboguer sur un vrai téléphone Android (débogage USB activé) : `chrome://inspect` dans Chrome sur l'ordinateur.

## Tests et intégration continue

- **Tests unitaires** (`tests/*.test.js`, `npm test`) : les modules purs (rythme, mise en page, mise en mesure, accords, iReal, stockage…), dont un test aléatoire sur la mise en mesure.
- **Tests d'interface** (`tests/e2e/*.spec.js`, `npm run test:e2e`) : Playwright pilote un vrai Chromium au format téléphone et rejoue les parcours importants (saisie sur une portée, modes, mise en mesure, dossiers, recherche, sauvegarde, blocs réduits, partage, entraînement, hors ligne). Les coordonnées des touchers sont calculées par le moteur de mise en page de l'appli : les tests ne dépendent pas des pixels. Le serveur est lancé tout seul (`scripts/dev.mjs --static`).
- **Intégration continue** (`.github/workflows/check.yml`) : à chaque push, GitHub lance `npm run check` puis les tests d'interface. Résultat dans l'onglet **Actions** du dépôt, et en coche verte ou croix rouge à côté de chaque commit. En cas d'échec, les captures et traces sont jointes au rapport.

## Conventions de code

- **Formatage** : Prettier (`.prettierrc.json`), lignes de 110 caractères au plus. Ne pas formater à la main : `npm run format`.
- **Analyse** : ESLint (`eslint.config.js`), règles recommandées + variables inutilisées, `===`, `const`.
- **Exports** : un module n'exporte que ce qui est utilisé ailleurs ou testé ; le reste est privé et apparaît dans la doc comme membre interne (`~`).
- **Commentaires** : JSDoc en français sur chaque module et chaque fonction ; les algorithmes sont expliqués en tête de fonction.
- **Fonctions longues** : découpées en étapes nommées (par exemple `render-staff` : une fonction par couche de dessin).

## Arborescence

```
index.html            balisage des palettes, CSP, chargement de js/main.js
css/*.css             feuilles de style par zone (ordre et thème : voir css/base.css)
css/fonts.css         déclaration des polices hébergées
fonts/                polices woff2 (licence SIL OFL)
sw.js                 service worker (hors ligne)
manifest.webmanifest  nom, icônes, mode « standalone »
icon-*.png, apple-touch-icon.png, inkline-icon*.svg   icônes (any, maskable, iOS, SVG source)
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
  storage.js          enregistrement du carnet, migration, sauvegarde/restauration, fichiers .inkline
  db.js               petite couche au-dessus d'IndexedDB (ouvrir, lire, écrire en transaction)
  sanitize.js         validation des données importées (liste blanche)
  folders.js          dossiers : modèle, sélection, compteurs, suppression
  search.js           recherche (titres, textes, accords) et tri
  folding.js          règle d'affichage réduit des blocs longs
  placements.js       entraînement rythmique : mesures, écriture des placements, séries
  exercise.js         exercices rythmiques aléatoires (tirage reproductible par numéro)
  transpose.js        instruments transpositeurs : réécrire une portée pour un autre instrument
  chord-keys.js       clavier d'accords : effet de chaque touche
  measure-fit.js      mise en mesure : liaisons automatiques aux barres, compensation par des silences
  export.js           partage d'une note : .inkline, PNG, PDF
  pdf.js              générateur PDF minimal (images JPEG)
  history.js          annulation (instantanés)
  ui/
    state.js          état de l'interface
    nav.js            registre des écrans, navigation, bouton retour d'Android
    blocks.js         registre des blocs musicaux, bloc actif, annulation
    common.js         version, petits outils d'interface partagés
    icons.js          pictogrammes SVG
    home.js           accueil : recherche, barre de dossiers, tri, liste
    note.js           écran note : titre, dossier, épingle, blocs, partage
    folder-sheet.js   éditeur de dossier (panneau du bas)
    fold.js           blocs longs réduits : bouton, fondu, toucher
    training.js       écrans Entraînement et Placements
    exercises.js      écrans des exercices aléatoires (réglages, lecture)
    drill-kit.js      pièces communes de l'entraînement (réglages, métronome, lecture)
    measure-select.js sélection de mesures à l'appui long (jouer d'ici, boucle)
    chord-keyboard.js clavier d'accords à l'écran (grille, accord d'une note)
    staff/            bloc portée : index (enregistrement), view (en-tête, dessin),
                      input (toucher, modes), palette, bars, chord, shared (socle commun)
    grid-ui.js        bloc grille : saisie, palette, panneau iReal
    options.js        écran Options : affichage, dossiers, sauvegarde, import, iReal, à propos
    list-view.js      affichages de la liste : Cartes, Mosaïque, Liste
tests/                tests unitaires des modules purs
docs/                 documentation générée (npm run docs)
```

## Architecture

Le code est séparé en deux couches :

- **Modules purs** (`model`, `pitch`, `rhythm`, `layout`, `render-staff`, `chords`, `grid`, `ireal`, `folders`, `search`, `folding`, `placements`, `exercise`, `transpose`, `measure-fit`) : pas de DOM, pas d'effet de bord, testés sous Node. Ils contiennent toute la logique musicale et d'organisation.
- **Interface** (`ui/*`, `audio`, `storage`, `main`) : branche la logique sur le navigateur.

Les écrans (`ui/home`, `ui/note`, `ui/options`) et les blocs musicaux (`ui/staff`, `ui/grid-ui`) **s'enregistrent** au chargement auprès de deux registres, `ui/nav` et `ui/blocks`, qui les appellent ensuite par leur nom. Ces registres n'importent aucun écran : le graphe d'imports est sans cycle (voir le module `main`).

Le rendu suit un modèle _immediate mode_ : l'état est modifié, puis la partie concernée de l'écran est régénérée (template strings → `innerHTML`, SVG en chaîne). Pas de DOM virtuel ni de réactivité : à cette échelle, c'est le plus simple, et c'est assez rapide.

Le moteur de mise en page (`layout`) est utilisé **à la fois** par le rendu et par le hit-testing : ce que l'on voit et ce que l'on touche sont calculés par la même fonction.

## Sécurité

L'app n'a ni serveur ni compte : la seule entrée non fiable, ce sont les **fichiers importés** (note reçue, sauvegarde, lien iReal). Trois couches indépendantes :

1. **Validation** (`sanitize`) : toute donnée importée ou chargée est reconstruite champ par champ à partir d'une liste blanche (types, énumérations, bornes, longueurs) ; les identifiants invalides sont régénérés.
2. **Échappement** : toute valeur insérée dans du HTML ou du SVG passe par `esc()` ; les sélecteurs CSS par `CSS.escape()`.
3. **Content Security Policy** (`index.html`) : seuls les fichiers `.js` de l'app peuvent s'exécuter ; aucune origine tierce n'est contactée.

`tests/security-export.test.js` vérifie qu'un fichier piégé est neutralisé.

## Données

Voir le module `model` pour le détail des types. En bref :

- une note = une liste de blocs (texte, portée, grille) ;
- une hauteur est stockée en **position sur la portée** (ce que l'on touche), convertie en MIDI à la demande ;
- les durées sont en **noires** (point ×1.5, triolet ×2/3) ;
- les champs optionnels sont absents plutôt que `false`.

Le format est rétrocompatible : une note créée en 1.0 s'ouvre dans la dernière version. Chaque note porte une date de création (`created`) et de modification (`updated`) ; pour les notes antérieures à la 1.7.0, la date de création a été initialisée avec la date de modification.

Depuis la 2.0, une note peut porter `folder` (id de dossier) et `pinned`. Les dossiers `{ id, name, color, created }` sont stockés à part ; une note sans dossier, ou dont le dossier a disparu, est « non classée ».

Une note partagée est un fichier `.inkline` : du JSON `{ app: 'inkline', kind: 'note', version: 1, note }`, **sans** `folder` ni `pinned` (le rangement reste chez soi).

Une sauvegarde est du JSON `{ app, version: 2, exported, notes, folders }` ; les sauvegardes `version: 1` (sans dossiers) restent importables.

## Stockage

Depuis la 2.1, le carnet est enregistré dans **IndexedDB** (base `inkline`, magasins `notes` et `folders`, une entrée par note et par dossier). Les métadonnées (affichage, dossier sélectionné, tris, date de dernière sauvegarde) restent dans `localStorage` (clé `inkline-meta`).

- **Migration** : au premier lancement de la 2.1, le carnet de `localStorage` (clés `carnet-portees-v1` et `inkline-folders`) est copié en une transaction, seulement si la base est vide. L'ancienne copie est conservée, figée à la date de la migration.
- **Écritures** : seule la note modifiée est écrite ; après une opération groupée, une comparaison avec la dernière version écrite (JSON) détecte toutes les modifications et suppressions.
- **Repli** : si IndexedDB est indisponible, l'app fonctionne comme avant avec `localStorage`. Les Options indiquent le stockage utilisé (À propos).
- **Tests** : `tests/storage-idb.test.js` utilise `fake-indexeddb`, une implémentation en mémoire d'IndexedDB pour Node.

## Publier une nouvelle version

1. Mettre à jour `APP_VERSION` dans `js/ui/common.js`, `version` dans `package.json` et `CACHE` dans `sw.js`.
2. Ajouter l'entrée correspondante dans `CHANGELOG.md`.
3. `npm test`, puis `npm run docs`.
4. Pousser sur la branche publiée par GitHub Pages.

Sur le téléphone, la nouvelle version s'affiche à la **deuxième** ouverture de l'app (stratégie _stale-while-revalidate_ du service worker).
