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
| `generateSystem(state)` | `tokensCss` + `config` + `styles` + `googleFontsUrl` — **mutuje** `state` |
| `normalizeStateForStyleCount(state)` | Sync `styleCount` ↔ `styles[]` (unikátní jména, `baseStyle`) |
| `resolveStyles(state)` | Vypočtené metriky + inherit flagy |
| `formatBezierCss` / `parseBezierCss` | Křivky LS / LH |
| `googleFontsCssUrl(family)` | Link na Google Fonts CSS2 (`wght@100..900`) |
| `formatRem` / `formatEm` / `formatUnitless` | CSS výstup (rem 4 dp, em/unitless 2 dp) |

## Config

* `fontFamily`, `styleCount`, `baseStyle`, `baseSizePx`, `sizeScale`
* `weightRegular`, `weightBold`
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
* Duplicate `name` se při normalize přejmenují.
* UI CSS je vlastní (`app/engine-ui.css`), nesdílí se s color-engine.
