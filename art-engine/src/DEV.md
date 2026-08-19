# Art Engine — maintainer/API notes

## Contract

Art Engine is a deterministic formatter and normalizer:

```text
ArtState → normalize/export → generatePrompt → string
```

It performs no model calls and has no runtime dependency.

## Public API

| Export | Purpose |
| :--- | :--- |
| `createDefaultState()` | Editable starter profile with default dimensions |
| `importEngineConfig(value)` | Parse and normalize JSON/string input |
| `exportEngineConfig(state)` | Return the canonical serializable config |
| `generatePrompt(state)` | Produce the single Art Engine prompt |
| `generateSystem(state)` | Return `{ config, prompt }` |
| `normalizeAxes(value)` | Validate free-form dimensions and dedupe names |
| `normalizeAxisSnippet(value)` | Validate one reference override |
| `normalizeAxisSnippets(value, legacy?)` | Validate axis overrides and migrate legacy `snippet` |
| `assignUniqueAxisName(name, usedKeys)` | Append `-2`, `-3`, … when a sanitized name collides |
| `clampAxisValue(value)` | Round and clamp to 0–100 |
| `sanitizeId(value)` | Normalize profile names and dedupe axis names internally |

## State shape

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

Axes are free-form and may be empty. Import preserves their order, clamps values, dedupes duplicate names with `-2`, `-3` suffixes, and accepts legacy `label`/`id` fields. Snippets are retained only when `code` is non-empty, capped at 8 per axis; language defaults to `text`. A legacy `snippet` object is migrated into `snippets`.

## Invariants

1. Same canonical config produces the same prompt.
2. Export uses only `name` for each axis; there is no separate axis ID field.
3. Default dimensions live in `config/engine-config.json` and `createDefaultState()`; normalization never restores deleted axes.
4. Missing optional `confidence` and empty `snippets` are omitted from exported JSON.
5. Axis snippets are scoped reference overrides, not a global component or token definition.
6. Prompt output always includes product/usability/accessibility priority and integration boundaries.
7. Config is intent; generated prompt is disposable output.

## Verification

For changes to the engine, verify:

- JSON import/export roundtrip,
- zero axes and custom axes,
- no hard cap on axis count,
- duplicate axis name normalization (`Name-2`),
- legacy `id`/`label` and `snippet` import migration,
- valid and empty axis snippet normalization,
- values below/above range,
- deterministic prompt equality after roundtrip,
- prompt includes every active rule, anti-rule, heuristic, axis, and reference override.
