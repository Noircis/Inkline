# Mettre Inkline à jour sur GitHub

Depuis la 1.4.0, l'app est composée de plusieurs dossiers (`js/`, `css/`, `docs/`…).

## Option 1 : par le site GitHub (sans rien installer)

1. Décompresse le zip sur ton ordinateur.
2. Dans le dépôt GitHub : **Add file > Upload files**.
3. Sélectionne **tout le contenu** du dossier décompressé (fichiers et dossiers) et glisse-le dans la page. GitHub conserve l'arborescence.
4. **Commit changes**.
5. Les anciens fichiers de la 1.3 qui ne servent plus peuvent rester : ils sont inoffensifs.

## Option 2 : avec git (recommandé pour la suite)

```bash
git clone https://github.com/Noircis/Inkline.git
cd Inkline
# copier le contenu du zip ici (écrase les anciens fichiers)
git add -A
git commit -m "Inkline 1.4.0 : liaisons, triolets, modules, doc"
git push
```

## Après la mise en ligne

- L'app : https://noircis.github.io/Inkline/ (ouvre-la deux fois sur le téléphone pour passer en 1.4.0).
- La doc du code : https://noircis.github.io/Inkline/docs/

## Développement

```bash
npm install     # outils de dev (JSDoc)
npm test        # tests unitaires
npm run docs    # régénère docs/
npm run serve   # http://localhost:8080
```
