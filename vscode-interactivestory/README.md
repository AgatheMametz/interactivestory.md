# Extension Cursor / VS Code — fichiers `.it`

Coloration pour le format **passage en colonne 0 + bloc indenté + séparateur `--`** (histoires interactives).

L’extension **`.it`** évite que Cursor ouvre le fichier comme du Markdown générique (`.md`).

## Pourquoi tu ne vois pas « Install from Location »

Cette commande existe sur certaines versions de **VS Code**, mais **pas toujours dans Cursor**. Les méthodes ci‑dessous fonctionnent partout.

## Méthode recommandée : fichier `.vsix`

Dans un terminal :

```bash
cd vscode-interactivestory
npm run package
```

Cela produit un fichier `interactivestory-md-0.2.0.vsix` (le numéro suit `version` dans `package.json`).

Puis dans **Cursor** :

1. **Cmd+Shift+P** (Mac) ou **Ctrl+Shift+P** (Windows / Linux).
2. Tape **`vsix`** → **Extensions: Install from VSIX…** / **Installer à partir d’un VSIX…**.
3. Sélectionne le `.vsix` généré.

Tu peux aussi glisser‑déposer le `.vsix` dans la vue **Extensions**.

En ligne de commande (si la CLI `cursor` est installée) :

```bash
cursor --install-extension ./vscode-interactivestory/interactivestory-md-0.2.0.vsix
```

(adapte le nom du fichier si la version change.)

## Méthode copie du dossier (sans VSIX)

1. Ferme Cursor.
2. Copie le dossier `vscode-interactivestory` vers :

   `~/.cursor/extensions/interactivestory.interactivestory-md-0.2.0`

   (nom = **`publisher.name-version`** selon `package.json`.)

3. Rouvre Cursor.

## Association des fichiers

Le dépôt contient `.vscode/settings.json` : les fichiers `**/*.it` utilisent le langage `interactivestory` une fois l’extension installée.

## Modifier la grammaire

Édite `syntaxes/interactivestory.tmLanguage.json`, régénère le `.vsix`, puis **Developer: Reload Window**.
