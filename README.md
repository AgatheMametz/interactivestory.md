# interactivestory.md

Histoires en Markdown → une page HTML autonome (runtime + données inlinés).

## Format

- **Front matter YAML** : `title`, `version`, `author`, `email`, `link`, optionnel `start` (id du node d’entrée ; défaut = premier `#` du fichier).
- **`## css`** puis bloc ` ```css ` … ` ``` ` : styles ajoutés au gabarit.
- **Nodes** : titre `# id_du_node`, corps en Markdown, puis `## options` et liens `[libellé](id_cible)`.

## Marqueurs (dans le corps d’un node)

- `(set: nom valeur)` — `true` / `false`, nombre, ou `"chaîne"`.
- `(set: nom++)` / `(set: nom--)` — réservé aux nombres.
- **Ternaire** : `(if: variable = valeur ; texteSiVrai ; texteSiFaux)` — égalité stricte (avec coercition légère nombre / chaîne comme dans le runtime). Les deux branches peuvent contenir du Markdown ; éviter `;` non protégés dans un segment (utiliser des guillemets si besoin).
- **Ternaire ifnot** : `(ifnot: variable = valeur ; texteSiDifferent ; texteSiEgal)` — première branche si `variable ≠ valeur`, sinon seconde.
- **Lien conditionnel vers un node** : `(if: condition)(id_node)` et `(ifnot: condition)(id_node)` — si la condition est vraie / fausse, insère un lien vers `id_node` (libellé = id du node).

**Conditions** (formes `if` / `ifnot` avec `(…)(node)`) : soit `variable = valeur`, soit un nom de variable seul (vérité « truthy » : pas `false`, pas `0`, pas `""`, pas `undefined`).

## Build

```bash
npm install
npm run build -- examples/sample.story.md
```

Sortie : `dist/<slug-du-title>.html` (slug dérivé de `title`).
