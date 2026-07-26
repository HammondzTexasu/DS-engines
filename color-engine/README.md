# Design System: AI-Ready Color Engine

Tento projekt definuje základní pilíř design systému založený na barevném modelu **HCT (Hue, Chroma, Tone)** od Googlu. Cílem je vytvořit programově ovladatelný systém, který zajišťuje vizuální konzistenci a kontrastní integritu napříč barevnými schématy a světlým a tmavým režimem.

Engine prozatím **generuje config a CSS tokeny** (CSS = jen barvy). Jak je projekt spotřebuje, řeší jiné vrstvy.

**Konfigurace:** výchozí hodnoty žijí v enginu (`createDefaultState`). Projektový soubor [`config/engine-config.json`](./config/engine-config.json) má prioritu — playground ho při startu načte; když chybí nebo selže, použije se engine default. GUI Import přepíše jen aktuální session.

Vývojářské detaily (API, soubory, headless použití): viz [`src/DEV.md`](./src/DEV.md).

## 1. Architektonické principy
* **Technologie:** Vanilla HTML, CSS, JS (pokud možno žádné frameworky).
* **Color Model:** Google HCT (zajišťuje vnímání jasu nezávisle na odstínu a sytosti).
* **Základní paleta:** `key-palette` (H=0, C=0, stupně šedi).
* **Light / Dark varianty:** Každá paleta — `key-palette` i všechny odvozené — existuje ve dvou verzích: bez suffixu pro Light Mode a se suffixem `-dm` pro Dark Mode (např. `key-palette` / `key-palette-dm`, `custom-palette` / `custom-palette-dm`). Odvozené palety dědí světlostní stupně z odpovídající verze `key-palette`.
* **Stupňování palety:** Variabilní počet kroků světelnosti, defaultně **10** — číslovány od **10** po `end` v krocích po 10 (při 10 krocích: `10, 20, 30 … 100`). První pozice je vždy **10**.
* **Mimo paletu:** Kroky `0` (`min`) a `end + 10` (`max`) **nepatří do palety**. Jsou to hardcoded primitives — extrémní barvy mimo interpolovaný rozsah (typicky pozadí a nejkontrastnější popředí). V DM variantě jsou role `min` a `max` **opačné** než v LM (světlá/tmavá extréma se prohodí).

## 2. Logika interpolace
Interpolace mezi klíčovými body (`start`, `end`, případně mezikroky) probíhá pomocí kubických Bézierových křivek. Stejný princip platí pro Tone (T), Hue (H) i Chroma (C). Hue interpolate volitelně `hueArc`: `shortest` (default) \| `longest` \| `increasing` \| `decreasing`.

**Key-palette — interpolace Tone:**

* **Light Mode (LM):** `cubic-bezier(0.32, 0.18, 0.68, 0.77)` (alias: `key-tone-interpolator`) → `key-palette`
* **Dark Mode (DM):** Matematicky invertovaná křivka `key-tone-interpolator`
    * *Vzorec:* `x1'=1-x2, y1'=1-y2, x2'=1-x1, y2'=1-y1`
    * Výsledná: `cubic-bezier(0.32, 0.23, 0.68, 0.82)` (alias: `key-dm-tone-interpolator`) → `key-palette-dm`
* **Zaokrouhlování:** Všechny hodnoty vygenerované interpolátorem (Tone, H, C) se zaokrouhlují na **celá čísla**.

## 3. Primitives & Tokens
Systém umožňuje úpravu následujících proměnných a interpolátorů (v **configu** / enginu). Do CSS tokenů jdou jen **barvy**.

| Proměnná / Interpolátor | Typ | Popis |
| :--- | :--- | :--- |
| `min` | Barva (CSS) | Extrémní barva na pozici `0` — mimo paletu (defaultně nejsvětlejší v LM) |
| `max` | Barva (CSS) | Extrémní barva na pozici `end + 10` — mimo paletu (defaultně nejtmavší v LM) |
| kroky `10…end` | Barva (CSS) | Interpolované barvy palety |
| `start` | Config | Tone klíčového bodu `10` — začátek interpolace |
| `end` | Config | Tone klíčového bodu posledního kroku (při 10 krocích: `100`) |
| `key-tone-interpolator` | Config | Bézier křivka pro Tone v `key-palette` (LM) |
| `key-dm-tone-interpolator` | Config | Bézier křivka pro Tone v `key-palette-dm` (DM) |

**Výchozí hodnoty Tone pro `start` a `end`:**

| Paleta | `start` (krok 10) | `end` (krok 100) | Směr |
| :--- | :--- | :--- | :--- |
| `key-palette` (LM) | 96 (světlá) | 7 (tmavá) | světlá → tmavá |
| `key-palette-dm` (DM) | 8 (tmavá) | 93 (světlá) | tmavá → světlá |

## 4. Odvozené palety (Custom Palettes)
Odvozené palety dědí světlostní stupně z `key-palette` (resp. `key-palette-dm` u varianty `-dm`), ale umožňují:
1.  **Override H a C:** Nastavení vlastního odstínu a sytosti.
2.  **Vlastní interpolátory** (config / engine, ne CSS tokeny):
    * `[nazev]-hue-interpolator`
    * `[nazev]-chroma-interpolator`
    * Podpora vícebodové interpolace (např. suffix `-1`, `-2` pro případ interpolace mezi více body, např. 10–50–100, tedy interpolátor mezi 10–50 a druhý mezi 50–100). Kroky `min` a `max` se do interpolace H/C nepočítají.

**Chroma (interpolate):** defaultně absolutní C u kontrolních bodů i mezikroků (může být nad gamutem; hex stejně projde HCT). Volitelně `clampInterpolatedChroma: true` — drží **ratio** na bodech a clampuje. Volitelně `relativeInterpolateChroma: true` — mezikroky interpolují **ratio** (ne absolutní C), pak × limit kroku; implikuje clamp.

**Chroma (fixed):** defaultně absolutní C (může sedět nad peakem; render clampuje per step). Volitelně stejný `relativeInterpolateChroma: true` — jeden **ratio**, `C = round(ratio × limit kroku)`; UI 100 % = peak marker.

**GUI Relative:** společný toggle Fixed/Interpolate; number 0–100 %; slider absolutní C + marker.

**Published steps (`includeSteps` / `includeStepsDm`):** whitelist kroků mřížky do CSS tokenů a GUI swatchů. Generování + sync s key zůstává na plné mřížce.
* LM `includeSteps`: `null` / vynecháno / celá mřížka → publikuje se vše včetně `0` / `max` + ghost `--*-0-state1|2`
* DM `includeStepsDm`: `null` / vynecháno → **stejné jako LM** (včetně LM sync). Po editaci = dirty; `[]` runtime / export plný seznam = dirty full (vždy aktuální mřížka); clear → znovu inherit. Partial = tones/offsets kolem **DM** override.
* např. `[40]` nebo `[20, 40, 60]` → jen tyto kroky (**bez** `0` / `max` / ghost `0-state*`)
* Intent: bez override = `_includeTones` / `_includeTonesDm` (T-remap při `stepCount`); s `colorOverride` / `colorOverrideDm` = `_includeOffsets` / `_includeOffsetsDm` od override stepu (hex T). Do JSON jdou jen step id.
* **1 published krok (per mode):** Fixed vs Interpolate nemá smysl — engine collapsuje H/C na **Fixed** (nevratně; křivku neobnoví) a chromu drží jako relative % gamutu (`ratio`). Stejné při `stepCount === 1` (celá mřížka = jeden krok).

**Změna počtu kroků palety:** krajní body interpolace drží své hodnoty (konec se jen přesune na nový poslední krok). Střední body drží **relativní pozici** na škále; zahodí se jen když jich je víc, než je volných prostředních kroků. Whitelist se drží přes tones/offsets (viz výše).

**Názvy custom palet:** jen `a–z`, `0–9`, `-` (stejný tvar v configu i v názvech CSS tokenů).

## 4b. Brand color (seed)

Založení škály z konkrétní barvy (headless i GUI). Seed se ukládá do configu jako `brand` (sdílení / import).

```json
"brand": {
  "hex": "#cc0000",
  "perfectFit": true,
  "overrideNearest": false,
  "palette": "palette-1"
}
```

* Najde key krok s tone nejbližším seed T.
* **Ani jedno:** jen nastaví LM hue + chroma u brand custom palety. Hex override se nenastavuje.
* **`overrideNearest: true`:** nastaví na paletě **`colorOverride`** (přesný hex na nearest-T kroku), **bez** ohybu křivky. Mutex s Perfect fit.
* **`perfectFit: true`:** ohne LM `key-tone-interpolator` + nastaví **`colorOverride`**. Mutex s Override nearest (při obou v JSON vyhraje Perfect fit).
* API: `applyBrandColor(state, hex, { perfectFit, overrideNearest, paletteId? })`, `clearBrandConfig(state)`, `setColorOverride` / `applyColorOverrides`.
* **Import** obnoví `state.brand` (GUI link / dokumentace seedu) — **ne** znovu ohýbá křivku. Orphan `brand.palette` → `brand` se zahodí.
* **GUI:** Brand hex + PF/OV zůstávají, dokud platí palette Override color / zapnuté PF·OV (edit H/C je neshazuje). Reset brand: vypnutí Override u palety, smazání brand hexu, nebo drift H/C u **seed-only** brandu (bez PF/OV a bez `colorOverride`). Ruční edit key křivky odlinkuje brand (křivku nechá).
## 4c. Override color (per palette)

Sticky hex lock na **libovolné** custom paletě — LM a DM **odděleně**, stejná pravidla:

```json
"colorOverride": { "hex": "#cc0000" },
"colorOverrideDm": { "hex": "#3366ff" }
```

* Krok = vždy **nearest key T** daného módu k tonu hexu (při změně `stepCount` / key křivky se přesune; override vyhraje slot).
* Při generate vynutí přesný hex na tom kroku (LM → `colorOverride`, DM → `colorOverrideDm`). Edit H/C override **nemaze**.
* Interpolate: na tom kroku je control point (křivka platí), step + value **read-only**.
* GUI: Hue & Chroma (LM) / (DM) → toggle Override color + hex + info step.
* Brand (`perfectFit` / `overrideNearest`) sahá jen na LM `colorOverride`.

## 5. Interaction states (delta T → delivery)

Stavy na **krocích palety** (ne `min`/`max` — až na ghost níže).

* **Sdílená strategie** (jen `keyPalette.lm.states`): `delivery`, `space`, `relativeChroma`, `oklchGamut`, `pivotTone`
* **Per mode deltas:** `deltaMin` / `deltaMax` / `state2Scale` — LM i DM (DM config má jen tyto tři)
* **Matika vždy HCT T:** `|ΔT| = deltaMin + (|T − T_bg| / 100) × (deltaMax − deltaMin)` (LM default 5/20; DM 8/15). `deltaMax < deltaMin` je povolené (invertovaný průběh).
* **Stropy:** `deltaMin` / `deltaMax` ∈ 0…40 (`STATE_DELTA_LIMIT`); `state2Scale` ∈ 1…4. Engine i GUI stejné; mimo rozsah se clampne.
* **`pivotTone`:** absolutní HCT T práh (default 40). `T <= pivotTone` → zesvětlit, jinak ztmavit. DM dědí z LM.
* **`bg`** = povrch za barvou (playground: key `min`) — do matiky jde jeho HCT T
* **state1** = 1×; **state2** = × `state2Scale` — výsledné |Δ| / signed Δ se bere na **1 desetinu** (build i runtime tokeny)
* **OKLCH / runtime** jen provedení: stejné Δ z T se přičte k OKLCH L (případně relative C / gamut)
* **Ghost `0`:** na full paletách (key + custom bez partial whitelist) `--*-0-state1` → `var(--*-10)`, `--*-0-state2` → `var(--*-20)` (grid jump, ne Δ; build i runtime). Playground u swatche `0`: hover/pressed fill preview (bez T/L labelu).

### Delivery

| `delivery` | Space | Relative chroma | CSS tokeny |
| :--- | :--- | :--- | :--- |
| **`build`** (default) | `hct` nebo `oklch` | volitelně | `--{prefix}-{step}-state1` / `state2` (hex); full: `--*-0-state1|2` → `var(--*-10|20)` |
| **`runtime`** | vždy OKLCH | vypnuto | univerzální `--state-{step}-state1` / `state2` + `--state-dm-…` (Δ z T); full: `--*-0-state1|2` → `var(--*-10|20)` |

* Build + OKLCH: `oklchGamut` vždy (i bez relative — clamp C). GUI: runtime zamkne Space na OKLCH + Relative off (preference v configu zůstanou).
* **Build** použití (komentář v `tokensCss`): `background: var(--palette-1-50-state1);` — hex tokeny; `state1` ≈ hover, `state2` ≈ pressed. Step `0`: `--*-0-state1|2` → `var(--*-10|20)`.
* **Runtime** použití (komentář v `tokensCss`) — Δ na L, výsledek oříznout do sRGB přes `rgb(from …)`:
  `rgb(from oklch(from var(--palette-1-50) calc(l + var(--state-50-state1) / 100) c h) r g b)` — token je 0–100, CSS `l` je 0–1. Δ: LM `--state-…`, DM `--state-dm-…`.
* Playground runtime hover/pressed používá stejný CSS zápis; build zůstává u JS hex.
* Playground: hover/pressed → `T:` (HCT) nebo `L: L_rest + Δ` (OKLCH / runtime; ne L z hex roundtripu).
* API: `resolveModeInteractionStates`, `resolvePivotTone`, `colorAtInteractionState(color, bgHex, states, level, pivotTone)`.
