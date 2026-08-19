# Typo Engine

Headless modulární typografická škála (Google Font + size scale + křivky letter-spacing / line-height) → **JSON config** + **CSS tokeny**.

Playground: [`app/`](./app/). AI workflow: [`AGENTS.md`](./AGENTS.md). API: [`src/DEV.md`](./src/DEV.md).

**Nesdílí kód ani CSS s `color-engine`.** Stejné produktové principy (config = intent, generate = tokeny).

## Výchozí hodnoty

| Nastavení | Default |
| :--- | :--- |
| Font | Inter (Google Fonts) |
| Styly | 9 (`tiny` … `display`) |
| Base style | `body-main` (přiřaditelný) |
| Base size | 16px → `1rem` (rem root je vždy ÷16) |
| Size scale | 1.25 (Major Third) |
| Weights | regular 400 / bold 700 |
| Letter-spacing | start `0.02em` → end `-0.02em`, lineární Bézier |
| Line-height | start `1.6` → end `1.15`, lineární Bézier (bezjednotkové) |
| Paragraph-spacing | inherit = stejný rem jako `font-size` daného stylu |
| Ikony | Material Symbols **font** (variable) + **Outlined**; 3 velikosti (20 / 24 / 40 px, weight 400) |

Každý styl emituje sady tokenů **`-regular`** a **`-bold`**. Pole per-style dědí globály (prázdné / `null`), dokud nejsou přepsaná. Jméno stylu **`icon`** je rezervované (koliduje s `--typo-icon-*`) a sanitizuje se na `style`. Textové weights se clampují na **100–900**.

Ikonové tokeny jsou **globální**: source, style, family (když font), plus `--typo-icon-{sm|md|lg|xl}-font-size/weight` (1–4 velikosti, nezávislé na type scale). Názvy slotů jdou podle **indexu**, ne podle count: `0=sm`, `1=md`, `2=lg`, `3=xl`. Zmenšení 3→2 zahodí jen `lg` (`sm`/`md` zůstanou). Fill vs outline **není** token enginu — font: `"FILL"` 0\|1; SVG: jiný asset. Optical size není token: font používá `font-optical-sizing: auto` (nepřipínej `"opsz"`, pokud k tomu nemáš důvod); SVG používá asset **24px** a škáluje v CSS. SVG náhled v playgroundu je jen UI (není v configu/tokenech).

## Tokeny (příklad)

Default `body-main` (index na 9krokové škále):

```css
:root {
  --typo-font-family: Inter, system-ui, sans-serif;
  --typo-body-main-regular-font-family: var(--typo-font-family);
  --typo-body-main-regular-font-size: 1rem;
  --typo-body-main-regular-font-weight: 400;
  --typo-body-main-regular-line-height: 1.49;
  --typo-body-main-regular-letter-spacing: 0.01em;
  --typo-body-main-regular-paragraph-spacing: 1rem;
  /* … bold … */
  --typo-icon-source: font;
  --typo-icon-style: outlined;
  --typo-icon-font-family: "Material Symbols Outlined";
  --typo-icon-sm-font-size: 1.25rem;
  --typo-icon-sm-font-weight: 400;
  --typo-icon-md-font-size: 1.5rem;
  --typo-icon-md-font-weight: 400;
  --typo-icon-lg-font-size: 2.5rem;
  --typo-icon-lg-font-weight: 400;
}
```

## Headless

```js
import { importEngineConfig, generateSystem } from './src/typo-engine.js';
const { tokensCss, config } = generateSystem(importEngineConfig(json));
```

`generateSystem` **mutuje** state na místě (normalize jmen / `styleCount` / `baseStyle`). Pokud potřebuješ neměnnou kopii, nejdřív clone.
