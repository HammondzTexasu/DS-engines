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
│   └── color-config.json     # Projektový config (playground načte prioritně)
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
1. `config/color-config.json` (pokud fetch OK + validní) → `importEngineConfig`
2. jinak engine `createDefaultState()`
3. GUI Import v session přepíše aktuální stav (nesahá na soubor)

Playground bere config relativně (`../config/color-config.json` z `app/`). Hostitel musí ten soubor doručit spolu s `app/` — jinak boot spadne na engine default.

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

**Playground** při startu zkusí načíst `../config/color-config.json`; při chybě spadne na B.

**Důležité:** `generateSystem(state)` **může změnit** interpolate chroma body přímo ve `state` (viz §6). Nejde o čistou funkci „jen výstup“.

---

## 4. Config JSON

Zdroj pravdy pro uložení / sdílení nastavení.

```json
{
  "stepCount": 10,
  "keyPalette": {
    "lm": { "/* min, max, start, end, interpolator, states */": "…" },
    "dm": { "/* …, interpolatorOverride, states (deltas only) */": "…" }
  },
  "customPalettes": [
    {
      "name": "accent",
      "includeSteps": [40],
      "includeStepsDm": [50, 60],
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

* `customPalettes[].name` — sanitizuje se (`a–z`, `0–9`, `-`); runtime `id` se do JSON **neukládá**.
* `customPalettes[].includeSteps` — volitelné; `null` / vynecháno / celá key mřížka = publikovat vše včetně `0`/`max` + ghost `0-state*`. Jinak unikátní seřazené step id (**bez** pólů). Bez override: `_includeTones` + T-remap při `stepCount`. S LM `colorOverride`: `_includeOffsets` od override stepu (hex T) při key změně i `stepCount`. Při 1 published kroku **per mode** (LM / dirty DM / DM inherit) engine collapsuje H/C toho módu na fixed a chromu drží relative (`ratio`).
* `customPalettes[].includeStepsDm` — volitelné; `null` / vynecháno = **inherit LM** (včetně LM sync). Po nastavení = dirty: runtime `[]` = dirty full (vždy aktuální mřížka; exportuje se jako úplný seznam), jinak partial kolem DM override / `_includeTonesDm`. Clear → inherit.
* **`brand`** (volitelné) — `{ hex, perfectFit, overrideNearest, palette }`; `perfectFit` ⊥ `overrideNearest` (PF vyhraje). Orphan `palette` → drop brand.
* **`customPalettes[].colorOverride`** (volitelné) — `{ hex }`; sticky LM hex lock; step = nearest key T (neukládá se).
* **`customPalettes[].colorOverrideDm`** (volitelné) — totéž pro DM; nezávislé na LM.
* **ParamConfig**
  * `{ "mode": "fixed", "value": number, "ratio"?, "relativeInterpolateChroma"? }` — Relative: `ratio` × limit kroku; UI 100 % = peak marker
  * `{ "mode": "interpolate", "points": [...], "interpolators": [...], "clampInterpolatedChroma"?, "relativeInterpolateChroma"?, "hueArc"? }`  
    * `clampInterpolatedChroma` (jen chroma; default `false`) — `true` = relative/clamp bodů i mezikroků (absolutní interpolace `value`)  
    * `relativeInterpolateChroma` (jen chroma; Fixed i Interpolate; default `false`) — `true` = `ratio` (0–1) × limit kroku; u interpolate **implikuje clamp**
    * `hueArc` (jen hue interpolate; default `shortest`) — `shortest` \| `longest` \| `linear` \| `increasing` \| `decreasing`  
      (`linear` = raw stupně; `increasing`/`decreasing` = vždy ten směr na kruhu, bez speciálů)
* **Interpolate point:** `{ "step", "value", "ratio"? }`  
  * `ratio` (0–1) = relativní chroma intent (exportováno u chroma při clamp on)  
  * `gamutLimit` = jen runtime, **nikdy** do JSON
* **`keyPalette.lm.states`** — plná strategie + LM delty:
  * `{ "deltaMin", "deltaMax", "state2Scale", "relativeChroma", "delivery", "space", "oklchGamut", "pivotTone" }`
  * `delivery`: `"build"` \| `"runtime"`; `space`: `"hct"` \| `"oklch"`; `oklchGamut`: `"srgb"` \| `"p3"`
  * `relativeChroma` default `true`; `pivotTone` default `40` (HCT T)
  * `pivotTone` — absolutní HCT T práh: `T <= pivotTone` → zesvětlit, jinak ztmavit
* **`keyPalette.dm.states`** — jen delty `{ "deltaMin", "deltaMax", "state2Scale" }` (shared bere z LM; extra klíče se při importu ignorují)
* Matika states vždy z HCT T; OKLCH/runtime jen aplikace Δ na L. `bg` **není** v configu — `bgHex` do API.
* `colorAtInteractionState(color, bgHex, states, level, pivotTone)`

**Export** (`exportEngineConfig`): fixed chroma ořízne na peak (nebo Relative / 1 published krok → `ratio` + flag); interpolate s `clampInterpolatedChroma: true` → relative + clamp + flag v JSON; default (off) → absolutní C, flag vynechán; bez `gamutLimit`; `includeSteps` jen když není plná mřížka; `includeStepsDm` jen když je dirty; `states` + volitelný `brand` s key palette / brand.

**Import** (`importEngineConfig`): validace → nové `id` palet → normalizace `includeSteps` / `includeStepsDm` → clamp/relative normalizace chroma; chybějící `states` → defaulty; orphan `brand.palette` → `brand: null`.

---

## 5. Veřejné API (`color-engine.js`)

### 5.1 Produktové (používej tohle)

| API | Účel |
| :--- | :--- |
| `createDefaultState()` | Výchozí engine state |
| `createCustomPalette(name?)` | Nová custom paleta (+ runtime `id`, `includeSteps` / `includeStepsDm: null`) |
| `moveCustomPalette(state, id, ±1)` | Pořadí custom palet v poli (config) |
| `createFixedParam(value)` / `createInterpolateParam(...)` | H/C parametry |
| `createDefaultInteractionStates()` | LM default: deltas + `delivery: build`, `space: hct`, `relativeChroma: true`, `oklchGamut: srgb`, `pivotTone: 40` |
| `createDefaultInteractionDeltas(forDm?)` | Jen `deltaMin` / `deltaMax` / `state2Scale` (DM default při `true`) |
| `normalizeStoredInteractionStates(states)` | LM config/GUI shape — **bez** runtime override space/relative; clamp `pivotTone` |
| `resolveInteractionStates(states)` | Efektivní LM (runtime → OKLCH + relative off; nemění uložené preference) |
| `resolveInteractionDeltas(deltas, forDm?)` | Normalizace DM/LM deltas (clamp: Δ 0…`STATE_DELTA_LIMIT`, scale `STATE2_SCALE_MIN`…`MAX`) |
| `resolveModeInteractionStates(keyPalette, mode)` | Efektivní stavy: LM strategy + mode deltas |
| `resolvePivotTone(pivotTone)` / `DEFAULT_PIVOT_TONE` | Clamp HCT T prahu 0–100 |
| `importEngineConfig(json)` | JSON → state (orphan `brand.palette` → `brand: null`) |
| `exportEngineConfig(state)` | state → JSON (kopie, state nemění kromě čtení) |
| `generateSystem(state)` | Palety + `tokensCss` + `config` (**mutuje** relative chroma / override body); volá `syncColorOverridePoints` + `applyColorOverrides` |
| `setColorOverride(palette, hex\|null, mode?, keyResult?, steps?)` | Sticky hex lock (`colorOverride` / `colorOverrideDm`); default mode `lm`. Clear → drop offsets + reseed tones from current whitelist (pass `keyResult` + `steps`) |
| `resolveColorOverrideStep(palette, keyResult, steps, mode?)` | Aktuální locknutý step id pro mód |
| `syncColorOverridePoints(state, key)` | Dosadí LM i DM interp body na override step (vyhraje slot) |
| `applyColorOverrides(state, key, custom)` | Vynutí hex 1:1 na LM / DM kroku (**voláno z** `generateSystem`) |
| `applyBrandColor(state, hex, opts?)` | Seed → H/C; `perfectFit` = ohyb + override; `overrideNearest` = jen override (mutex) |
| `clearBrandConfig(state)` | Smaže `state.brand` (křivka i sticky override zůstávají — GUI toggle undo řeší baseline zvlášť) |
| `normalizeStateForStepCount(state)` | Po změně `stepCount`: interpolate body + `syncIncludeStepsFromTones` (`pivotTone` beze změny). GUI: při Perfect fit pak znovu `applyBrandColor` |
| `colorAtInteractionState(color, bgHex, states, level, pivotTone)` | state1/state2 barva; matika T; `bgHex` = povrch za barvou |
| `interactionStateDelta(...)` | Podepsané Δ z HCT T na 1 desetinu (runtime tokeny + OKLCH) |
| `roundStateDelta(n)` | Zaokrouhlení Δ na 1 desetinu |

Konstanty: `KEY_PALETTE_NAME`, `DEFAULT_BEZIER`, `LINEAR_BEZIER`, `CHROMA_MAX`, `DEFAULT_STATE_DELTA_MIN`, `DEFAULT_STATE_DELTA_MAX`, `DEFAULT_STATE_DELTA_MIN_DM`, `DEFAULT_STATE_DELTA_MAX_DM`, `DEFAULT_STATE2_SCALE`, `STATE_DELTA_LIMIT`, `STATE2_SCALE_MIN`, `STATE2_SCALE_MAX`, `DEFAULT_PIVOT_TONE`.
### 5.2 Low-level (playground / tooling)

Headless pipeline je typicky nepotřebuje; `app/` je používá.

* **HCT:** `hctToHex`, `hexToHct`, `clampChroma`, `maxChromaForHueTone`, `peakChromaForSteps`
* **Interaction states:** `normalizeStoredInteractionStates`, `resolveInteractionStates`, `resolveInteractionDeltas`, `resolveModeInteractionStates`, `resolvePivotTone`, `applyInteractionTone`, `interactionStateDelta`, `roundStateDelta`  
  * Matika vždy HCT T (`T <= pivotTone` → zesvětlit); Δ na 1 desetinu; OKLCH/runtime jen aplikace. Uložené preference (space/relative/gamut) přežijí runtime.
* **Chroma politika:** `chromaLimitAtStep`, `chromaRatioFromValue`, `lockChromaPointRatio`, `isClampInterpolatedChroma`, `isRelativeChroma`, `isRelativeInterpolateChroma`, `resolveChromaAtStep`, `applyRelativeChromaParam`, `applyRelativeFixedChroma`, `applyRelativeFixedChromaAtStep`, `applyRelativeCustomChroma`, `clampChromaParamValues`, `clampAllCustomChroma`
* **Interpolace / Bézier:** `interpolateValue`, `interpolateAcrossSteps`, `resolveParam` (hue: `asHue` → `hueInterpDelta` / `hueArc`), `resolveHueArc`, `HUE_ARC_MODES`, `invertBezier`, `formatBezierCss`, `parseBezierCss`, `roundBezier`
* **Kroky:** `getSteps`, `getEndStep`
* **Published steps:** `formatIncludeSteps`, `parseIncludeStepsInput`, `resolveIncludeSteps`, `resolvePublishedIncludeSteps`, `normalizeIncludeSteps`, `setIncludeStepsIntent`, `setIncludeStepsDmIntent`, `syncIncludeStepsFromTones`, `isFullIncludeSteps`, `isDirtyFullIncludeStepsDm`, `isFullPublishedIncludeSteps`, `isSinglePublishedIncludeStep`, `collapseParamsForSingleIncludeStep`
* **Brand seed:** `parseBrandHex`, `nearestStepForTone`, `fitBezierForTone`, `applyBrandColor`, `clearBrandConfig`, `resolveBrandPalette`
* **Color override:** `setColorOverride`, `resolveColorOverrideStep`, `syncColorOverridePoints`, `applyColorOverrides`
* **Generování po kouskách:** `generateKeyPalette`, `generateKeyPalettes`, `generateCustomPaletteForMode`
* **Tokeny:** `buildTokensCss(...)` — barvy min/steps/max; build = per-palette `state1`/`state2` hex; runtime = univerzální `--state-*-state1|2` / `--state-dm-*` (Δ z T, key krok)
* **Jména:** `sanitizePaletteName`, `filterPaletteNameInput`

---

## 6. Chování `generateSystem` (mutace)

Pořadí uvnitř:

1. Spočítá key palety z aktuálního `stepCount`.
2. **`syncIncludeStepsFromTones`** — s `requireColorOverride: true` (v `generateSystem`): jen módy, které **mají** override (LM `colorOverride` / dirty DM + `colorOverrideDm`) → offsety kolem override stepu. Dirty DM bez DM ov se tu nepřemapuje. Bez flagu (`stepCount`): LM vždy + dirty DM; s override = offsety, bez = `_includeTones` / `_includeTonesDm`. DM `null` = inherit, nesyncuje se zvlášť.
3. **`applyRelativeCustomChroma`** — u interpolate chroma s clamp on přepíše ve `state`: `ratio`, `value`, `gamutLimit`. Při `clampInterpolatedChroma: false` přeskočí. Při 1 published kroku **per mode** collapsuje H/C na fixed a chromu remapuje relative na tom kroku.
4. **`clampAllCustomChroma`** — safety ořez interpolate `value` do HCT limitu (při clamp on).
5. **`syncColorOverridePoints`** — u palet s `colorOverride` / `colorOverrideDm` drží LM / DM interp body na nearest-T kroku (value z hexu; override vyhraje slot).
6. Spočítá custom palety (LM/DM) na **plné** mřížce (mezikroky: clamp on → `clampChroma`; clamp off → raw interpolované C).
7. **`applyColorOverrides`** — vynutí přesný hex na LM / DM kroku.
8. Složí `tokensCss` (custom kroky filtrované per-mode `includeSteps` / `includeStepsDm`) + vrátí i `config` z `exportEngineConfig` (včetně volitelného `brand` / `colorOverride` / `colorOverrideDm`).

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

Hue i chroma interpolate parametry se normalizují stejně. Počet Bézier segmentů se dorovná na `points.length - 1`. Whitelist při `stepCount`: s override = offsety od override stepu, bez = tones; dirty DM zvlášť. Key křivka hýbe whitelistem jen s příslušným `colorOverride`. `pivotTone` se při `stepCount` nemění.

---

## 8. Výstupní CSS tokeny

`tokensCss` je jeden blok `:root { … }` — **jen barvy** (hex). Interpolátory, `start`/`end` tony a H/C parametry žijí v config JSON.

Příklady jmen (po `sanitizePaletteName`):

* `--key-palette-0`, `--key-palette-10`, …, `--key-palette-{end+10}`
* totéž pro DM: `--key-palette-dm-…`
* full custom: stejně včetně `0` / `end+10` + `--*-0-state1|2` → `var(--*-10|20)`
* partial `includeSteps` / dirty `includeStepsDm`: jen whitelisted kroky (**bez** `0` / `max` / ghost `0-state*`), `--{name}-dm-…`

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
AGENTS.md            →  AI workflow + krátké sharp edges
src/color-engine.js  →  jak se to počítá
src/DEV.md           →  jak to volat z kódu + caveats (§11)
app/*                →  jak to ovládat v browseru (nad enginem)
```

---

## 11. Caveats (sharp edges) — lidský výklad

Jsou to **hrany při manipulaci se stavem**, ne „po uložení se barvy rozjedou“.

**Roundtrip:** `generate → export → import → generate` při stejném configu dává **stejné CSS tokeny i vizuál**. Config je zdroj pravdy; export už nese normalizovaný intent.

Caveaty bolí u **agresivních transformací** (hodně kroků → málo, zúžení na 1 published krok, orphan brand, …). Engine rozhodne deterministicky (stejný vstup → stejný výstup), ale výsledek nemusí být intuitivní vůči designérskému „chtěl jsem zachovat dojem škály“. Pro AI actionable shrnutí: [`../AGENTS.md`](../AGENTS.md) §8.

### 11.1 `generateSystem` mutuje vstup

Volání přepíše i `state` (relative chroma body, override sync, případný collapse H/C).  
Po generate persistuj **`config` z návratové hodnoty**, ne „starý“ JSON z před generate.

### 11.2 Jeden published krok → nevratný collapse

Když mód publikuje přesně **1 krok** (nebo `stepCount === 1`), interpolate H/C se **collapsuje** na Fixed + relative chroma. Předchozí křivka se **neukládá stranou** — není Undo.  
Chceš znovu interpolate → znovu nastav body / rozšiř `includeSteps`.

### 11.3 Duplicate `name` → CSS last-wins

Tokeny se jmenují podle `name`. Dvě palety se stejným `name` → v CSS vyhraje pozdější, **bez warningu**. Runtime `id` (`palette-1`) CSS nechrání.

### 11.4 Brand seed-only drift

Brand jen jako seed (`hex` + paleta) **bez** Perfect fit / Override nearest / `colorOverride`: ruční drift H/C v GUI **odlinkuje** brand.  
S PF/OV nebo sticky override brand drží (viz README). Seed-only = měkká poznámka „odkud jsme vyšli“.

### 11.5 Import brandu znovu neohýbá křivku

`brand` v JSON po importu obnoví **metadata**; **neznovu** spouští Perfect fit wizard. Výsledná křivka + `colorOverride` už mají být v exportu.  
Znovu seednout → `applyBrandColor`, ne jen import.

### 11.6 Orphan brand

`brand.palette` ukazuje na neexistující custom paletu → import nastaví `brand: null`. Nejdřív paleta, pak brand.

### 11.7 Dirty DM whitelist bez DM override

LM `includeSteps` s `colorOverride` se při změně key tonů remapuje (offsety kolem locku).  
Dirty `includeStepsDm` **bez** `colorOverrideDm` se při běžném `generateSystem` (`requireColorOverride`) **nepřemapuje** stejně. Po změně key zkontroluj DM whitelist, nebo používej inherit / DM override.

### 11.8 Relative OFF a Clamp (GUI)

V playgroundu Relative ON u interpolate **implikuje** clamp; Relative OFF typicky shodí clamp intent (návrat k absolutnímu C). V JSON jsou flagy oddělené, produktově relative ≈ „držím % gamutu“.

### 11.9 `gamutLimit` není v JSON

Peak C na kroku je runtime cache. Po importu se dopočítá. Stabilní intent = `ratio` (relative) nebo `value`, ne uložený limit.

### 11.10 Po změně `stepCount` nestačí jen generate

Volej `normalizeStateForStepCount(state)` **po** nastavení `stepCount`, **před** `generateSystem` / render — jinak body a whitelist můžou sedět na starých step id.

### 11.11 Žádné automatické testy (1.0)

Tyto hrany CI nehlídá. Spoleh: docs + manuální / AI checklist po agresivních změnách.
