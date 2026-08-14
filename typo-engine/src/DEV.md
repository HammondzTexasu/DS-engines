# Typo Engine — DEV

Produkt: [`../README.md`](../README.md). AI: [`../AGENTS.md`](../AGENTS.md).

## Struktura

```text
typo-engine/
├── README.md
├── AGENTS.md
├── config/engine-config.json
├── src/typo-engine.js
├── src/DEV.md
└── app/          # playground (ne headless API)
```

## API

| API | Účel |
| :--- | :--- |
| `createDefaultState()` | Default intent |
| `importEngineConfig(json)` | JSON → state (+ normalize) |
| `exportEngineConfig(state)` | state → JSON (overrides jen když nastavené; čísla zaokrouhlená) |
| `generateSystem(state)` | `tokensCss` + `config` + `styles` + `googleFontsUrl` + `googleFontsUrlStatic` + `iconFontsUrl` — **mutuje** `state` |
| `normalizeStateForStyleCount(state)` | Sync `styleCount` ↔ `styles[]` (unikátní jména, `baseStyle`) |
| `resolveStyles(state)` | Vypočtené metriky + inherit flagy |
| `formatBezierCss` / `parseBezierCss` | Křivky LS / LH |
| `googleFontsCssUrl(family)` | CSS2 variable axis (`wght@100..900`) — 550 a mezikroky |
| `googleFontsCssUrlStatic(family)` | CSS2 diskrétní řezy (`100;200;…;900`) — fallback pro static rodiny |
| `materialSymbolsCssUrl(style)` | Link na Material Symbols variable font (osy `opsz,wght,FILL,GRAD`) |
| `formatRem` / `formatEm` / `formatUnitless` | CSS výstup (rem 4 dp, em/unitless 2 dp) |

## Config

* `fontFamily`, `styleCount`, `baseStyle`, `baseSizePx`, `sizeScale`
* `icons`: `{ source, style, sizeCount: 1–4, sizes: [{ fontSizePx, weight }] }` — default `font` / `outlined` / 3 sizes (20 / 24 / 40, weight 400). Názvy tokenů **podle indexu** (ne podle count): `0=sm`, `1=md`, `2=lg`, `3=xl`. Zmenšení 3→2 uřízne konec → zmizí `lg`, `sm`/`md` zůstanou. Fill/outline **není** v configu (font osa `FILL`, SVG jiný asset).
* `weightRegular`, `weightBold` — text 100–900 (`clampFontWeight`); ikony 100–700 (`clampIconWeight`).
* `letterSpacing` / `lineHeight`: `{ start, end, interpolator: [x1,y1,x2,y2] }`
* `styles[]`: `{ name, fontSizePx?, letterSpacing?, lineHeight?, paragraphSpacingRem?, weightRegular?, weightBold? }`  
  Chybějící / `null` = inherit z globálu (scale / křivka / weights; paragraph = font-size rem).

### `styleCount` vs `styles[]`

* Je-li `styles[]` neprázdné a **`styleCount` je v JSON** → platí `styleCount` (normalize doroste / uřízne sloty).
* Je-li `styles[]` neprázdné a **`styleCount` chybí** → délka = `styles.length`.
* Bez `styles[]` → defaultní jména pro `styleCount`.

## Jednotky ve výstupu

* `font-size` / `paragraph-spacing` → `rem` (px/16, 4 desetinná místa)
* `letter-spacing` → `em` (2 desetinná místa)
* `line-height` → bezjednotkové číslo (2 desetinná místa)

## Poznámky

* `importEngineConfig` i `generateSystem` volají `normalizeStateForStyleCount`.
* Stejný počet stylů: normalize **ponechá reference** objektů (důležité pro live UI).
* Změna počtu: remap podle relativní pozice (může duplikovat mid overrides / zahodit konce).
* Duplicate `name` se při normalize přejmenují. Rezervované jméno **`icon`** → `style` (kolize s `--typo-icon-*`).
* `googleFontsUrl` = osa `wght@100..900` (VF, mezikroky). Static rodiny často 400 → `googleFontsUrlStatic` (`100;200;…;900`). Playground: range URL nejdřív; do fail-cache jen při CSS **`error`**, ne při timeoutu (8 s).
* `iconFontsUrl` je Google Fonts CSS2 URL, nebo `null` když `icons.source === 'svg'`.
* Chybějící `icons` v JSON → default `font` / `outlined` / 3 sizes.
* `icons.sizes` stejný počet: normalize **ponechá reference** (live UI). Růst = append default; zmenšení = uříznout konec.
* SVG náhled ikon je **jen playground** (inline z Google `symbols/web` přes jsDelivr `@gh`, kresba **opsz 24**, size přes CSS). Není v configu ani v tokenech. Weight preview: nejbližší řez 100 / 200 / … / 700 (400 = `name_24px.svg`, jinak `name_wght500_24px.svg`).
* Font ikony: **opsz auto** (`font-optical-sizing: auto`). Engine `opsz` token neemituje; v `font-variation-settings` `"opsz"` nenastavuj, pokud k tomu nemáš důvod.
