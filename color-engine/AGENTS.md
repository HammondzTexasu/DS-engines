# AGENTS.md — Color Engine (AI workflow)

> **Pro AI agenty (Cursor, Claude, Codex, …).**  
> Lidská specifikace: [`README.md`](./README.md).  
> Maintainer / API detaily: [`src/DEV.md`](./src/DEV.md).  
> Release: **1.0** — engine je stabilní; defaultně **neměň** runtime kód.

---

## 0. Role agenta (jedna věta)

Jsi **orchestrátor konfigurace a regenerace tokenů**, ne autor enginu.  
Upravuješ **intent v JSON configu**, spustíš **headless generate**, zapíšeš **config + CSS tokeny**.  
Logiku HCT / interpolace / gamutu **neimplementuješ znovu**.

---

## 1. Mentální model

```text
┌─────────────────────┐
│  color-config.json  │  ← jediný zdroj pravdy (intent)
└──────────┬──────────┘
           │ importEngineConfig
           ▼
┌─────────────────────┐
│   color-engine.js   │  ← black box (1.0) — NESAHEJ bez explicitního requestu
│   generateSystem()  │
└──────────┬──────────┘
           │
           ├─► color-config.json   (export / normalizovaný config)
           └─► tokens.css          (jen barvy: :root { --… })
```

| Vrstva | Co to je | Smí AI měnit? |
| :--- | :--- | :--- |
| Config JSON | Intent (H/C, křivky, brand, includeSteps, states…) | **Ano** — primární práce |
| `tokensCss` / `*.css` tokeny | Generovaný výstup | **Ano** — jen přepsat výsledkem generate |
| `src/color-engine.js` + `lib/*` | Engine 1.0 | **Ne** (default) |
| `app/*` | Playground GUI | **Ne** (default) |
| Mapování tokenů do produktu (Button, theme, …) | Mimo engine | Ano, ale **mimo** tento workflow soubor |

**CSS tokeny neobsahují** interpolátory, `start`/`end`, H/C módy ani brand metadata — ty žijí jen v configu.

---

## 2. Hard boundaries

### 2.1 Smíš (default)

1. Číst a editovat `config/color-config.json` (nebo ekvivalent v spotřebitelském projektu).
2. Volat headless API z `src/color-engine.js` (import / generate / export / brand / override helpers).
3. Přepsat výstupní CSS tokeny výsledkem `generateSystem`.
4. Číst `README.md` / `DEV.md` při nejasnosti chování.
5. Spustit playground (`app/`) jen pro vizuální kontrolu — ne jako místo „opravy enginu“.

### 2.2 Nesmíš (bez výslovného requestu uživatele)

- Refaktorovat / „vylepšovat“ / optimalizovat `color-engine.js` nebo `lib/*`.
- Měnit výchozí matematiku (Bézier, hue arc, relative chroma, states) v kódu.
- Ručně dopočítávat hex barvy „od oka“ a vkládat je do CSS **místo** `generateSystem`.
- Duplikovat engine do spotřebitelského projektu (copy-paste celého `src/`).
- Měnit `DEV.md` / `README.md` kvůli jedné změně palety.
- Přidávat build systém, React wrapper, nebo CLI „pro jistotu“ — mimo scope 1.0 workflow.

### 2.3 Kdy smíš sáhnout na engine kód

Jen když uživatel **výslovně** požádá o změnu enginu (bugfix, feature, breaking change).  
Pak nejdřív: reprodukce → `DEV.md` § chování → minimální diff → ověření generate.

---

## 3. Kanonický workflow (vždy stejný)

### Krok A — Orientace

1. Najdi **projektový config** (typicky `config/color-config.json`).
2. Najdi **cestu k enginu** (`src/color-engine.js` v tomto repu, nebo závislost / submodule ve spotřebitelském projektu).
3. Najdi **kam patří tokeny** (soubor typu `tokens.css` / `colors.css` — pokud neexistuje, zeptej se nebo navrhni jedno místo vedle configu).

### Krok B — Intent → config

Uprav **jen** JSON pole odpovídající požadavku (viz §5).  
Nepřepisuj celý config, pokud není nutný reset.

### Krok C — Regenerace (povinná)

```js
import {
  importEngineConfig,
  generateSystem,
  exportEngineConfig,
  normalizeStateForStepCount,
} from './src/color-engine.js'; // uprav cestu dle projektu

const state = importEngineConfig(configJson);

// Pokud měníš stepCount:
// state.stepCount = N;
// normalizeStateForStepCount(state);

const { tokensCss, config } = generateSystem(state);

// Zapiš OBOJÍ:
// 1) config  → color-config.json  (použij `config` z výsledku, ne ruční JSON „od oka“)
// 2) tokensCss → výstupní .css
```

**Důležité:**

- `generateSystem(state)` **mutuje** `state` (relative chroma body, override sync, případný collapse H/C při 1 published kroku).
- Po generate **persistuj `config` z návratové hodnoty** (nebo `exportEngineConfig(state)` po generate) — obsahuje normalizaci (ratio, flagy, includeSteps).
- Nikdy neber starý CSS a „dolaď“ pár hexů ručně, pokud jsi měnil intent.

### Krok D — Verifikace (checklist)

- [ ] Config je validní JSON a projde `importEngineConfig` bez pádu.
- [ ] CSS je jeden (nebo konzistentní) `:root` blok s očekávanými prefixy (`--key-palette-…`, `--{name}-…`, `-dm-`).
- [ ] Požadované palety / kroky / brand / override jsou vidět v CSS nebo v configu dle intentu.
- [ ] Nezměnil jsi `src/color-engine.js` / `lib/*` / `app/*` (pokud to nebylo explicitní).
- [ ] Nezanechal jsi rozpracovaný state jen v paměti — soubory na disku jsou aktuální.

---

## 4. Dva provozní režimy

### 4.1 Tento repozitář (color-engine)

| Soubor | Role |
| :--- | :--- |
| `config/color-config.json` | Projektový intent (playground ho načte prioritně) |
| `src/color-engine.js` | Engine |
| `app/` | Volitelný vizuální playground — **není** headless API |

Headless happy path: viz `DEV.md` §3.

### 4.2 Spotřebitelský design-systém / app repozitář

**Doporučený layout (intent):**

```text
consumer-project/
├── design-tokens/
│   ├── color-config.json     ← edituj
│   └── colors.css            ← generuj
└── (engine: npm / git submodule / relative path — NEkoptuj logiku)
```

Agent ve spotřebitelském projektu:

1. Edituje **jen** `color-config.json` (+ případně mapování tokenů mimo engine).
2. Spustí generate proti **sdílenému** enginu.
3. Přepíše `colors.css`.

Pokud engine v consumer projektu chybí, **nejdřív** vyjasni s uživatelem, odkud se importuje — nevymýšlej fork enginu.

---

## 5. Intent mapování (požadavek → co editovat)

### 5.1 Základní

| Požadavek | Kde v configu | Poznámka |
| :--- | :--- | :--- |
| Počet kroků škály | `stepCount` | Pak **povinně** `normalizeStateForStepCount(state)` před generate |
| LM/DM extrémy (min/max hex) | `keyPalette.lm\|dm.min\|max` | Mimo interpolovanou paletu (`0` / `end+10`) |
| Tone start/end key | `keyPalette.lm\|dm.start.tone` / `end.tone` | |
| Key tone křivka | `keyPalette.lm\|dm.interpolator` | `[x1,y1,x2,y2]`; DM může mít `interpolatorOverride` |
| Nová / edit custom paleta | `customPalettes[]` | `name`: jen `a-z`, `0-9`, `-` |
| Pořadí palet | pořadí pole `customPalettes` | runtime `id` se do JSON neukládá |

### 5.2 Hue / Chroma

| Požadavek | Config | Pravidla |
| :--- | :--- | :--- |
| Konstantní H nebo C | `"mode": "fixed", "value": …` | |
| Křivka H/C | `"mode": "interpolate", "points", "interpolators"` | `interpolators.length === points.length - 1` |
| Hue cesta | `hue.hueArc` | `shortest` (default) \| `longest` \| `linear` \| `increasing` \| `decreasing` |
| Absolute C (default) | bez relative/clamp flagů | Může být „nad gamutem“ v intentu; render clampne |
| Relative chroma (Fixed i Interpolate) | `relativeInterpolateChroma: true` + `ratio` (0–1) | U interpolate **implikuje clamp**; `C = round(ratio × limit)` |
| Clamp interpolate (absolutní body + clamp mezikroků) | `clampInterpolatedChroma: true` | Bez `relativeInterpolateChroma` = jiný režim než full relative path |

**1 published krok** (per mode) nebo `stepCount === 1`: engine **collapsuje** H/C na Fixed + relative chroma — **nevratně** vzhledem k předchozí křivce. Neobnovuj křivku „tipařením“, pokud uživatel nechce jiný `includeSteps` / `stepCount`.

### 5.3 Published steps

| Požadavek | Pole | Chování |
| :--- | :--- | :--- |
| Plná paleta (včetně 0/max + ghost states) | vynechat / `null` / celá mřížka | |
| Jen vybrané kroky LM | `includeSteps: [40, 60]` | Bez 0/max/ghost |
| DM stejně jako LM | vynechat `includeStepsDm` | inherit |
| DM vlastní whitelist | `includeStepsDm: […]` | dirty; `[]` semantics = dirty full (viz DEV.md) |

### 5.4 Brand & override

| Požadavek | API / config | Mutex / pozor |
| :--- | :--- | :--- |
| Seed z hexu | `applyBrandColor(state, hex, { perfectFit, overrideNearest, paletteId? })` | PF ⊥ OV; při obou v JSON vyhraje **Perfect fit** |
| Uložený brand | `brand: { hex, perfectFit, overrideNearest, palette }` | Import **ne**znovu ohýbá křivku — jen metadata |
| Sticky hex na kroku LM | `colorOverride: { hex }` / `setColorOverride(palette, hex, 'lm', …)` | Step = nearest key T |
| Sticky hex DM | `colorOverrideDm` / mode `'dm'` | Nezávislé na LM |
| Clear brand metadata | `clearBrandConfig(state)` | Křivka/override mohou zůstat |

Po brand/override vždy `generateSystem`.

### 5.5 Interaction states

| Požadavek | Kde | Poznámka |
| :--- | :--- | :--- |
| Strategie (delivery, space, relativeChroma, oklchGamut, pivotTone) | `keyPalette.lm.states` | Jen LM |
| Delty LM/DM | `keyPalette.lm\|dm.states` — DM jen `deltaMin`, `deltaMax`, `state2Scale` | Δ clamp 0…40; scale 1…4 |
| `delivery: "build"` | hex `--*-state1\|2` | |
| `delivery: "runtime"` | univerzální `--state-*-state1\|2` (+ dm) | Space efektivně OKLCH |

`bg` **není** v configu — jen runtime API (`bgHex`).

---

## 6. Allowlist API (používej toto)

**Produktové (preferované):**

- `importEngineConfig` / `exportEngineConfig` / `createDefaultState`
- `generateSystem`
- `normalizeStateForStepCount` (po změně `stepCount`)
- `createCustomPalette` / `moveCustomPalette`
- `createFixedParam` / `createInterpolateParam`
- `applyBrandColor` / `clearBrandConfig`
- `setColorOverride` / `resolveColorOverrideStep`
- Interaction: `createDefaultInteractionStates`, `resolveModeInteractionStates`, `colorAtInteractionState` (jen když spotřebitel potřebuje runtime barvy mimo CSS)

**Nepoužívej** low-level (`interpolateValue`, `clampChroma`, …) pro běžný workflow — viz `DEV.md` §5.2.

---

## 7. Invarianty (neruš je)

1. **Config = intent, CSS = výstup.** Po změně intentu vždy regenerate.
2. **`generateSystem` mutuje state** — po něm serializuj `config` z výsledku.
3. **Key palette** dodává tone mřížku; custom palety dědí T, mění H/C.
4. **LM a DM** jsou oddělené větve (`-dm` suffix v CSS).
5. **Kroky `0` a `end+10`** nejsou součást interpolované palety (min/max).
6. **Palette `id`** (`palette-1`) je runtime — do JSON a CSS jmen nepatří; CSS používá `name`.
7. **Duplicate `name`** v custom paletách → CSS last-wins (vyhýbej se).
8. **Orphan `brand.palette`** → import shodí `brand`.
9. Starý config **bez** nových flagů = validní (defaults).
10. Playground není zdroj pravdy — soubor configu ano.

---

## 8. Sharp edges (actionable)

Hrany při **manipulaci se stavem** (agresivní změny intentu).  
Roundtrip `generate → export → import → generate` při stejném configu = **stejné tokeny / vizuál**.  
Podrobný lidský výklad: [`src/DEV.md`](./src/DEV.md) §11.

- **`generateSystem` mutuje `state`** → persistuj `config` z návratové hodnoty.
- **`stepCount` dolů / nahoru** → nejdřív `normalizeStateForStepCount`, pak generate; body/whitelist se remapují — po velkém skoku **ověř vizuál / tokeny**.
- **1 published krok** (per mode) nebo `stepCount === 1` → H/C **collapse** na Fixed + relative; předchozí křivka se **neuchová**.
- **Duplicate `name`** → CSS last-wins, bez warningu.
- **Orphan `brand.palette`** → import shodí `brand`.
- **Import brandu ≠ re-apply Perfect fit** — křivka/override už musí být v JSON; `applyBrandColor` jen když uživatel chce znovu seednout.
- **Seed-only brand** (bez PF/OV/`colorOverride`) + drift H/C → GUI odlinkuje brand.
- **Dirty DM `includeStepsDm` bez `colorOverrideDm`** → při generate se nepřemapuje podle key stejně jako LM s override; po změně key zkontroluj DM whitelist.
- **`gamutLimit`** nikdy do JSON; intent = `ratio` / `value`.
- Agresivní změna (hodně kroků → málo, zúžení includeSteps, smazání brand palety) = deterministická, ale **ne vždy intuitivní** vůči design intentu — po generate zkontroluj výsledek, nehackuj engine.

---

## 9. Anti-patterns (dělej opak)

| Špatně | Správně |
| :--- | :--- |
| Ručně přepsat 3 hexy v CSS | Změnit config → generate → přepsat celý token soubor |
| „Opravím Bézier v engine.js“ | Upravit `interpolator` v configu |
| Zkopírovat `color-engine.js` do 5 app repozitářů | Jedna sdílená verze enginu + config per projekt |
| Editovat jen `value` chroma při Relative a čekat stabilitu | Držet / lockovat `ratio` (Relative ON) |
| Po `stepCount` jen generate | `normalizeStateForStepCount` → generate |
| Persistovat `gamutLimit` do JSON | Nikdy — runtime only |
| Slibovat pixel-perfect Figma bez generate | Engine je zdroj numerické pravdy |

---

## 10. Minimální skripty / příkazy (orientace)

V tomto repu **není** povinný npm CLI pro generate — headless = ESM import.

Typický agent postup v Node / bun (uprav cesty):

```bash
# Pseudopostup — agent napíše krátký one-off skript NEBO použije existující tooling projektu
node --experimental-vm-modules ./scripts/regen-tokens.mjs
# nebo ekvivalent: načti JSON → importEngineConfig → generateSystem → write files
```

Pokud `scripts/regen-tokens.mjs` neexistuje, **pro 1.0** ho nevymýšlej jako produkt — stačí jednorázový generate v session a zápis souborů. Trvalý skript jen na výslovnou žádost.

Playground (vizuální kontrola): servíruj `app/` tak, aby bylo dostupné `../config/color-config.json`.

---

## 11. Jak odpovídat uživateli

1. Shrň **intent** (1–2 věty).
2. Uveď **která pole configu** změníš.
3. Proveď generate + zápis.
4. Stručně potvrď výstup (např. „palette `accent` LM fixed H=32 C=relative 100%; tokens přegenerovány“).
5. Neodkládej „ještě předělám engine“ — mimo scope.

Když požadavek koliduje s invariantem (např. interpolate + 1 include step), **vysvětli collapse** a zeptej se na preferovaný intent — neobcházej engine hackem.

---

## 12. Escalační matice

| Situace | Akce |
| :--- | :--- |
| Nejasný vizuální cíl | Zeptej se (reference, brand hex, LM/DM) |
| Chybí cesta k enginu ve consumer projektu | Zeptej se — neforkuj |
| Podezření na bug enginu | Repro + čti `DEV.md` §6–7; engine měň jen s povolením |
| Agresivní změna configu / neočekávaný look | Ověř §8; detaily `DEV.md` §11 — nejdřív regenerate + kontrola, ne refactor enginu |
| Potřeba nových tokenů mimo barvy | Mimo scope enginu — řeš ve spotřebitelské vrstvě |
| Potřeba CI / npm publish / CLI | Nový úkol mimo tento workflow soubor |

---

## 13. Rychlá karta (TL;DR)

```text
1. Edit color-config.json (intent only)
2. importEngineConfig → [normalizeStateForStepCount?] → generateSystem
3. Write config + tokensCss
4. Do not touch color-engine.js / lib / app
5. README = meaning, DEV.md = API + caveats §11, AGENTS.md = workflow + sharp edges §8
```

---

*Color Engine 1.0 — AI orchestration contract. Engine code is frozen unless the user explicitly requests engine changes.*
