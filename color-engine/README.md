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

**Chroma (interpolate):** defaultně drží **relativní podíl** dostupného gamutu a clampuje body i mezikroky. Volitelně `clampInterpolatedChroma: false` — absolutní C u kontrolních bodů i mezikroků (může být nad gamutem; hex stejně projde HCT).

**Fixed chroma:** požadovaná hodnota může zůstat i nad peakem gamutu; při vykreslení kroku se C stejně ořízne do HCT.

**Published steps (`includeSteps`):** whitelist kroků mřížky, které jdou do CSS tokenů a GUI swatchů. Generování + sync s key zůstává na plné mřížce; `min`/`max` se tímto filtrem neřeší (vždy).
* `null` / vynecháno / celá mřížka → publikuje se vše (`10-20-…-end`)
* např. `[40]` nebo `[20, 40, 60]` → jen tyto kroky
* **1 published krok:** Fixed vs Interpolate nemá smysl — chroma se chová jako interpolate bod (relative % gamutu). Při 2+ krocích zůstává Fixed/Interpolate jako dřív.

**Změna počtu kroků palety:** krajní body interpolace drží své hodnoty (konec se jen přesune na nový poslední krok). Střední body drží **relativní pozici** na škále; zahodí se jen když jich je víc, než je volných prostředních kroků. `includeSteps` se po změně `stepCount` znovu normalizuje proti nové mřížce.

**Názvy custom palet:** jen `a–z`, `0–9`, `-` (stejný tvar v configu i v názvech CSS tokenů).

## 4b. Brand color (seed)

Jednorázové založení škály z konkrétní barvy (headless i GUI). **Brand hex se do configu neukládá** — výsledkem jsou upravené LM tony / H·C.

* Najde key krok s tone nejbližším seed T.
* **`perfectFit: false`:** jen nastaví LM hue + chroma u brand custom palety (podle `paletteId`, default první).
* **`perfectFit: true`:** navíc ohne aktuální LM `key-tone-interpolator` (minimální odchylka od současné křivky), aby ten krok měl seed T. DM zůstává default (invert LM, pokud není override).
* API: `applyBrandColor(state, hex, { perfectFit, paletteId? })`.
* **GUI:** při změně `stepCount` a zapnutém Perfect fit se seed znovu aplikuje (nová mřížka → nový nearest step / `t`). Bez Perfect fit není potřeba — H/C brandu na `stepCount` nezávisí.

## 5. Interaction states (delta T)

Live math pro stavy na **krocích palety** (ne `min`/`max`). Do CSS tokenů se **nezapisuje**.

* **`bgTone`** = HCT tone **povrchu za barvou** (kontrastní „bg“ vůči swatchi). Často je to krok `0` (`min`), ale může to být libovolný underlay (karta, overlay, jiný token) — engine ho jen dostane jako číslo.
* `|ΔT| = deltaMin + (|T − T_bg| / 100) × (deltaMax − deltaMin)` (default LM min 5 / max 20; DM min 8 / max 15).
* Směr: T > 50 → ztmavit; jinak zesvětlit.
* **state1** = 1× delta (GUI: hover); **state2** = delta × `state2Scale` (default 2, GUI: pressed).
* **relativeChroma** (default zapnuto): při posunu T drží C jako % HCT gamutu (stejný princip jako u interpolate chroma); vypnuto = absolutní C + clamp.
* Nastavení je v configu u `keyPalette.lm.states` / `keyPalette.dm.states`.
* **Playground (`app/`):** demo předává `bgTone` z key `min` (page surface). V produkci dodá volající tone skutečného podkladu pod prvkem.
