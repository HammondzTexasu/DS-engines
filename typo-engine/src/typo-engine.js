/**
 * Typo Engine — headless modular type scale (config + CSS tokens).
 *
 *   import { importEngineConfig, generateSystem } from './typo-engine.js';
 *   const { tokensCss, config } = generateSystem(importEngineConfig(json));
 */

/** @typedef {[number, number, number, number]} Bezier */

/**
 * @typedef {{
 *   start: number,
 *   end: number,
 *   interpolator: Bezier,
 * }} RangeCurve
 */

/**
 * Per-style overrides: `null` / omitted = inherit from global computation.
 * @typedef {{
 *   name: string,
 *   fontSizePx?: number | null,
 *   letterSpacing?: number | null,
 *   lineHeight?: number | null,
 *   paragraphSpacingRem?: number | null,
 *   weightRegular?: number | null,
 *   weightBold?: number | null,
 * }} StyleConfig
 */

/**
 * @typedef {{
 *   fontSizePx: number,
 *   weight: number,
 * }} IconSizeConfig
 */

/**
 * Icon source + a small independent size scale (not the type scale).
 * @typedef {{
 *   source: 'font' | 'svg',
 *   style: 'outlined' | 'rounded' | 'sharp',
 *   sizeCount: number,
 *   sizes: IconSizeConfig[],
 * }} IconConfig
 */

/**
 * @typedef {{
 *   fontFamily: string,
 *   icons: IconConfig,
 *   styleCount: number,
 *   baseStyle: string,
 *   baseSizePx: number,
 *   sizeScale: number,
 *   weightRegular: number,
 *   weightBold: number,
 *   letterSpacing: RangeCurve,
 *   lineHeight: RangeCurve,
 *   styles: StyleConfig[],
 * }} EngineState
 */

/**
 * @typedef {{
 *   name: string,
 *   fontSizePx: number,
 *   fontSizeRem: number,
 *   letterSpacing: number,
 *   lineHeight: number,
 *   paragraphSpacingRem: number,
 *   weightRegular: number,
 *   weightBold: number,
 *   fontSizeInherited: boolean,
 *   letterSpacingInherited: boolean,
 *   lineHeightInherited: boolean,
 *   paragraphSpacingInherited: boolean,
 *   weightRegularInherited: boolean,
 *   weightBoldInherited: boolean,
 * }} ResolvedStyle
 */

export const LINEAR_BEZIER = Object.freeze(/** @type {Bezier} */ ([0, 0, 1, 1]));

export const DEFAULT_STYLE_NAMES = Object.freeze([
  'tiny',
  'caption',
  'body-main',
  'body-lead',
  'heading-minor',
  'heading-secondary',
  'heading-primary',
  'heading-major',
  'display',
]);

export const PREVIEW_SENTENCE = 'Příliš žluťoučký kůň úpěl ďábelské ódy';

/** @type {readonly ('font' | 'svg')[]} */
export const ICON_SOURCES = Object.freeze(['font', 'svg']);

/** @type {readonly ('outlined' | 'rounded' | 'sharp')[]} */
export const ICON_STYLES = Object.freeze(['outlined', 'rounded', 'sharp']);

export const ICON_STYLE_FAMILIES = Object.freeze({
  outlined: 'Material Symbols Outlined',
  rounded: 'Material Symbols Rounded',
  sharp: 'Material Symbols Sharp',
});

export const ICON_SVG_SOURCE_URL =
  'https://github.com/google/material-design-icons/tree/master/symbols/web';

export const ICON_FONT_SOURCE_URL =
  'https://github.com/google/material-design-icons/tree/master/variablefont';

export const DEFAULT_ICON_SIZE_PX = Object.freeze([20, 24, 40, 48]);

/** Slot 0..3 — names follow index, not count (`sm` is always the first size). */
export const ICON_SIZE_NAMES = Object.freeze(['sm', 'md', 'lg', 'xl']);

const STYLE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** @returns {Bezier} */
export function createLinearBezier() {
  return [...LINEAR_BEZIER];
}

/**
 * @param {number} [start]
 * @param {number} [end]
 * @param {Bezier} [interpolator]
 * @returns {RangeCurve}
 */
export function createRangeCurve(start, end, interpolator = createLinearBezier()) {
  return {
    start: Number(start),
    end: Number(end),
    interpolator: roundBezier(interpolator),
  };
}

/** @returns {EngineState} */
export function createDefaultState() {
  const styleCount = 9;
  return {
    fontFamily: 'Inter',
    icons: createDefaultIcons(),
    styleCount,
    baseStyle: 'body-main',
    baseSizePx: 16,
    sizeScale: 1.25,
    weightRegular: 400,
    weightBold: 700,
    letterSpacing: createRangeCurve(0.02, -0.02),
    lineHeight: createRangeCurve(1.6, 1.15),
    styles: defaultStylesForCount(styleCount),
  };
}

/**
 * @param {number} count
 * @returns {StyleConfig[]}
 */
export function defaultStylesForCount(count) {
  const n = clampStyleCount(count);
  /** @type {StyleConfig[]} */
  const styles = [];
  for (let i = 0; i < n; i++) {
    styles.push(createStyleConfig(defaultNameForIndex(i, n)));
  }
  return styles;
}

/**
 * @param {unknown} value
 * @returns {'font' | 'svg'}
 */
export function normalizeIconSource(value) {
  return String(value ?? '').trim().toLowerCase() === 'svg' ? 'svg' : 'font';
}

/**
 * @param {unknown} value
 * @returns {'outlined' | 'rounded' | 'sharp'}
 */
export function normalizeIconStyle(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'rounded' || v === 'sharp') return v;
  return 'outlined';
}

/**
 * @param {unknown} n
 * @returns {number}
 */
export function clampIconSizeCount(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 3;
  return Math.min(4, Math.max(1, v));
}

/**
 * @param {unknown} n
 * @returns {number}
 */
export function clampIconSizePx(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 24;
  return Math.min(64, Math.max(12, v));
}

/**
 * @param {unknown} n
 * @returns {number}
 */
export function clampIconWeight(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 400;
  return Math.min(700, Math.max(100, v));
}

/**
 * Text (Inter etc.) weights. UI and tokens: 100–900.
 * @param {unknown} n
 * @returns {number}
 */
export function clampFontWeight(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 400;
  return Math.min(900, Math.max(100, v));
}

/**
 * @param {number} index
 * @param {number} [_count] unused — names are by index
 * @returns {string}
 */
export function iconSizeNameForIndex(index, _count) {
  void _count;
  const i = Math.round(Number(index));
  if (Number.isFinite(i) && ICON_SIZE_NAMES[i]) return ICON_SIZE_NAMES[i];
  return `size-${Math.max(1, i + 1)}`;
}

/**
 * @param {number} [index]
 * @returns {IconSizeConfig}
 */
export function createIconSize(index = 0) {
  const i = Math.max(0, Math.min(DEFAULT_ICON_SIZE_PX.length - 1, Math.round(Number(index)) || 0));
  return { fontSizePx: DEFAULT_ICON_SIZE_PX[i], weight: 400 };
}

/**
 * In-place: keep size object refs when count is unchanged (live sliders).
 * Grow = append defaults; shrink = slice from the end.
 * @param {IconConfig} icons
 * @returns {IconConfig}
 */
export function normalizeIcons(icons) {
  icons.source = normalizeIconSource(icons.source);
  icons.style = normalizeIconStyle(icons.style);
  icons.sizeCount = clampIconSizeCount(icons.sizeCount ?? icons.sizes?.length ?? 3);
  const prev = Array.isArray(icons.sizes) ? icons.sizes : [];

  if (prev.length === icons.sizeCount) {
    icons.sizes = prev;
  } else {
    /** @type {IconSizeConfig[]} */
    const next = [];
    for (let i = 0; i < icons.sizeCount; i++) {
      next.push(i < prev.length ? prev[i] : createIconSize(i));
    }
    icons.sizes = next;
  }

  for (const size of icons.sizes) {
    size.fontSizePx = clampIconSizePx(size.fontSizePx);
    size.weight = clampIconWeight(size.weight);
  }
  return icons;
}

/** @returns {IconConfig} */
export function createDefaultIcons() {
  return normalizeIcons({
    source: 'font',
    style: 'outlined',
    sizeCount: 3,
    sizes: [],
  });
}

/**
 * @param {unknown} raw
 * @returns {IconConfig}
 */
export function importIcons(raw) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const sizesIn = Array.isArray(src.sizes) ? src.sizes : [];
  /** @type {IconSizeConfig[]} */
  const sizes = sizesIn.map((item, i) => {
    const row = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
    const fallback = createIconSize(i);
    return {
      fontSizePx: Number.isFinite(Number(row.fontSizePx)) ? Number(row.fontSizePx) : fallback.fontSizePx,
      weight: Number.isFinite(Number(row.weight)) ? Number(row.weight) : 400,
    };
  });
  const sizeCount =
    src.sizeCount != null && Number.isFinite(Number(src.sizeCount))
      ? Number(src.sizeCount)
      : sizes.length || 3;
  return normalizeIcons({
    source: normalizeIconSource(src.source),
    style: normalizeIconStyle(src.style),
    sizeCount,
    sizes,
  });
}

/**
 * @param {IconConfig['style']} [style]
 * @returns {string}
 */
export function iconFontFamilyName(style = 'outlined') {
  return ICON_STYLE_FAMILIES[normalizeIconStyle(style)];
}

/**
 * Quoted CSS family for Material Symbols — no system-ui fallback (would leak ligature names).
 * @param {IconConfig['style']} [style]
 * @returns {string}
 */
export function formatIconFontFamilyCss(style = 'outlined') {
  return `"${iconFontFamilyName(style).replace(/"/g, '')}"`;
}

/**
 * Google Fonts CSS2 URL for the Material Symbols variable font (full axes).
 * @param {IconConfig['style']} [style]
 * @returns {string}
 */
export function materialSymbolsCssUrl(style = 'outlined') {
  const familyParam = iconFontFamilyName(style).replace(/\s+/g, '+');
  return `https://fonts.googleapis.com/css2?family=${familyParam}:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block`;
}

/**
 * @param {string} [name]
 * @returns {StyleConfig}
 */
export function createStyleConfig(name = 'style') {
  return {
    name: sanitizeStyleName(name),
    fontSizePx: null,
    letterSpacing: null,
    lineHeight: null,
    paragraphSpacingRem: null,
    weightRegular: null,
    weightBold: null,
  };
}

/**
 * @param {number} count
 * @returns {number}
 */
export function clampStyleCount(count) {
  const n = Math.round(Number(count));
  if (!Number.isFinite(n)) return 9;
  return Math.min(24, Math.max(1, n));
}

/**
 * @param {number} index
 * @param {number} count
 * @returns {string}
 */
export function defaultNameForIndex(index, count) {
  void count;
  if (DEFAULT_STYLE_NAMES[index] && index < DEFAULT_STYLE_NAMES.length) {
    return DEFAULT_STYLE_NAMES[index];
  }
  return `style-${index + 1}`;
}

/**
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeStyleName(name) {
  const raw = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (raw === 'icon') return 'style';
  if (raw && STYLE_NAME_RE.test(raw)) return raw;
  return 'style';
}

/**
 * @param {string} name
 * @returns {string}
 */
export function filterStyleNameInput(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * @param {Bezier} bezier
 * @returns {Bezier}
 */
export function roundBezier([x1, y1, x2, y2]) {
  const out = [
    Math.round(Number(x1) * 100) / 100,
    Math.round(Number(y1) * 100) / 100,
    Math.round(Number(x2) * 100) / 100,
    Math.round(Number(y2) * 100) / 100,
  ];
  if (out.some((n) => !Number.isFinite(n))) {
    return /** @type {Bezier} */ ([...LINEAR_BEZIER]);
  }
  return /** @type {Bezier} */ (out);
}

/**
 * @param {Bezier} bezier
 * @returns {string}
 */
export function formatBezierCss(bezier) {
  const [x1, y1, x2, y2] = roundBezier(bezier);
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/**
 * @param {string} str
 * @returns {Bezier}
 */
export function parseBezierCss(str) {
  const match = String(str).trim().match(
    /cubic-bezier\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i,
  );
  if (!match) {
    throw new Error('Invalid format. Use: cubic-bezier(0, 0, 1, 1)');
  }
  const nums = match.slice(1, 5).map(Number);
  if (nums.some((n) => !Number.isFinite(n))) {
    throw new Error('Invalid format. Use: cubic-bezier(0, 0, 1, 1)');
  }
  return roundBezier(nums);
}

/**
 * @param {number} t
 * @param {number} p0
 * @param {number} p1
 * @param {number} p2
 * @param {number} p3
 */
function cubicPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/**
 * @param {number} x
 * @param {Bezier} bezier
 * @returns {number}
 */
function cubicBezierY(x, bezier) {
  const [x1, y1, x2, y2] = bezier;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const cx = cubicPoint(t, 0, x1, x2, 1) - x;
    if (Math.abs(cx) < 1e-6) break;
    const dx =
      3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    t -= cx / dx;
    t = Math.max(0, Math.min(1, t));
  }
  return cubicPoint(t, 0, y1, y2, 1);
}

/**
 * @param {number} startVal
 * @param {number} endVal
 * @param {number} t
 * @param {Bezier} bezier
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function interpolateFloat(startVal, endVal, t, bezier, decimals = 2) {
  const eased = cubicBezierY(t, bezier);
  const v = startVal + (endVal - startVal) * eased;
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/**
 * @param {number} px
 * @returns {number}
 */
export function pxToRem(px) {
  return Math.round((Number(px) / 16) * 10000) / 10000;
}

/**
 * @param {number} rem
 * @returns {string}
 */
export function formatRem(rem) {
  const n = Number(rem);
  if (!Number.isFinite(n)) return '0rem';
  const s = String(Math.round(n * 10000) / 10000);
  return `${s}rem`;
}

/**
 * @param {number} em
 * @returns {string}
 */
export function formatEm(em) {
  const n = Number(em);
  if (!Number.isFinite(n)) return '0em';
  return `${(Math.round(n * 100) / 100).toFixed(2)}em`;
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatUnitless(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v * 100) / 100);
}

/**
 * @param {EngineState} state
 * @returns {number}
 */
export function resolveBaseIndex(state) {
  const styles = state.styles ?? [];
  const want = sanitizeStyleName(state.baseStyle);
  const idx = styles.findIndex((s) => s.name === want);
  if (idx >= 0) return idx;
  if (!styles.length) return 0;
  return Math.min(styles.length - 1, Math.floor(styles.length / 2));
}

/**
 * Modular scale sizes from base style + scale factor.
 * @param {EngineState} state
 * @returns {number[]}
 */
export function computeScaleSizesPx(state) {
  const count = state.styles.length;
  const baseIndex = resolveBaseIndex(state);
  const baseRaw = Number(state.baseSizePx);
  const scaleRaw = Number(state.sizeScale);
  const basePx = Number.isFinite(baseRaw) && baseRaw > 0 ? baseRaw : 16;
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  /** @type {number[]} */
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const raw = basePx * scale ** (i - baseIndex);
    sizes.push(Math.round(raw * 100) / 100);
  }
  return sizes;
}

/**
 * @param {RangeCurve} curve
 * @param {number} index
 * @param {number} count
 * @param {number} [decimals=2]
 * @returns {number}
 */
export function resolveCurveAtIndex(curve, index, count, decimals = 2) {
  const last = Math.max(0, count - 1);
  const t = last === 0 ? 0 : index / last;
  return interpolateFloat(curve.start, curve.end, t, curve.interpolator, decimals);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function hasOverride(value) {
  return value != null && value !== '' && Number.isFinite(Number(value));
}

/**
 * @param {EngineState} state
 * @returns {ResolvedStyle[]}
 */
export function resolveStyles(state) {
  const styles = state.styles ?? [];
  const count = styles.length;
  const scalePx = computeScaleSizesPx(state);
  /** @type {ResolvedStyle[]} */
  const out = [];

  for (let i = 0; i < count; i++) {
    const style = styles[i];
    const name = sanitizeStyleName(style.name || defaultNameForIndex(i, count));

    const fontSizeInherited = !hasOverride(style.fontSizePx);
    const fontSizePx = fontSizeInherited
      ? scalePx[i]
      : Math.round(Number(style.fontSizePx) * 100) / 100;
    const fontSizeRem = pxToRem(fontSizePx);

    const letterSpacingInherited = !hasOverride(style.letterSpacing);
    const letterSpacing = letterSpacingInherited
      ? resolveCurveAtIndex(state.letterSpacing, i, count, 2)
      : Math.round(Number(style.letterSpacing) * 100) / 100;

    const lineHeightInherited = !hasOverride(style.lineHeight);
    const lineHeight = lineHeightInherited
      ? resolveCurveAtIndex(state.lineHeight, i, count, 2)
      : Math.round(Number(style.lineHeight) * 100) / 100;

    const paragraphSpacingInherited = !hasOverride(style.paragraphSpacingRem);
    const paragraphSpacingRem = paragraphSpacingInherited
      ? fontSizeRem
      : Math.round(Number(style.paragraphSpacingRem) * 10000) / 10000;

    const weightRegularInherited = !hasOverride(style.weightRegular);
    const weightRegular = clampFontWeight(
      weightRegularInherited ? state.weightRegular : style.weightRegular,
    );
    const weightBoldInherited = !hasOverride(style.weightBold);
    const weightBold = clampFontWeight(
      weightBoldInherited ? state.weightBold : style.weightBold,
    );

    out.push({
      name,
      fontSizePx,
      fontSizeRem,
      letterSpacing,
      lineHeight,
      paragraphSpacingRem,
      weightRegular,
      weightBold,
      fontSizeInherited,
      letterSpacingInherited,
      lineHeightInherited,
      paragraphSpacingInherited,
      weightRegularInherited,
      weightBoldInherited,
    });
  }

  return out;
}

/**
 * @param {string} family
 * @returns {string}
 */
export function formatFontFamilyCss(family) {
  const name = String(family || 'Inter').trim() || 'Inter';
  const quoted = /\s/.test(name) ? `"${name.replace(/"/g, '')}"` : name;
  return `${quoted}, system-ui, sans-serif`;
}

/**
 * Google Fonts CSS2 URL — variable axis `100..900` (any weight, e.g. 550).
 * Static families (Poppins) often 400 this URL; use `googleFontsCssUrlStatic` as fallback.
 * @param {string} family
 * @returns {string}
 */
export function googleFontsCssUrl(family) {
  return googleFontsCssUrlWithWeights(family, '100..900');
}

/**
 * Google Fonts CSS2 URL — discrete cuts. Works for static and variable families.
 * Intermediate weights (550) snap to the nearest cut.
 * @param {string} family
 * @returns {string}
 */
export function googleFontsCssUrlStatic(family) {
  return googleFontsCssUrlWithWeights(family, '100;200;300;400;500;600;700;800;900');
}

/**
 * @param {string} family
 * @param {string} wght
 * @returns {string}
 */
function googleFontsCssUrlWithWeights(family, wght) {
  const name = String(family || 'Inter').trim() || 'Inter';
  const familyParam = name.replace(/\s+/g, '+');
  return `https://fonts.googleapis.com/css2?family=${familyParam}:wght@${wght}&display=swap`;
}

/**
 * @param {EngineState} state
 * @param {ResolvedStyle[]} [resolved]
 * @returns {string}
 */
export function buildTokensCss(state, resolved = resolveStyles(state)) {
  const icons = importIcons(state.icons);
  const lines = [];
  lines.push('/* Typo Engine tokens — font metrics + icon source */');
  lines.push(
    `/* Font: ${state.fontFamily} — ${googleFontsCssUrl(state.fontFamily)} (variable axis; static fallback: ${googleFontsCssUrlStatic(state.fontFamily)}) */`,
  );
  if (icons.source === 'font') {
    lines.push(
      `/* Icons: ${iconFontFamilyName(icons.style)} (font) — ${materialSymbolsCssUrl(icons.style)} */`,
    );
    lines.push(
      '/* Fill/outline: engine does not emit a token. Consumer sets font-variation-settings "FILL" 0 (outline) or 1 (fill). Do not add "opsz" unless you have a reason — leave font-optical-sizing: auto (browser default) so opsz follows font-size. */',
    );
  } else {
    lines.push(
      `/* Icons: ${iconFontFamilyName(icons.style)} (svg) — ${ICON_SVG_SOURCE_URL} */`,
    );
    lines.push(
      '/* Fill/outline: engine does not emit a token. Consumer picks a filled vs outlined SVG asset in the same style (outlined/rounded/sharp). */',
    );
    lines.push(
      '/* Optical size: use the 24px SVG asset (opsz 24) and scale with CSS. Engine does not emit opsz. */',
    );
  }
  lines.push(':root {');
  lines.push(`  --typo-font-family: ${formatFontFamilyCss(state.fontFamily)};`);
  lines.push('');

  for (const style of resolved) {
    for (const role of /** @type {const} */ (['regular', 'bold'])) {
      const weight = role === 'regular' ? style.weightRegular : style.weightBold;
      const prefix = `--typo-${style.name}-${role}`;
      lines.push(`  ${prefix}-font-family: var(--typo-font-family);`);
      lines.push(`  ${prefix}-font-size: ${formatRem(style.fontSizeRem)};`);
      lines.push(`  ${prefix}-font-weight: ${weight};`);
      lines.push(`  ${prefix}-line-height: ${formatUnitless(style.lineHeight)};`);
      lines.push(`  ${prefix}-letter-spacing: ${formatEm(style.letterSpacing)};`);
      lines.push(`  ${prefix}-paragraph-spacing: ${formatRem(style.paragraphSpacingRem)};`);
      lines.push('');
    }
  }

  lines.push(`  --typo-icon-source: ${icons.source};`);
  lines.push(`  --typo-icon-style: ${icons.style};`);
  if (icons.source === 'font') {
    lines.push(`  --typo-icon-font-family: ${formatIconFontFamilyCss(icons.style)};`);
  }
  for (let i = 0; i < icons.sizes.length; i++) {
    const size = icons.sizes[i];
    const name = iconSizeNameForIndex(i, icons.sizes.length);
    const rem = Math.round((size.fontSizePx / 16) * 10000) / 10000;
    lines.push(`  --typo-icon-${name}-font-size: ${formatRem(rem)};`);
    lines.push(`  --typo-icon-${name}-font-weight: ${size.weight};`);
  }

  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/**
 * After styleCount change: keep relative slots, refresh default names for new slots.
 * When count is unchanged, keep the same style object references (UI closes over them).
 * @param {EngineState} state
 */
export function normalizeStateForStyleCount(state) {
  const nextCount = clampStyleCount(state.styleCount);
  state.styleCount = nextCount;
  const prev = Array.isArray(state.styles) ? state.styles : [];

  /** @type {StyleConfig[]} */
  let next;
  if (prev.length === nextCount) {
    // Same count: keep references so live override controls stay attached.
    next = prev;
  } else {
    next = [];
    for (let i = 0; i < nextCount; i++) {
      if (prev.length === 0) {
        next.push(createStyleConfig(defaultNameForIndex(i, nextCount)));
        continue;
      }
      // Map by relative position on old scale.
      const t = nextCount === 1 ? 0 : i / (nextCount - 1);
      const srcIndex = Math.round(t * (prev.length - 1));
      const src = prev[Math.min(prev.length - 1, Math.max(0, srcIndex))];
      const style = cloneStyle(src);
      // New slot names: if growing beyond previous length at this index, use default.
      if (prev.length < nextCount) {
        const occupied = new Set(next.map((s) => s.name));
        let name = sanitizeStyleName(style.name);
        if (i >= prev.length || occupied.has(name)) {
          name = defaultNameForIndex(i, nextCount);
          let n = 2;
          while (occupied.has(name)) {
            name = `${defaultNameForIndex(i, nextCount)}-${n++}`;
          }
        }
        style.name = name;
      }
      next.push(style);
    }
    state.styles = next;
  }

  // Ensure unique names (in-place — safe for both paths).
  const seen = new Set();
  for (let i = 0; i < next.length; i++) {
    let name = sanitizeStyleName(next[i].name);
    if (!name || seen.has(name)) {
      name = defaultNameForIndex(i, nextCount);
      let n = 2;
      while (seen.has(name)) name = `${defaultNameForIndex(i, nextCount)}-${n++}`;
    }
    next[i].name = name;
    seen.add(name);
  }

  if (!next.some((s) => s.name === sanitizeStyleName(state.baseStyle))) {
    const body = next.find((s) => s.name === 'body-main');
    state.baseStyle = body?.name ?? next[Math.floor(next.length / 2)]?.name ?? next[0]?.name ?? 'body-main';
  } else {
    state.baseStyle = sanitizeStyleName(state.baseStyle);
  }
}

/**
 * @param {StyleConfig} style
 * @returns {StyleConfig}
 */
function cloneStyle(style) {
  return {
    name: sanitizeStyleName(style?.name),
    fontSizePx: hasOverride(style?.fontSizePx) ? Number(style.fontSizePx) : null,
    letterSpacing: hasOverride(style?.letterSpacing) ? Number(style.letterSpacing) : null,
    lineHeight: hasOverride(style?.lineHeight) ? Number(style.lineHeight) : null,
    paragraphSpacingRem: hasOverride(style?.paragraphSpacingRem)
      ? Number(style.paragraphSpacingRem)
      : null,
    weightRegular: hasOverride(style?.weightRegular) ? clampFontWeight(style.weightRegular) : null,
    weightBold: hasOverride(style?.weightBold) ? clampFontWeight(style.weightBold) : null,
  };
}

/**
 * @param {unknown} raw
 * @returns {RangeCurve}
 */
function importRangeCurve(raw, fallbackStart, fallbackEnd) {
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  let interpolator = createLinearBezier();
  if (Array.isArray(src.interpolator) && src.interpolator.length === 4) {
    interpolator = roundBezier(src.interpolator.map(Number));
  } else if (typeof src.interpolator === 'string') {
    try {
      interpolator = parseBezierCss(src.interpolator);
    } catch {
      interpolator = createLinearBezier();
    }
  }
  return createRangeCurve(
    Number.isFinite(Number(src.start)) ? Number(src.start) : fallbackStart,
    Number.isFinite(Number(src.end)) ? Number(src.end) : fallbackEnd,
    interpolator,
  );
}

/**
 * @param {unknown} json
 * @returns {EngineState}
 */
export function importEngineConfig(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const src = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const state = createDefaultState();

  if (typeof src.fontFamily === 'string' && src.fontFamily.trim()) {
    state.fontFamily = src.fontFamily.trim();
  }
  state.icons = importIcons(src.icons);
  state.styleCount = clampStyleCount(src.styleCount ?? state.styleCount);
  state.baseSizePx = Number.isFinite(Number(src.baseSizePx)) ? Number(src.baseSizePx) : 16;
  state.sizeScale = Number.isFinite(Number(src.sizeScale)) ? Number(src.sizeScale) : 1.25;
  state.weightRegular = Number.isFinite(Number(src.weightRegular))
    ? clampFontWeight(src.weightRegular)
    : 400;
  state.weightBold = Number.isFinite(Number(src.weightBold))
    ? clampFontWeight(src.weightBold)
    : 700;
  state.letterSpacing = importRangeCurve(src.letterSpacing, 0.02, -0.02);
  state.lineHeight = importRangeCurve(src.lineHeight, 1.6, 1.15);

  if (Array.isArray(src.styles) && src.styles.length) {
    state.styles = src.styles.map((item, i) => {
      const row = item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
      return {
        name: sanitizeStyleName(row.name || defaultNameForIndex(i, src.styles.length)),
        fontSizePx: hasOverride(row.fontSizePx) ? Number(row.fontSizePx) : null,
        letterSpacing: hasOverride(row.letterSpacing) ? Number(row.letterSpacing) : null,
        lineHeight: hasOverride(row.lineHeight) ? Number(row.lineHeight) : null,
        paragraphSpacingRem: hasOverride(row.paragraphSpacingRem)
          ? Number(row.paragraphSpacingRem)
          : null,
        weightRegular: hasOverride(row.weightRegular) ? clampFontWeight(row.weightRegular) : null,
        weightBold: hasOverride(row.weightBold) ? clampFontWeight(row.weightBold) : null,
      };
    });
    // Explicit styleCount wins (grow/shrink via normalize); else styles[] length.
    state.styleCount =
      src.styleCount != null && Number.isFinite(Number(src.styleCount))
        ? clampStyleCount(src.styleCount)
        : state.styles.length;
  } else {
    state.styles = defaultStylesForCount(state.styleCount);
  }

  state.baseStyle =
    typeof src.baseStyle === 'string' && src.baseStyle.trim()
      ? sanitizeStyleName(src.baseStyle)
      : 'body-main';

  normalizeStateForStyleCount(state);
  return state;
}

/**
 * @param {EngineState} state
 * @returns {Record<string, unknown>}
 */
export function exportEngineConfig(state) {
  const round2 = (n) => Math.round(Number(n) * 100) / 100;
  return {
    fontFamily: state.fontFamily,
    styleCount: state.styles.length,
    baseStyle: sanitizeStyleName(state.baseStyle),
    baseSizePx: round2(state.baseSizePx),
    sizeScale: round2(state.sizeScale),
    weightRegular: Math.round(clampFontWeight(state.weightRegular)),
    weightBold: Math.round(clampFontWeight(state.weightBold)),
    letterSpacing: {
      start: round2(state.letterSpacing.start),
      end: round2(state.letterSpacing.end),
      interpolator: roundBezier(state.letterSpacing.interpolator),
    },
    lineHeight: {
      start: round2(state.lineHeight.start),
      end: round2(state.lineHeight.end),
      interpolator: roundBezier(state.lineHeight.interpolator),
    },
    icons: {
      source: state.icons.source,
      style: state.icons.style,
      sizeCount: state.icons.sizes.length,
      sizes: state.icons.sizes.map((size) => ({
        fontSizePx: clampIconSizePx(size.fontSizePx),
        weight: clampIconWeight(size.weight),
      })),
    },
    styles: state.styles.map((style) => {
      /** @type {Record<string, unknown>} */
      const row = { name: sanitizeStyleName(style.name) };
      if (hasOverride(style.fontSizePx)) row.fontSizePx = round2(style.fontSizePx);
      if (hasOverride(style.letterSpacing)) row.letterSpacing = round2(style.letterSpacing);
      if (hasOverride(style.lineHeight)) row.lineHeight = round2(style.lineHeight);
      if (hasOverride(style.paragraphSpacingRem)) {
        row.paragraphSpacingRem = Math.round(Number(style.paragraphSpacingRem) * 10000) / 10000;
      }
      if (hasOverride(style.weightRegular)) row.weightRegular = clampFontWeight(style.weightRegular);
      if (hasOverride(style.weightBold)) row.weightBold = clampFontWeight(style.weightBold);
      return row;
    }),
  };
}

/**
 * Build tokens + exportable config. Mutates `state` in place via
 * `normalizeStateForStyleCount` (unique names, styleCount sync, baseStyle).
 * @param {EngineState} state
 * @returns {{
 *   tokensCss: string,
 *   config: Record<string, unknown>,
 *   styles: ResolvedStyle[],
 *   googleFontsUrl: string,
 *   googleFontsUrlStatic: string,
 *   iconFontsUrl: string | null,
 * }}
 */
export function generateSystem(state) {
  normalizeStateForStyleCount(state);
  if (!state.icons) state.icons = createDefaultIcons();
  else normalizeIcons(state.icons);
  const styles = resolveStyles(state);
  return {
    tokensCss: buildTokensCss(state, styles),
    config: exportEngineConfig(state),
    styles,
    googleFontsUrl: googleFontsCssUrl(state.fontFamily),
    googleFontsUrlStatic: googleFontsCssUrlStatic(state.fontFamily),
    iconFontsUrl: state.icons.source === 'font' ? materialSymbolsCssUrl(state.icons.style) : null,
  };
}
