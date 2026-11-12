# Changelog

All notable changes to Inkline are listed here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [SemVer](https://semver.org/).
Entries are written in English since 2.9.1; earlier entries are kept in French, as they were published.

## [2.15.1] - 2026-11-12

### Added

- **Metronome: quintuplets, sextuplets and septuplets** (5, 6 and 7 clicks per beat), with a level bar per click like the others.

### Changed

- The subdivision choices are now numbered by **clicks per beat**, 1 to 7, in the body font: no more note glyphs, which Android drew as colored emoji.
- The **dotted eighth and sixteenth** choice is gone: it played the same as eighths with swing at 75 %, now labelled "dotted" on the swing slider. Settings and presets that used it are converted.

## [2.15.0] - 2026-11-12

### Added

- **Metronome from a block.** Staff and chart headers get a metronome button, next to Listen. It opens the metronome on the block's time signature and tempo (6/8 at ♩ = 90 becomes ♩. = 60) and its swing (eighths at 67 %; a chart swings when its style does). A banner says so, with **Undo** to get the previous settings back.
- **Metronome settings in a note.** Opened from a note, the main page has a **Save to the note** button. Open the metronome from that note later and its settings come back, with the same banner and Undo. The button turns into "Saved in the note" when nothing changed, "Update the note" otherwise; ✕ removes the settings from the note. They travel with a shared note.
- **Polyrhythm**, on a new page: a second voice plays 2 to 16 even hits over 1 to 4 bars, on top of the pulses (3 over one bar of 4/4 is 3:4, 5 over two bars is 5:8). Its own sound, a level bar per hit (tap to mute, slide to set). On the main page, a row of small lights under the bars follows the hits. A hit on a silenced pulse is silent too.
- **Lock-screen player** (experimental): while the metronome plays, a looping near-silent audio file gives Android its media player on the lock screen, with play/pause and ⏮ ⏭ for tempo −5 / +5.

### Technical

- `fromBlock`, `polyHits`, `withPoly`, `sameAsStored` in `metronome.js`; a looping cycle lasts a common multiple of the silence cycle and the polyrhythm bars. `note.metro` is validated field by field in `sanitize.js`.
- CSP: `media-src 'self' blob:` for the in-memory silent WAV.

## [2.14.0] - 2026-11-12

### Added

- **Metronome: Silences**, to work on the inner tempo. The click stops, you keep going alone, and when it comes back you hear whether you drifted. Four modes on the new Silences page:
  - **Off**;
  - **Whole bars**: X bars with click, Y without (1 to 8 each);
  - **Random**: 10 to 90 % of the pulses silenced at random (a silenced pulse takes its subdivisions with it);
  - **Growing**: random silences going from one share to another (0 % to 70 %…) over 1 to 30 minutes, then staying there.
    The lights go on in grey during the silence.
- **Metronome: Tempo ramp** (speed trainer), on the new Ramp page: from the tempo of the main page to a target, by steps (+4 every 4 bars…), going up or down. At the end: stay at the target, start again, or stop. During the ramp, the big number and the mini-bar show the tempo playing, with a progress bar on the main page. Setting the tempo by hand starts the ramp again from there.
- Silences and ramp can be combined.

### Changed

- "Every other bar" leaves the Jazz page: "once per bar" plus Silences 1 + 1 does the same. Settings saved with it are converted.

### Technical

- The engine still loops one pre-rendered cycle when it can (whole-bar silences included). With a ramp or random silences, every bar differs: it plans the bars (`planBar`) and renders them by chunks of about 4 s, scheduled at exact audio times, 12 s ahead while the page is visible and 80 s once hidden (Chrome may then run timers only once a minute). A change drops what comes after the next bar line and plans again from there.

## [2.13.0] - 2026-11-11

### Changed

- **Metronome: a pared-down screen.** The main page keeps only what is used every time: the level bars (which are also the lights), the tempo, and Start. Everything else moved to sub-pages, each opened from a row that shows its current value: Time signature, Subdivision, Sound, Jazz, Options, and Presets (★). Android's back button returns from a sub-page to the main page.
- **TAP** is now a small outlined button next to the tempo, far from the wide Start button: the two are no longer confused. Tapping the tempo number in rhythm works too; dragging it still changes the tempo.
- − and + sit next to the number: a tap moves by 1, holding moves by steps of 5.
- The time signature page holds the menus, the group limits (tap between two bars) and what the tempo counts; the subdivision page holds the choices, a small bar per click and swing; sound and jazz are simple lists; options are switches with a short explanation.

## [2.12.0] - 2026-11-11

### Changed

- **Metronome: any time signature.** Two menus replace the list: the top number (1 to 32) and the bottom number (2, 4, 8 or 16), so 15/16 or 11/8 are possible. A third menu holds shortcuts to the usual ones (4/4, 3/4, 6/8, 7/8 in its three groupings…).
- **One level bar per pulse**, from 0 (silent) to 4 (full), instead of strong / normal / muted. Tap a bar to switch it off and on again (it keeps its level), slide up or down to set its level. The bars are also the lights.
- **Groups** in /8 and /16: the default grouping comes first (7/8 = 2+2+3, 15/16 = 4+4+4+3), a menu offers the others, and a tap between two bars splits or joins a group. Each group starts with an accent.
- **Subdivisions** in /2 and /4 now have a small bar per click, with the same levels: accent the "and" of each beat, mute one sixteenth out of four… The global subdivision volume is gone.
- The tempo counts pulses, or groups when they are all equal (6/8 counts dotted quarters by default). Switching between the two keeps the speed.
- Settings and presets of 2.11 are converted.

## [2.11.1] - 2026-11-11

### Added

- Metronome: 6/4 and 7/4 time signatures.

## [2.11.0] - 2026-11-11

### Added

- **Metronome, from every screen.** The ♩ button in every header opens it over the current screen; Android's back button closes it and leaves the screen as it was.
  - Tempo from 20 to 400: drag the big number up or down, −5 −1 +1 +5 (hold to repeat), or **tap tempo** (average of the last 4 taps). The Italian marking is shown under the number.
  - Every time signature of the practice screens, odd meters included (7/8 as 2+2+3, 2+3+2 or 3+2+2). The tempo counts quarter notes in x/4, dotted quarters in 6/8, 9/8, 12/8 and eighths in 5/8 and 7/8.
  - **Accents per beat**: tap a beat to switch it between strong, normal and muted.
  - **Subdivisions**: eighths, triplets, sixteenths, dotted eighth and sixteenth, with their own volume.
  - **Swing** on eighth subdivisions, from straight to 75 %.
  - **Jazz modes**: click on 2 and 4 only; click once per bar (on the beat of your choice), optionally every other bar.
  - Five sounds: click, woodblock, cowbell, cross-stick, hi-hat.
  - **Presets**: save the current settings under a name, load, rename, delete.
  - Options: vibration and full-screen flash on each beat, keep the screen on.
- **Mini-bar**: while it plays, the collapsed metronome stays at the bottom of every screen (beat lights, tempo − +, stop, expand), above an open palette.
- The metronome keeps playing with the screen locked: one cycle is rendered in advance and looped by the audio hardware, with no script running.
- One tempo at a time: playing a staff, a chart or a practice exercise stops the metronome, and the other way round.

### Changed

- New icon for the Practice button on the home screen; the metronome icon now opens the metronome.

### Technical

- New pure modules `metronome` (settings, cycle sounds, tap tempo, presets) and `metro-clock` (timing of a looping cycle, seamless swaps on any change), with unit tests; `metro-engine` renders and loops the cycle.
- The 2.10 engine spike and its test panel are removed (`js/ui/metro-spike.js`, `css/metro-spike.css`).
- `ui/nav` handles overlays with their own history entry (`openOverlay`, `closeOverlay`).

## [2.9.1] - 2026-11-11

### Changed

- **Code documentation in English.** Every comment and JSDoc block (JavaScript, CSS, HTML), the README, the test names, the CI workflow and the generated documentation are now in English. The code itself is unchanged: an automated check compared the token stream of every file before and after.
- Interface texts are not affected: the app still follows the phone's language (English or French).

### Technical

- Fixed outdated module names in `index.html` comments (`ui/nav`, `ui/staff/palette`).
- `css/base.css` lists the `chord-keys` stylesheet.
- From now on, changelog entries and commit messages are in English.

## [2.9.0] - 2026-11-11

### Ajouté

- **Interface en anglais et en français.**
  - Au premier lancement, l'appli suit la langue du téléphone (du navigateur) : français si elle est en français, anglais sinon.
  - Options › Langue : Automatique, English ou Français. Le choix est retenu.
  - Tout est traduit : écrans, palettes, clavier d'accords, panneaux, messages, entraînement, exports PNG et PDF, note d'exemple.
  - Noms de notes selon la langue : Do Ré Mi en français (« Si♭ 4 »), C D E en anglais (« B♭4 »). Les accords chiffrés restent identiques.
  - Les dates suivent la langue (« 11 nov. », « Nov 11 »).

### Technique

- Nouveaux modules `i18n` (`t('clé', { n })`, pluriels par `Intl.PluralRules`, détection), `lang-init` (importé en premier par `main`), dictionnaires `locales/en` et `locales/fr` (317 textes).
- Textes fixes de `index.html` : attributs `data-i18n` et `data-i18n-attr`.
- Tests : mêmes clés dans les deux langues, chaque clé utilisée existe, aucune variable locale `t` ne masque la fonction de traduction ; tests d'interface en anglais.
- Le manifeste d'installation est en anglais.

## [2.8.8] - 2026-11-10

### Corrigé

- **Écoute des grilles : on n'entendait pas toujours le changement d'accord ni le mouvement de basse** (par exemple Fmaj7 → F♯ø7).
  - La nappe était jouée sans fondamentale. Or Fmaj7 sans fa et F♯ø7 sans fa♯ donnent tous deux la, do, mi : les deux accords sonnaient pareil. La fondamentale fait maintenant partie de la nappe.
  - La basse jouait entre 82 et 155 Hz avec un son très filtré, là où un haut-parleur de téléphone ne rend presque rien. Elle a maintenant un son de basse pincée, riche en harmoniques et doublé d'une octave douce : sur un haut-parleur de téléphone simulé, elle ressort environ 6 fois plus fort, sans être plus lourde au casque.

## [2.8.7] - 2026-11-10

### Corrigé

- **Ajouter une catégorie ne marchait pas au téléphone.**
  - Panneau « Ranger la note » : le champ « + Nouvelle catégorie » n'avait pas de bouton et attendait la touche Entrée, que le clavier d'Android n'envoie pas toujours (pendant qu'il propose des mots). Il a maintenant un bouton **Ajouter**, et la touche ✓ du clavier marche aussi.
  - Panneau des catégories : la touche ✓ du clavier dans « Nouvelle catégorie » enregistrait et fermait le panneau, en perdant le nom tapé. Elle ajoute maintenant la catégorie.
  - Un nom tapé mais pas encore ajouté n'est plus jamais perdu : « Enregistrer » ou « Fini » l'ajoutent aussi.

## [2.8.6] - 2026-11-10

### Ajouté

- **Catégories dans les dossiers.** Chaque dossier peut avoir ses propres catégories (par exemple Technique, Son, Impro dans « Saxophone »). Elles ne sont pas partagées entre dossiers.
  - Une note peut avoir **plusieurs** catégories ; elle apparaît alors dans chacune.
  - Accueil : dans un dossier, une deuxième rangée de puces (Tout, chaque catégorie, Sans catégorie, +). Sur « Tout », les notes sont rangées **en sections repliables**, une par catégorie dans l'ordre choisi, puis « Sans catégorie ». L'état replié est mémorisé.
  - Toucher une catégorie la choisit : la liste ne montre plus qu'elle. Une nouvelle note créée là prend le dossier et la catégorie.
  - Toucher la catégorie déjà choisie, ou « + », ouvre le panneau des catégories : ajouter, renommer, changer l'ordre (↑ ↓), supprimer. Supprimer une catégorie ne supprime aucune note.
- **Ranger une note** : le menu de dossier en haut d'une note devient un bouton « ● Saxophone › Technique, Son » qui ouvre un panneau : le dossier, puis ses catégories à cocher, avec création d'une catégorie ou d'un dossier sur place.
- Recherche et « Toutes » : la catégorie s'affiche à côté du dossier de chaque note.

### Modifié

- Changer une note de dossier efface ses catégories (elles appartiennent à l'ancien dossier).
- Un fichier de note partagé n'emporte pas ses catégories, comme pour le dossier.
- Restaurer une sauvegarde dans un dossier qui existe déjà lui ajoute les catégories qui lui manquent.

### Technique

- `folders` : `addCategory`, `catsOf`, `inCategory`, `countByCategory`, `groupByCategory`, `deleteCategory`, `moveCategory`, `fileNote` ; champs `cats` du dossier et de la note, validés par `sanitize` ; métadonnées `catSel` et `catFold`.

## [2.8.5] - 2026-11-10

### Ajouté

- **Clavier d'accords** à la place du clavier du téléphone, dans la grille et pour l'accord d'une note. Plus de majuscules ni de « b » à taper.
  - Ligne 1 : la fondamentale (C à B) et ♭ ♯. Après `/`, la même ligne donne la basse.
  - Lignes 2 et 3 : la couleur en un toucher (7, −7, Δ7, ø7, °7, 7alt, 6, −6, +, sus4, 7sus4, 9, −9, Δ9, 7♭9, 7♯9, 13). La même touche deux fois retire la couleur.
  - `⋯` : pavé détaillé pour les accords rares (−, Δ, ø, °, +, sus, add, alt, 2 à 13, ♭5, ♯5, ♭9, ♯9, ♯11, ♭13).
  - Dernière ligne : `/`, N.C., répétition de mesure, `␣` (deuxième accord dans la mesure), effacer, annuler, Suivant (mesure suivante) ou OK (accord d'une note).
  - Aperçu de la mesure en cours, avec la couleur choisie surlignée sur le clavier.
  - `⌨` repasse au champ texte (pour coller un accord ou écrire au clavier d'ordinateur), `♫` revient au clavier d'accords.
  - Grille : une seule annulation par mesure saisie.
- **Palette de grille en deux onglets** : Accords et Structure (sections, voltas, reprises, barres, insertion et suppression de mesure).

### Modifié

- **Affichage des accords comme dans iReal Pro**, partout (grille, portées, exports) : `−7`, `Δ7`, `ø7`, `°7`. Toutes les écritures (`m7`, `-7`, `maj7`, `^7`, `m7b5`, `h7`…) donnent le même affichage. L'accord au-dessus d'une note a maintenant sa couleur en exposant, comme dans la grille.

### Technique

- Nouveaux modules `chord-keys` (pur) et `ui/chord-keyboard`, feuille `css/chord-keys.css`. Les accords du clavier sont enregistrés en notation iReal (`-7`, `^7`, `h7`, `o7`), déjà lue par l'écoute, la transposition et l'export iReal.

## [2.8.4] - 2026-11-10

### Ajouté

- **Sélection de mesures à l'appui long**, sur les portées, les lignes rythmiques, les grilles, les séries des Placements et les exercices aléatoires.
  - Appui long sur une mesure (environ une demi-seconde) : un cadre l'entoure et le téléphone vibre.
  - Sans lever le doigt, glisser étend la sélection à d'autres mesures, dans les deux sens et sur plusieurs lignes. La page ne défile pas pendant ce glisser.
  - Une barre apparaît au-dessus : **▶ Jouer d'ici** pour une mesure (jusqu'à la fin), **🔁 Boucle** pour plusieurs (le passage en boucle). ✕ ou un toucher ailleurs efface la sélection et arrête sa lecture.
  - Dans une note, la lecture commence par une mesure de décompte. Dans l'entraînement, le réglage Décompte est respecté.
  - Une reprise comprise dans la sélection est jouée dépliée. On part toujours du premier passage par la mesure choisie.
  - Grille : une case vide ou un « % » joue l'accord qu'on entendrait en partant du début.
  - Une note liée depuis la mesure précédente est attaquée au début de la sélection.
- Le toucher simple, le glisser de note et le bouton Écouter ne changent pas.

### Technique

- `rhythm.staffSegment` ; `audio.playStaff` : options `from` / `to` ; `audio.playGrid` : options `from`, `to`, `loop`, `countIn` ; `layout` : `mrects` (place de chaque mesure) ; nouveau module `ui/measure-select`.

## [2.8.3] - 2026-11-09

### Ajouté

- **Instruments transpositeurs.** Chaque portée a un menu Instrument : en ut, si♭ (trompette, clarinette, sax soprano), si♭ ténor, mi♭ alto, mi♭ baryton, fa, sol.
  - Les notes s'écrivent et se lisent comme le musicien les lit ; l'écoute joue le son réel.
  - L'étiquette de l'instrument (E♭, B♭, F, G) est affichée au-dessus du chiffrage, sur la portée, dans les exports PNG et PDF.
  - Sur une portée vide, on change simplement d'instrument.
  - Sur une portée qui a déjà des notes, l'appli demande quoi en faire : **transposer** (même son ; notes, armure et accords chiffrés sont réécrits) ou **garder l'écriture** (les notes ne bougent pas, c'est le son qui change).
  - La transposition garde l'orthographe musicale (do majeur au sax alto donne la majeur, avec do♯, fa♯ et sol♯ à l'armure). Une armure de plus de 7 altérations passe à l'enharmonique (ré♯ majeur devient mi♭ majeur).
  - Une note qui sortirait de la portée est ramenée d'une octave, avec un message.

### Technique

- Nouveau module pur `transpose` ; `model` : `INSTRUMENTS`, `instrumentOf`, champ de portée `tr` ; `chords` : `transposeChord` ; `pitch.resolveMidis` renvoie le son réel.

## [2.8.2] - 2026-11-09

### Ajouté

- **Glisser une note pour la placer.** Le doigt n'est pas toujours précis : la note suit maintenant le doigt tant qu'il reste posé, et elle est posée en le levant.
  - Mode Écrire : en touchant la zone d'insertion (ou la zone d'ajout en fin de portée).
  - Mode Modifier : en touchant la note sélectionnée.
  - Pendant le geste, on entend chaque changement de hauteur, et une bulle au-dessus du doigt affiche le nom de la note.
  - Tout le geste compte pour une seule annulation. Un simple toucher marche comme avant.
  - Ailleurs sur la portée, la page défile toujours normalement.
- **Notes plus aiguës** : jusqu'au ré 7 en clé de sol (six lignes supplémentaires), au lieu du mi 6. La portée s'agrandit vers le haut seulement quand une note dépasse l'ancienne limite.

### Modifié

- Les croches ligaturées très aiguës (ou très graves) ont des hampes qui descendent (ou montent) jusqu'à la 3e ligne, comme les notes seules : la ligature ne se perd plus dans les lignes supplémentaires.

### Technique

- `model` : `STEP_MIN`, `STEP_MAX`, `STEP_FIT` ; `layout` : `padTop` ; `ui/staff/input` : `bindStaffInput`, calques `drag-zone` en `touch-action: none` (le navigateur décide de faire défiler avant que le code ne s'exécute).

## [2.8.1] - 2026-11-09

### Modifié

- **Exercices aléatoires : 1, 2 ou 4 mesures** (au lieu de 4, 8 ou 12). Un ancien réglage à 8 ou 12 repasse à 4.
- **Jamais deux fois la même mesure dans un exercice.** Avant, seule la répétition immédiate était évitée. Le tirage se fait maintenant parmi les mesures pas encore sorties, ce qui garantit l'absence de doublon sans boucle de retirage. Chaque départ garde la même chance de sortir.
- Si les réglages ne permettent pas assez de mesures différentes (une note, une seule position permise…), un message le signale sur l'écran des réglages.

## [2.8.0] - 2026-11-08

### Ajouté

- **Exercices aléatoires** (Entraînement › Rythme) : 4, 8 ou 12 mesures à lire, tirées au hasard.
  - Réglages : mesure, longueur, nombre de notes par mesure (de… à…), positions permises pour la première note de chaque mesure (choisies en notation), subdivision (croches ; doubles et triolets plus tard).
  - Écran de lecture : l'exercice en grand, son numéro (↻ pour un autre), une barre en bas avec le tempo (− / +), le swing, la **lecture en boucle** et les réglages du métronome (⚙).
  - Un exercice est décidé par ses réglages et son numéro : le même numéro redonne le même exercice.
- **Toutes les mesures dans les Placements** : 2/4, 3/4, 4/4, 5/4, 3/8, 6/8, 9/8, 12/8, 5/8 (2+3 ou 3+2), 7/8 (2+2+3, 2+3+2 ou 3+2+2).
  - Mesures composées : chaque temps de 3 croches s'écrit selon l'usage (noire pointée, croche + noire, demi-soupir + deux croches…), deux temps vides voisins deviennent une demi-pause pointée.
  - Mesures asymétriques : écrites groupe par groupe, ligatures et métronome suivent le groupement choisi (7/8 en 2+2+3 : trois clics inégaux).
  - Le métronome mémorise les temps choisis pour chaque mesure.

### Modifié

- **Placements en sections repliables** : une section par position de la première note, titrée en notation (silences puis croche), sans texte de comptage (il reste lu par les lecteurs d'écran). Seule la première est dépliée ; « Tout déplier / Tout replier » ; ▶ joue une section même repliée (et la déplie). En-tête : « 28 mesures · 7 départs ».
- Les portées des sections ne sont dessinées qu'à l'ouverture, et la lecture ne redessine plus toute la série à chaque note : les grosses séries (924 mesures en 12/8 à six notes) restent fluides. Pendant la lecture, la page suit la note jouée.
- Le tempo reste donné à la noire dans toutes les mesures.
- Le swing n'est proposé qu'en mesure simple (x/4).

### Technique

- Nouveaux modules : `exercise` (tirage, pur), `ui/exercises`, `ui/drill-kit` (pièces communes de l'entraînement).
- `model` : `defaultGroups`, `meterGroups`, `groupStarts` ; champ de bloc `groups` (groupement des croches). Ligatures (`beamGroups`) et métronome s'appuient dessus ; sorties identiques à la 2.7 pour les mesures déjà existantes.
- `audio.playStaff` : option `loop`.
- Réglages : `meta.drill` (mesure, temps du métronome par mesure, boucle ; l'ancien format est repris) et `meta.gen`.

## [2.7.0] - 2026-11-08

Version de nettoyage : aucun changement visible. Vérifié : sorties des moteurs identiques, captures d'écran identiques au pixel près (18 écrans, clair et sombre) à la 2.6.1, exports PNG identiques.

### Ajouté

- **Tests d'interface dans le dépôt** (`tests/e2e/`, `npm run test:e2e`) : 17 parcours rejoués dans un vrai navigateur avec Playwright (saisie et modes, mise en mesure, armure, triolets, rechargement, migration, dossiers, recherche, tri, sauvegarde, blocs réduits, partage PNG / PDF / .inkline, entraînement et métronome, hors ligne).
- **Intégration continue** (GitHub Actions) : `npm run check` et les tests d'interface à chaque push.
- `scripts/dev.mjs --static` : sert l'appli telle qu'en production (utilisé par les tests).

### Modifié

- **Bloc portée découpé** : `ui/staff-ui.js` (839 lignes) devient le dossier `ui/staff/` : `index` (enregistrement), `view` (en-tête, dessin), `input` (toucher, modes), `palette`, `bars`, `chord`, `shared` (socle commun). Le graphe des modules reste sans cycle.
- **Fonctions longues découpées** : écran Options (une fonction par section), éditeur de dossier, palette de portée (table d'actions), lecteur iReal (table de jetons), mise en mesure (`cutAtBars`, `valuesFor`, `piecesFrom`). Les deux derniers ont été comparés à la 2.6.1 sur des dizaines de milliers d'entrées aléatoires : sorties identiques.
- **Feuilles de style par zone** : `css/app.css` (1 806 lignes) devient 12 fichiers chargés dans le même ordre (l'ordre est documenté dans `css/base.css`).
- 14 exports qui ne servaient qu'à leur propre module sont redevenus privés.

### Corrigé

- Refus d'un triolet qui passerait la barre : l'état d'avant est maintenant restauré entièrement (une liaison retirée sur la note précédente revenait mal).
- Le sous-menu des barres indique correctement la barre d'une note coupée par une barre de mesure.

### Retiré

- `npm run serve` (il demandait Python) : remplacé par `npm run dev`.

## [2.6.1] - 2026-11-08

### Corrigé

- **Durée qui grossit à l'infini** (mode Modifier) : basculer le point d'une double croche plusieurs fois de suite ajoutait un temps à chaque bascule. La différence entre une double croche et une double croche pointée (1/8 de temps) ne s'écrit pas en silences ; le silence de compensation, impossible à écrire, était alors remplacé par erreur par un soupir entier. Désormais :
  - une différence plus petite qu'une double croche n'est pas compensée : la suite se décale, et l'opération inverse la ramène ;
  - un silence n'est entamé que si ce qu'il en reste s'écrit ;
  - un silence de compensation qui tombe hors de la grille est écrit d'un bloc au lieu d'être perdu ou faussé.

### Ajouté

- **Environnement de développement** : réglages VS Code partagés (`.vscode/`), et `npm run dev`, un serveur d'aperçu qui recharge l'appli à chaque enregistrement (compatible avec la Content Security Policy, contrairement à l'extension Live Server).

### Tests

- Toutes les valeurs (ronde à double croche) dans quatre contextes : basculer le point 12 fois ne fait jamais varier la durée de plus d'une demi-valeur, et chaque aller-retour redonne la même durée.
- Test aléatoire (fuzz) : 300 portées au hasard, 6 changements de durée chacune ; la durée totale ne varie jamais plus que la note modifiée. Vérifié aussi hors suite sur 144 000 opérations et 6 chiffrages (dont 3/4, 6/8, 12/8), avec en plus la stabilité de la remise en mesure. 87 tests au total.

## [2.6.0] - 2026-11-08

Mise en mesure automatique : liaisons aux barres et compensation par des silences.

### Ajouté

- **Liaisons automatiques aux barres de mesure** : une note qui déborde de sa mesure est coupée à la barre et liée à la suite. Noire, noire, ronde en 4/4 donne noire, noire, blanche⁀ | blanche. Le reste est écrit en valeurs usuelles (points compris), sur plusieurs mesures si besoin. Les silences sont coupés de la même façon, sans liaison.
  - Le découpage se refait après chaque modification (insertion, suppression, changement de durée ou de mesure) : une note coupée redevient entière si elle tient de nouveau dans sa mesure.
  - On ne coupe qu'aux barres : à l'intérieur d'une mesure, l'écriture reste celle de l'utilisateur (syncopes comprises).
  - Les liaisons posées à la main ne sont jamais touchées.
  - Une note coupée se comporte comme une seule note : la toucher la sélectionne en entier (surlignée en entier), la palette affiche sa valeur totale, ⌫ l'efface en entier, et le curseur d'insertion ne se place jamais au milieu.
- **Compensation par des silences** (mode Modifier), comme dans MuseScore :
  - raccourcir une note ajoute un silence de la différence (noire → croche + demi-soupir) : la suite reste à sa place ;
  - allonger une note mange d'abord les silences qui la suivent (l'aller-retour noire → croche → noire redonne la mesure de départ) ; s'il n'y en a pas assez, la suite se décale et les barres sont recoupées.
- **Changer la mesure** (4/4 → 3/4…) recoupe toute la portée.
- **Triolets** : un triolet ne peut pas traverser une barre. L'ajout est refusé, avec un message dans la palette.

### Détails

- Les portées écrites avant la 2.6 ne sont pas modifiées à l'ouverture : elles sont remises en mesure à la première modification.
- Format : les morceaux créés automatiquement portent `auto: true` (et `tie: true` pour une note). Les versions précédentes les affichent comme des notes liées normales.

### Développement

- `js/measure-fit.js` : notes logiques, découpage aux barres, écriture des durées (`decompose`), compensation (`resizeEvent`). Fonctions pures, 14 tests (`tests/measure-fit.test.js`). 85 tests au total.

## [2.5.1] - 2026-11-07

### Modifié

- **Nouvelle icône** dessinée par Nathan : portée, note et plume, sur fond crème. Versions arrondie (« any »), plein cadre pour les icônes adaptatives d'Android (« maskable », 192 et 512 px), icône pour iOS (180 px) et SVG (onglet du navigateur).
- L'écran de démarrage de l'appli installée prend le fond crème de l'icône.

## [2.5.0] - 2026-11-07

Saisie des portées repensée, et armures.

### Ajouté

- **Deux modes de saisie**, choisis en haut de la palette, comme le mode « N » de MuseScore :
  - **Écrire** (par défaut) : la palette règle toujours la prochaine note. Un curseur d'insertion indique où elle arrivera. Toucher une note y place le curseur, sans rien modifier : on peut **insérer une note au milieu** de la portée, dans la zone bleue qui s'ouvre. ◀ ▶ déplacent le curseur, ⌫ efface la note juste avant lui.
  - **Modifier** : toucher une note la sélectionne, la palette la modifie, ◀ ▶ passent à la voisine, toucher plus haut ou plus bas la déplace.
  - Passer de l'un à l'autre se fait d'un toucher et reprend là où on en était (la note avant le curseur devient la sélection, et inversement). « Terminé » ne sert plus qu'à fermer la palette.
- **Armure** pour les portées (pas les lignes rythmiques) : de 7 bémols à 7 dièses, choisie dans l'en-tête du bloc, avec la tonalité majeure et mineure correspondante. Elle est dessinée au début de chaque ligne, prise en compte à l'écoute, et une altération écrite la remplace jusqu'à la barre (un bécarre annule le dièse de l'armure). Le nom de la note sélectionnée en tient compte.

### Modifié

- La ligne d'aide de la palette passe sous la rangée des modes.

### Développement

- `pitch` : `keyAcc`, `degreeOf`, ordres des dièses et des bémols ; `resolveMidis` applique l'armure.
- `layout` : largeur de l'armure (`ksw`) et trou d'insertion (`insertAt`, `insertX`).
- `render-staff` : dessin de l'armure ; zone d'insertion au curseur.
- 7 tests de plus (armure, insertion, validation). 71 au total.

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
