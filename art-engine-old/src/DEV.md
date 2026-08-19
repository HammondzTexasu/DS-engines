# Art Engine — DEV

Produkt: [`../README.md`](../README.md). AI workflow: [`../AGENTS.md`](../AGENTS.md).

## Rozsah

| Engine dělá | Engine nedělá |
| :--- | :--- |
| Normalizuje art-direction config | Neanalyzuje screenshoty |
| Generuje LLM guidance a prompty | Nevolá AI/API |
| Vytváří critique checklist | Negeneruje CSS tokeny ani komponenty |
| Drží stabilní schema os | Nemění color/typo engine |

## Struktura

```text
art-engine/
├── README.md
├── AGENTS.md
├── config/engine-config.json
├── prompts/
├── src/
│   ├── art-engine.js
│   └── DEV.md
└── app/
```

## API

| API | Účel |
| :--- | :--- |
| `createDefaultState()` | Výchozí profil |
| `importEngineConfig(json)` | JSON/string → normalizovaný state |
| `exportEngineConfig(state)` | State → persistovatelný config |
| `normalizeState(state)` | In-place normalizace |
| `normalizeAxes(axes)` | Doplní známé osy ve stabilním pořadí |
| `clampAxisValue(value)` | Celé číslo 0–100 |
| `sanitizeProfileName(value)` | kebab-case |
| `describeAxis(axis)` | Deterministický text osy podle pásma |
| `buildLlmGuidance(state)` | Hlavní art-direction markdown |
| `buildCritiqueChecklist(state)` | Checklist jako `string[]` |
| `buildGenerationPrompt(state)` | Prompt pro tvorbu |
| `buildReviewPrompt(state)` | Prompt pro kontrolu |
| `buildRefineConfigPrompt(state)` | Prompt pro externí AI kalibraci configu |
| `generateSystem(state)` | Všechny výstupy + normalizovaný config; mutuje state |

## `generateSystem`

```js
const result = generateSystem(importEngineConfig(json));
```

Vrací:

```js
{
  config,
  llmGuidance,
  critiqueChecklist,
  critiqueChecklistMarkdown,
  generationPrompt,
  reviewPrompt,
  refineConfigPrompt
}
```

Engine negeneruje význam pomocí modelu. Výstup skládá z:

1. doslovných polí configu,
2. stabilní struktury markdownu,
3. čtyř pásem os: 0–25, 26–50, 51–75, 76–100.

Hlavní inteligence profilu žije v `rules`, `antiRules`, `heuristics`, `notes` a explicitních významech pólů os.

## Import/export

- Neznámé osy se zahodí; chybějící známé se doplní hodnotou 50 a defaultními významy.
- Hodnota osy se zaokrouhlí a clampne na 0–100.
- `confidence` je `low | medium | high`; jiné hodnoty → `null`.
- Prázdné položky textových seznamů se zahodí.
- Snippet bez `code` se zahodí.
- Volitelná prázdná pole (`notes`, `snippets`, `sourceReferences`) se při exportu vynechají.
- `generateSystem` normalizuje state na místě; persistuj `result.config`.

## Playground

Playground načte `../config/engine-config.json`, jinak použije default. Import JSON mění jen session. Copy/download operace jsou lokální v prohlížeči.

Žádný upload screenshotů ani API klient není součástí aplikace. Screenshoty se přikládají přímo externímu AI nástroji spolu s promptem z `prompts/`.
