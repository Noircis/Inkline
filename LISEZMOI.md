# Carnet de portées : installation sur Android

App autonome : elle fonctionne hors ligne et garde les notes sur le téléphone. Elle n'a aucun lien avec Claude.

## 1. Mettre l'app en ligne (une seule fois, gratuit)

Avec GitHub Pages :

1. Crée un compte sur github.com si besoin, puis un dépôt public, par exemple `carnet`.
2. Dans le dépôt : **Add file > Upload files**, puis glisse tous les fichiers de ce dossier :
   `index.html`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `icon-maskable.png`.
   Valide avec **Commit changes**.
3. Va dans **Settings > Pages**. Dans **Source**, choisis **Deploy from a branch**, puis la branche `main` et le dossier `/ (root)`. Enregistre.
4. Après une minute environ, l'adresse s'affiche : `https://<ton-pseudo>.github.io/carnet/`.

N'importe quel hébergement statique en HTTPS convient aussi (Netlify, Cloudflare Pages, etc.).

## 2. Installer sur le téléphone

1. Ouvre l'adresse dans **Chrome** sur ton Android.
2. Menu **⋮ > Installer l'application** (ou « Ajouter à l'écran d'accueil »).
3. L'icône apparaît dans tes apps. Elle s'ouvre en plein écran, sans barre de navigateur.

Une fois ouverte une première fois, l'app fonctionne sans connexion.

## 3. Sauvegarde

Les notes sont stockées dans l'app, sur le téléphone uniquement.
Si tu désinstalles l'app ou effaces les données de Chrome, elles sont perdues.
Utilise **Exporter** (en bas de la liste des notes) de temps en temps : tu obtiens un fichier `.json` que tu pourras restaurer avec **Importer**.

## Mettre à jour l'app

Remplace les fichiers sur GitHub, puis change `carnet-v1` en `carnet-v2` dans `sw.js`.
L'app se mettra à jour à la réouverture suivante. Tes notes sont conservées.
