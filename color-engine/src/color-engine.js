/**
 * Color Engine — headless HCT palette system (config + token generation).
 *
 *   import { importEngineConfig, generateSystem } from './color-engine.js';
 *   const { tokensCss, config } = generateSystem(importEngineConfig(json));
 *
 * generateSystem may update interpolate chroma points in the passed state (relative gamut %).
 */

import { Hct, hexFromArgb, argbFromHex } from '../lib/material-color-utilities.mjs';
import { hexToOklch, oklchAtLightness } from '../lib/oklch-relative-chroma.mjs';

/** @typedef {[number, number, number, number]} Bezier */
/**
 * Interpolate control point.
 * For chroma: `ratio` (0–1 of HCT gamut at the point) is the stable intent; `value` is derived.
 * `gamutLimit` is runtime-only (last limit used) — not written to config JSON.
 * @typedef {{ step: number, value: number, ratio?: number, gamutLimit?: number }} ParamPoint
 */
/**
 * Fixed param. For chroma with a single published step, `ratio` / `gamutLimit` mirror interpolate points (runtime).
 * @typedef {{ mode: 'fixed', value: number, ratio?: number, gamutLimit?: number }} FixedParam
 */
/** @typedef {{ mode: 'interpolate', points: ParamPoint[], interpolators: Bezier[], clampInterpolatedChroma?: boolean }} InterpolateParam */
/** @typedef {FixedParam | InterpolateParam} ParamConfig */
/**
 * Interaction states for palette steps (not min/max).
 * LM holds full config; DM stores only deltas (`InteractionStatesDeltas`) and inherits
 * delivery / space / relativeChroma / oklchGamut / pivotStep from LM via `resolveModeInteractionStates`.
 * `delivery: 'build'` — emit hex `--*-state1` / `--*-state2` (space HCT or OKLCH).
 * `delivery: 'runtime'` — force OKLCH, relative chroma off; emit only `--state-*-state1` / `--state-*-state2` (Δ from HCT T math, applied as OKLCH L).
 * `oklchGamut` — used when build + OKLCH (sRGB / Display P3 max-C).
 * `pivotStep` — key grid step whose HCT T is the lighten/darken threshold (LM only; remapped with stepCount).
 * @typedef {{ deltaMin: number, deltaMax: number, state2Scale: number }} InteractionStatesDeltas
 * @typedef {InteractionStatesDeltas & {
 *   relativeChroma: boolean,
 *   delivery: 'build' | 'runtime',
 *   space: 'hct' | 'oklch',
 *   oklchGamut: 'srgb' | 'p3',
 *   pivotStep: number,
 * }} InteractionStatesConfig
 */
/** @typedef {{ min: string, max: string, start: { tone: number }, end: { tone: number }, interpolator: Bezier, states: InteractionStatesConfig | InteractionStatesDeltas, interpolatorOverride?: boolean }} KeyPaletteConfig */
/** @typedef {{ lm: KeyPaletteConfig, dm: KeyPaletteConfig & { interpolatorOverride: boolean } }} KeyPaletteState */
/**
 * Custom palette. `includeSteps` — whitelist of grid step ids to publish (tokens + GUI).
 * `null` / omitted / full grid = all key steps. Never includes min/max.
 * @typedef {{ name: string, includeSteps: number[] | null, lm: { hue: ParamConfig, chroma: ParamConfig }, dm: { hue: ParamConfig, chroma: ParamConfig } }} CustomPaletteConfig
 */
/**
 * Optional brand seed (shared in config). With perfectFit, generateSystem forces seed hex on that LM step.
 * @typedef {{ hex: string, perfectFit: boolean, palette: string }} BrandConfig
 */
/** @typedef {{ stepCount: number, keyPalette: KeyPaletteState, customPalettes: Array<CustomPaletteConfig & { id: string }>, brand: BrandConfig | null }} EngineState */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {Bezier} */
export const DEFAULT_BEZIER = [0.32, 0.18, 0.68, 0.77];

/** @type {Bezier} — default for hue / chroma interpolate segments */
export const LINEAR_BEZIER = [0, 0, 1, 1];

/** Token / display name for the neutral key palette. */
export const KEY_PALETTE_NAME = 'key-palette';

/** Engine ceiling for chroma (Material Web HCT picker range). */
export const CHROMA_MAX = 150;

/** Default |ΔT| when swatch tone equals `bgTone` (surface behind the color). */
export const DEFAULT_STATE_DELTA_MIN = 5;

/** Default |ΔT| when |swatchTone − bgTone| is 100. */
export const DEFAULT_STATE_DELTA_MAX = 20;

/** DM key palette defaults (near / far from bg). */
export const DEFAULT_STATE_DELTA_MIN_DM = 8;
export const DEFAULT_STATE_DELTA_MAX_DM = 15;

/** Default state2 magnitude = state1 × this scale. */
export const DEFAULT_STATE2_SCALE = 2;

export const ENGINE_CONFIG_VERSION = 1;

// ---------------------------------------------------------------------------
// Steps & Bézier
// ---------------------------------------------------------------------------

/**
 * @param {number} stepCount
 * @returns {number[]}
 */
export function getSteps(stepCount) {
  return Array.from({ length: stepCount }, (_, i) => (i + 1) * 10);
}

/**
 * @param {number} stepCount
 * @returns {number}
 */
export function getEndStep(stepCount) {
  return stepCount * 10;
}

/**
 * Format step ids as `10-20-30` (GUI / power-user string).
 * @param {number[]} steps
 * @returns {string}
 */
export function formatIncludeSteps(steps) {
  return steps.join('-');
}

/**
 * Parse `10-20-30` / `10, 20, 30` into unique sorted ids that exist on the key grid.
 * Invalid / empty → full grid (same as “publish all”).
 * @param {string} raw
 * @param {number[]} gridSteps
 * @returns {number[]}
 */
export function parseIncludeStepsInput(raw, gridSteps) {
  const parts = String(raw ?? '')
    .split(/[-,\s]+/)
    .map((p) => Number(String(p).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return resolveIncludeSteps(parts, gridSteps);
}

/**
 * Effective published steps for a custom palette (never empty; never min/max).
 * @param {number[] | null | undefined} includeSteps
 * @param {number[]} gridSteps
 * @returns {number[]}
 */
export function resolveIncludeSteps(includeSteps, gridSteps) {
  if (!includeSteps || includeSteps.length === 0) return gridSteps.slice();
  const allowed = new Set(gridSteps);
  const out = [...new Set(includeSteps.filter((s) => allowed.has(s)))].sort((a, b) => a - b);
  return out.length ? out : gridSteps.slice();
}

/**
 * @param {number[] | null | undefined} includeSteps
 * @param {number[]} gridSteps
 * @returns {boolean}
 */
export function isFullIncludeSteps(includeSteps, gridSteps) {
  const resolved = resolveIncludeSteps(includeSteps, gridSteps);
  if (resolved.length !== gridSteps.length) return false;
  return resolved.every((s, i) => s === gridSteps[i]);
}

/**
 * Normalize stored whitelist: `null` when publishing the full key grid.
 * @param {number[] | null | undefined} includeSteps
 * @param {number[]} gridSteps
 * @returns {number[] | null}
 */
export function normalizeIncludeSteps(includeSteps, gridSteps) {
  if (includeSteps == null || includeSteps.length === 0) return null;
  const resolved = resolveIncludeSteps(includeSteps, gridSteps);
  return isFullIncludeSteps(resolved, gridSteps) ? null : resolved;
}

/**
 * @param {number[] | null | undefined} includeSteps
 * @param {number[]} gridSteps
 * @returns {boolean}
 */
export function isSingleIncludeStep(includeSteps, gridSteps) {
  return resolveIncludeSteps(includeSteps, gridSteps).length === 1;
}

/**
 * When only one step is published, collapse H/C interpolate → fixed at that step
 * (Fixed vs Interpolate is meaningless for a single color).
 * Chroma keeps `ratio` when the source interpolate point had one.
 * @param {CustomPaletteConfig} palette
 * @param {number[]} gridSteps
 */
export function collapseParamsForSingleIncludeStep(palette, gridSteps) {
  const published = resolveIncludeSteps(palette.includeSteps, gridSteps);
  if (published.length !== 1) return;
  const step = published[0];
  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    for (const paramName of /** @type {const} */ (['hue', 'chroma'])) {
      const param = palette[mode][paramName];
      if (param.mode !== 'interpolate') continue;
      const value = resolveParam(param, step, gridSteps);
      /** @type {FixedParam} */
      const fixed = createFixedParam(value);
      if (paramName === 'chroma') {
        const atStep = param.points.find((p) => p.step === step);
        if (atStep && typeof atStep.ratio === 'number' && Number.isFinite(atStep.ratio)) {
          fixed.ratio = Math.min(1, Math.max(0, atStep.ratio));
        }
      }
      palette[mode][paramName] = fixed;
    }
  }
}

/**
 * Remap fixed chroma so `ratio` stays stable at one published step (same as interpolate points).
 * Mutates the fixed param in place.
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number} step
 */
export function applyRelativeFixedChromaAtStep(chromaParam, hueParam, keyResult, steps, step) {
  if (chromaParam.mode !== 'fixed') return;

  const limit = chromaLimitAtStep(hueParam, keyResult, steps, step);

  if (typeof chromaParam.ratio !== 'number' || !Number.isFinite(chromaParam.ratio)) {
    chromaParam.ratio = chromaRatioFromValue(chromaParam.value, limit);
  } else if (
    typeof chromaParam.gamutLimit === 'number'
    && chromaParam.gamutLimit > 0
    && Math.round(Number(chromaParam.value)) !== Math.round(chromaParam.ratio * chromaParam.gamutLimit)
  ) {
    chromaParam.ratio = chromaRatioFromValue(chromaParam.value, limit);
  }

  chromaParam.ratio = Math.min(1, Math.max(0, chromaParam.ratio));
  chromaParam.value = Math.round(chromaParam.ratio * limit);
  chromaParam.gamutLimit = limit;
}

/**
 * @param {Bezier} bezier
 * @returns {Bezier}
 */
export function roundBezier([x1, y1, x2, y2]) {
  return [
    Math.round(x1 * 100) / 100,
    Math.round(y1 * 100) / 100,
    Math.round(x2 * 100) / 100,
    Math.round(y2 * 100) / 100,
  ];
}

/**
 * @param {Bezier} bezier
 * @returns {Bezier}
 */
export function invertBezier(bezier) {
  const [x1, y1, x2, y2] = bezier;
  return roundBezier([1 - x2, 1 - y2, 1 - x1, 1 - y1]);
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
  const match = str.trim().match(
    /cubic-bezier\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i,
  );
  if (!match) {
    throw new Error(`Invalid format. Use: cubic-bezier(0.32, 0.18, 0.68, 0.77)`);
  }
  return roundBezier(match.slice(1, 5).map(Number));
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
    const dx = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
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
 * @returns {number}
 */
export function interpolateValue(startVal, endVal, t, bezier) {
  const eased = cubicBezierY(t, bezier);
  return Math.round(startVal + (endVal - startVal) * eased);
}

/**
 * @param {number[]} steps
 * @param {number} startVal
 * @param {number} endVal
 * @param {Bezier} bezier
 * @returns {Record<number, number>}
 */
export function interpolateAcrossSteps(steps, startVal, endVal, bezier) {
  /** @type {Record<number, number>} */
  const result = {};
  const last = steps.length - 1;
  for (let i = 0; i < steps.length; i++) {
    const t = last === 0 ? 0 : i / last;
    result[steps[i]] = interpolateValue(startVal, endVal, t, bezier);
  }
  return result;
}

/**
 * Nudge a cubic-bezier so `interpolateValue(start, end, tTarget, bezier) === targetTone`,
 * staying as close as possible to the original handles (shape / trend first).
 * @param {Bezier} bezier
 * @param {number} tTarget — 0…1 position on the step grid
 * @param {number} startTone
 * @param {number} endTone
 * @param {number} targetTone
 * @returns {Bezier}
 */
export function fitBezierForTone(bezier, tTarget, startTone, endTone, targetTone) {
  const orig = roundBezier(bezier);
  const t = Math.min(1, Math.max(0, Number(tTarget) || 0));
  const start = Number(startTone);
  const end = Number(endTone);
  const want = Math.round(Number(targetTone));

  const toneAt = (b) => interpolateValue(start, end, t, b);
  const drift = (b) => b.reduce((s, v, i) => s + (v - orig[i]) ** 2, 0);

  let cur = [...orig];
  let best = [...orig];
  let bestErr = Math.abs(toneAt(cur) - want);
  let bestDrift = 0;

  if (bestErr === 0) return best;

  for (let iter = 0; iter < 500; iter++) {
    const step = iter < 120 ? 0.05 : iter < 300 ? 0.02 : 0.005;
    let improved = false;
    for (let i = 0; i < 4; i++) {
      for (const dir of /** @type {const} */ ([-1, 1])) {
        const next = /** @type {Bezier} */ ([...cur]);
        next[i] = Math.min(1, Math.max(0, next[i] + dir * step));
        const candidate = roundBezier(next);
        const err = Math.abs(toneAt(candidate) - want);
        const d = drift(candidate);
        if (err < bestErr || (err === bestErr && d < bestDrift - 1e-12)) {
          best = candidate;
          bestErr = err;
          bestDrift = d;
          cur = candidate;
          improved = true;
        }
      }
    }
    if (bestErr === 0) break;
    if (!improved && iter > 50) break;
  }

  return best;
}

/**
 * Step id whose current key tone is closest to `tone`.
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number} tone
 * @returns {number}
 */
export function nearestStepForTone(keyResult, steps, tone) {
  let bestStep = steps[0];
  let bestDist = Infinity;
  const target = Number(tone);
  for (const step of steps) {
    const dist = Math.abs((keyResult.steps[step]?.tone ?? 0) - target);
    if (dist < bestDist || (dist === bestDist && step < bestStep)) {
      bestDist = dist;
      bestStep = step;
    }
  }
  return bestStep;
}

/**
 * Normalize a brand hex string to `#rrggbb`, or `null` if invalid.
 * @param {string} raw
 * @returns {string | null}
 */
export function parseBrandHex(raw) {
  const s = String(raw ?? '').trim();
  const match = s.match(/^#?([0-9a-fA-F]{6})$/);
  if (!match) return null;
  return `#${match[1].toLowerCase()}`;
}

/**
 * Apply a brand color to engine state (headless + GUI).
 * - Picks the key step whose tone is nearest to the brand tone.
 * - `perfectFit`: bend LM key tone interpolator (minimal drift from current curve) so that step gets brand T.
 * - Sets brand custom palette LM hue/chroma to brand H/C. DM params untouched.
 * - Writes `state.brand` for config export / Perfect-fit hex override in `generateSystem`.
 *
 * @param {EngineState} state
 * @param {string} hex — `#rrggbb` or `rrggbb`
 * @param {{ perfectFit?: boolean, paletteId?: string }} [options]
 * @returns {{ hex: string, step: number, paletteId: string, hue: number, chroma: number, tone: number }}
 */
export function applyBrandColor(state, hex, options = {}) {
  const normalized = parseBrandHex(hex);
  if (!normalized) {
    throw new Error('Brand color must be a hex color (#rrggbb)');
  }

  const perfectFit = Boolean(options.perfectFit);
  const hct = hexToHct(normalized);
  const steps = getSteps(state.stepCount);
  if (steps.length === 0) {
    throw new Error('stepCount must be at least 1');
  }

  const keyResult = generateKeyPalette(state.keyPalette.lm, steps);
  const step = nearestStepForTone(keyResult, steps, hct.tone);
  const stepIndex = steps.indexOf(step);
  const tTarget = steps.length <= 1 ? 0 : stepIndex / (steps.length - 1);

  if (perfectFit) {
    const start = state.keyPalette.lm.start.tone;
    const end = state.keyPalette.lm.end.tone;
    state.keyPalette.lm.interpolator = fitBezierForTone(
      state.keyPalette.lm.interpolator,
      tTarget,
      start,
      end,
      hct.tone,
    );
    if (!state.keyPalette.dm.interpolatorOverride) {
      state.keyPalette.dm.interpolator = invertBezier(state.keyPalette.lm.interpolator);
    }
  }

  if (!state.customPalettes.length) {
    state.customPalettes.push(createCustomPalette('brand'));
  }

  let palette = options.paletteId
    ? state.customPalettes.find((p) => p.id === options.paletteId)
    : null;
  if (!palette) {
    palette = state.customPalettes[0];
  }

  palette.lm.hue = createFixedParam(hct.hue);
  palette.lm.chroma = createFixedParam(hct.chroma);

  state.brand = {
    hex: normalized,
    perfectFit,
    palette: palette.name,
  };

  return {
    hex: normalized,
    step,
    paletteId: palette.id,
    hue: hct.hue,
    chroma: hct.chroma,
    tone: hct.tone,
  };
}

/**
 * Clear persisted brand seed (config + Perfect-fit override).
 * @param {EngineState} state
 */
export function clearBrandConfig(state) {
  state.brand = null;
}

/**
 * @param {EngineState} state
 * @returns {(CustomPaletteConfig & { id: string }) | null}
 */
export function resolveBrandPalette(state) {
  if (!state.brand || !state.customPalettes.length) return null;
  const name = sanitizePaletteName(state.brand.palette);
  return state.customPalettes.find((p) => sanitizePaletteName(p.name) === name) || null;
}

/**
 * After palette generate: with Perfect fit, force seed hex on the brand LM step (1:1).
 * Mutates `customResults` only. Not written as a separate config field — derived from `state.brand`.
 * @param {EngineState} state
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} customResults
 * @returns {number | null} overridden step id, or null
 */
export function applyBrandStepOverride(state, keyResults, customResults) {
  if (!state.brand?.perfectFit) return null;
  const hex = parseBrandHex(state.brand.hex);
  if (!hex) return null;

  const palette = resolveBrandPalette(state);
  if (!palette) return null;
  const results = customResults[palette.id];
  if (!results?.lm?.steps) return null;

  const steps = getSteps(state.stepCount);
  const hct = hexToHct(hex);
  const step = nearestStepForTone(keyResults.lm, steps, hct.tone);
  const data = results.lm.steps[step];
  if (!data) return null;

  results.lm.steps[step] = {
    ...data,
    hex,
    hue: hct.hue,
    chroma: hct.chroma,
    tone: hct.tone,
  };
  return step;
}

/**
 * @param {ParamConfig} config
 * @param {number} step
 * @param {number[]} steps
 * @returns {number}
 */
export function resolveParam(config, step, steps) {
  if (config.mode === 'fixed') {
    return Math.round(config.value);
  }

  const points = [...config.points].sort((a, b) => a.step - b.step);
  if (points.length === 0) return 0;
  if (points.length === 1) return Math.round(points[0].value);

  if (step <= points[0].step) return Math.round(points[0].value);
  if (step >= points[points.length - 1].step) return Math.round(points[points.length - 1].value);

  let segIdx = 0;
  for (let i = 0; i < points.length - 1; i++) {
    if (step >= points[i].step && step <= points[i + 1].step) {
      segIdx = i;
      break;
    }
  }

  const p0 = points[segIdx];
  const p1 = points[segIdx + 1];
  const segSteps = steps.filter((s) => s >= p0.step && s <= p1.step);
  const idx = segSteps.indexOf(step);
  const t = segSteps.length <= 1 ? 0 : idx / (segSteps.length - 1);
  const bezier = config.interpolators[segIdx] ?? [0, 0, 1, 1];
  return interpolateValue(p0.value, p1.value, t, bezier);
}

// ---------------------------------------------------------------------------
// HCT & chroma
// ---------------------------------------------------------------------------

/**
 * Maximum chroma representable in sRGB for the given HCT hue and tone.
 * @param {number} hue
 * @param {number} tone
 * @returns {number}
 */
export function maxChromaForHueTone(hue, tone) {
  return Math.round(Hct.from(hue, 999, tone).chroma);
}

/**
 * Clamp requested chroma to what HCT can actually deliver for hue + tone.
 * @param {number} chroma
 * @param {number} hue
 * @param {number} tone
 * @returns {number}
 */
export function clampChroma(chroma, hue, tone) {
  const requested = Math.max(0, Math.round(Number(chroma)) || 0);
  return Math.min(requested, maxChromaForHueTone(hue, tone));
}

/**
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @returns {number}
 */
export function peakChromaForSteps(hueParam, keyResult, steps) {
  let peak = 0;
  for (const step of steps) {
    const hue = resolveParam(hueParam, step, steps);
    const tone = keyResult.steps[step].tone;
    peak = Math.max(peak, maxChromaForHueTone(hue, tone));
  }
  return peak;
}

/**
 * Clamp stored interpolate chroma point values to HCT limits. Mutates chromaParam.
 * Fixed chroma is left as requested (UI may sit past the peak marker); render still clamps per step.
 * No-op when `clampInterpolatedChroma` is false (absolute C allowed above gamut).
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @returns {boolean}
 */
export function clampChromaParamValues(chromaParam, hueParam, keyResult, steps) {
  if (chromaParam.mode === 'fixed') return false;
  if (!isClampInterpolatedChroma(chromaParam)) return false;

  let changed = false;
  for (const point of chromaParam.points) {
    const hue = resolveParam(hueParam, point.step, steps);
    const tone = keyResult.steps[point.step]?.tone;
    if (tone === undefined) continue;
    const next = clampChroma(point.value, hue, tone);
    if (next !== point.value) {
      point.value = next;
      const limit = clampChroma(CHROMA_MAX, hue, tone);
      if (typeof point.ratio === 'number') {
        point.ratio = chromaRatioFromValue(next, limit);
      }
      point.gamutLimit = limit;
      changed = true;
    }
  }
  return changed;
}

/**
 * Whether interpolate chroma should clamp control points + generated steps (default false).
 * @param {ParamConfig} chromaParam
 * @returns {boolean}
 */
export function isClampInterpolatedChroma(chromaParam) {
  if (chromaParam.mode !== 'interpolate') return true;
  return chromaParam.clampInterpolatedChroma === true;
}

/**
 * @param {number} hue
 * @param {number} chroma
 * @param {number} tone
 * @returns {string}
 */
export function hctToHex(hue, chroma, tone) {
  const hct = Hct.from(hue, chroma, tone);
  return hexFromArgb(hct.toInt());
}

/**
 * @param {string} hex
 * @returns {{ hue: number, chroma: number, tone: number, hex: string }}
 */
export function hexToHct(hex) {
  const argb = argbFromHex(hex);
  const hct = Hct.fromInt(argb);
  return {
    hue: Math.round(hct.hue),
    chroma: Math.round(hct.chroma),
    tone: Math.round(hct.tone),
    hex: hexFromArgb(argb),
  };
}

/**
 * @param {boolean} [forDm=false]
 * @returns {InteractionStatesDeltas}
 */
export function createDefaultInteractionDeltas(forDm = false) {
  return {
    deltaMin: forDm ? DEFAULT_STATE_DELTA_MIN_DM : DEFAULT_STATE_DELTA_MIN,
    deltaMax: forDm ? DEFAULT_STATE_DELTA_MAX_DM : DEFAULT_STATE_DELTA_MAX,
    state2Scale: DEFAULT_STATE2_SCALE,
  };
}

/**
 * Default pivot step id for a grid (prefer 60 → 5 darken / 5 lighten on 10-step grid).
 * @param {number} stepCount
 * @returns {number}
 */
export function defaultPivotStep(stepCount) {
  const steps = getSteps(Math.max(1, Math.round(stepCount) || 1));
  if (!steps.length) return 10;
  return resolvePivotStep(60, steps);
}

/**
 * Snap / pick a valid pivot step on the grid.
 * @param {unknown} pivotStep
 * @param {number[]} steps
 * @returns {number}
 */
export function resolvePivotStep(pivotStep, steps) {
  if (!steps.length) return 10;
  if (typeof pivotStep === 'number' && Number.isFinite(pivotStep) && steps.includes(pivotStep)) {
    return pivotStep;
  }
  const target = typeof pivotStep === 'number' && Number.isFinite(pivotStep) ? pivotStep : 60;
  let best = steps[0];
  let bestDist = Math.abs(steps[0] - target);
  for (const step of steps) {
    const dist = Math.abs(step - target);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Remap pivot step when the key grid changes (proportional by index / span).
 * @param {number} pivotStep
 * @param {number[]} fromSteps
 * @param {number[]} toSteps
 * @returns {number}
 */
export function remapPivotStep(pivotStep, fromSteps, toSteps) {
  if (!toSteps.length) return pivotStep;
  if (!fromSteps.length) return resolvePivotStep(pivotStep, toSteps);

  const fromIdx = fromSteps.indexOf(pivotStep);
  let t;
  if (fromIdx >= 0) {
    t = fromIdx / Math.max(1, fromSteps.length - 1);
  } else {
    const a = fromSteps[0];
    const b = fromSteps[fromSteps.length - 1];
    t = b > a ? (Number(pivotStep) - a) / (b - a) : 0.5;
  }
  const clamped = Math.min(1, Math.max(0, t));
  return toSteps[Math.round(clamped * (toSteps.length - 1))];
}

/**
 * HCT T at the configured pivot step (from that mode's key palette).
 * @param {Partial<InteractionStatesConfig> | null | undefined} states
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @returns {number}
 */
export function resolvePivotTone(states, keyResult, steps) {
  const step = resolvePivotStep(states?.pivotStep, steps);
  const tone = keyResult.steps[step]?.tone;
  return typeof tone === 'number' && Number.isFinite(tone) ? tone : 50;
}

/**
 * Full LM defaults (strategy + deltas).
 * @param {number} [stepCount=10]
 * @returns {InteractionStatesConfig}
 */
export function createDefaultInteractionStates(stepCount = 10) {
  return {
    ...createDefaultInteractionDeltas(false),
    relativeChroma: true,
    delivery: 'build',
    space: 'hct',
    oklchGamut: 'srgb',
    pivotStep: defaultPivotStep(stepCount),
  };
}

/**
 * Normalize deltas only (DM config shape).
 * @param {Partial<InteractionStatesDeltas> | null | undefined} deltas
 * @param {boolean} [forDm=false]
 * @returns {InteractionStatesDeltas}
 */
export function resolveInteractionDeltas(deltas, forDm = false) {
  const base = createDefaultInteractionDeltas(forDm);
  const deltaMin = typeof deltas?.deltaMin === 'number' && Number.isFinite(deltas.deltaMin)
    ? deltas.deltaMin
    : base.deltaMin;
  const deltaMax = typeof deltas?.deltaMax === 'number' && Number.isFinite(deltas.deltaMax)
    ? deltas.deltaMax
    : base.deltaMax;
  const state2Scale = typeof deltas?.state2Scale === 'number' && Number.isFinite(deltas.state2Scale)
    ? deltas.state2Scale
    : base.state2Scale;
  return {
    deltaMin,
    deltaMax: Math.max(deltaMin, deltaMax),
    state2Scale,
  };
}

/**
 * Stored LM states (config / GUI). Does **not** force runtime overrides —
 * preferences for space / relative / gamut survive delivery toggles.
 * @param {Partial<InteractionStatesConfig> | null | undefined} states
 * @param {number[]} [steps] — when provided, snaps `pivotStep` onto the grid
 * @returns {InteractionStatesConfig}
 */
export function normalizeStoredInteractionStates(states, steps) {
  const deltas = resolveInteractionDeltas(states, false);
  const grid = steps?.length ? steps : getSteps(10);
  return {
    ...deltas,
    delivery: states?.delivery === 'runtime' ? 'runtime' : 'build',
    space: states?.space === 'oklch' ? 'oklch' : 'hct',
    relativeChroma: typeof states?.relativeChroma === 'boolean' ? states.relativeChroma : true,
    oklchGamut: states?.oklchGamut === 'p3' ? 'p3' : 'srgb',
    pivotStep: resolvePivotStep(states?.pivotStep, grid),
  };
}

/**
 * Effective LM states for math / tokens (runtime → OKLCH + relativeChroma off).
 * Does not mutate stored preferences.
 * @param {Partial<InteractionStatesConfig> | null | undefined} states
 * @param {number[]} [steps]
 * @returns {InteractionStatesConfig}
 */
export function resolveInteractionStates(states, steps) {
  const stored = normalizeStoredInteractionStates(states, steps);
  if (stored.delivery !== 'runtime') return stored;
  return {
    ...stored,
    space: 'oklch',
    relativeChroma: false,
  };
}

/**
 * Effective states for a key mode: LM strategy shared; DM overrides only deltas.
 * @param {KeyPaletteState} keyPalette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} [steps]
 * @returns {InteractionStatesConfig}
 */
export function resolveModeInteractionStates(keyPalette, mode, steps) {
  const lm = resolveInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (keyPalette.lm?.states),
    steps,
  );
  if (mode === 'lm') return lm;
  const dmDeltas = resolveInteractionDeltas(
    /** @type {Partial<InteractionStatesDeltas>} */ (keyPalette.dm?.states),
    true,
  );
  return { ...lm, ...dmDeltas };
}

/**
 * |ΔT| from proximity of swatch HCT T to bg HCT T.
 * Closer to bg → nearer `deltaMin`; farther → nearer `deltaMax`.
 * @param {number} colorTone
 * @param {number} bgTone
 * @param {InteractionStatesConfig | InteractionStatesDeltas} states
 * @returns {number}
 */
export function interactionDeltaMagnitude(colorTone, bgTone, states) {
  const diff = Math.min(100, Math.abs(Number(colorTone) - Number(bgTone)));
  const min = Number(states.deltaMin);
  const max = Number(states.deltaMax);
  return min + (diff / 100) * (max - min);
}

/**
 * Round interaction Δ to one decimal (build + runtime tokens share this).
 * @param {number} n
 * @returns {number}
 */
export function roundStateDelta(n) {
  const rounded = Math.round(Number(n) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Next HCT T after interaction (state1 = 1×, state2 = × `state2Scale`).
 * Direction from `pivotTone`; |Δ| rounded to 1 decimal before apply.
 * @param {number} colorTone
 * @param {number} bgTone
 * @param {InteractionStatesConfig | InteractionStatesDeltas} states
 * @param {1 | 2} level
 * @param {number} pivotTone
 * @returns {number}
 */
export function applyInteractionTone(colorTone, bgTone, states, level, pivotTone) {
  const delta = interactionDeltaMagnitude(colorTone, bgTone, states);
  const scale = level === 2 ? Number(states.state2Scale) : 1;
  const amount = roundStateDelta(delta * scale);
  const next = colorTone > pivotTone ? colorTone - amount : colorTone + amount;
  return Math.min(100, Math.max(0, next));
}

/**
 * Signed Δ from HCT T math (`nextT − colorT`), one decimal.
 * Runtime tokens / OKLCH apply this to L.
 * @param {number} colorTone
 * @param {number} bgTone
 * @param {InteractionStatesConfig | InteractionStatesDeltas} states
 * @param {1 | 2} level
 * @param {number} pivotTone
 * @returns {number}
 */
export function interactionStateDelta(colorTone, bgTone, states, level, pivotTone) {
  return roundStateDelta(
    applyInteractionTone(colorTone, bgTone, states, level, pivotTone) - Number(colorTone),
  );
}

/**
 * @param {number} dl
 * @returns {string}
 */
function formatDeltaL(dl) {
  return String(roundStateDelta(dl));
}

/**
 * OKLCH delivery: Δ from HCT T math, applied as OKLCH L shift on the hex.
 * @param {{ hue: number, chroma: number, tone: number, hex?: string }} color
 * @param {string} bgHex
 * @param {InteractionStatesConfig} states
 * @param {1 | 2} level
 * @param {number} pivotTone
 * @returns {{ hue: number, chroma: number, tone: number, hex: string }}
 */
function colorAtInteractionStateOklch(color, bgHex, states, level, pivotTone) {
  const hex = color.hex || hctToHex(color.hue, color.chroma, color.tone);
  const bgTone = hexToHct(bgHex).tone;
  const delta = interactionStateDelta(color.tone, bgTone, states, level, pivotTone);
  const src = hexToOklch(hex);
  const nextL = Math.min(100, Math.max(0, src.l + delta));
  const out = oklchAtLightness(hex, nextL, {
    relativeChroma: states.relativeChroma === true,
    gamut: states.oklchGamut,
  });
  return hexToHct(out.hex);
}

/**
 * Interaction color for a palette step (not min/max).
 * Math always HCT T (vs bg T, pivot T). Build HCT edits T; OKLCH/runtime applies the same Δ to L.
 * @param {{ hue: number, chroma: number, tone: number, hex?: string }} color
 * @param {string} bgHex — surface behind the color (often key min)
 * @param {InteractionStatesConfig} states
 * @param {1 | 2} level
 * @param {number} pivotTone — HCT T at configured pivot step
 * @returns {{ hue: number, chroma: number, tone: number, hex: string }}
 */
export function colorAtInteractionState(color, bgHex, states, level, pivotTone) {
  const cfg = resolveInteractionStates(states);

  if (cfg.space === 'oklch') {
    return colorAtInteractionStateOklch(color, bgHex, cfg, level, pivotTone);
  }

  const bgTone = hexToHct(bgHex).tone;
  const tone = applyInteractionTone(color.tone, bgTone, cfg, level, pivotTone);
  const hue = color.hue;
  const useRelative = cfg.relativeChroma === true;

  let chroma;
  if (useRelative) {
    const limitFrom = maxChromaForHueTone(hue, color.tone);
    const ratio = chromaRatioFromValue(color.chroma, limitFrom);
    const limitTo = maxChromaForHueTone(hue, tone);
    chroma = Math.round(ratio * limitTo);
  } else {
    chroma = clampChroma(color.chroma, hue, tone);
  }

  return {
    hue,
    chroma,
    tone: Math.round(tone),
    hex: hctToHex(hue, chroma, tone),
  };
}

/**
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number} step
 * @returns {number}
 */
export function chromaLimitAtStep(hueParam, keyResult, steps, step) {
  const hue = resolveParam(hueParam, step, steps);
  const tone = keyResult.steps[step]?.tone;
  if (tone === undefined) return 0;
  return clampChroma(CHROMA_MAX, hue, tone);
}

/**
 * @param {number} value
 * @param {number} limit
 * @returns {number}
 */
export function chromaRatioFromValue(value, limit) {
  if (!(limit > 0)) return 0;
  return Math.min(1, Math.max(0, Number(value) / limit));
}

/**
 * Lock relative chroma intent from an absolute C at the current gamut limit.
 * Prefer this when code/GUI sets an interpolate chroma point (keeps `ratio` in sync).
 * @param {ParamPoint} point
 * @param {number} value
 * @param {number} limit
 */
export function lockChromaPointRatio(point, value, limit) {
  const next = Math.max(0, Math.round(Number(value)) || 0);
  const capped = limit > 0 ? Math.min(next, Math.round(limit)) : next;
  point.value = capped;
  point.ratio = chromaRatioFromValue(capped, limit);
  point.gamutLimit = limit > 0 ? limit : 0;
}

/**
 * Remap interpolate chroma so `ratio` (0–1 of HCT gamut) stays stable when limits change.
 * `value` is derived from `ratio * limit`. Seeds `ratio` when missing.
 * If `value` was edited since last apply/lock (`gamutLimit` set), re-locks from the new value.
 * Mutates points in place.
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
export function applyRelativeChromaParam(chromaParam, hueParam, keyResult, steps) {
  if (chromaParam.mode !== 'interpolate') return;
  if (!isClampInterpolatedChroma(chromaParam)) return;

  for (const point of chromaParam.points) {
    const limit = chromaLimitAtStep(hueParam, keyResult, steps, point.step);

    if (typeof point.ratio !== 'number' || !Number.isFinite(point.ratio)) {
      point.ratio = chromaRatioFromValue(point.value, limit);
    } else if (
      typeof point.gamutLimit === 'number'
      && point.gamutLimit > 0
      && Math.round(Number(point.value)) !== Math.round(point.ratio * point.gamutLimit)
    ) {
      // Absolute value edited since last apply/lock — re-lock against the live limit.
      point.ratio = chromaRatioFromValue(point.value, limit);
    }

    point.ratio = Math.min(1, Math.max(0, point.ratio));
    point.value = Math.round(point.ratio * limit);
    point.gamutLimit = limit;
  }
}

/**
 * @param {Array<CustomPaletteConfig & { id?: string }>} customPalettes
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {number[]} steps
 */
export function applyRelativeCustomChroma(customPalettes, keyResults, steps) {
  for (const palette of customPalettes) {
    const published = resolveIncludeSteps(palette.includeSteps, steps);
    if (published.length === 1) {
      collapseParamsForSingleIncludeStep(palette, steps);
      const step = published[0];
      for (const mode of /** @type {const} */ (['lm', 'dm'])) {
        applyRelativeFixedChromaAtStep(
          palette[mode].chroma,
          palette[mode].hue,
          keyResults[mode],
          steps,
          step,
        );
      }
      continue;
    }
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      applyRelativeChromaParam(palette[mode].chroma, palette[mode].hue, keyResults[mode], steps);
    }
  }
}

/**
 * @param {Array<CustomPaletteConfig & { id?: string }>} customPalettes
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {number[]} steps
 */
export function clampAllCustomChroma(customPalettes, keyResults, steps) {
  for (const palette of customPalettes) {
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      clampChromaParamValues(palette[mode].chroma, palette[mode].hue, keyResults[mode], steps);
    }
  }
}

/**
 * Live GUI filter: only characters allowed in a palette / token name.
 * Keeps case and edge hyphens while typing; finalize with sanitizePaletteName on blur.
 * @param {string} value
 * @returns {string}
 */
export function filterPaletteNameInput(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Canonical palette name (= CSS token prefix). Lowercase, a-z / 0-9 / -, no edge hyphens.
 * @param {string} name
 * @returns {string}
 */
export function sanitizePaletteName(name) {
  return filterPaletteNameInput(name)
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'palette';
}

// ---------------------------------------------------------------------------
// Palette generation
// ---------------------------------------------------------------------------

/**
 * @param {KeyPaletteConfig} config
 * @param {number[]} steps
 * @returns {{ min: string, max: string, steps: Record<number, { tone: number, hex: string }> }}
 */
export function generateKeyPalette(config, steps) {
  const tones = interpolateAcrossSteps(steps, config.start.tone, config.end.tone, config.interpolator);
  /** @type {Record<number, { tone: number, hex: string }>} */
  const stepColors = {};

  for (const step of steps) {
    const tone = tones[step];
    stepColors[step] = { tone, hex: hctToHex(0, 0, tone) };
  }

  return {
    min: config.min,
    max: config.max,
    steps: stepColors,
  };
}

/**
 * @param {KeyPaletteState} keyPalette
 * @param {number[]} steps
 * @returns {{ lm: ReturnType<typeof generateKeyPalette>, dm: ReturnType<typeof generateKeyPalette> }}
 */
export function generateKeyPalettes(keyPalette, steps) {
  const dmInterpolator = keyPalette.dm.interpolatorOverride
    ? keyPalette.dm.interpolator
    : invertBezier(keyPalette.lm.interpolator);

  const dmConfig = { ...keyPalette.dm, interpolator: dmInterpolator };
  return {
    lm: generateKeyPalette(keyPalette.lm, steps),
    dm: generateKeyPalette(dmConfig, steps),
  };
}

/**
 * @param {CustomPaletteConfig} palette
 * @param {'lm' | 'dm'} mode
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
export function generateCustomPaletteForMode(palette, mode, keyResult, steps) {
  const cfg = palette[mode];
  /** @type {Record<number, { tone: number, hue: number, chroma: number, hex: string }>} */
  const stepColors = {};

  for (const step of steps) {
    const tone = keyResult.steps[step].tone;
    const hue = resolveParam(cfg.hue, step, steps);
    const requested = resolveParam(cfg.chroma, step, steps);
    const chroma = isClampInterpolatedChroma(cfg.chroma)
      ? clampChroma(requested, hue, tone)
      : Math.max(0, Math.round(Number(requested)) || 0);
    stepColors[step] = { tone, hue, chroma, hex: hctToHex(hue, chroma, tone) };
  }

  return { min: keyResult.min, max: keyResult.max, steps: stepColors };
}

// ---------------------------------------------------------------------------
// State model (config)
// ---------------------------------------------------------------------------

/**
 * Nearest unused slot to `ideal` (tie → lower step).
 * @param {number} ideal
 * @param {number[]} slots
 * @param {Set<number>} used
 * @returns {number | null}
 */
function takeNearestFreeSlot(ideal, slots, used) {
  let best = null;
  let bestDist = Infinity;
  for (const slot of slots) {
    if (used.has(slot)) continue;
    const dist = Math.abs(slot - ideal);
    if (dist < bestDist || (dist === bestDist && (best === null || slot < best))) {
      bestDist = dist;
      best = slot;
    }
  }
  return best;
}

/**
 * Remap interpolate control points onto a new step grid.
 * Start → first step, end → last step (values kept). Middles keep relative position;
 * discarded only when there are more middles than middle slots.
 * @param {ParamPoint[]} points
 * @param {number[]} steps — new grid (e.g. 10,20,…,end)
 * @returns {ParamPoint[]}
 */
function remapInterpolatePointsForSteps(points, steps) {
  if (steps.length === 0) return [];

  const startStep = steps[0];
  const endStep = steps[steps.length - 1];
  const middleSlots = steps.slice(1, -1);

  const sorted = [...points].sort((a, b) => a.step - b.step);
  if (sorted.length === 0) {
    return [
      { step: startStep, value: 0 },
      { step: endStep, value: 0 },
    ];
  }

  const startSrc = sorted[0];
  const endSrc = sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0];
  const oldStart = startSrc.step;
  const oldEnd = endSrc.step;
  const span = oldEnd - oldStart;

  /** @type {ParamPoint} */
  const startPoint = { ...startSrc, step: startStep };
  /** @type {ParamPoint} */
  const endPoint = { ...endSrc, step: endStep };

  if (middleSlots.length === 0 || sorted.length <= 2) {
    return [startPoint, endPoint];
  }

  const middles = sorted.slice(1, -1).map((point) => {
    const t = span > 0 ? (point.step - oldStart) / span : 0.5;
    return {
      point,
      t: Math.min(1, Math.max(0, t)),
    };
  });
  middles.sort((a, b) => a.t - b.t || a.point.step - b.point.step);

  const kept = middles.length > middleSlots.length
    ? middles.slice(0, middleSlots.length)
    : middles;

  const used = new Set();
  /** @type {ParamPoint[]} */
  const placed = [];
  for (const { point, t } of kept) {
    const ideal = startStep + t * (endStep - startStep);
    const slot = takeNearestFreeSlot(ideal, middleSlots, used);
    if (slot === null) break;
    used.add(slot);
    placed.push({ ...point, step: slot });
  }
  placed.sort((a, b) => a.step - b.step);

  return [startPoint, ...placed, endPoint];
}

/**
 * Keep interpolate H/C points + LM pivotStep aligned with the current step grid (mutates state).
 * @param {EngineState} state
 * @param {number} [previousStepCount] — when set, remaps `pivotStep` proportionally from the old grid
 */
export function normalizeStateForStepCount(state, previousStepCount) {
  const steps = getSteps(state.stepCount);

  if (
    typeof previousStepCount === 'number'
    && Number.isFinite(previousStepCount)
    && previousStepCount !== state.stepCount
    && state.keyPalette?.lm?.states
  ) {
    const lmStates = /** @type {InteractionStatesConfig} */ (state.keyPalette.lm.states);
    lmStates.pivotStep = remapPivotStep(
      lmStates.pivotStep,
      getSteps(previousStepCount),
      steps,
    );
  }

  if (state.keyPalette?.lm?.states) {
    Object.assign(
      state.keyPalette.lm.states,
      normalizeStoredInteractionStates(
        /** @type {Partial<InteractionStatesConfig>} */ (state.keyPalette.lm.states),
        steps,
      ),
    );
  }

  for (const palette of state.customPalettes) {
    palette.includeSteps = normalizeIncludeSteps(palette.includeSteps, steps);

    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      for (const param of /** @type {const} */ (['hue', 'chroma'])) {
        const cfg = palette[mode][param];
        if (cfg.mode !== 'interpolate') continue;

        cfg.points = remapInterpolatePointsForSteps(cfg.points, steps);

        const segCount = Math.max(0, cfg.points.length - 1);
        cfg.interpolators = cfg.interpolators.slice(0, segCount);
        while (cfg.interpolators.length < segCount) {
          cfg.interpolators.push([...LINEAR_BEZIER]);
        }
      }
    }
  }
}

/**
 * @returns {ParamConfig}
 */
export function createFixedParam(value) {
  return { mode: 'fixed', value };
}

/**
 * @param {number} startStep
 * @param {number} startVal
 * @param {number} endStep
 * @param {number} endVal
 * @param {Bezier} [bezier]
 * @returns {ParamConfig}
 */
export function createInterpolateParam(startStep, startVal, endStep, endVal, bezier = LINEAR_BEZIER) {
  return {
    mode: 'interpolate',
    points: [
      { step: startStep, value: startVal },
      { step: endStep, value: endVal },
    ],
    interpolators: [[...bezier]],
  };
}

/**
 * @returns {KeyPaletteState}
 */
export function createDefaultKeyPalette() {
  return {
    lm: {
      min: '#ffffff',
      max: '#000000',
      start: { tone: 96 },
      end: { tone: 7 },
      interpolator: [...DEFAULT_BEZIER],
      states: createDefaultInteractionStates(),
    },
    dm: {
      min: '#000000',
      max: '#ffffff',
      start: { tone: 8 },
      end: { tone: 93 },
      interpolator: [0.32, 0.23, 0.68, 0.82],
      interpolatorOverride: false,
      states: createDefaultInteractionDeltas(true),
    },
  };
}

let nextId = 1;

/**
 * @param {string} [name]
 * @returns {CustomPaletteConfig & { id: string }}
 */
export function createCustomPalette(name = 'palette-1') {
  return {
    id: `palette-${nextId++}`,
    name: sanitizePaletteName(name),
    includeSteps: null,
    lm: {
      hue: createFixedParam(210),
      chroma: createFixedParam(48),
    },
    dm: {
      hue: createFixedParam(210),
      chroma: createFixedParam(36),
    },
  };
}

/**
 * Reorder a custom palette in `state.customPalettes` by runtime id.
 * @param {EngineState} state
 * @param {string} paletteId
 * @param {-1 | 1} delta — -1 = up, +1 = down
 * @returns {boolean} whether order changed
 */
export function moveCustomPalette(state, paletteId, delta) {
  const list = state.customPalettes;
  const index = list.findIndex((p) => p.id === paletteId);
  if (index < 0) return false;
  const next = index + delta;
  if (next < 0 || next >= list.length) return false;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);
  return true;
}

/**
 * @returns {EngineState}
 */
export function createDefaultState() {
  return {
    stepCount: 10,
    keyPalette: createDefaultKeyPalette(),
    customPalettes: [createCustomPalette()],
    brand: null,
  };
}

/**
 * @param {unknown} value
 * @returns {value is Bezier}
 */
function isBezier(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
  );
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Bezier}
 */
function parseBezier(value, label) {
  if (!isBezier(value)) {
    throw new Error(`${label} must be a cubic-bezier array of four numbers between 0 and 1`);
  }
  return [...value];
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseTone(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number`);
  }
  return Math.round(value);
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function parseHexColor(value, label) {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`${label} must be a hex color (#rrggbb)`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {ParamConfig}
 */
function parseParamConfig(value) {
  if (!value || typeof value !== 'object' || !('mode' in value)) {
    throw new Error('Invalid parameter config');
  }

  if (value.mode === 'fixed') {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
      throw new Error('Fixed parameter requires a numeric value');
    }
    /** @type {FixedParam} */
    const fixed = createFixedParam(value.value);
    if (typeof value.ratio === 'number' && Number.isFinite(value.ratio)) {
      fixed.ratio = Math.min(1, Math.max(0, value.ratio));
    }
    return fixed;
  }

  if (value.mode === 'interpolate') {
    if (!Array.isArray(value.points) || value.points.length < 2) {
      throw new Error('Interpolate parameter requires at least two points');
    }

    const points = value.points.map((point, index) => {
      if (!point || typeof point !== 'object' || typeof point.step !== 'number' || typeof point.value !== 'number') {
        throw new Error(`Invalid interpolate point at index ${index}`);
      }
      /** @type {ParamPoint} */
      const parsed = { step: point.step, value: point.value };
      if (typeof point.ratio === 'number' && Number.isFinite(point.ratio)) {
        parsed.ratio = Math.min(1, Math.max(0, point.ratio));
      }
      return parsed;
    });

    if (!Array.isArray(value.interpolators) || value.interpolators.length !== points.length - 1) {
      throw new Error('Interpolators count must match segments between points');
    }

    const interpolators = value.interpolators.map((bezier, index) => parseBezier(bezier, `interpolator ${index + 1}`));
    /** @type {InterpolateParam} */
    const interpolated = { mode: 'interpolate', points, interpolators };
    if (value.clampInterpolatedChroma === true) {
      interpolated.clampInterpolatedChroma = true;
    }
    return interpolated;
  }

  throw new Error(`Unknown parameter mode: ${String(value.mode)}`);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {InteractionStatesConfig}
 */
function parseInteractionStates(value, label) {
  if (value == null) {
    return createDefaultInteractionStates();
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${label}`);
  }

  const parsed = normalizeStoredInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (value),
  );

  if (parsed.deltaMin < 0 || parsed.deltaMax < 0 || parsed.state2Scale < 0) {
    throw new Error(`${label} values must be non-negative`);
  }

  return parsed;
}

/**
 * DM states: only deltas (shared strategy lives on LM). Extra keys ignored.
 * @param {unknown} value
 * @param {string} label
 * @returns {InteractionStatesDeltas}
 */
function parseInteractionStatesDeltas(value, label) {
  if (value == null) {
    return createDefaultInteractionDeltas(true);
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${label}`);
  }

  const parsed = resolveInteractionDeltas(
    /** @type {Partial<InteractionStatesDeltas>} */ (value),
    true,
  );

  if (parsed.deltaMin < 0 || parsed.deltaMax < 0 || parsed.state2Scale < 0) {
    throw new Error(`${label} values must be non-negative`);
  }

  return parsed;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {boolean} [forDm=false]
 * @returns {KeyPaletteConfig}
 */
function parseKeyPaletteMode(value, label, forDm = false) {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid ${label}`);
  }

  /** @type {KeyPaletteConfig} */
  const config = {
    min: parseHexColor(value.min, `${label}.min`),
    max: parseHexColor(value.max, `${label}.max`),
    start: { tone: parseTone(value.start?.tone, `${label}.start.tone`) },
    end: { tone: parseTone(value.end?.tone, `${label}.end.tone`) },
    interpolator: parseBezier(value.interpolator, `${label}.interpolator`),
    states: forDm
      ? parseInteractionStatesDeltas(value.states, `${label}.states`)
      : parseInteractionStates(value.states, `${label}.states`),
  };

  if ('interpolatorOverride' in value) {
    config.interpolatorOverride = Boolean(value.interpolatorOverride);
  }

  return config;
}

/**
 * Clamp chroma for config import/export (mutates chromaParam).
 * Fixed → peak across steps (or single published step → relative like interpolate);
 * interpolate → relative remap then per-step HCT limit.
 * Live GUI state must not use this for multi-step fixed (slider may sit past the peak).
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number[]} [publishedSteps]
 */
function clampChromaParamForConfig(chromaParam, hueParam, keyResult, steps, publishedSteps = steps) {
  if (chromaParam.mode === 'fixed') {
    if (publishedSteps.length === 1) {
      applyRelativeFixedChromaAtStep(chromaParam, hueParam, keyResult, steps, publishedSteps[0]);
      delete chromaParam.gamutLimit;
      return;
    }
    const peak = peakChromaForSteps(hueParam, keyResult, steps);
    chromaParam.value = Math.min(Math.max(0, Math.round(Number(chromaParam.value)) || 0), peak);
    delete chromaParam.ratio;
    delete chromaParam.gamutLimit;
    return;
  }
  if (!isClampInterpolatedChroma(chromaParam)) {
    delete chromaParam.clampInterpolatedChroma;
    for (const point of chromaParam.points) {
      delete point.gamutLimit;
      delete point.ratio;
    }
    return;
  }
  applyRelativeChromaParam(chromaParam, hueParam, keyResult, steps);
  clampChromaParamValues(chromaParam, hueParam, keyResult, steps);
  chromaParam.clampInterpolatedChroma = true;
  for (const point of chromaParam.points) {
    delete point.gamutLimit;
  }
}

/**
 * Deep-clone palette H/C params with chroma clamped for config (does not touch live state).
 * @param {{ hue: ParamConfig, chroma: ParamConfig }} modeParams
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number[]} publishedSteps
 */
function cloneModeParamsForConfig(modeParams, keyResult, steps, publishedSteps) {
  const cloned = JSON.parse(JSON.stringify(modeParams));
  clampChromaParamForConfig(cloned.chroma, cloned.hue, keyResult, steps, publishedSteps);
  return cloned;
}

/**
 * Serialize engine state to JSON config.
 * Export copy clamps fixed chroma to peak; interpolate keeps ratio + absolute value at current gamut.
 * Single published step: fixed chroma exports with `ratio` (relative).
 * @param {EngineState} state
 */
export function exportEngineConfig(state) {
  const steps = getSteps(state.stepCount);
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);

  const keyPalette = JSON.parse(JSON.stringify(state.keyPalette));
  keyPalette.lm.states = normalizeStoredInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (keyPalette.lm.states),
    steps,
  );
  keyPalette.dm.states = resolveInteractionDeltas(
    /** @type {Partial<InteractionStatesDeltas>} */ (keyPalette.dm.states),
    true,
  );

  /** @type {{ version: number, stepCount: number, keyPalette: unknown, customPalettes: unknown[], brand?: BrandConfig }} */
  const out = {
    version: ENGINE_CONFIG_VERSION,
    stepCount: state.stepCount,
    keyPalette,
    customPalettes: state.customPalettes.map(({ name, includeSteps, lm, dm }) => {
      const published = resolveIncludeSteps(includeSteps, steps);
      const normalized = normalizeIncludeSteps(includeSteps, steps);
      /** @type {{ name: string, includeSteps?: number[], lm: unknown, dm: unknown }} */
      const paletteOut = {
        name: sanitizePaletteName(name),
        lm: cloneModeParamsForConfig(lm, keyPalettes.lm, steps, published),
        dm: cloneModeParamsForConfig(dm, keyPalettes.dm, steps, published),
      };
      if (normalized) paletteOut.includeSteps = normalized;
      return paletteOut;
    }),
  };

  if (state.brand) {
    const hex = parseBrandHex(state.brand.hex);
    if (hex) {
      out.brand = {
        hex,
        perfectFit: Boolean(state.brand.perfectFit),
        palette: sanitizePaletteName(state.brand.palette),
      };
    }
  }

  return out;
}

/**
 * @param {unknown} data
 * @returns {EngineState}
 */
export function importEngineConfig(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Config must be a JSON object');
  }

  if (data.version !== ENGINE_CONFIG_VERSION) {
    throw new Error(`Unsupported config version: ${String(data.version)}`);
  }

  if (typeof data.stepCount !== 'number' || !Number.isFinite(data.stepCount) || data.stepCount < 1) {
    throw new Error('stepCount must be a positive number');
  }

  if (!data.keyPalette || typeof data.keyPalette !== 'object') {
    throw new Error('keyPalette is required');
  }

  if (!Array.isArray(data.customPalettes)) {
    throw new Error('customPalettes must be an array');
  }

  const keyPalette = {
    lm: parseKeyPaletteMode(data.keyPalette.lm, 'keyPalette.lm', false),
    dm: {
      ...parseKeyPaletteMode(data.keyPalette.dm, 'keyPalette.dm', true),
      interpolatorOverride: Boolean(data.keyPalette.dm?.interpolatorOverride),
    },
  };

  const customPalettes = data.customPalettes.map((palette, index) => {
    if (!palette || typeof palette !== 'object') {
      throw new Error(`Invalid custom palette at index ${index}`);
    }

    return {
      id: `palette-${nextId++}`,
      name: sanitizePaletteName(typeof palette.name === 'string' ? palette.name : 'palette'),
      includeSteps: Array.isArray(palette.includeSteps) ? palette.includeSteps : null,
      lm: {
        hue: parseParamConfig(palette.lm?.hue),
        chroma: parseParamConfig(palette.lm?.chroma),
      },
      dm: {
        hue: parseParamConfig(palette.dm?.hue),
        chroma: parseParamConfig(palette.dm?.chroma),
      },
    };
  });

  const state = {
    stepCount: Math.max(1, Math.round(data.stepCount)),
    keyPalette,
    customPalettes,
    brand: null,
  };

  const steps = getSteps(state.stepCount);
  state.keyPalette.lm.states = normalizeStoredInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (state.keyPalette.lm.states),
    steps,
  );
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);
  for (const palette of state.customPalettes) {
    palette.includeSteps = normalizeIncludeSteps(palette.includeSteps, steps);
    const published = resolveIncludeSteps(palette.includeSteps, steps);
    if (published.length === 1) {
      collapseParamsForSingleIncludeStep(palette, steps);
    }
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      clampChromaParamForConfig(palette[mode].chroma, palette[mode].hue, keyPalettes[mode], steps, published);
    }
  }

  state.brand = parseBrandConfig(data.brand, state.customPalettes);
  return state;
}

/**
 * @param {unknown} raw
 * @param {Array<CustomPaletteConfig & { id: string }>} customPalettes
 * @returns {BrandConfig | null}
 */
function parseBrandConfig(raw, customPalettes) {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object') {
    throw new Error('brand must be an object or omitted');
  }
  if (!customPalettes.length) return null;

  const hex = parseBrandHex(/** @type {{ hex?: unknown }} */ (raw).hex);
  if (!hex) {
    throw new Error('brand.hex must be a hex color (#rrggbb)');
  }
  const perfectFit = Boolean(/** @type {{ perfectFit?: unknown }} */ (raw).perfectFit);
  const paletteRaw = /** @type {{ palette?: unknown }} */ (raw).palette;

  if (typeof paletteRaw === 'string' && paletteRaw.trim()) {
    const paletteName = sanitizePaletteName(paletteRaw);
    // Orphan name (typo / deleted palette) → drop brand; never silently remap.
    if (!customPalettes.some((p) => p.name === paletteName)) return null;
    return { hex, perfectFit, palette: paletteName };
  }

  return {
    hex,
    perfectFit,
    palette: sanitizePaletteName(customPalettes[0].name),
  };
}

// ---------------------------------------------------------------------------
// Tokens & system output
// ---------------------------------------------------------------------------

/**
 * @param {object} result
 * @param {number[]} steps — published grid steps (min/max always emitted separately)
 * @param {number} endStep
 * @param {string} prefix
 * @param {string[]} lines
 * @param {'tone' | 'hc'} format
 */
function appendPaletteColorTokens(result, steps, endStep, prefix, lines, format) {
  lines.push(`  --${prefix}-0: ${result.min};`);
  for (const step of steps) {
    const data = result.steps[step];
    if (!data) continue;
    if (format === 'tone') {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* T: ${data.tone} */`);
    } else {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* H: ${data.hue}, C: ${data.chroma} */`);
    }
  }
  lines.push(`  --${prefix}-${endStep + 10}: ${result.max};`);
}

/**
 * Emit build-time hex state1/state2 for published steps (not min/max).
 * @param {ReturnType<typeof generateKeyPalette>} result
 * @param {number[]} steps
 * @param {string} prefix
 * @param {string[]} lines
 * @param {InteractionStatesConfig} states
 * @param {string} bgHex
 * @param {number} pivotTone
 */
function appendBuildInteractionStateTokens(result, steps, prefix, lines, states, bgHex, pivotTone) {
  const cfg = resolveInteractionStates(states, steps);
  for (const step of steps) {
    const data = result.steps[step];
    if (!data) continue;
    const color = {
      hue: data.hue ?? 0,
      chroma: data.chroma ?? 0,
      tone: data.tone,
      hex: data.hex,
    };
    const s1 = colorAtInteractionState(color, bgHex, cfg, 1, pivotTone);
    const s2 = colorAtInteractionState(color, bgHex, cfg, 2, pivotTone);
    lines.push(`  --${prefix}-${step}-state1: ${s1.hex};`);
    lines.push(`  --${prefix}-${step}-state2: ${s2.hex};`);
  }
}

/**
 * Runtime: shared Δ tokens per mode from HCT T math (applied as OKLCH L); keyed on key-palette steps.
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {'lm' | 'dm'} mode
 * @param {string[]} lines
 * @param {InteractionStatesConfig} states
 * @param {string} bgHex
 * @param {number} pivotTone
 */
function appendRuntimeStateDeltaTokens(keyResult, steps, mode, lines, states, bgHex, pivotTone) {
  const cfg = resolveInteractionStates(states, steps);
  const bgTone = hexToHct(bgHex).tone;
  const prefix = mode === 'dm' ? 'state-dm' : 'state';
  for (const step of steps) {
    const data = keyResult.steps[step];
    if (!data) continue;
    lines.push(`  --${prefix}-${step}-state1: ${formatDeltaL(interactionStateDelta(data.tone, bgTone, cfg, 1, pivotTone))};`);
    lines.push(`  --${prefix}-${step}-state2: ${formatDeltaL(interactionStateDelta(data.tone, bgTone, cfg, 2, pivotTone))};`);
  }
}

/**
 * Build `:root { … }` CSS custom properties — **colors only** (min / steps / max + interaction states).
 * Interpolators, start/end tones live in config JSON, not in CSS tokens.
 * Does not regenerate colors — pass results from `generateSystem` / `generateCustomPaletteForMode`.
 * Custom palettes emit only `includeSteps` (full grid when null); min/max always.
 * Runtime: universal `--state-{step}-state1|2` / `--state-dm-…` (Δ from HCT T, applied as OKLCH L; key-step anchored).
 * @param {EngineState} state
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} customResults
 * @param {number[]} steps
 * @param {number} endStep
 * @returns {string}
 */
export function buildTokensCss(state, keyResults, customResults, steps, endStep) {
  const lines = [];
  const lmStates = resolveModeInteractionStates(state.keyPalette, 'lm', steps);
  const dmStates = resolveModeInteractionStates(state.keyPalette, 'dm', steps);
  const runtime = lmStates.delivery === 'runtime';
  const lmPivotTone = resolvePivotTone(lmStates, keyResults.lm, steps);
  const dmPivotTone = resolvePivotTone(dmStates, keyResults.dm, steps);

  appendPaletteColorTokens(keyResults.lm, steps, endStep, KEY_PALETTE_NAME, lines, 'tone');
  if (!runtime) {
    appendBuildInteractionStateTokens(
      keyResults.lm, steps, KEY_PALETTE_NAME, lines, lmStates, keyResults.lm.min, lmPivotTone,
    );
  }
  appendPaletteColorTokens(keyResults.dm, steps, endStep, `${KEY_PALETTE_NAME}-dm`, lines, 'tone');
  if (!runtime) {
    appendBuildInteractionStateTokens(
      keyResults.dm, steps, `${KEY_PALETTE_NAME}-dm`, lines, dmStates, keyResults.dm.min, dmPivotTone,
    );
  }

  for (const palette of state.customPalettes) {
    const name = sanitizePaletteName(palette.name);
    const results = customResults[palette.id];
    if (!results) continue;

    const published = resolveIncludeSteps(palette.includeSteps, steps);
    appendPaletteColorTokens(results.lm, published, endStep, name, lines, 'hc');
    if (!runtime) {
      appendBuildInteractionStateTokens(
        results.lm, published, name, lines, lmStates, keyResults.lm.min, lmPivotTone,
      );
    }
    appendPaletteColorTokens(results.dm, published, endStep, `${name}-dm`, lines, 'hc');
    if (!runtime) {
      appendBuildInteractionStateTokens(
        results.dm, published, `${name}-dm`, lines, dmStates, keyResults.dm.min, dmPivotTone,
      );
    }
  }

  if (runtime) {
    lines.push(
      '',
      '  /* Runtime interaction states — signed Δ from HCT T math, applied as OKLCH L (0–100).',
      '   * CSS relative `l` is 0–1, so divide the token by 100:',
      '   *   background: oklch(from var(--palette-1-50) calc(l + var(--state-50-state1) / 100) c h);',
      '   * LM: --state-{step}-state1|state2',
      '   * DM: --state-dm-{step}-state1|state2',
      '   */',
    );
    appendRuntimeStateDeltaTokens(keyResults.lm, steps, 'lm', lines, lmStates, keyResults.lm.min, lmPivotTone);
    appendRuntimeStateDeltaTokens(keyResults.dm, steps, 'dm', lines, dmStates, keyResults.dm.min, dmPivotTone);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Generate the full color system from engine state.
 * Side effect: remaps interpolate chroma (and single-include-step fixed chroma) in `state`
 * when clamp is on. With `clampInterpolatedChroma` omitted/false (default), absolute C is left alone.
 * Multi-step fixed chroma in live state is left as requested; per-step render still clamps unless
 * interpolate chroma has clamp off.
 * @param {EngineState} state
 */
export function generateSystem(state) {
  const steps = getSteps(state.stepCount);
  const endStep = getEndStep(state.stepCount);
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);

  applyRelativeCustomChroma(state.customPalettes, keyPalettes, steps);
  clampAllCustomChroma(state.customPalettes, keyPalettes, steps);

  /** @type {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} */
  const customPalettes = {};
  for (const palette of state.customPalettes) {
    customPalettes[palette.id] = {
      lm: generateCustomPaletteForMode(palette, 'lm', keyPalettes.lm, steps),
      dm: generateCustomPaletteForMode(palette, 'dm', keyPalettes.dm, steps),
    };
  }

  applyBrandStepOverride(state, keyPalettes, customPalettes);

  return {
    steps,
    endStep,
    keyPalettes,
    customPalettes,
    tokensCss: buildTokensCss(state, keyPalettes, customPalettes, steps, endStep),
    config: exportEngineConfig(state),
  };
}
