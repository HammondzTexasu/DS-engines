# Design System: AI-Ready Color Engine

Tento projekt definuje základní pilíř design systému založený na barevném modelu **HCT (Hue, Chroma, Tone)** od Googlu. Cílem je vytvořit programově ovladatelný systém, který zajišťuje vizuální konzistenci a kontrastní integritu napříč barevnými schématy a světlým a tmavým režimem.

Engine prozatím **generuje config a CSS tokeny**. Jak je projekt spotřebuje, řeší jiné vrstvy.

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
Systém umožňuje úpravu následujících proměnných a interpolátorů:

| Proměnná / Interpolátor | Typ | Popis |
| :--- | :--- | :--- |
| `min` | Hardcoded | Extrémní barva na pozici `0` — mimo paletu (defaultně nejsvětlejší v LM) |
| `max` | Hardcoded | Extrémní barva na pozici `end + 10` — mimo paletu (defaultně nejtmavší v LM) |
| `start` | Token | Klíčový bod `10` — začátek interpolace |
| `end` | Token | Klíčový bod posledního kroku palety (při 10 krocích: `100`) — konec interpolace |
| `key-tone-interpolator` | Interpolátor | Bézier křivka pro Tone v `key-palette` (LM) |
| `key-dm-tone-interpolator` | Interpolátor | Bézier křivka pro Tone v `key-palette-dm` (DM) |

**Výchozí hodnoty Tone pro `start` a `end`:**

| Paleta | `start` (krok 10) | `end` (krok 100) | Směr |
| :--- | :--- | :--- | :--- |
| `key-palette` (LM) | 96 (světlá) | 7 (tmavá) | světlá → tmavá |
| `key-palette-dm` (DM) | 8 (tmavá) | 93 (světlá) | tmavá → světlá |

## 4. Odvozené palety (Custom Palettes)
Odvozené palety dědí světlostní stupně z `key-palette` (resp. `key-palette-dm` u varianty `-dm`), ale umožňují:
1.  **Override H a C:** Nastavení vlastního odstínu a sytosti.
2.  **Vlastní interpolátory:**
    * `[nazev]-hue-interpolator`
    * `[nazev]-chroma-interpolator`
    * Podpora vícebodové interpolace (např. suffix `-1`, `-2` pro případ interpolace mezi více body, např. 10–50–100, tedy interpolátor mezi 10–50 a druhý mezi 50–100). Kroky `min` a `max` se do interpolace H/C nepočítají.

**Chroma (interpolate):** drží se **relativní podíl** dostupného gamutu (ne absolutní C natvrdo). Při změně key / hue se absolutní C přepočte, poměr zůstane.

**Fixed chroma:** požadovaná hodnota může zůstat i nad peakem gamutu; při vykreslení kroku se C stejně ořízne do HCT.

**Změna počtu kroků palety:** krajní body interpolace drží své hodnoty (konec se jen přesune na nový poslední krok). Střední body drží **relativní pozici** na škále; zahodí se jen když jich je víc, než je volných prostředních kroků.

**Názvy custom palet:** jen `a–z`, `0–9`, `-` (stejný tvar v configu i v názvech CSS tokenů).

## 5. Interaction states (delta T)

Live math pro stavy na **krocích palety** (ne `min`/`max`). Do CSS tokenů se **nezapisuje**.

* Pozadí pro blízkost = tone barvy **`0` (`min`)** v daném LM/DM.
* `|ΔT| = deltaMin + (|T − T_bg| / 100) × (deltaMax − deltaMin)` (default min 5, max 20).
* Směr: T > 50 → ztmavit; jinak zesvětlit.
* **state1** = 1× delta (GUI: hover); **state2** = delta × `state2Scale` (default 2, GUI: pressed).
* Nastavení je v configu u `keyPalette.lm.states` / `keyPalette.dm.states`. Custom palety používají stejná pravidla (bg z key min).
