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
Interpolace mezi klíčovými body (`start`, `end`, případně mezikroky) probíhá pomocí kubických Bézierových křivek. Stejný princip platí pro Tone (T), Hue (H) i Chroma (C).

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

**Chroma (interpolate):** defaultně absolutní C u kontrolních bodů i mezikroků (může být nad gamutem; hex stejně projde HCT). Volitelně `clampInterpolatedChroma: true` — drží **relativní podíl** dostupného gamutu a clampuje body i mezikroky.

**Fixed chroma:** požadovaná hodnota může zůstat i nad peakem gamutu; při vykreslení kroku se C stejně ořízne do HCT.

**Published steps (`includeSteps`):** whitelist kroků mřížky, které jdou do CSS tokenů a GUI swatchů. Generování + sync s key zůstává na plné mřížce; `min`/`max` se tímto filtrem neřeší (vždy).
* `null` / vynecháno / celá mřížka → publikuje se vše (`10-20-…-end`)
* např. `[40]` nebo `[20, 40, 60]` → jen tyto kroky
* **1 published krok:** Fixed vs Interpolate nemá smysl — chroma se chová jako interpolate bod (relative % gamutu). Při 2+ krocích zůstává Fixed/Interpolate jako dřív.

**Změna počtu kroků palety:** krajní body interpolace drží své hodnoty (konec se jen přesune na nový poslední krok). Střední body drží **relativní pozici** na škále; zahodí se jen když jich je víc, než je volných prostředních kroků. `includeSteps` se po změně `stepCount` znovu normalizuje proti nové mřížce.

**Názvy custom palet:** jen `a–z`, `0–9`, `-` (stejný tvar v configu i v názvech CSS tokenů).

## 4b. Brand color (seed)

Založení škály z konkrétní barvy (headless i GUI). Seed se ukládá do configu jako `brand` (sdílení / import).

```json
"brand": {
  "hex": "#cc0000",
  "perfectFit": true,
  "palette": "palette-1"
}
```

* Najde key krok s tone nejbližším seed T.
* **`perfectFit: false`:** jen nastaví LM hue + chroma u brand custom palety (podle `paletteId` / jména `palette`, default první). Override hexu se neaplikuje.
* **`perfectFit: true`:** navíc ohne aktuální LM `key-tone-interpolator` (minimální odchylka od současné křivky), aby ten krok měl seed T, a při `generateSystem` **vynutí seed hex 1:1** na tom LM kroku (hex override při generování — křivka + HCT zaokrouhlení jinak hex mírně posunou). DM zůstává default (invert LM, pokud není override).
* API: `applyBrandColor(state, hex, { perfectFit, paletteId? })`, `clearBrandConfig(state)`, `applyBrandStepOverride` (volá ho `generateSystem`).
* **Import** obnoví jen `state.brand` (a GUI link) — **ne** znovu ohýbá křivku; H/C a interpolátor už jsou v configu. Hex override běží až při generování. `brand.palette` musí sedět na existující custom paletu, jinak se `brand` při importu **zahodí**.
* **GUI:** link zrcadlí `state.brand`; při změně `stepCount` a zapnutém Perfect fit se seed znovu aplikuje (`applyBrandColor`). Ruční edit LM H/C brand palety / smazání linku / vypnutí Perfect fit → `brand` z configu pryč; **ohnutá LM křivka zůstává**, dokud ji uživatel nezmění.

## 5. Interaction states (delta T → delivery)

Stavy na **krocích palety** (ne `min`/`max`).

* **Sdílená strategie** (jen `keyPalette.lm.states`): `delivery`, `space`, `relativeChroma`, `oklchGamut`, `pivotStep`
* **Per mode deltas:** `deltaMin` / `deltaMax` / `state2Scale` — LM i DM (DM config má jen tyto tři)
* **Matika vždy HCT T:** `|ΔT| = deltaMin + (|T − T_bg| / 100) × (deltaMax − deltaMin)` (LM default 5/20; DM 8/15)
* **`pivotStep`:** krok key mřížky; prah = **T** toho kroku. `T_barvy > T_prah` → ztmavit, jinak zesvětlit. Při změně `stepCount` se step proporčně přemapuje. DM dědí z LM.
* **`bg`** = povrch za barvou (playground: key `min`) — do matiky jde jeho HCT T
* **state1** = 1×; **state2** = × `state2Scale` — výsledné |Δ| / signed Δ se bere na **1 desetinu** (build i runtime tokeny)
* **OKLCH / runtime** jen provedení: stejné Δ z T se přičte k OKLCH L (případně relative C / gamut)

### Delivery

| `delivery` | Space | Relative chroma | CSS tokeny |
| :--- | :--- | :--- | :--- |
| **`build`** (default) | `hct` nebo `oklch` | volitelně | `--{prefix}-{step}-state1` / `state2` (hex) |
| **`runtime`** | vždy OKLCH | vypnuto | univerzální `--state-{step}-state1` / `state2` + `--state-dm-…` (Δ z T; kotva = key krok; aplikace jako OKLCH L) |

* Build + OKLCH: `oklchGamut` vždy (i bez relative — clamp C). GUI: runtime zamkne Space na OKLCH + Relative off (preference v configu zůstanou).
* Runtime použití (také komentář v `tokensCss`): `oklch(from var(--palette-1-50) calc(l + var(--state-50-state1) / 100) c h)` — token je 0–100, CSS `l` je 0–1.
* Playground runtime hover/pressed používá stejný CSS zápis (tokeny injektované do DOM); build zůstává u JS hex.
* Playground: hover/pressed → `T:` (HCT) nebo `L: L_rest + Δ` (OKLCH / runtime; ne L z hex roundtripu).
* API: `resolveModeInteractionStates`, `resolvePivotTone`, `colorAtInteractionState(color, bgHex, states, level, pivotTone)`.
