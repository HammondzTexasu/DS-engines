# AGENTS.md — Typo Engine (AI workflow)

> **Pro AI agenty (Cursor, Claude, Codex, …).**  
> Lidská specifikace: [`README.md`](./README.md).  
> Maintainer / API detaily: [`src/DEV.md`](./src/DEV.md).  
> Release: **1.0** — engine je stabilní; defaultně **neměň** runtime kód.  
> **Nesahej na `color-engine/`** při práci na typo (a naopak) — sdílí se jen produktové principy, ne kód ani CSS.

---

## 0. Role agenta (jedna věta)

Jsi **orchestrátor typo konfigurace a regenerace tokenů**, ne autor enginu.  
Upravuješ **intent v JSON configu**, spustíš **headless generate**, zapíšeš **config + CSS tokeny**.  
Škálu / Bézier / rem–em převody **neimplementuješ znovu**.

---

## 1. Mentální model

```text
┌─────────────────────┐
│  engine-config.json │  ← jediný zdroj pravdy (intent)
└──────────┬──────────┘
           │ importEngineConfig
           ▼
┌─────────────────────┐
│   typo-engine.js    │  ← black box (1.0) — NESAHEJ bez explicitního requestu
│   generateSystem()  │
└──────────┬──────────┘
           │
           ├─► engine-config.json  (export / normalizovaný config)
           └─► typo tokens CSS     (metriky: :root { --typo-… })
```

| Vrstva | Co to je | Smí AI měnit? |
| :--- | :--- | :--- |
| Config JSON | Intent (font, škála, LS/LH křivky, overrides) | **Ano** — primární práce |
| `tokensCss` / `*.css` tokeny | Generovaný výstup | **Ano** — jen přepsat výsledkem generate |
| `src/typo-engine.js` | Engine 1.0 | **Ne** (default) |
| `app/*` | Playground GUI | **Ne** (default) |
| Mapování tokenů do produktu (Text, theme, …) | Mimo engine | Ano, ale **mimo** tento workflow soubor |

**CSS tokeny neobsahují** křivky `start`/`end`, interpolátory ani UI sample text — ty žijí v configu (resp. jen v playgroundu).

---

## 2. Hard boundaries

### 2.1 Smíš (default)

1. Číst a editovat `config/engine-config.json` (nebo ekvivalent ve spotřebitelském projektu).
2. Volat headless API z `src/typo-engine.js` (import / generate / export / normalize / formáttery).
3. Přepsat výstupní CSS tokeny výsledkem `generateSystem`.
4. Číst `README.md` / `DEV.md` při nejasnosti chování.
5. Spustit playground (`app/`) jen pro vizuální kontrolu — ne jako místo „opravy enginu“.

### 2.2 Nesmíš (bez výslovného requestu uživatele)

- Refaktorovat / „vylepšovat“ / optimalizovat `typo-engine.js`.
- Ručně dopočítávat `rem` / `em` / line-height „od oka“ a vkládat je do CSS **místo** `generateSystem`.
- Duplikovat engine do spotřebitelského projektu (copy-paste celého `src/`).
- Měnit `DEV.md` / `README.md` kvůli jedné změně škály.
- Přidávat build systém, React wrapper, nebo CLI „pro jistotu“ — mimo scope 1.0 workflow.
- Sahat na `color-engine/` „pro konzistenci“ bez výslovného úkolu.

### 2.3 Kdy smíš sáhnout na engine kód

Jen když uživatel **výslovně** požádá o změnu enginu (bugfix, feature, breaking change).  
Pak nejdřív: reprodukce → `DEV.md` → minimální diff → ověření generate.

---

## 3. Kanonický workflow (vždy stejný)

### Krok A — Orientace

1. Najdi **projektový config** (typicky `config/engine-config.json`).
2. Najdi **cestu k enginu** (`src/typo-engine.js` v tomto repu, nebo závislost / submodule ve spotřebitelském projektu).
3. Najdi **kam patří tokeny** (soubor typu `typo.css` / `typography.css` — pokud neexistuje, zeptej se nebo navrhni jedno místo vedle configu).

### Krok B — Intent → config

Uprav **jen** JSON pole odpovídající požadavku (viz §5).  
Nepřepisuj celý config, pokud není nutný reset.

### Krok C — Regenerace (povinná)

```js
import {
  importEngineConfig,
  generateSystem,
  normalizeStateForStyleCount,
} from './src/typo-engine.js'; // uprav cestu dle projektu

const state = importEngineConfig(configJson);

// Pokud měníš styleCount (a chceš remap hned na state před generate):
// state.styleCount = N;
// normalizeStateForStyleCount(state);
// Pozn.: import i generate volají normalize sami — explicitní volání je hlavně
// když měníš count na už načteném state bez re-importu.

const { tokensCss, config, googleFontsUrl } = generateSystem(state);

// Zapiš OBOJÍ:
// 1) config       → engine-config.json  (použij `config` z výsledku)
// 2) tokensCss    → výstupní .css
// Volitelně: googleFontsUrl → <link> / @import ve spotřebitelské appce
```

**Důležité:**

- `generateSystem(state)` **mutuje** `state` (unikátní jména, sync `styleCount`, oprava `baseStyle`).
- Po generate **persistuj `config` z návratové hodnoty** — obsahuje normalizaci.
- Nikdy neber starý CSS a „dolaď“ pár hodnot ručně, pokud jsi měnil intent.

### Krok D — Verifikace (checklist)

- [ ] Config je validní JSON a projde `importEngineConfig` bez pádu.
- [ ] CSS je `:root` blok s prefixem `--typo-…` a očekávanými styly (`tiny` … / custom `name`).
- [ ] Každý styl má **`-regular`** i **`-bold`** sadu metrík.
- [ ] Požadovaný font / škála / LS / LH / override je vidět v CSS nebo v configu dle intentu.
- [ ] Nezměnil jsi `src/typo-engine.js` / `app/*` (pokud to nebylo explicitní).
- [ ] Nezanechal jsi rozpracovaný state jen v paměti — soubory na disku jsou aktuální.

---

## 4. Dva provozní režimy

### 4.1 Tento repozitář (typo-engine)

| Soubor | Role |
| :--- | :--- |
| `config/engine-config.json` | Projektový intent (playground ho načte prioritně) |
| `src/typo-engine.js` | Engine |
| `app/` | Volitelný vizuální playground — **není** headless API |

Headless happy path: viz `README.md` § Headless a `DEV.md`.

### 4.2 Spotřebitelský design-systém / app repozitář

**Doporučený layout (intent):**

```text
consumer-project/
├── design-tokens/
│   ├── engine-config.json    ← edituj (typo intent; nebo typo-engine-config.json)
│   └── typo.css              ← generuj
└── (engine: npm / git submodule / relative path — NEkoptuj logiku)
```

Agent ve spotřebitelském projektu:

1. Edituje **jen** typo config JSON (+ případně mapování tokenů mimo engine).
2. Spustí generate proti **sdílenému** enginu.
3. Přepíše `typo.css` (nebo dohodnutý soubor).
4. Napojí `googleFontsUrl` (nebo self-host font) mimo engine — engine jen URL navrhne.

Pokud engine v consumer projektu chybí, **nejdřív** vyjasni s uživatelem, odkud se importuje — nevymýšlej fork enginu.

---

## 5. Intent mapování (požadavek → co editovat)

### 5.1 Globál

| Požadavek | Kde v configu | Poznámka |
| :--- | :--- | :--- |
| Font family | `fontFamily` | Google / systém; tokeny + `googleFontsUrl` |
| Počet stylů | `styleCount` | 1–24; viz §5.2 a §8 |
| Základní krok škály | `baseStyle` | Musí odpovídat některému `styles[].name` |
| Velikost base kroku | `baseSizePx` | Modular px; **rem root je vždy ÷16** |
| Modular ratio | `sizeScale` | Např. `1.25` |
| Weight regular / bold | `weightRegular` / `weightBold` | Globální defaulty; override per styl |
| Letter-spacing křivka | `letterSpacing: { start, end, interpolator }` | `em`; `interpolator` = `[x1,y1,x2,y2]` |
| Line-height křivka | `lineHeight: { start, end, interpolator }` | Unitless |

Defaultní jména při 9 krocích: `tiny`, `caption`, `body-main`, `body-lead`, `heading-minor`, `heading-secondary`, `heading-primary`, `heading-major`, `display`.

### 5.2 `styleCount` vs `styles[]`

| Situace | Chování |
| :--- | :--- |
| `styles[]` + **explicitní** `styleCount` | Platí `styleCount` → normalize doroste / uřízne |
| `styles[]` **bez** `styleCount` | Délka = `styles.length` |
| Jen `styleCount`, bez `styles[]` | Defaultní jména pro daný počet |

Po agresivní změně count **ověř názvy, overrides a `baseStyle`** (remap je relativní — viz §8).

### 5.3 Per-style override

| Požadavek | Pole na `styles[i]` | Inherit |
| :--- | :--- | :--- |
| Pevná velikost | `fontSizePx` | Vynechat / `null` = modular scale |
| Tracking | `letterSpacing` | Vynechat = z LS křivky |
| Leading | `lineHeight` | Vynechat = z LH křivky |
| Odstavec | `paragraphSpacingRem` | Vynechat = stejné rem jako `font-size` stylu |
| Řez regular / bold | `weightRegular` / `weightBold` | Vynechat = globál |
| Přejmenovat styl | `name` | `a-z`, `0-9`, `-` (kebab); duplicity se při normalize přejmenují |

**Clear override** = smazat klíč z JSON (nebo `null`) → znovu globál / křivka.

### 5.4 Co nepatří do configu

| Věc | Kde žije |
| :--- | :--- |
| Sample sentence v preview | Jen playground UI — **ne** do engine JSON |
| Google Fonts `<link>` | Spotřebitel podle `googleFontsUrl` |
| Mapování na komponenty | Spotřebitelský DS |

---

## 6. Allowlist API (používej toto)

**Produktové (preferované):**

- `importEngineConfig` / `exportEngineConfig` / `createDefaultState`
- `generateSystem`
- `normalizeStateForStyleCount` (když měníš `styleCount` na už načteném state)
- `resolveStyles` (když potřebuješ vypočtené metriky bez CSS)
- `formatBezierCss` / `parseBezierCss` (validace křivek v toolingu)
- `googleFontsCssUrl(family)`
- `formatRem` / `formatEm` / `formatUnitless` (jen pokud skládáš CSS mimo `tokensCss` — běžně netřeba)

**Nepoužívej** low-level (`interpolateFloat`, `cubicBezierY`, …) pro běžný workflow — detaily v `DEV.md`.

---

## 7. Invarianty (neruš je)

1. **Config = intent, CSS = výstup.** Po změně intentu vždy regenerate.
2. **`generateSystem` mutuje state** — po něm serializuj `config` z výsledku.
3. **Každý styl → `-regular` + `-bold`** token sady (liší se hlavně weight).
4. **Rem = px / 16** vždy (ne ÷ `baseSizePx`). `baseSizePx` je jen modular kotva.
5. **LS = `em` (2 dp), LH = unitless (2 dp), rem metriky = 4 dp.**
6. **Inherit** = chybějící / `null` override — ne „magická“ nula, pokud nula není záměr.
7. **`name`** musí být unikátní po normalize; CSS jinak last-wins.
8. **Playground není zdroj pravdy** — soubor configu ano.
9. Roundtrip `generate → export → import → generate` při stejném configu = **stejné tokeny**.
10. Typo a color engine **nesdílí** kód ani CSS.

---

## 8. Sharp edges (actionable)

Hrany při **manipulaci se stavem** (agresivní změny intentu).  
Roundtrip při stejném configu = stejné tokeny.  
Podrobnosti: [`src/DEV.md`](./src/DEV.md).

- **`generateSystem` mutuje `state`** → persistuj `config` z návratové hodnoty; případně clone před generate.
- **`styleCount` nahoru / dolů** → relativní remap slotů; mid overrides se můžou **zkopírovat**, konce **zmizet**; `baseStyle` se může přepnout na existující jméno — **po skoku ověř vizuál / tokeny**.
- **`styles[]` bez `styleCount`** → count = délka pole; bump jen `styleCount` v JSON **s** existujícím polem stylů doroste teprve když je `styleCount` explicitní.
- **Duplicate `name`** → normalize přejmenuje; nehackuj ručně v CSS.
- **Rem vs base size** — `baseSizePx: 18` dává `1.125rem` u base kroku, ne `1rem`.
- **Count = 1** → LS/LH křivka bere jen `start` (`t = 0`); `end` se neuplatní.
- **Clear override** = pryč z JSON / `null` — prázdný string v UI = inherit.
- Agresivní změna (9→2 styly, přejmenování base, skok scale) = deterministická, ale **ne vždy intuitivní** vůči design intentu — po generate zkontroluj výsledek, nehackuj engine.

---

## 9. Anti-patterns (dělej opak)

| Špatně | Správně |
| :--- | :--- |
| Ručně přepsat 3 `font-size` v CSS | Změnit config → generate → přepsat celý token soubor |
| „Opravím Bézier v typo-engine.js“ | Upravit `letterSpacing` / `lineHeight.interpolator` v configu |
| Zkopírovat `typo-engine.js` do 5 app repozitářů | Jedna sdílená verze enginu + config per projekt |
| Po `styleCount` tipařit názvy v CSS | Persistuj normalizovaný `config` z generate |
| Slibovat pixel-perfect Figma bez generate | Engine je zdroj numerické pravdy |
| Míchat color + typo CSS do jednoho „engine.css“ bez dohody | Oddělené token soubory / vrstvy dle projektu |

---

## 10. Minimální skripty / příkazy (orientace)

V tomto repu **není** povinný npm CLI pro generate — headless = ESM import.

```bash
# Pseudopostup — agent napíše krátký one-off skript NEBO použije tooling projektu
node --input-type=module ./scripts/regen-typo-tokens.mjs
# nebo: načti JSON → importEngineConfig → generateSystem → write files
```

Pokud regen skript neexistuje, **pro 1.0** ho nevymýšlej jako produkt — stačí jednorázový generate v session a zápis souborů. Trvalý skript jen na výslovnou žádost.

Playground (vizuální kontrola): servíruj `app/` tak, aby bylo dostupné `../config/engine-config.json`.

---

## 11. Jak odpovídat uživateli

1. Shrň **intent** (1–2 věty).
2. Uveď **která pole configu** změníš.
3. Proveď generate + zápis.
4. Stručně potvrď výstup (např. „base `body-main` 16px, scale 1.25, LS `0.02→-0.02`; tokens přegenerovány“).
5. Neodkládej „ještě předělám engine“ — mimo scope.

Když požadavek koliduje s invariantem (např. očekávání `1rem` při `baseSizePx ≠ 16`), **vysvětli rem root** a zeptej se na preferovaný intent — neobcházej engine hackem.

---

## 12. Escalační matice

| Situace | Akce |
| :--- | :--- |
| Nejasný typografický cíl | Zeptej se (font, base size, počet stylů, tracking) |
| Chybí cesta k enginu ve consumer projektu | Zeptej se — neforkuj |
| Podezření na bug enginu | Repro + čti `DEV.md`; engine měň jen s povolením |
| Agresivní změna `styleCount` / neočekávaný look | Ověř §8 — nejdřív regenerate + kontrola, ne refactor enginu |
| Potřeba tokenů mimo typo metriky | Mimo scope enginu — řeš ve spotřebitelské vrstvě |
| Potřeba CI / npm publish / CLI | Nový úkol mimo tento workflow soubor |
| Úkol zasahuje color i typo | Odděl práce; nesahej na druhý engine „mimochodem“ |

---

## 13. Rychlá karta (TL;DR)

```text
1. Edit engine-config.json (intent only)
2. importEngineConfig → [normalizeStateForStyleCount?] → generateSystem
3. Write config + tokensCss (+ googleFontsUrl ve spotřebiteli)
4. Do not touch typo-engine.js / app / color-engine
5. README = meaning, DEV.md = API, AGENTS.md = workflow + sharp edges §8
```

**Token shape:** `--typo-{name}-{regular|bold}-{font-family|font-size|font-weight|line-height|letter-spacing|paragraph-spacing}`  
+ root `--typo-font-family`.

**Default `body-main` sanity check:** LH `1.49`, LS `0.01em`, size `1rem` (při defaults).

---

*Typo Engine 1.0 — AI orchestration contract. Engine code is frozen unless the user explicitly requests engine changes.*
