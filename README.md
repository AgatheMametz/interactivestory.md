# interactivestory.md

Histoires au format **`.it`** (indentation + YAML) → une page HTML autonome (runtime + données inlinés).

## Format

- **Fichier source** : extension recommandée **`.it`** (évite d’être ouvert comme Markdown `.md`).

- **Front matter YAML** : `title`, `version`, `author`, `email`, `link`, optionnel `start` (id du passage de départ ; défaut = premier passage du fichier, hors `_css`).
- **Passages (indentation)** : une ligne **sans indentation** en tête de colonne = **id du passage** (pas de `#`). Toutes les lignes suivantes **indentées** (tab ou espaces) font partie du passage jusqu’au prochain titre de colonne 0. Les **lignes vides** à l’intérieur d’un passage sont conservées (elles ne ferment pas le bloc).
- **Corps vs options (indentation)** : sous le titre, toutes les lignes sont indentées. Le **corps** est au **niveau d’indentation minimal** (première « colonne » du passage). Les **options** sont le bloc final plus indenté (un cran de plus : tab supplémentaire, ou 4 espaces de plus, etc.) ; elles sont remplacées à chaque navigation. Les lignes vides ne comptent pas pour ouvrir le bloc options.
- **Styles** : passage réservé `_css` en titre, puis bloc indenté contenant un fence ` ```css ` … ` ``` ` (injecté dans le HTML). Ce passage n’est pas jouable.
- **Options** : bloc plus indenté ; **chaque ligne non vide** est du Markdown interprété comme le corps (`(if:)`, `(ifnot:)`, ternaires, `(set:)`, `ifnotyet …`, etc.). La ligne doit finir par au moins un lien `[libellé](id_passage)` visible après évaluation ; la **première** paire lien / cible sert au menu.

## Marqueurs (dans le corps d’un node)

- `(set: nom valeur)` — `true` / `false`, nombre, ou `"chaîne"`.
- `(set: nom++)` / `(set: nom--)` — réservé aux nombres.
- `(clear)` — efface tout le texte déjà affiché dans la chronique avant d’afficher ce passage ; le marqueur lui-même ne rend rien (il peut se trouver dans une branche `(if:…)`).
- **Ternaire** : `(if: variable = valeur ; texteSiVrai ; texteSiFaux)` — égalité stricte (avec coercition légère nombre / chaîne comme dans le runtime). Les deux branches peuvent contenir du Markdown ; éviter `;` non protégés dans un segment (utiliser des guillemets si besoin).
- **Ternaire ifnot** : `(ifnot: variable = valeur ; texteSiDifferent ; texteSiEgal)` — première branche si `variable ≠ valeur`, sinon seconde.
- **Lien conditionnel** : `(if: condition)(…)` ou `(ifnot: condition)(…)` — le second bloc est un **fragment Markdown libre** (texte, `**gras**`, liens `[libellé](id_node)`, marqueurs imbriqués `(set:…)` / `(if:…)`, etc.). S’il ne reste qu’un seul id de node (sans espace ni lien), il est traité comme `[id](id)`.

- **Variables dans le texte** : `{{nomVariable}}` est remplacé par la valeur courante (chaîne) après marqueurs, avant rendu Markdown.

**Conditions** (dans `(if:…)(…)` / `(ifnot:…)(…)`) : `variable = valeur` ; raccourci `variable valeur` (littéral `true` / `false` / nombre / mot sans espace) ; ou un seul identifiant (truthy).

## Build

```bash
npm install
npm run build -- examples/sample.it
```

Sortie : `dist/<slug-du-title>.html` (slug dérivé de `title`).

## Coloration dans Cursor / VS Code

Une extension locale dans [`vscode-interactivestory/`](vscode-interactivestory/) enregistre le langage **interactivestory** pour les fichiers **`.it`**. **Cursor** n’a souvent pas la commande « Install from Location » : empaqueter avec `npm run package` dans ce dossier, puis **Cmd+Shift+P** → chercher **vsix** → **Install from VSIX**. Détail dans [`vscode-interactivestory/README.md`](vscode-interactivestory/README.md).
