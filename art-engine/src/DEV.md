# Art Engine — DEV

Produkt: [`../README.md`](../README.md). AI: [`../AGENTS.md`](../AGENTS.md).

## Kontrakt

Art Engine je deterministický formatter a normalizer:

```text
ArtState → normalize/export → generatePrompt → string
```

Neprovádí žádná volání modelu a nemá runtime závislost.

## Veřejné API

| Export | Účel |
| :--- | :--- |
| `createDefaultState()` | Editovatelný startovní profil s výchozími osami |
| `importEngineConfig(value)` | Parsovat a normalizovat JSON/string vstup |
| `exportEngineConfig(state)` | Vrátit kanonický serializovatelný config |
| `generatePrompt(state)` | Vyrobit jediný Art Engine prompt |
| `generateSystem(state)` | Vrátit `{ config, prompt }` |
| `normalizeAxes(value)` | Validovat volné osy a deduplikovat názvy |
| `normalizeAxisSnippet(value)` | Validovat jeden reference override |
| `normalizeAxisSnippets(value, legacy?)` | Validovat override osy a migrovat legacy `snippet` |
| `assignUniqueAxisName(name, usedKeys)` | Připojit `-2`, `-3`, … když sanitizovaný název koliduje |
| `clampAxisValue(value)` | Zaokrouhlit a clampovat na 0–100 |
| `sanitizeId(value)` | Normalizovat názvy profilu a interně deduplikovat názvy os |

## Tvar stavu

```js
{
  styleProfile: { name, summary },
  axes: [
    {
      name, value, meaningLow, meaningHigh, confidence?,
      snippets?: [{ language, code, note? }]
    }
  ],
  rules: [],
  antiRules: [],
  heuristics: []
}
```

Osy jsou volné a mohou být prázdné. Import zachová jejich pořadí, clampuje hodnoty, deduplikuje duplicitní názvy suffixy `-2`, `-3` a přijímá legacy pole `label`/`id`. Snippety se ponechají jen když `code` není prázdný, max 8 na osu; language defaultuje na `text`. Legacy `snippet` se při importu přesune do `snippets`.

## Invarianty

1. Stejný kanonický config vyrobí stejný prompt.
2. Export používá u každé osy jen `name`; samostatné pole axis ID neexistuje.
3. Výchozí osy žijí v `config/art-config.json` a `createDefaultState()`; normalizace nikdy neobnoví smazané osy.
4. Chybějící volitelné `confidence` a prázdné `snippets` se z exportovaného JSON vynechají.
5. Axis snippety jsou scoped reference override, ne globální definice komponenty ani tokenů.
6. Výstup promptu vždy obsahuje prioritu produktu/usability/accessibility a integrační boundaries.
7. Config je intent; vygenerovaný prompt je jednorázový výstup.

## Verifikace

Při změnách enginu ověř:

- JSON import/export roundtrip,
- nula os i vlastní osy,
- žádný tvrdý strop na počet os,
- normalizace duplicitních názvů os (`Name-2`),
- import migrace legacy `id`/`label` a `snippet`,
- normalizace platného i prázdného axis snippetu,
- hodnoty pod/nad rozsahem,
- deterministická rovnost promptu po roundtripu,
- prompt obsahuje každé aktivní pravidlo, anti-rule, heuristic, osu i reference override.
