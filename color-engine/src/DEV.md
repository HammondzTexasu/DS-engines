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
├── config/
│   └── engine-config.json    # Projektový config (playground načte prioritně)
├── src/
│   ├── color-engine.js       # Headless engine (jediný zdroj pravdy logiky)
│   └── DEV.md                # Tento soubor
├── lib/
│   ├── material-color-utilities.mjs
│   └── oklch-relative-chroma.mjs   # OKLCH L shift / relative C / gamut (states)
└── app/                      # Playground (DOM)
    ├── index.html
    ├── app.js
    └── engine-ui.css
```

**Priorita stavu (playground):**
1. `config/engine-config.json` (pokud fetch OK + validní) → `importEngineConfig`
2. jinak engine `createDefaultState()`
3. GUI Import v session přepíše aktuální stav (nesahá na soubor)

Playground bere config relativně (`../config/engine-config.json` z `app/`). Hostitel musí ten soubor doručit spolu s `app/` — jinak boot spadne na engine default.

---

## 3. Headless happy path

```js
import {
  importEngineConfig,
  generateSystem,
  exportEngineConfig,
  createDefaultState,
} from './color-engine.js';

// A) z JSON configu (projektový soubor, import, …)
const state = importEngineConfig(configJson);
const {
  tokensCss,   // string: :root { --key-palette-10: #…; … }
  config,      // exportnutý config (po normalizaci chroma)
  steps,
  endStep,
  keyPalettes,
  customPalettes, // keyed by runtime palette id
} = generateSystem(state);

// B) výchozí stav enginu (když local config chybí / není validní)
const fresh = createDefaultState();
const system = generateSystem(fresh);
```

**Playground** při startu zkusí načíst `../config/engine-config.json`; při chybě spadne na B.

**Důležité:** `generateSystem(state)` **může změnit** interpolate chroma body přímo ve `state` (viz §6). Nejde o čistou funkci „jen výstup“.

---

## 4. Config JSON

Zdroj pravdy pro uložení / sdílení nastavení.

```json
{
  "version": 1,
  "stepCount": 10,
  "keyPalette": {
    "lm": { "/* min, max, start, end, interpolator, states */": "…" },
    "dm": { "/* …, interpolatorOverride, states (deltas only) */": "…" }
  },
  "customPalettes": [
    {
      "name": "accent",
      "includeSteps": [40],
      "lm": { "hue": { /* ParamConfig */ }, "chroma": { /* ParamConfig */ } },
      "dm": { "hue": { /* … */ }, "chroma": { /* … */ } }
    }
  ],
  "brand": {
    "hex": "#cc0000",
    "perfectFit": true,
    "palette": "accent"
  }
}
```

* `version` — musí sedět s `ENGINE_CONFIG_VERSION` (aktuálně `1`), jinak `importEngineConfig` hodí chybu.
* `customPalettes[].name` — sanitizuje se (`a–z`, `0–9`, `-`); runtime `id` se do JSON **neukládá**.
* `customPalettes[].includeSteps` — volitelné; `null` / vynecháno / celá key mřížka = publikovat vše včetně `0`/`max` + ghost `0-state*`. Jinak unikátní seřazené step id (**bez** pólů). Bez override: `_includeTones` + T-remap při `stepCount`. S LM `colorOverride`: `_includeOffsets` od override stepu (hex T) při key změně i `stepCount`. Při 1 kroku engine collapsuje H/C na fixed a chromu drží relative (`ratio`).
* **`brand`** (volitelné) — `{ hex, perfectFit, overrideNearest, palette }`; `perfectFit` ⊥ `overrideNearest` (PF vyhraje). Orphan `palette` → drop brand.
* **`customPalettes[].colorOverride`** (volitelné) — `{ hex }`; sticky LM hex lock; step = nearest key T (neukládá se).
* **`customPalettes[].colorOverrideDm`** (volitelné) — totéž pro DM; nezávislé na LM.
* **ParamConfig**
  * `{ "mode": "fixed", "value": number, "ratio"? }` — `ratio` u single-include-step chromy (a runtime u fixed)
  * `{ "mode": "interpolate", "points": [...], "interpolators": [...], "clampInterpolatedChroma"? }`  
    * `clampInterpolatedChroma` (jen chroma; default `false`) — `true` = relative/clamp bodů i mezikroků
* **Interpolate point:** `{ "step", "value", "ratio"? }`  
  * `ratio` (0–1) = relativní chroma intent (exportováno u chroma při clamp on)  
  * `gamutLimit` = jen runtime, **nikdy** do JSON
* **`keyPalette.lm.states`** — plná strategie + LM delty:
  * `{ "deltaMin", "deltaMax", "state2Scale", "relativeChroma", "delivery", "space", "oklchGamut", "pivotTone" }`
  * `delivery`: `"build"` \| `"runtime"`; `space`: `"hct"` \| `"oklch"`; `oklchGamut`: `"srgb"` \| `"p3"`
  * `relativeChroma` default `true`; `pivotTone` default `40` (HCT T)
  * `pivotTone` — absolutní HCT T práh: `T <= pivotTone` → zesvětlit, jinak ztmavit
* **`keyPalette.dm.states`** — jen delty `{ "deltaMin", "deltaMax", "state2Scale" }` (shared bere z LM; staré shared klíče se při importu ignorují)
* Matika states vždy z HCT T; OKLCH/runtime jen aplikace Δ na L. `bg` **není** v configu — `bgHex` do API.
* `colorAtInteractionState(color, bgHex, states, level, pivotTone)`

**Export** (`exportEngineConfig`): fixed chroma ořízne na peak (nebo u 1 published kroku relative + `ratio`); interpolate s `clampInterpolatedChroma: true` → relative + clamp + flag v JSON; default (off) → absolutní C, flag vynechán; bez `gamutLimit`; `includeSteps` jen když není plná mřížka; `states` + volitelný `brand` s key palette / brand.

**Import** (`importEngineConfig`): validace → nové `id` palet → normalizace `includeSteps` → clamp/relative normalizace chroma; chybějící `states` → defaulty; orphan `brand.palette` → `brand: null`.

---

## 5. Veřejné API (`color-engine.js`)

### 5.1 Produktové (používej tohle)

| API | Účel |
| :--- | :--- |
| `createDefaultState()` | Výchozí engine state |
| `createCustomPalette(name?)` | Nová custom paleta (+ runtime `id`, `includeSteps: null`) |
| `moveCustomPalette(state, id, ±1)` | Pořadí custom palet v poli (config) |
| `createFixedParam(value)` / `createInterpolateParam(...)` | H/C parametry |
| `createDefaultInteractionStates(stepCount?)` | LM default: deltas + `delivery: build`, `space: hct`, `relativeChroma: true`, `oklchGamut: srgb`, `pivotTone: 40` |
| `createDefaultInteractionDeltas(forDm?)` | Jen `deltaMin` / `deltaMax` / `state2Scale` (DM default při `true`) |
| `normalizeStoredInteractionStates(states, steps?)` | LM config/GUI shape — **bez** runtime override space/relative; clamp `pivotTone` |
| `resolveInteractionStates(states, steps?)` | Efektivní LM (runtime → OKLCH + relative off; nemění uložené preference) |
| `resolveInteractionDeltas(deltas, forDm?)` | Normalizace DM/LM deltas |
| `resolveModeInteractionStates(keyPalette, mode, steps?)` | Efektivní stavy: LM strategy + mode deltas |
| `resolvePivotTone(pivotTone)` / `DEFAULT_PIVOT_TONE` | Clamp HCT T prahu 0–100 |
| `importEngineConfig(json)` | JSON → state (orphan `brand.palette` → `brand: null`) |
| `exportEngineConfig(state)` | state → JSON (kopie, state nemění kromě čtení) |
| `generateSystem(state)` | Palety + `tokensCss` + `config` (**mutuje** relative chroma / override body); volá `syncColorOverridePoints` + `applyColorOverrides` |
| `setColorOverride(palette, hex\|null, mode?)` | Sticky hex lock (`colorOverride` / `colorOverrideDm`); default mode `lm` |
| `resolveColorOverrideStep(palette, keyResult, steps, mode?)` | Aktuální locknutý step id pro mód |
| `syncColorOverridePoints(state, key)` | Dosadí LM i DM interp body na override step (vyhraje slot) |
| `applyColorOverrides(state, key, custom)` | Vynutí hex 1:1 na LM / DM kroku (**voláno z** `generateSystem`) |
| `applyBrandColor(state, hex, opts?)` | Seed → H/C; `perfectFit` = ohyb + override; `overrideNearest` = jen override (mutex) |
| `clearBrandConfig(state)` | Smaže `state.brand` (křivka i sticky override zůstávají — GUI toggle undo řeší baseline zvlášť) |
| `applyBrandStepOverride(...)` | Alias → `applyColorOverrides` |
| `normalizeStateForStepCount(state, previousStepCount?)` | Po změně `stepCount`: interpolate body + `syncIncludeStepsFromTones` (`pivotTone` beze změny). GUI: při Perfect fit pak znovu `applyBrandColor` |
| `colorAtInteractionState(color, bgHex, states, level, pivotTone)` | state1/state2 barva; matika T; `bgHex` = povrch za barvou |
| `interactionStateDelta(...)` | Podepsané Δ z HCT T na 1 desetinu (runtime tokeny + OKLCH) |
| `roundStateDelta(n)` | Zaokrouhlení Δ na 1 desetinu |

Konstanty: `ENGINE_CONFIG_VERSION`, `KEY_PALETTE_NAME`, `DEFAULT_BEZIER`, `LINEAR_BEZIER`, `CHROMA_MAX`, `DEFAULT_STATE_DELTA_MIN`, `DEFAULT_STATE_DELTA_MAX`, `DEFAULT_STATE_DELTA_MIN_DM`, `DEFAULT_STATE_DELTA_MAX_DM`, `DEFAULT_STATE2_SCALE`, `DEFAULT_PIVOT_TONE`.
### 5.2 Low-level (playground / tooling)

Headless pipeline je typicky nepotřebuje; `app/` je používá.

* **HCT:** `hctToHex`, `hexToHct`, `clampChroma`, `maxChromaForHueTone`, `peakChromaForSteps`
* **Interaction states:** `normalizeStoredInteractionStates`, `resolveInteractionStates`, `resolveInteractionDeltas`, `resolveModeInteractionStates`, `resolvePivotTone`, `applyInteractionTone`, `interactionStateDelta`, `roundStateDelta`  
  * Matika vždy HCT T (`T <= pivotTone` → zesvětlit); Δ na 1 desetinu; OKLCH/runtime jen aplikace. Uložené preference (space/relative/gamut) přežijí runtime.
* **Chroma politika:** `chromaLimitAtStep`, `chromaRatioFromValue`, `lockChromaPointRatio`, `isClampInterpolatedChroma`, `applyRelativeChromaParam`, `applyRelativeFixedChromaAtStep`, `applyRelativeCustomChroma`, `clampChromaParamValues`, `clampAllCustomChroma`
* **Interpolace / Bézier:** `interpolateValue`, `interpolateAcrossSteps`, `resolveParam` (hue: `asHue` → shortest-arc přes `hueInterpDelta`), `invertBezier`, `formatBezierCss`, `parseBezierCss`, `roundBezier`
* **Kroky:** `getSteps`, `getEndStep`
* **Published steps:** `formatIncludeSteps`, `parseIncludeStepsInput`, `resolveIncludeSteps`, `normalizeIncludeSteps`, `setIncludeStepsIntent`, `syncIncludeStepsFromTones`, `isFullIncludeSteps`, `isSingleIncludeStep`, `collapseParamsForSingleIncludeStep`
* **Brand seed:** `parseBrandHex`, `nearestStepForTone`, `fitBezierForTone`, `applyBrandColor`, `clearBrandConfig`, `resolveBrandPalette`
* **Color override:** `setColorOverride`, `resolveColorOverrideStep`, `syncColorOverridePoints`, `applyColorOverrides`
* **Generování po kouskách:** `generateKeyPalette`, `generateKeyPalettes`, `generateCustomPaletteForMode`
* **Tokeny:** `buildTokensCss(...)` — barvy min/steps/max; build = per-palette `state1`/`state2` hex; runtime = univerzální `--state-*-state1|2` / `--state-dm-*` (Δ z T, key krok)
* **Jména:** `sanitizePaletteName`, `filterPaletteNameInput`

---

## 6. Chování `generateSystem` (mutace)

Pořadí uvnitř:

1. Spočítá key palety z aktuálního `stepCount`.
2. **`syncIncludeStepsFromTones`** (`requireColorOverride`) — u palet s LM `colorOverride` drží whitelist jako offsety kolem override stepu (hex T). (Při `stepCount` bez flagu: s override = offsety, bez = `_includeTones`.)
3. **`applyRelativeCustomChroma`** — u interpolate chroma s clamp on přepíše ve `state`: `ratio`, `value`, `gamutLimit`. Při `clampInterpolatedChroma: false` přeskočí. Při `includeSteps` s právě 1 krokem collapsuje H/C na fixed a chromu remapuje relative na tom kroku.
4. **`clampAllCustomChroma`** — safety ořez interpolate `value` do HCT limitu (při clamp on).
5. **`syncColorOverridePoints`** — u palet s `colorOverride` / `colorOverrideDm` drží LM / DM interp body na nearest-T kroku (value z hexu; override vyhraje slot).
6. Spočítá custom palety (LM/DM) na **plné** mřížce (mezikroky: clamp on → `clampChroma`; clamp off → raw interpolované C).
7. **`applyColorOverrides`** — vynutí přesný hex na LM / DM kroku.
8. Složí `tokensCss` (custom kroky filtrované `includeSteps`) + vrátí i `config` z `exportEngineConfig` (včetně volitelného `brand` / `colorOverride` / `colorOverrideDm`).

**Fixed chroma** (2+ published kroků) ve state se v tomto kroku **nemění** (může sedět nad peakem; při výpočtu barvy kroku se C stejně clampne).

### Relative chroma (interpolate / single published step)

* Záměr = **`ratio`** (podíl max C na daném kroku / hue / tone) — jen když je clamp zapnutý.
* **`value`** = odvozené absolutní C (`round(ratio * limit)`), nebo absolutní C bez clamp.
* Explicitní edit C (GUI/kód): `lockChromaPointRatio(point|fixedParam, value, limit)` (clamp on).
* Když někdo změní jen `value` bez locku a `gamutLimit` už je nastavené, další `generateSystem` to detekuje jako edit a přepočte `ratio` (clamp on).
* API: `isClampInterpolatedChroma(chromaParam)`.
---

## 7. Změna počtu kroků (`normalizeStateForStepCount`)

Volat **po** nastavení `state.stepCount` (před `generateSystem` / render).

| Body | Chování |
| :--- | :--- |
| Start (první krok mřížky, typicky `10`) | Zůstane; hodnota beze změny |
| End (poslední krok) | Přesune se na nový end; **hodnota konce** zůstane |
| Střední | Relativní pozice `t` na staré škále → nejbližší **volný** prostřední slot |
| Zahazování | Jen když `počet středních > počet prostředních slotů` (nechá se zleva podle `t`) |

Hue i chroma interpolate parametry se normalizují stejně. Počet Bézier segmentů se dorovná na `points.length - 1`. `includeSteps` při `stepCount`: s override = offsety od override stepu, bez = `_includeTones`. Key křivka hýbe whitelistem jen s LM `colorOverride` (offsety). `pivotTone` se při `stepCount` nemění.

---

## 8. Výstupní CSS tokeny

`tokensCss` je jeden blok `:root { … }` — **jen barvy** (hex). Interpolátory, `start`/`end` tony a H/C parametry žijí v config JSON.

Příklady jmen (po `sanitizePaletteName`):

* `--key-palette-0`, `--key-palette-10`, …, `--key-palette-{end+10}`
* totéž pro DM: `--key-palette-dm-…`
* full custom: stejně včetně `0` / `end+10` + `--*-0-state1|2` → `var(--*-10|20)`
* partial `includeSteps`: jen whitelisted kroky (**bez** `0` / `max` / ghost `0-state*`), `--{name}-dm-…`

U kroků palety jsou v komentáři T (key) nebo H/C (custom).

---

## 9. Runtime detaily

* **`palette.id`** (`palette-1`, …) — jen session / GUI / klíč v `customPalettes` výsledku. Po importu vždy nové. Do config ani do CSS jmen tokenů nepatří.
* **Názvy palet** — `sanitizePaletteName`; GUI při psaní `filterPaletteNameInput`.
* **Závislosti** — HCT: `../lib/material-color-utilities.mjs`; OKLCH L-shift / relative C / gamut (interaction states): `../lib/oklch-relative-chroma.mjs`. Obě ESM.

---

## 10. Vrstvy (orientace)

```text
README.md (spec)     →  co systém znamená a co se ovládá
src/color-engine.js  →  jak se to počítá
src/DEV.md           →  jak to volat z kódu
app/*                →  jak to ovládat v browseru (nad enginem)
```
