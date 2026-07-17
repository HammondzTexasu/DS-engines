# Color Engine — DEV

Produktová specifikace: [`../README.md`](../README.md).

Tento dokument popisuje **implementaci**: struktura repa, headless použití, config, API a důležité runtime chování.

---

## 1. Rozsah

| Engine dělá | Engine nedělá |
| :--- | :--- |
| Generuje **JSON config** a **CSS tokeny** (`:root { --… }`) z HCT | Mapování na tokeny cizího projektu |
| Drží pravidla interpolace, relative chroma, změnu `stepCount` | Inject / overwrite do webu (to řeší jiné vrstvy) |

GUI ve složce `app/` je **volitelný playground** — není součástí headless API.

---

## 2. Struktura

```text
color-engine/
├── README.md                 # Specifikace (chování, tokeny)
├── src/
│   ├── color-engine.js       # Headless engine (jediný zdroj pravdy logiky)
│   └── DEV.md                # Tento soubor
├── lib/
│   └── material-color-utilities.mjs
└── app/                      # Playground (DOM)
    ├── index.html
    ├── app.js
    └── engine-ui.css
```

**Playground:** z kořene monorepa / projektu:

```bash
npx serve . -l 3456
```

→ `http://localhost:3456/color-engine/app/`

---

## 3. Headless happy path

```js
import {
  importEngineConfig,
  generateSystem,
  exportEngineConfig,
  createDefaultState,
} from './color-engine.js';

// A) z JSON configu
const state = importEngineConfig(configJson);
const {
  tokensCss,   // string: :root { --key-palette-10: #…; … }
  config,      // exportnutý config (po normalizaci chroma)
  steps,
  endStep,
  keyPalettes,
  customPalettes, // keyed by runtime palette id
} = generateSystem(state);

// B) výchozí stav
const fresh = createDefaultState();
const system = generateSystem(fresh);
```

**Důležité:** `generateSystem(state)` **může změnit** interpolate chroma body přímo ve `state` (viz §6). Nejde o čistou funkci „jen výstup“.

---

## 4. Config JSON

Zdroj pravdy pro uložení / sdílení nastavení.

```json
{
  "version": 1,
  "stepCount": 10,
  "keyPalette": { "lm": { /* … */ }, "dm": { /* … */ } },
  "customPalettes": [
    {
      "name": "accent",
      "includeSteps": [40],
      "lm": { "hue": { /* ParamConfig */ }, "chroma": { /* ParamConfig */ } },
      "dm": { "hue": { /* … */ }, "chroma": { /* … */ } }
    }
  ]
}
```

* `version` — musí sedět s `ENGINE_CONFIG_VERSION` (aktuálně `1`), jinak `importEngineConfig` hodí chybu.
* `customPalettes[].name` — sanitizuje se (`a–z`, `0–9`, `-`); runtime `id` se do JSON **neukládá**.
* `customPalettes[].includeSteps` — volitelné; `null` / vynecháno / celá key mřížka = publikovat vše. Jinak unikátní seřazené step id z mřížky (ne `min`/`max`). Při 1 kroku engine collapsuje H/C na fixed a chromu drží relative (`ratio`).
* **ParamConfig**
  * `{ "mode": "fixed", "value": number, "ratio"? }` — `ratio` u single-include-step chromy (a runtime u fixed)
  * `{ "mode": "interpolate", "points": [...], "interpolators": [...] }`
* **Interpolate point:** `{ "step", "value", "ratio"? }`  
  * `ratio` (0–1) = relativní chroma intent (exportováno u chroma)  
  * `gamutLimit` = jen runtime, **nikdy** do JSON
* **`keyPalette.lm|dm.states`** (volitelné; při importu doplní defaulty):
  * `{ "deltaMin": 5, "deltaMax": 20, "state2Scale": 2, "relativeChroma": true }`
  * Live interaction math — **nejsou** CSS tokeny
  * `relativeChroma` — C jako % gamutu při změně T (default `true`)
  * `bgTone` **není** v configu — volající ho předá do `colorAtInteractionState` (tone povrchu za barvou)

**Export** (`exportEngineConfig`): fixed chroma ořízne na peak (nebo u 1 published kroku relative + `ratio`); interpolate přepočte relative + clamp; bez `gamutLimit`; `includeSteps` jen když není plná mřížka; `states` se exportují s key palette.

**Import** (`importEngineConfig`): validace → nové `id` palet → normalizace `includeSteps` → clamp/relative normalizace chroma; chybějící `states` → defaulty.

---

## 5. Veřejné API (`color-engine.js`)

### 5.1 Produktové (používej tohle)

| API | Účel |
| :--- | :--- |
| `createDefaultState()` | Výchozí engine state |
| `createCustomPalette(name?)` | Nová custom paleta (+ runtime `id`, `includeSteps: null`) |
| `moveCustomPalette(state, id, ±1)` | Pořadí custom palet v poli (config) |
| `createFixedParam(value)` / `createInterpolateParam(...)` | H/C parametry |
| `createDefaultInteractionStates()` | Default `deltaMin` / `deltaMax` / `state2Scale` / `relativeChroma` |
| `importEngineConfig(json)` | JSON → state |
| `exportEngineConfig(state)` | state → JSON (kopie, state nemění kromě čtení) |
| `generateSystem(state)` | Palety + `tokensCss` + `config` (**mutuje** relative chroma ve state) |
| `applyBrandColor(state, hex, opts?)` | Seed z hex → nearest step; volitelně ohýbá LM bezier; nastaví LM H/C brand palety |
| `normalizeStateForStepCount(state)` | Po změně `state.stepCount` srovná interpolate body + `includeSteps` na novou mřížku. GUI: při Perfect fit pak znovu `applyBrandColor` |
| `colorAtInteractionState(color, bgTone, states, level)` | Live state1/state2 barva (level `1` \| `2`); `bgTone` = tone povrchu za barvou |

Konstanty: `ENGINE_CONFIG_VERSION`, `KEY_PALETTE_NAME`, `DEFAULT_BEZIER`, `LINEAR_BEZIER`, `CHROMA_MAX`, `DEFAULT_STATE_DELTA_MIN`, `DEFAULT_STATE_DELTA_MAX`, `DEFAULT_STATE2_SCALE`, `INTERACTION_TONE_PIVOT`.
### 5.2 Low-level (playground / tooling)

Headless pipeline je typicky nepotřebuje; `app/` je používá.

* **HCT:** `hctToHex`, `hexToHct`, `clampChroma`, `maxChromaForHueTone`, `peakChromaForSteps`
* **Interaction states:** `interactionDeltaMagnitude`, `applyInteractionTone`, `colorAtInteractionState`  
  * `bgTone` — HCT tone **za** barvou (kontrastní bg). Playground používá key `min`; produkce dodá tone skutečného underlay.
* **Chroma politika:** `chromaLimitAtStep`, `chromaRatioFromValue`, `lockChromaPointRatio`, `applyRelativeChromaParam`, `applyRelativeFixedChromaAtStep`, `applyRelativeCustomChroma`, `clampChromaParamValues`, `clampAllCustomChroma`
* **Interpolace / Bézier:** `interpolateValue`, `interpolateAcrossSteps`, `resolveParam`, `invertBezier`, `formatBezierCss`, `parseBezierCss`, `roundBezier`
* **Kroky:** `getSteps`, `getEndStep`
* **Published steps:** `formatIncludeSteps`, `parseIncludeStepsInput`, `resolveIncludeSteps`, `normalizeIncludeSteps`, `isFullIncludeSteps`, `isSingleIncludeStep`, `collapseParamsForSingleIncludeStep`
* **Brand seed:** `parseBrandHex`, `nearestStepForTone`, `fitBezierForTone`, `applyBrandColor`
* **Generování po kouskách:** `generateKeyPalette`, `generateKeyPalettes`, `generateCustomPaletteForMode`
* **Tokeny:** `buildTokensCss(state, keyResults, customResults, steps, endStep)` — skládá CSS z **už spočítaných** palet (negeneruje znovu); custom jen `includeSteps`
* **Jména:** `sanitizePaletteName`, `filterPaletteNameInput`

---

## 6. Chování `generateSystem` (mutace)

Pořadí uvnitř:

1. Spočítá key palety z aktuálního `stepCount`.
2. **`applyRelativeCustomChroma`** — u interpolate chroma přepíše ve `state`: `ratio`, `value`, `gamutLimit`. Při `includeSteps` s právě 1 krokem collapsuje H/C na fixed a chromu remapuje relative na tom kroku.
3. **`clampAllCustomChroma`** — safety ořez interpolate `value` do HCT limitu (a případně doladí `ratio`).
4. Spočítá custom palety (LM/DM) na **plné** mřížce.
5. Složí `tokensCss` (custom kroky filtrované `includeSteps`) + vrátí i `config` z `exportEngineConfig`.

**Fixed chroma** (2+ published kroků) ve state se v tomto kroku **nemění** (může sedět nad peakem; při výpočtu barvy kroku se C stejně clampne).

### Relative chroma (interpolate / single published step)

* Záměr = **`ratio`** (podíl max C na daném kroku / hue / tone).
* **`value`** = odvozené absolutní C (`round(ratio * limit)`).
* Explicitní edit C (GUI/kód): `lockChromaPointRatio(point|fixedParam, value, limit)`.
* Když někdo změní jen `value` bez locku a `gamutLimit` už je nastavené, další `generateSystem` to detekuje jako edit a přepočte `ratio`.

---

## 7. Změna počtu kroků (`normalizeStateForStepCount`)

Volat **po** nastavení `state.stepCount` (před `generateSystem` / render).

| Body | Chování |
| :--- | :--- |
| Start (první krok mřížky, typicky `10`) | Zůstane; hodnota beze změny |
| End (poslední krok) | Přesune se na nový end; **hodnota konce** zůstane |
| Střední | Relativní pozice `t` na staré škále → nejbližší **volný** prostřední slot |
| Zahazování | Jen když `počet středních > počet prostředních slotů` (nechá se zleva podle `t`) |

Hue i chroma interpolate parametry se normalizují stejně. Počet Bézier segmentů se dorovná na `points.length - 1`. `includeSteps` se prožene `normalizeIncludeSteps` (neplatné id pryč; plná mřížka → `null`).

---

## 8. Výstupní CSS tokeny

`tokensCss` je jeden blok `:root { … }`.

Příklady jmen (po `sanitizePaletteName`):

* `--key-palette-0`, `--key-palette-10`, …, `--key-palette-{end+10}`
* `--key-palette-start`, `--key-palette-end`, `--key-tone-interpolator`
* totéž pro DM: `--key-palette-dm-…`, `--key-dm-tone-interpolator`
* custom: `--{name}-10`, … (jen kroky z `includeSteps`; `0` a `end+10` vždy), `--{name}-dm-…`, `--{name}-hue-interpolator`, `--{name}-chroma-interpolator` (u více segmentů `-1`, `-2`, …)

Hex barvy; u kroků palety jsou v komentáři T nebo H/C.

---

## 9. Runtime detaily

* **`palette.id`** (`palette-1`, …) — jen session / GUI / klíč v `customPalettes` výsledku. Po importu vždy nové. Do config ani do CSS jmen tokenů nepatří.
* **Názvy palet** — `sanitizePaletteName`; GUI při psaní `filterPaletteNameInput`.
* **Závislosti** — HCT přes `../lib/material-color-utilities.mjs` (ESM).

---

## 10. Vrstvy (orientace)

```text
README.md (spec)     →  co systém znamená a co se ovládá
src/color-engine.js  →  jak se to počítá
src/DEV.md           →  jak to volat z kódu
app/*                →  jak to ovládat v browseru (nad enginem)
```
