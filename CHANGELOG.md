# Changelog

Toutes les évolutions notables d'Inkline sont listées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

## [2.4.1] - 2026-11-06

### Corrigé

- **Doubles croches en swing** (signalé par un utilisateur) : à l'écoute, quatre doubles croches sur un temps étaient jouées inégales (1/3, 1/3, 1/6, 1/6 du temps), parce que la déformation du swing, pensée pour les croches, s'appliquait aussi à elles. Désormais, le swing ne s'applique qu'aux temps écrits en croches ; un temps qui contient des doubles croches (ou une croche pointée suivie d'une double) est joué droit, comme on le fait en jazz pour un passage en doubles. L'écriture n'est pas concernée.

### Développement

- `rhythm.straightBeats` : temps à jouer droits malgré le swing. 1 test de plus, 65 au total.

## [2.4.0] - 2026-11-06

Entraînement rythmique : séries, swing et métronome.

### Ajouté

- **Séries** : les placements sont regroupés selon la position de la première note, chaque série sur une seule portée (plusieurs lignes si besoin) dans une carte numérotée. Avec une seule note par mesure, les 8 placements forment une seule série.
- **Écouter** joue toute la série.
- **Swing** : les croches sont jouées swing.
- **Métronome** :
  - tu choisis les temps qui cliquent (1, 2, 3, 4 ; par exemple seulement 2 et 4) ;
  - accent sur le 1 (optionnel) ;
  - mesure de décompte avant de démarrer (optionnelle) ;
  - « Couper le rythme » : seul le métronome joue, pour jouer les rythmes soi-même. La lecture continue de surligner les notes.
- Tous ces réglages sont mémorisés.

### Modifié

- Le comptage « 1 et 2 et… » au-dessus des mesures est retiré.
- Le clic de métronome a un son distinct de celui des lignes rythmiques.

### Corrigé

- Le bouton « Swing » des portées dans les notes avait repris, depuis la 2.0, le style des puces de dossiers (fond sombre). Il retrouve son style d'origine.

### Développement

- `audio.playStaff` accepte des options de lecture (décompte, temps du métronome, accent, rythme coupé).
- `placements.js` : `groupSeries`, `placementSeries`, `seriesBlock`. 2 tests de plus, 64 au total.

## [2.3.0] - 2026-11-06

Première brique de l'**entraînement** : les placements rythmiques.

### Ajouté

- **Section Entraînement**, ouverte par l'icône de métronome sur l'accueil. Elle regroupera les exercices ; le premier est Rythme › Placements.
- **Placements** : tu choisis le nombre de notes par mesure (1 à 8) et l'appli génère toutes les façons de les placer sur les 8 croches d'une mesure de 4/4 (8 placements pour une note, 28 pour deux, 56 pour trois, 70 pour quatre…).
  - Écriture d'usage : noire sur le temps, demi-soupir + croche sur le contretemps, deux croches ligaturées sur un temps plein, pas de syncope, demi-pause seulement sur les temps 1-2 ou 3-4.
  - Chaque placement affiche le comptage (« 1 et 2 et… ») avec les positions jouées en gras, et peut être écouté au tempo choisi.
  - Le nombre de notes et le tempo sont mémorisés.
  - Doubles croches et triolets sont annoncés (« bientôt »), pas encore disponibles.
- Le bouton retour d'Android remonte d'un écran à la fois (Placements → Entraînement → accueil).

### Développement

- `js/placements.js` : génération des combinaisons et règles d'écriture, en fonctions pures.
- `js/ui/training.js` : écrans Entraînement et Placements.
- Mise en page : option `justify` pour étirer une mesure sur toute la largeur (utilisée par les placements, sans effet sur les notes).
- Navigation : écrans enfants (`goChild`) et historique qui mémorise l'écran.
- 4 tests (`tests/placements.test.js`), dont la vérification que chacune des 255 mesures générées dure exactement 4 temps. 62 tests au total.

## [2.2.0] - 2026-11-04

Blocs longs réduits : une longue portée ou une longue grille ne prend plus tout l'écran.

### Ajouté

- **Réduire un bloc long** : une portée, une ligne rythmique ou une grille de 5 lignes ou plus a un bouton « Réduire ▴ ». Réduite, elle n'affiche que ses 3 premières lignes, avec un fondu et un bouton « Afficher tout · N lignes ▾ ».
- **Option « Réduire automatiquement les blocs longs »** (Options › Affichage), désactivée par défaut. Un choix fait à la main sur un bloc (déplier ou réduire) l'emporte toujours sur l'option.
- Toucher un bloc réduit l'ouvre en édition : il s'affiche en entier tant qu'on l'édite, et aucune note n'est posée par erreur. Avec l'option automatique, il se réduit de nouveau quand on passe à autre chose.
- Un bloc réduit peut être écouté sans être déplié.

### Détails

- L'état réduit est mémorisé dans la note, sans changer sa date de modification, et n'est pas modifié par « Annuler ».
- Il n'est pas transmis dans un fichier `.inkline` partagé : chez le destinataire, c'est son option qui décide.
- Les exports PNG et PDF montrent toujours les blocs en entier.

### Développement

- `js/folding.js` (règle de décision, pure et testée) et `js/ui/fold.js` (bouton, fondu, interception des touchers).
- 3 tests (`tests/folding.test.js`). 58 tests au total.

## [2.1.0] - 2026-11-04

Nouveau stockage : le carnet passe de `localStorage` à IndexedDB. Rien ne change à l'écran.

### Modifié

- **Stockage dans IndexedDB** : une entrée par note et par dossier, au lieu d'une seule chaîne JSON pour tout le carnet.
  - Capacité : des centaines de Mo au lieu d'environ 5 Mo.
  - Rapidité : une modification n'écrit plus que la note concernée, au lieu de réécrire tout le carnet à chaque frappe.
  - Quand l'app passe en arrière-plan, l'écriture attend que les données soient physiquement sur le disque.
- Les Options (À propos) indiquent le stockage utilisé.

### Migration

- Automatique au premier lancement : notes et dossiers sont copiés de `localStorage` vers IndexedDB en une seule transaction (tout ou rien). Si l'app est fermée pendant la copie, elle recommence au lancement suivant.
- La copie n'a lieu que vers une base vide : des données déjà présentes dans IndexedDB ne sont jamais écrasées.
- L'ancien carnet reste dans `localStorage`, intact, comme filet de sécurité.
- Si IndexedDB est indisponible, l'app continue avec `localStorage`, comme avant.

### Ajouté (développement)

- `js/db.js` : petite couche au-dessus d'IndexedDB (ouverture, lecture, écriture en transaction), documentée pour les débutants.
- 6 tests (`tests/storage-idb.test.js`) : migration, base déjà remplie jamais écrasée, écriture ciblée, suppressions, dossiers, repli sur `localStorage`. 55 tests au total. Dépendance de développement : `fake-indexeddb`.

## [2.0.0] - 2026-11-04

Organisation des notes : dossiers, recherche, tri, épingles.

### Ajouté

- **Dossiers** : une barre de dossiers défile en haut de l'accueil (`Toutes · tes dossiers · Non classées · +`), avec le nombre de notes de chacun et une pastille de couleur (8 couleurs, adaptées au mode sombre).
  - Créer un dossier : `+` dans la barre, « + Nouveau dossier » dans les Options ou dans le sélecteur d'une note.
  - Modifier ou supprimer : toucher de nouveau le dossier sélectionné, « Modifier » au-dessus de la liste, ou la section Dossiers des Options. Supprimer un dossier ne supprime aucune note : elles passent dans « Non classées ».
  - Une note créée depuis un dossier est rangée dedans.
- **Sélecteur « Dossier »** sous le titre de chaque note.
- **Épingle** dans l'en-tête d'une note : les notes épinglées restent en tête de liste, quel que soit le tri.
- **Recherche** dans toutes les notes : titres, textes et accords (grilles et accords des portées). Insensible à la casse et aux accents ; `B♭7` et `Bb7` sont équivalents. Tous les mots tapés doivent être présents.
- **Tri** sur l'accueil : modifiées récemment, créées récemment ou titre (A → Z). Le choix est mémorisé pour chaque dossier.
- Les cartes, la mosaïque et la liste indiquent le dossier de chaque note (dans « Toutes » et dans les résultats de recherche) et les notes épinglées.
- Section **Dossiers** dans les Options.

### Modifié

- **Sauvegarde du carnet, format 2** : elle contient maintenant les dossiers. Les sauvegardes des versions précédentes restent importables. Importer une sauvegarde ajoute les dossiers manquants sans modifier ceux qui existent.
- **Une note partagée (.inkline) ne transporte ni son dossier ni son épingle** : chez le destinataire, elle arrive dans « Non classées ».
- Ranger une note (dossier, épingle) ne change pas sa date de modification.
- **Architecture de l'interface** : fin des imports circulaires. Les écrans (accueil, note, options) et les blocs musicaux s'enregistrent auprès de deux registres (`ui/nav`, `ui/blocks`) ; l'ancien `ui/views.js` est découpé en `ui/home`, `ui/note`, `ui/nav`, `ui/blocks`, `ui/common`, `ui/icons` et `ui/folder-sheet`.
- Choisir deux fois le même fichier à importer fonctionne (le sélecteur de fichier est remis à zéro).

### Migration

- Automatique et sans perte : au premier lancement de la 2.0, toutes les notes existantes sont « non classées ». Le format des notes est inchangé (deux champs optionnels en plus : `folder`, `pinned`).

### Tests

- 12 nouveaux tests (`tests/folders-search.test.js`) : dossiers, recherche, tri, validation des dossiers importés, sauvegarde v2 (aller-retour), import d'une sauvegarde v1, note partagée sans rangement. 49 tests au total.

## [1.7.5] - 2026-11-04

Version technique : aucune nouvelle fonctionnalité, l'app se comporte exactement comme la 1.7.0.

### Modifié

- **Lisibilité du code** :
  - formatage automatique de tout le code (Prettier) : une instruction par ligne, lignes de 110 caractères au plus ;
  - découpage des fonctions les plus longues en étapes nommées : rendu des portées (`staffSvg`, une fonction par couche de dessin), mise en page (`layout`), grille du mode écran (`gridBlockEl`) et de l'export (`gridSvg`) ;
  - noms de variables explicites et constantes nommées à la place des nombres magiques ;
  - commentaires et graphe des modules mis à jour.
- Les fonctions internes ne sont plus exportées : l'interface publique de chaque module se limite à ce qui sert ailleurs.
- Outils de développement : `npm run lint` (ESLint), `npm run format` (Prettier), `npm run check` (tout d'un coup).

### Supprimé

- CSS mort hérité des anciennes versions (section « Sauvegarde » de l'accueil, numéro de version de l'accueil, séparateur de palette inutilisé).
- Une ligne redondante dans l'import iReal.

### Corrigé

- Message périmé après l'import d'une playlist dans une grille : la playlist s'importe depuis les Options, plus depuis l'accueil.
- L'export en image ne dépend plus de la mise en forme exacte de `css/fonts.css` (un reformatage du fichier faisait perdre les polices dans les images exportées).

### Tests

- 37 tests (3 nouveaux : décodage iReal direct, pagination du PDF, lecture des polices).
- Vérification de non-régression : sorties des moteurs de rendu identiques au caractère près à la 1.7.0 sur 86 cas ; export PNG et PDF identiques au pixel près.

## [1.7.0] - 2026-11-04

### Ajouté

- **Trois affichages de la liste**, au choix dans Options > Affichage des notes (choix mémorisé) :
  - **Cartes** : l'affichage habituel ;
  - **Mosaïque** : cartes carrées, 2 par ligne, avec un aperçu adapté au contenu (début de la portée en zoom, premiers accords d'une grille, ou début du texte) ;
  - **Liste** : une ligne par note, avec titre, date de modification, date de création et résumé du contenu.
- **Date de création** des notes, remplie automatiquement. Les notes existantes la reçoivent au premier lancement (approximée par leur date de modification, puis figée). Une note reçue garde sa date de création d'origine.
- Les exports PNG et PDF affichent la date de création.

## [1.6.1] - 2026-11-04

### Corrigé

- Mise à jour de l'app : le service worker pouvait reprendre d'anciens fichiers dans le cache HTTP du navigateur (GitHub Pages les garde 10 minutes), et l'app restait sur l'ancienne version. Le préchargement passe maintenant toujours par le réseau.

## [1.6.0] - 2026-11-04

### Ajouté

- **Écran Options** (roue crantée sur l'accueil) : exporter et importer le carnet, importer depuis iReal Pro, version, nouveautés et documentation du code.
- **Rappel de sauvegarde** : la date de la dernière sauvegarde est affichée dans les Options, et un point apparaît sur la roue crantée après 30 jours sans export.
- **Bouton retour d'Android** : il ramène d'une note ou des Options à la liste au lieu de fermer l'app.

### Modifié

- L'accueil ne montre plus que les notes : les sections « Sauvegarde » et « iReal Pro » ont rejoint les Options.
- Le bouton iReal de chaque grille (export de la grille) reste dans le bloc.

## [1.5.0] - 2026-11-04

### Ajouté

- **Partager une note** (bouton « Partager » en haut de chaque note) :
  - **Fichier Inkline** (`.inkline`, par défaut) : la note reste modifiable et écoutable chez la personne qui la reçoit ;
  - **Image PNG** : la note entière (titre, textes, portées, grilles), lisible sans l'app ;
  - **PDF A4** : pages coupées entre deux blocs quand c'est possible.
  - Sur Android, le menu de partage du téléphone s'ouvre (WhatsApp, Messages, mail…) ; sinon le fichier est téléchargé.
- **Importer une note reçue** : le bouton « Importer un fichier » de l'accueil accepte les `.inkline` ; la note est ajoutée (jamais écrasée) puis ouverte.

### Sécurité

- Toute donnée importée (note reçue, sauvegarde, lien iReal) ou relue du stockage est **validée** champ par champ ; un fichier piégé ne peut plus injecter de code.
- **Échappement systématique** de toutes les valeurs insérées dans le HTML et le SVG.
- **Content Security Policy** : seuls les scripts de l'app peuvent s'exécuter.
- Les **polices sont hébergées dans le dépôt** : l'app ne contacte plus Google Fonts (ni aucun autre serveur), et fonctionne entièrement hors ligne.

### Modifié

- « Exporter » sur l'accueil devient « Exporter le carnet » (sauvegarde complète), « Importer » devient « Importer un fichier ».

## [1.4.0] - 2026-11-04

### Ajouté

- **Liaisons de prolongation** (bouton ‿) : deux notes liées sont jouées comme une seule note tenue. Elles sont dessinées du côté opposé aux hampes, y compris par-dessus une barre de mesure ou un retour à la ligne (deux demi-liaisons).
  - Note sélectionnée : ‿ la lie à la suivante, qui prend la même hauteur.
  - Sans sélection : la prochaine note ajoutée prolonge la dernière (la hauteur touchée est ignorée).
  - Une note liée garde la hauteur de la précédente, altérations comprises, même dans la mesure suivante.
- **Triolets** (bouton 3) : 3 notes dans le temps de 2, de la croche à la noire, groupes mixtes acceptés (noire + croche). Crochet « 3 » au-dessus du groupe, ligature propre au triolet, lecture exacte.
  - Le swing ne déforme pas les triolets.
- Documentation du code générée avec JSDoc (dossier `docs/`), avec le README comme page d'accueil.
- Tests unitaires (`npm test`, 24 tests sur le rythme, les hauteurs, la mise en page, les grilles et iReal).
- `README.md` : architecture, arborescence, procédure de publication.

### Modifié

- **Refonte du code** : le fichier unique est découpé en modules ES natifs (`js/`), commentés en JSDoc, toujours sans framework ni étape de build. La logique musicale (modules purs) est séparée de l'interface (`js/ui/`).
- L'application s'appelle désormais **Inkline** (titre, icône installée).
- Palette de portée : annuler et effacer remontent sur la ligne du haut, pour faire de la place à ‿ et 3.
- Supprimer une note retire la liaison qui y menait ; déplacer une note liée entraîne les notes qui lui sont liées.

### Compatibilité

- Les notes existantes sont conservées (même stockage, format rétrocompatible).

## [1.3.0] - 2026-11-04

### Ajouté

- Bloc **Grille** (style iReal Pro), à côté de Texte, Portée et Rythme : 4 mesures par ligne, accords chiffrés avec qualités en exposant (Δ, –, ø, °, alt…).
- Saisie rapide des accords : on tape les accords d'une mesure séparés par des espaces, Entrée passe à la mesure suivante, et `|` remplit plusieurs mesures d'un coup (`F7|Bb7|F7|Cm7 F7`).
- Dans une mesure : `/` prolonge l'accord précédent, `NC` indique _no chord_, `%` répète la mesure précédente.
- Repères de structure : sections (A, B, C, D, Intro), 1re et 2e fins (volta), reprises, double barre et barre de fin.
- Réglages de la grille : tonalité (majeure ou mineure), mesure, style, tempo.
- Lecture audio de la grille (basse + accords, charleston sur 2 et 4 dans les styles swing). Les reprises et les 1re et 2e fins sont respectées.
- **Export vers iReal Pro** : bouton « Ouvrir dans iReal Pro » (lien `irealb://`) et « Copier le lien ».
- **Import depuis iReal Pro** : collage d'un lien `irealb://` ou `irealbook://`, ou ouverture du fichier `.html` partagé par iReal Pro. Depuis l'accueil, une playlist entière crée une note par morceau.
- Accords non reconnus soulignés en rouge pendant la saisie.
- Numéro de version affiché en bas de l'accueil.

### Modifié

- Les palettes de saisie restent au-dessus du clavier Android au lieu d'être cachées dessous.
- Les boutons d'ajout de bloc tiennent sur une seule ligne (4 boutons).

## [1.2.1] - 2026-11-04

### Modifié

- Justification automatique : avec une barre de fin, la dernière ligne s'étire jusqu'au bord si elle occupe déjà plus de 50 % de la largeur.
- Les lignes de la portée s'arrêtent à la barre de fin au lieu de continuer jusqu'au bord.

## [1.2.0] - 2026-11-03

### Ajouté

- Barres de mesure : simple, double, barre de fin, début et fin de reprise. Une barre posée ferme la mesure même si elle est incomplète.
- Après une barre de fin, aucune nouvelle mesure n'est proposée (fin de motif).
- Lecture audio des reprises (la section est jouée deux fois).

### Modifié

- Les altérations sont réinitialisées à chaque barre de mesure.

## [1.1.0] - 2026-11-03

### Modifié

- Mode silence plus lisible : quand il est actif, les boutons de durée affichent pause, demi-pause, soupir, demi-soupir et quart de soupir.

## [1.0.0] - 2026-11-03

### Ajouté

- Première version : notes composées de blocs texte, portée (clé de sol ou de fa) et ligne rythmique.
- Saisie des notes au toucher sur la portée : durées de la ronde à la double croche, points, silences, altérations.
- Accords chiffrés au-dessus des notes, ligatures automatiques des croches et doubles croches.
- Lecture audio avec tempo et option swing.
- Application installable, fonctionnement hors ligne, notes stockées sur le téléphone, export et import d'une sauvegarde `.json`.
