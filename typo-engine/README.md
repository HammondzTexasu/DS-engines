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

Each style emits **`-regular`** and **`-bold`** token sets. Per-style fields inherit globals (empty / null) until overridden.

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
}
```

## Headless

```js
import { importEngineConfig, generateSystem } from './src/typo-engine.js';
const { tokensCss, config } = generateSystem(importEngineConfig(json));
```

`generateSystem` **mutates** the state in place (normalize names / `styleCount` / `baseStyle`). Clone first if you need an immutable copy.
