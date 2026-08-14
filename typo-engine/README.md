# Typo Engine

Headless modular type scale (Google Font + size scale + letter-spacing / line-height curves) → **JSON config** + **CSS tokens**.

Playground: [`app/`](./app/). AI workflow: [`AGENTS.md`](./AGENTS.md). API: [`src/DEV.md`](./src/DEV.md).

**Does not share code or CSS with `color-engine`.** Same product principles (config = intent, generate = tokens).

## Defaults

| Setting | Default |
| :--- | :--- |
| Font | Inter (Google Fonts) |
| Styles | 9 (`tiny` … `display`) |
| Base style | `body-main` (assignable) |
| Base size | 16px → `1rem` (rem root is always ÷16) |
| Size scale | 1.25 (Major Third) |
| Weights | regular 400 / bold 700 |
| Letter-spacing | start `0.02em` → end `-0.02em`, linear Bézier |
| Line-height | start `1.6` → end `1.15`, linear Bézier (unitless) |
| Paragraph-spacing | inherit = same rem as that style’s `font-size` |
| Icons | Material Symbols **font** (variable) + **Outlined**; 3 sizes (20 / 24 / 40 px, weight 400) |

Each style emits **`-regular`** and **`-bold`** token sets. Per-style fields inherit globals (empty / null) until overridden. Style name **`icon`** is reserved (collides with `--typo-icon-*`) and sanitizes to `style`. Text weights clamp to **100–900**.

Icon tokens are **global**: source, style, family (when font), plus `--typo-icon-{sm|md|lg|xl}-font-size/weight` (1–4 sizes, independent of the type scale). Slot names follow **index**, not count: `0=sm`, `1=md`, `2=lg`, `3=xl`. Shrinking 3→2 drops `lg` only (`sm`/`md` stay). Fill vs outline is **not** an engine token — font: `"FILL"` 0\|1; SVG: a different asset. Optical size is not a token: font uses `font-optical-sizing: auto` (do not pin `"opsz"` unless you have a reason); SVG uses the **24px** asset and scales in CSS. SVG preview in the playground is UI-only (not in config/tokens).

## Tokens (example)

Default `body-main` (index on the 9-step scale):

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

`generateSystem` **mutates** the state in place (normalize names / `styleCount` / `baseStyle`). Clone first if you need an immutable copy.
