# Changelog

Toutes les évolutions notables d'Inkline sont listées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions selon [SemVer](https://semver.org/lang/fr/).

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
- Dans une mesure : `/` prolonge l'accord précédent, `NC` indique *no chord*, `%` répète la mesure précédente.
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
