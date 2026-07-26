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
/** Hue path when interpolating hue (`shortest` = default / omit). @typedef {'shortest' | 'longest' | 'linear' | 'increasing' | 'decreasing'} HueArc */
/**
 * Fixed param. For chroma: optional `relativeInterpolateChroma` + `ratio` (same Relative toggle as interpolate).
 * `gamutLimit` is runtime-only (peak or single-step limit) — not written to config JSON.
 * @typedef {{ mode: 'fixed', value: number, ratio?: number, gamutLimit?: number, relativeInterpolateChroma?: boolean }} FixedParam
 */
/** @typedef {{ mode: 'interpolate', points: ParamPoint[], interpolators: Bezier[], clampInterpolatedChroma?: boolean, relativeInterpolateChroma?: boolean, hueArc?: HueArc }} InterpolateParam */
/** @typedef {FixedParam | InterpolateParam} ParamConfig */
/**
 * Interaction states for palette steps (not min/max).
 * LM holds full config; DM stores only deltas (`InteractionStatesDeltas`) and inherits
 * delivery / space / relativeChroma / oklchGamut / pivotTone from LM via `resolveModeInteractionStates`.
 * `delivery: 'build'` — emit hex `--*-state1` / `--*-state2` (space HCT or OKLCH).
 * `delivery: 'runtime'` — force OKLCH, relative chroma off; emit only `--state-*-state1` / `--state-*-state2` (Δ from HCT T math, applied as OKLCH L).
 * `oklchGamut` — used when build + OKLCH (sRGB / Display P3 max-C).
 * `pivotTone` — HCT T threshold (LM only): `T <= pivotTone` → lighten, else darken.
 * @typedef {{ deltaMin: number, deltaMax: number, state2Scale: number }} InteractionStatesDeltas
 * @typedef {InteractionStatesDeltas & {
 *   relativeChroma: boolean,
 *   delivery: 'build' | 'runtime',
 *   space: 'hct' | 'oklch',
 *   oklchGamut: 'srgb' | 'p3',
 *   pivotTone: number,
 * }} InteractionStatesConfig
 */
/** @typedef {{ min: string, max: string, start: { tone: number }, end: { tone: number }, interpolator: Bezier, states: InteractionStatesConfig | InteractionStatesDeltas, interpolatorOverride?: boolean }} KeyPaletteConfig */
/** @typedef {{ lm: KeyPaletteConfig, dm: KeyPaletteConfig & { interpolatorOverride: boolean } }} KeyPaletteState */
/**
 * Sticky hex lock: step = nearest key T to hex tone (recomputed; not stored).
 * @typedef {{ hex: string }} ColorOverride
 */
/**
 * Custom palette. `includeSteps` — LM whitelist of grid step ids (tokens + GUI).
 * `null` / omitted / full grid = all key steps. Never includes min/max.
 * `includeStepsDm` — DM whitelist; `null` = inherit LM published steps (including LM sync).
 * Dirty: concrete step ids, or `[]` = dirty full (always current key grid — never a frozen snapshot).
 * When dirty partial, same tone/offset rules as LM around DM’s override (`_includeTonesDm` / `_includeOffsetsDm`).
 * Runtime `_includeTones` / `_includeOffsets` — LM only.
 * `colorOverride` / `colorOverrideDm` — optional exact hex on LM / DM nearest-T step (export/import).
 * @typedef {{ name: string, includeSteps: number[] | null, includeStepsDm: number[] | null, colorOverride: ColorOverride | null, colorOverrideDm: ColorOverride | null, lm: { hue: ParamConfig, chroma: ParamConfig }, dm: { hue: ParamConfig, chroma: ParamConfig }, _includeTones?: number[] | null, _includeOffsets?: number[] | null, _includeTonesDm?: number[] | null, _includeOffsetsDm?: number[] | null }} CustomPaletteConfig
 */
/**
 * Optional brand seed (shared in config).
 * `perfectFit` and `overrideNearest` are mutually exclusive (PF wins if both set).
 * @typedef {{ hex: string, perfectFit: boolean, overrideNearest: boolean, palette: string }} BrandConfig
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

/** Ceiling for `deltaMin` / `deltaMax` (engine + GUI). */
export const STATE_DELTA_LIMIT = 40;

/** Allowed range for `state2Scale` (engine + GUI). */
export const STATE2_SCALE_MIN = 1;
export const STATE2_SCALE_MAX = 4;

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
 * Effective published steps from a raw whitelist (never empty; never min/max).
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
 * Published steps for LM or DM. DM with `includeStepsDm == null` inherits LM.
 * Dirty DM full is `[]` (always current grid via `resolveIncludeSteps`).
 * @param {CustomPaletteConfig} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} gridSteps
 * @returns {number[]}
 */
export function resolvePublishedIncludeSteps(palette, mode, gridSteps) {
  if (mode === 'dm' && palette.includeStepsDm == null) {
    return resolveIncludeSteps(palette.includeSteps, gridSteps);
  }
  return resolveIncludeSteps(mode === 'dm' ? palette.includeStepsDm : palette.includeSteps, gridSteps);
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
 * Dirty DM full sentinel: `[]` (distinct from `null` = inherit LM).
 * @param {number[] | null | undefined} includeStepsDm
 * @returns {boolean}
 */
export function isDirtyFullIncludeStepsDm(includeStepsDm) {
  return Array.isArray(includeStepsDm) && includeStepsDm.length === 0;
}

/**
 * @param {CustomPaletteConfig} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} gridSteps
 * @returns {boolean}
 */
export function isFullPublishedIncludeSteps(palette, mode, gridSteps) {
  if (mode === 'dm' && palette.includeStepsDm == null) {
    return isFullIncludeSteps(palette.includeSteps, gridSteps);
  }
  return isFullIncludeSteps(mode === 'dm' ? palette.includeStepsDm : palette.includeSteps, gridSteps);
}

/**
 * Normalize LM whitelist: `null` when publishing the full key grid.
 * @param {number[] | null | undefined} includeSteps
 * @param {number[]} gridSteps
 * @returns {number[] | null}
 */
export function normalizeIncludeSteps(includeSteps, gridSteps) {
  if (includeSteps == null || includeSteps.length === 0) return null;
  const resolved = resolveIncludeSteps(includeSteps, gridSteps);
  return isFullIncludeSteps(resolved, gridSteps) ? null : resolved;
}

/** @param {'lm' | 'dm'} mode */
function includeStepsField(mode) {
  return mode === 'dm' ? 'includeStepsDm' : 'includeSteps';
}

/** @param {'lm' | 'dm'} mode */
function includeTonesField(mode) {
  return mode === 'dm' ? '_includeTonesDm' : '_includeTones';
}

/** @param {'lm' | 'dm'} mode */
function includeOffsetsField(mode) {
  return mode === 'dm' ? '_includeOffsetsDm' : '_includeOffsets';
}

/**
 * Lock LM whitelist intent as key tones; sets `includeSteps` + `_includeTones`.
 * With LM colorOverride, also locks `_includeOffsets` relative to the override step.
 * @param {CustomPaletteConfig} palette
 * @param {number[] | null | undefined} includeSteps
 * @param {ReturnType<typeof generateKeyPalette>} keyLm
 * @param {number[]} steps
 */
export function setIncludeStepsIntent(palette, includeSteps, keyLm, steps) {
  const normalized = normalizeIncludeSteps(includeSteps, steps);
  palette.includeSteps = normalized;
  if (normalized == null) {
    palette._includeTones = null;
    palette._includeOffsets = null;
    return;
  }
  palette._includeTones = normalized.map((step) => {
    const tone = keyLm.steps[step]?.tone;
    return tone != null && Number.isFinite(tone) ? tone : 0;
  });
  lockIncludeOffsetsAroundOverride(palette, keyLm, steps, normalized, 'lm');
}

/**
 * Lock DM whitelist. `null` → inherit LM (clears DM tones/offsets).
 * Dirty full → `[]` (always current grid). Dirty partial → concrete step ids.
 * @param {CustomPaletteConfig} palette
 * @param {number[] | null | undefined} includeStepsDm — `null` = inherit LM
 * @param {ReturnType<typeof generateKeyPalette>} keyDm
 * @param {number[]} steps
 */
export function setIncludeStepsDmIntent(palette, includeStepsDm, keyDm, steps) {
  if (includeStepsDm == null) {
    palette.includeStepsDm = null;
    palette._includeTonesDm = null;
    palette._includeOffsetsDm = null;
    return;
  }
  const resolved = resolveIncludeSteps(includeStepsDm, steps);
  if (isFullIncludeSteps(resolved, steps)) {
    palette.includeStepsDm = [];
    palette._includeTonesDm = null;
    palette._includeOffsetsDm = null;
    return;
  }
  palette.includeStepsDm = resolved;
  palette._includeTonesDm = resolved.map((step) => {
    const tone = keyDm.steps[step]?.tone;
    return tone != null && Number.isFinite(tone) ? tone : 0;
  });
  lockIncludeOffsetsAroundOverride(palette, keyDm, steps, resolved, 'dm');
}

/**
 * Index offsets of a whitelist from that mode’s colorOverride step (includes 0).
 * @param {CustomPaletteConfig} palette
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number[]} includeSteps
 * @param {'lm' | 'dm'} mode
 */
function lockIncludeOffsetsAroundOverride(palette, keyResult, steps, includeSteps, mode) {
  const offsetsKey = includeOffsetsField(mode);
  const ovStep = resolveColorOverrideStep(palette, keyResult, steps, mode);
  if (ovStep == null) {
    palette[offsetsKey] = null;
    return;
  }
  const ovIdx = steps.indexOf(ovStep);
  if (ovIdx < 0) {
    palette[offsetsKey] = null;
    return;
  }
  const offsets = includeSteps.map((step) => steps.indexOf(step) - ovIdx);
  if (!offsets.includes(0)) offsets.push(0);
  offsets.sort((a, b) => a - b);
  palette[offsetsKey] = offsets;
}

/**
 * Place mode whitelist around that mode’s colorOverride using offsets.
 * @param {CustomPaletteConfig} palette
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {'lm' | 'dm'} mode
 */
function syncIncludeStepsAroundOverride(palette, keyResult, steps, mode) {
  const stepsKey = includeStepsField(mode);
  const offsetsKey = includeOffsetsField(mode);
  const ovStep = resolveColorOverrideStep(palette, keyResult, steps, mode);
  if (ovStep == null || !steps.length) return;

  const stored = palette[stepsKey];
  // LM null = full grid; DM null = inherit (caller must skip DM inherit).
  if (stored == null) {
    palette[offsetsKey] = null;
    return;
  }
  // Dirty DM full (`[]` or concrete list equal to current grid): always current grid.
  if (mode === 'dm' && (isDirtyFullIncludeStepsDm(stored) || isFullIncludeSteps(stored, steps))) {
    palette.includeStepsDm = [];
    palette[offsetsKey] = null;
    return;
  }
  // LM already on full grid (unusual concrete list): no offset dance.
  if (mode === 'lm' && isFullIncludeSteps(stored, steps) && !palette[offsetsKey]?.length) {
    palette[offsetsKey] = null;
    return;
  }

  if (!palette[offsetsKey]?.length) {
    lockIncludeOffsetsAroundOverride(palette, keyResult, steps, resolveIncludeSteps(stored, steps), mode);
  }

  const ovIdx = steps.indexOf(ovStep);
  if (ovIdx < 0 || !palette[offsetsKey]?.length) return;

  const last = steps.length - 1;
  const mapped = palette[offsetsKey].map((off) => {
    const idx = Math.min(last, Math.max(0, ovIdx + off));
    return steps[idx];
  });
  if (!mapped.includes(ovStep)) mapped.push(ovStep);

  if (mode === 'lm') {
    palette.includeSteps = normalizeIncludeSteps(mapped, steps);
    if (palette.includeSteps == null) palette._includeOffsets = null;
  } else if (isFullIncludeSteps(mapped, steps)) {
    palette.includeStepsDm = [];
    palette._includeOffsetsDm = null;
  } else {
    palette.includeStepsDm = resolveIncludeSteps(mapped, steps);
  }
}

/**
 * Remap one mode’s whitelist from tones (no override).
 * @param {CustomPaletteConfig} palette
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {'lm' | 'dm'} mode
 */
function syncIncludeStepsFromTonesForMode(palette, keyResult, steps, mode) {
  const stepsKey = includeStepsField(mode);
  const tonesKey = includeTonesField(mode);
  const offsetsKey = includeOffsetsField(mode);

  palette[offsetsKey] = null;

  const stored = palette[stepsKey];
  if (stored == null && (palette[tonesKey] == null || !palette[tonesKey].length)) {
    palette[tonesKey] = null;
    return;
  }
  // Dirty DM full (`[]` / full on current grid): always current grid.
  if (mode === 'dm' && (isDirtyFullIncludeStepsDm(stored) || (stored != null && isFullIncludeSteps(stored, steps)))) {
    palette.includeStepsDm = [];
    palette[tonesKey] = null;
    return;
  }
  if (!palette[tonesKey]?.length) {
    if (!stored?.length) {
      palette[tonesKey] = null;
      if (mode === 'lm') palette.includeSteps = null;
      else palette.includeStepsDm = null;
      return;
    }
    palette[tonesKey] = stored.map((step) => {
      const tone = keyResult.steps[step]?.tone;
      return tone != null && Number.isFinite(tone) ? tone : 0;
    });
  }
  const mapped = palette[tonesKey].map((tone) => nearestStepForTone(keyResult, steps, tone));
  if (mode === 'lm') {
    palette.includeSteps = normalizeIncludeSteps(mapped, steps);
    if (palette.includeSteps == null) palette._includeTones = null;
  } else if (isFullIncludeSteps(mapped, steps)) {
    palette.includeStepsDm = [];
    palette._includeTonesDm = null;
  } else {
    palette.includeStepsDm = resolveIncludeSteps(mapped, steps);
  }
}

/**
 * Re-resolve LM / dirty-DM whitelists.
 * With that mode’s colorOverride → offsets from override step; else `_includeTones*`.
 * @param {EngineState} state
 * @param {{ lm: ReturnType<typeof generateKeyPalette>, dm: ReturnType<typeof generateKeyPalette> }} keyResults
 * @param {number[]} steps
 * @param {{ requireColorOverride?: boolean }} [options] — when true, only modes with that mode’s override
 */
export function syncIncludeStepsFromTones(state, keyResults, steps, options = {}) {
  const requireOverride = Boolean(options.requireColorOverride);
  for (const palette of state.customPalettes) {
    const hasLmOv = Boolean(parseBrandHex(palette.colorOverride?.hex ?? ''));
    if (!requireOverride || hasLmOv) {
      if (hasLmOv) syncIncludeStepsAroundOverride(palette, keyResults.lm, steps, 'lm');
      else syncIncludeStepsFromTonesForMode(palette, keyResults.lm, steps, 'lm');
    }

    if (palette.includeStepsDm == null) continue;
    const hasDmOv = Boolean(parseBrandHex(palette.colorOverrideDm?.hex ?? ''));
    if (!requireOverride || hasDmOv) {
      if (hasDmOv) syncIncludeStepsAroundOverride(palette, keyResults.dm, steps, 'dm');
      else syncIncludeStepsFromTonesForMode(palette, keyResults.dm, steps, 'dm');
    }
  }
}

/**
 * @param {CustomPaletteConfig} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} gridSteps
 * @returns {boolean}
 */
export function isSinglePublishedIncludeStep(palette, mode, gridSteps) {
  return resolvePublishedIncludeSteps(palette, mode, gridSteps).length === 1;
}

/**
 * When a mode publishes exactly one step, collapse that mode’s H/C interpolate → fixed.
 * @param {CustomPaletteConfig} palette
 * @param {number[]} gridSteps
 */
export function collapseParamsForSingleIncludeStep(palette, gridSteps) {
  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    const published = resolvePublishedIncludeSteps(palette, mode, gridSteps);
    if (published.length !== 1) continue;
    const step = published[0];
    for (const paramName of /** @type {const} */ (['hue', 'chroma'])) {
      const param = palette[mode][paramName];
      if (param.mode !== 'interpolate') continue;
      const value = resolveParam(param, step, gridSteps, paramName === 'hue');
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
 * Remap fixed chroma so `ratio` stays stable.
 * Multi-step: ratio vs peak gamut (UI marker = 100%). Single-step callers pass that step via
 * `applyRelativeFixedChromaAtStep`.
 * Mutates the fixed param in place.
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
export function applyRelativeFixedChroma(chromaParam, hueParam, keyResult, steps) {
  if (chromaParam.mode !== 'fixed') return;
  if (!isRelativeChroma(chromaParam)) return;

  const peak = peakChromaForSteps(hueParam, keyResult, steps);
  lockFixedChromaRatioAgainstLimit(chromaParam, peak);
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
  lockFixedChromaRatioAgainstLimit(chromaParam, limit);
}

/**
 * @param {Extract<ParamConfig, { mode: 'fixed' }>} chromaParam
 * @param {number} limit
 */
function lockFixedChromaRatioAgainstLimit(chromaParam, limit) {
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
  chromaParam.value = Math.round(chromaParam.ratio * (limit > 0 ? limit : 0));
  chromaParam.gamutLimit = limit > 0 ? limit : 0;
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
 * Hue interpolate path modes.
 * @type {readonly HueArc[]}
 */
export const HUE_ARC_MODES = Object.freeze([
  'shortest',
  'longest',
  'linear',
  'increasing',
  'decreasing',
]);

/**
 * @param {unknown} hueArc
 * @returns {HueArc}
 */
export function resolveHueArc(hueArc) {
  if (
    hueArc === 'longest'
    || hueArc === 'linear'
    || hueArc === 'increasing'
    || hueArc === 'decreasing'
  ) {
    return hueArc;
  }
  return 'shortest';
}

/**
 * Signed Δ for one hue segment.
 * - `shortest` — circle (−180, 180]; 0≡360 → 0
 * - `longest` — circle, the other way (0 if equal)
 * - `linear` — raw degree delta (0→360 = +360; 356→359 = +3)
 * - `increasing` — circle, always [0, 360)
 * - `decreasing` — circle, always (−360, 0]
 * @param {number} from
 * @param {number} to
 * @param {HueArc} [hueArc='shortest']
 * @returns {number}
 */
export function hueInterpDelta(from, to, hueArc = 'shortest') {
  const rawFrom = Number(from);
  const rawTo = Number(to);
  const mode = resolveHueArc(hueArc);

  if (mode === 'linear') return rawTo - rawFrom;

  const a = ((rawFrom % 360) + 360) % 360;
  const b = ((rawTo % 360) + 360) % 360;
  const shortest = ((b - a) % 360 + 540) % 360 - 180;

  if (mode === 'shortest') return shortest;
  if (mode === 'longest') {
    if (shortest === 0) return 0;
    return shortest > 0 ? shortest - 360 : shortest + 360;
  }
  if (mode === 'increasing') {
    return ((b - a) % 360 + 360) % 360;
  }
  // decreasing
  const d = ((b - a) % 360 + 360) % 360;
  return d === 0 ? 0 : d - 360;
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
 * Hue segment: same easing as `interpolateValue`; arc from `hueArc`.
 * @param {number} startVal
 * @param {number} endVal
 * @param {number} t
 * @param {Bezier} bezier
 * @param {HueArc} [hueArc='shortest']
 * @returns {number}
 */
function interpolateHue(startVal, endVal, t, bezier, hueArc = 'shortest') {
  const eased = cubicBezierY(t, bezier);
  const h = startVal + hueInterpDelta(startVal, endVal, hueArc) * eased;
  return Math.round(((h % 360) + 360) % 360);
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
 * - `perfectFit`: bend LM key tone interpolator + set sticky `colorOverride` (exact hex).
 * - `overrideNearest`: set sticky `colorOverride` only (no curve bend). Ignored if `perfectFit`.
 * - Sets brand custom palette LM hue/chroma to brand H/C. DM params untouched.
 * - Writes `state.brand` for config export / re-apply on stepCount.
 *
 * @param {EngineState} state
 * @param {string} hex — `#rrggbb` or `rrggbb`
 * @param {{ perfectFit?: boolean, overrideNearest?: boolean, paletteId?: string }} [options]
 * @returns {{ hex: string, step: number, paletteId: string, hue: number, chroma: number, tone: number }}
 */
export function applyBrandColor(state, hex, options = {}) {
  const normalized = parseBrandHex(hex);
  if (!normalized) {
    throw new Error('Brand color must be a hex color (#rrggbb)');
  }

  const perfectFit = Boolean(options.perfectFit);
  const overrideNearest = Boolean(options.overrideNearest) && !perfectFit;
  const hct = hexToHct(normalized);
  const steps = getSteps(state.stepCount);
  if (steps.length === 0) {
    throw new Error('stepCount must be at least 1');
  }

  let keyResult = generateKeyPalette(state.keyPalette.lm, steps);
  let step = nearestStepForTone(keyResult, steps, hct.tone);
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
    keyResult = generateKeyPalette(state.keyPalette.lm, steps);
    step = nearestStepForTone(keyResult, steps, hct.tone);
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

  if (perfectFit || overrideNearest) {
    setColorOverride(palette, normalized);
  }

  state.brand = {
    hex: normalized,
    perfectFit,
    overrideNearest,
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
 * Clear persisted brand seed. Does not clear palette `colorOverride` / `colorOverrideDm` (sticky).
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
 * @param {'lm' | 'dm'} [mode]
 * @returns {'colorOverride' | 'colorOverrideDm'}
 */
function colorOverrideKey(mode = 'lm') {
  return mode === 'dm' ? 'colorOverrideDm' : 'colorOverride';
}

/**
 * @param {'lm' | 'dm'} [mode]
 * @returns {'_colorOverrideStep' | '_colorOverrideStepDm'}
 */
function colorOverrideStepKey(mode = 'lm') {
  return mode === 'dm' ? '_colorOverrideStepDm' : '_colorOverrideStep';
}

/**
 * After clearing a mode’s colorOverride: drop offsets and reseed tones from the
 * current whitelist on the *current* key grid (so later stepCount remap matches
 * what the user last saw, not pre-override tones / not a new-grid identity map).
 * @param {CustomPaletteConfig} palette
 * @param {ReturnType<typeof generateKeyPalette> | null | undefined} keyResult
 * @param {number[] | null | undefined} steps
 * @param {'lm' | 'dm'} mode
 */
function reseedIncludeTonesAfterOverrideClear(palette, keyResult, steps, mode) {
  const tonesKey = includeTonesField(mode);
  if (!keyResult || !steps?.length) {
    palette[tonesKey] = null;
    return;
  }

  if (mode === 'dm') {
    if (palette.includeStepsDm == null || isDirtyFullIncludeStepsDm(palette.includeStepsDm)) {
      palette[tonesKey] = null;
      return;
    }
    if (isFullIncludeSteps(palette.includeStepsDm, steps)) {
      palette.includeStepsDm = [];
      palette[tonesKey] = null;
      return;
    }
    const published = resolveIncludeSteps(palette.includeStepsDm, steps);
    palette._includeTonesDm = published.map((step) => {
      const tone = keyResult.steps[step]?.tone;
      return tone != null && Number.isFinite(tone) ? tone : 0;
    });
    return;
  }

  if (palette.includeSteps == null) {
    palette._includeTones = null;
    return;
  }
  const published = resolveIncludeSteps(palette.includeSteps, steps);
  palette._includeTones = published.map((step) => {
    const tone = keyResult.steps[step]?.tone;
    return tone != null && Number.isFinite(tone) ? tone : 0;
  });
}

/**
 * @param {CustomPaletteConfig & { id?: string, _colorOverrideStep?: number | null, _colorOverrideStepDm?: number | null }} palette
 * @param {string | null} hex
 * @param {'lm' | 'dm'} [mode]
 * @param {ReturnType<typeof generateKeyPalette> | null} [keyResult] — required on clear for correct tone reseed
 * @param {number[] | null} [steps]
 */
export function setColorOverride(palette, hex, mode = 'lm', keyResult = null, steps = null) {
  const ovKey = colorOverrideKey(mode);
  const stepKey = colorOverrideStepKey(mode);
  const offsetsKey = includeOffsetsField(mode);
  if (!hex) {
    palette[ovKey] = null;
    palette[stepKey] = null;
    palette[offsetsKey] = null;
    reseedIncludeTonesAfterOverrideClear(palette, keyResult, steps, mode);
    return;
  }
  const normalized = parseBrandHex(hex);
  palette[ovKey] = normalized ? { hex: normalized } : null;
  if (!palette[ovKey]) {
    palette[stepKey] = null;
    palette[offsetsKey] = null;
    reseedIncludeTonesAfterOverrideClear(palette, keyResult, steps, mode);
    return;
  }
  // Re-seed offsets on next sync from current whitelist vs new override step.
  palette[offsetsKey] = null;
}

/**
 * Nearest key step for a palette’s colorOverride / colorOverrideDm (or null).
 * @param {CustomPaletteConfig} palette
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {'lm' | 'dm'} [mode]
 * @returns {number | null}
 */
export function resolveColorOverrideStep(palette, keyResult, steps, mode = 'lm') {
  const hex = parseBrandHex(palette[colorOverrideKey(mode)]?.hex ?? '');
  if (!hex || !steps.length) return null;
  return nearestStepForTone(keyResult, steps, hexToHct(hex).tone);
}

/**
 * Ensure LM/DM interpolate points sit on the override step (nearest T); override wins slot conflicts.
 * Mutates palette params. Call after step remaps / before generate.
 * @param {EngineState} state
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 */
export function syncColorOverridePoints(state, keyResults) {
  const steps = getSteps(state.stepCount);
  for (const palette of state.customPalettes) {
    syncPaletteColorOverridePoints(palette, 'lm', keyResults.lm, steps);
    syncPaletteColorOverridePoints(palette, 'dm', keyResults.dm, steps);
  }
}

/**
 * @param {CustomPaletteConfig & { id?: string, _colorOverrideStep?: number | null, _colorOverrideStepDm?: number | null }} palette
 * @param {'lm' | 'dm'} mode
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
function syncPaletteColorOverridePoints(palette, mode, keyResult, steps) {
  const hex = parseBrandHex(palette[colorOverrideKey(mode)]?.hex ?? '');
  if (!hex || !steps.length) return;

  const hct = hexToHct(hex);
  const step = nearestStepForTone(keyResult, steps, hct.tone);
  const stepKey = colorOverrideStepKey(mode);
  const prev = palette[stepKey];

  for (const paramName of /** @type {const} */ (['hue', 'chroma'])) {
    const param = palette[mode][paramName];
    if (param.mode !== 'interpolate') continue;
    const value = paramName === 'hue' ? hct.hue : hct.chroma;
    placeOverrideInterpolatePoint(param, step, value, prev);
    // Like a manual point: raw hex C unless Clamp/Relative (then lock ratio; Relative resolve needs it).
    if (paramName === 'chroma' && isClampInterpolatedChroma(param)) {
      const point = param.points.find((p) => p.step === step);
      if (point) {
        lockChromaPointRatio(
          point,
          value,
          chromaLimitAtStep(palette[mode].hue, keyResult, steps, step),
        );
      }
    }
  }

  palette[stepKey] = step;
}

/**
 * Place/update interpolate point at `step` with `value`. If step moved, drop previous middle point.
 * Override always wins the target slot (reuses any point already there).
 * @param {InterpolateParam} param
 * @param {number} step
 * @param {number} value
 * @param {number | null | undefined} previousStep
 */
function placeOverrideInterpolatePoint(param, step, value, previousStep) {
  if (
    previousStep != null
    && previousStep !== step
  ) {
    const prevIdx = param.points.findIndex((p) => p.step === previousStep);
    if (prevIdx > 0 && prevIdx < param.points.length - 1) {
      param.points.splice(prevIdx, 1);
      if (prevIdx - 1 >= 0 && prevIdx - 1 < param.interpolators.length) {
        param.interpolators.splice(prevIdx - 1, 1);
      }
    }
  }

  const existing = param.points.find((p) => p.step === step);
  if (existing) {
    existing.value = value;
    delete existing.ratio;
    delete existing.gamutLimit;
    return;
  }

  const insertAt = param.points.findIndex((p) => p.step > step);
  const idx = insertAt === -1 ? param.points.length : insertAt;
  if (idx <= 0 || idx >= param.points.length) {
    // Target is outside open interval — endpoints own first/last grid steps after remap.
    if (param.points.length > 0 && param.points[0].step === step) {
      param.points[0].value = value;
      delete param.points[0].ratio;
      delete param.points[0].gamutLimit;
    } else if (param.points.length > 0 && param.points[param.points.length - 1].step === step) {
      const last = param.points[param.points.length - 1];
      last.value = value;
      delete last.ratio;
      delete last.gamutLimit;
    }
    return;
  }

  param.points.splice(idx, 0, { step, value });
  param.interpolators.splice(idx - 1, 0, [...LINEAR_BEZIER]);
}

/**
 * After palette generate: force each palette’s override hex on LM / DM nearest-T step (1:1).
 * @param {EngineState} state
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} customResults
 */
export function applyColorOverrides(state, keyResults, customResults) {
  const steps = getSteps(state.stepCount);
  for (const palette of state.customPalettes) {
    const results = customResults[palette.id];
    if (!results) continue;
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      const hex = parseBrandHex(palette[colorOverrideKey(mode)]?.hex ?? '');
      if (!hex || !results[mode]?.steps) continue;

      const hct = hexToHct(hex);
      const step = nearestStepForTone(keyResults[mode], steps, hct.tone);
      const data = results[mode].steps[step];
      if (!data) continue;

      results[mode].steps[step] = {
        ...data,
        hex,
        hue: hct.hue,
        chroma: hct.chroma,
        tone: hct.tone,
      };
    }
  }
}

/**
 * @param {ParamConfig} config
 * @param {number} step
 * @param {number[]} steps
 * @param {boolean} [asHue] — hue circle interpolate (uses `hueArc` when interpolate)
 * @returns {number}
 */
export function resolveParam(config, step, steps, asHue = false) {
  if (config.mode === 'fixed') {
    return Math.round(config.value);
  }

  const points = [...config.points].sort((a, b) => a.step - b.step);
  if (points.length === 0) return 0;

  const wrapHue = (h) => Math.round(((Number(h) % 360) + 360) % 360);
  const atPoint = (p) => (asHue ? wrapHue(p.value) : Math.round(p.value));

  if (points.length === 1) return atPoint(points[0]);

  if (step <= points[0].step) return atPoint(points[0]);
  if (step >= points[points.length - 1].step) return atPoint(points[points.length - 1]);

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
  return asHue
    ? interpolateHue(p0.value, p1.value, t, bezier, resolveHueArc(config.hueArc))
    : interpolateValue(p0.value, p1.value, t, bezier);
}

/**
 * Interpolate a numeric field on interpolate points (same segment/t/bezier as `resolveParam`).
 * @param {InterpolateParam} config
 * @param {number} step
 * @param {number[]} steps
 * @param {(point: ParamPoint) => number} getValue
 * @returns {number}
 */
function resolveInterpolatedScalar(config, step, steps, getValue) {
  const points = [...config.points].sort((a, b) => a.step - b.step);
  if (points.length === 0) return 0;
  if (points.length === 1) return getValue(points[0]);

  if (step <= points[0].step) return getValue(points[0]);
  if (step >= points[points.length - 1].step) return getValue(points[points.length - 1]);

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
  // Unrounded — ratios are 0–1; Math.round(0.5) === 1 would collapse mid-scale to 100%.
  const eased = cubicBezierY(t, bezier);
  return getValue(p0) + (getValue(p1) - getValue(p0)) * eased;
}

/**
 * Effective chroma at a custom-palette step (absolute C).
 * Relative (fixed or interpolate): uses stored `ratio` × HCT limit at this step.
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @param {number} step
 * @returns {number}
 */
export function resolveChromaAtStep(chromaParam, hueParam, keyResult, steps, step) {
  const hue = resolveParam(hueParam, step, steps, true);
  const tone = keyResult.steps[step]?.tone;
  if (tone === undefined) return 0;

  if (chromaParam.mode === 'fixed') {
    if (isRelativeChroma(chromaParam)) {
      const ratio = typeof chromaParam.ratio === 'number' && Number.isFinite(chromaParam.ratio)
        ? Math.min(1, Math.max(0, chromaParam.ratio))
        : 0;
      return Math.round(ratio * maxChromaForHueTone(hue, tone));
    }
    const requested = Math.round(chromaParam.value);
    return isClampInterpolatedChroma(chromaParam)
      ? clampChroma(requested, hue, tone)
      : Math.max(0, requested || 0);
  }

  if (isRelativeChroma(chromaParam)) {
    const ratio = Math.min(1, Math.max(0, resolveInterpolatedScalar(chromaParam, step, steps, (p) => {
      if (typeof p.ratio === 'number' && Number.isFinite(p.ratio)) return p.ratio;
      return 0;
    })));
    const limit = maxChromaForHueTone(hue, tone);
    return Math.round(ratio * limit);
  }

  const requested = resolveParam(chromaParam, step, steps);
  return isClampInterpolatedChroma(chromaParam)
    ? clampChroma(requested, hue, tone)
    : Math.max(0, Math.round(Number(requested)) || 0);
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
    const hue = resolveParam(hueParam, step, steps, true);
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
    const hue = resolveParam(hueParam, point.step, steps, true);
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
 * Relative chroma implies clamp for interpolate.
 * @param {ParamConfig} chromaParam
 * @returns {boolean}
 */
export function isClampInterpolatedChroma(chromaParam) {
  if (chromaParam.mode !== 'interpolate') return true;
  if (isRelativeChroma(chromaParam)) return true;
  return chromaParam.clampInterpolatedChroma === true;
}

/**
 * Relative chroma: store/use `ratio` (0–1 of gamut) instead of absolute C across steps.
 * Same flag `relativeInterpolateChroma` for fixed and interpolate. Implies clamp when interpolate.
 * @param {ParamConfig} chromaParam
 * @returns {boolean}
 */
export function isRelativeChroma(chromaParam) {
  return chromaParam.relativeInterpolateChroma === true;
}

/**
 * @deprecated Prefer `isRelativeChroma` (same flag on fixed + interpolate).
 * @param {ParamConfig} chromaParam
 * @returns {boolean}
 */
export function isRelativeInterpolateChroma(chromaParam) {
  return chromaParam.mode === 'interpolate' && isRelativeChroma(chromaParam);
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

/** Default HCT T pivot: `T <= pivotTone` → lighten, else darken. */
export const DEFAULT_PIVOT_TONE = 40;

/**
 * Clamp pivot tone to 0–100 (integer).
 * @param {unknown} pivotTone
 * @returns {number}
 */
export function resolvePivotTone(pivotTone) {
  if (typeof pivotTone === 'number' && Number.isFinite(pivotTone)) {
    return Math.min(100, Math.max(0, Math.round(pivotTone)));
  }
  return DEFAULT_PIVOT_TONE;
}

/**
 * Full LM defaults (strategy + deltas).
 * @returns {InteractionStatesConfig}
 */
export function createDefaultInteractionStates() {
  return {
    ...createDefaultInteractionDeltas(false),
    relativeChroma: true,
    delivery: 'build',
    space: 'hct',
    oklchGamut: 'srgb',
    pivotTone: DEFAULT_PIVOT_TONE,
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
    deltaMin: Math.min(STATE_DELTA_LIMIT, Math.max(0, deltaMin)),
    deltaMax: Math.min(STATE_DELTA_LIMIT, Math.max(0, deltaMax)),
    state2Scale: Math.min(STATE2_SCALE_MAX, Math.max(STATE2_SCALE_MIN, state2Scale)),
  };
}

/**
 * Stored LM states (config / GUI). Does **not** force runtime overrides —
 * preferences for space / relative / gamut survive delivery toggles.
 * @param {Partial<InteractionStatesConfig> | null | undefined} states
 * @returns {InteractionStatesConfig}
 */
export function normalizeStoredInteractionStates(states) {
  const deltas = resolveInteractionDeltas(states, false);
  return {
    ...deltas,
    delivery: states?.delivery === 'runtime' ? 'runtime' : 'build',
    space: states?.space === 'oklch' ? 'oklch' : 'hct',
    relativeChroma: typeof states?.relativeChroma === 'boolean' ? states.relativeChroma : true,
    oklchGamut: states?.oklchGamut === 'p3' ? 'p3' : 'srgb',
    pivotTone: resolvePivotTone(states?.pivotTone),
  };
}

/**
 * Effective LM states for math / tokens (runtime → OKLCH + relativeChroma off).
 * Does not mutate stored preferences.
 * @param {Partial<InteractionStatesConfig> | null | undefined} states
 * @returns {InteractionStatesConfig}
 */
export function resolveInteractionStates(states) {
  const stored = normalizeStoredInteractionStates(states);
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
 * @returns {InteractionStatesConfig}
 */
export function resolveModeInteractionStates(keyPalette, mode) {
  const lm = resolveInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (keyPalette.lm?.states),
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
 * `deltaMax < deltaMin` is allowed (inverted continuum).
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
 * `T <= pivotTone` → lighten; else darken. |Δ| rounded to 1 decimal before apply.
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
  const next = colorTone <= pivotTone ? colorTone + amount : colorTone - amount;
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
 * @param {number} pivotTone — HCT T threshold (`T <= pivot` → lighten)
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
  const hue = resolveParam(hueParam, step, steps, true);
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
    collapseParamsForSingleIncludeStep(palette, steps);
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      const published = resolvePublishedIncludeSteps(palette, mode, steps);
      const chroma = palette[mode].chroma;
      if (published.length === 1) {
        applyRelativeFixedChromaAtStep(
          chroma,
          palette[mode].hue,
          keyResults[mode],
          steps,
          published[0],
        );
      } else if (chroma.mode === 'fixed' && isRelativeChroma(chroma)) {
        applyRelativeFixedChroma(chroma, palette[mode].hue, keyResults[mode], steps);
      } else {
        applyRelativeChromaParam(chroma, palette[mode].hue, keyResults[mode], steps);
      }
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
    const hue = resolveParam(cfg.hue, step, steps, true);
    const chroma = resolveChromaAtStep(cfg.chroma, cfg.hue, keyResult, steps, step);
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
 * Keep interpolate H/C points aligned with the current step grid (mutates state).
 * @param {EngineState} state
 */
export function normalizeStateForStepCount(state) {
  const steps = getSteps(state.stepCount);

  if (state.keyPalette?.lm?.states) {
    Object.assign(
      state.keyPalette.lm.states,
      normalizeStoredInteractionStates(
        /** @type {Partial<InteractionStatesConfig>} */ (state.keyPalette.lm.states),
      ),
    );
  }

  const keyResults = generateKeyPalettes(state.keyPalette, steps);
  syncIncludeStepsFromTones(state, keyResults, steps);

  for (const palette of state.customPalettes) {
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

  // Override step = nearest T (wins conflicts); after proportional remap.
  syncColorOverridePoints(state, keyResults);
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
    includeStepsDm: null,
    _includeTones: null,
    _includeOffsets: null,
    _includeTonesDm: null,
    _includeOffsetsDm: null,
    colorOverride: null,
    colorOverrideDm: null,
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
    if (value.relativeInterpolateChroma === true) {
      fixed.relativeInterpolateChroma = true;
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
    if (value.relativeInterpolateChroma === true) {
      interpolated.relativeInterpolateChroma = true;
      interpolated.clampInterpolatedChroma = true;
    } else if (value.clampInterpolatedChroma === true) {
      interpolated.clampInterpolatedChroma = true;
    }
    const hueArc = resolveHueArc(/** @type {{ hueArc?: unknown }} */ (value).hueArc);
    if (hueArc !== 'shortest') {
      interpolated.hueArc = hueArc;
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

  return normalizeStoredInteractionStates(
    /** @type {Partial<InteractionStatesConfig>} */ (value),
  );
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

  return resolveInteractionDeltas(
    /** @type {Partial<InteractionStatesDeltas>} */ (value),
    true,
  );
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
    if (isRelativeChroma(chromaParam)) {
      applyRelativeFixedChroma(chromaParam, hueParam, keyResult, steps);
      chromaParam.relativeInterpolateChroma = true;
      delete chromaParam.gamutLimit;
      return;
    }
    const peak = peakChromaForSteps(hueParam, keyResult, steps);
    chromaParam.value = Math.min(Math.max(0, Math.round(Number(chromaParam.value)) || 0), peak);
    delete chromaParam.ratio;
    delete chromaParam.gamutLimit;
    delete chromaParam.relativeInterpolateChroma;
    return;
  }
  if (!isClampInterpolatedChroma(chromaParam)) {
    delete chromaParam.clampInterpolatedChroma;
    delete chromaParam.relativeInterpolateChroma;
    delete /** @type {Record<string, unknown>} */ (chromaParam).hueArc;
    for (const point of chromaParam.points) {
      delete point.gamutLimit;
      delete point.ratio;
    }
    return;
  }
  applyRelativeChromaParam(chromaParam, hueParam, keyResult, steps);
  clampChromaParamValues(chromaParam, hueParam, keyResult, steps);
  chromaParam.clampInterpolatedChroma = true;
  delete /** @type {Record<string, unknown>} */ (chromaParam).hueArc;
  if (isRelativeChroma(chromaParam)) {
    chromaParam.relativeInterpolateChroma = true;
  } else {
    delete chromaParam.relativeInterpolateChroma;
  }
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
  );
  keyPalette.dm.states = resolveInteractionDeltas(
    /** @type {Partial<InteractionStatesDeltas>} */ (keyPalette.dm.states),
    true,
  );

  /** @type {{ stepCount: number, keyPalette: unknown, customPalettes: unknown[], brand?: BrandConfig }} */
  const out = {
    stepCount: state.stepCount,
    keyPalette,
    customPalettes: state.customPalettes.map((palette) => {
      const { name, includeSteps, includeStepsDm, colorOverride, colorOverrideDm, lm, dm } = palette;
      const publishedLm = resolvePublishedIncludeSteps(palette, 'lm', steps);
      const publishedDm = resolvePublishedIncludeSteps(palette, 'dm', steps);
      const normalized = normalizeIncludeSteps(includeSteps, steps);
      /** @type {{ name: string, includeSteps?: number[], includeStepsDm?: number[], colorOverride?: ColorOverride, colorOverrideDm?: ColorOverride, lm: unknown, dm: unknown }} */
      const paletteOut = {
        name: sanitizePaletteName(name),
        lm: cloneModeParamsForConfig(lm, keyPalettes.lm, steps, publishedLm),
        dm: cloneModeParamsForConfig(dm, keyPalettes.dm, steps, publishedDm),
      };
      if (normalized) paletteOut.includeSteps = normalized;
      // Dirty DM only: omit when inheriting. Dirty full (`[]`) → explicit current grid.
      if (includeStepsDm != null) {
        paletteOut.includeStepsDm = isDirtyFullIncludeStepsDm(includeStepsDm) || isFullIncludeSteps(includeStepsDm, steps)
          ? steps.slice()
          : resolveIncludeSteps(includeStepsDm, steps);
      }
      const ovHex = parseBrandHex(colorOverride?.hex ?? '');
      if (ovHex) paletteOut.colorOverride = { hex: ovHex };
      const ovDmHex = parseBrandHex(colorOverrideDm?.hex ?? '');
      if (ovDmHex) paletteOut.colorOverrideDm = { hex: ovDmHex };
      return paletteOut;
    }),
  };

  if (state.brand) {
    const hex = parseBrandHex(state.brand.hex);
    if (hex) {
      out.brand = {
        hex,
        perfectFit: Boolean(state.brand.perfectFit),
        overrideNearest: Boolean(state.brand.overrideNearest) && !state.brand.perfectFit,
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
      includeStepsDm: Array.isArray(palette.includeStepsDm) ? palette.includeStepsDm : null,
      colorOverride: parseColorOverrideConfig(palette.colorOverride, 'colorOverride'),
      colorOverrideDm: parseColorOverrideConfig(palette.colorOverrideDm, 'colorOverrideDm'),
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
  );
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);
  for (const palette of state.customPalettes) {
    setIncludeStepsIntent(palette, palette.includeSteps, keyPalettes.lm, steps);
    setIncludeStepsDmIntent(palette, palette.includeStepsDm, keyPalettes.dm, steps);
    collapseParamsForSingleIncludeStep(palette, steps);
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      const published = resolvePublishedIncludeSteps(palette, mode, steps);
      clampChromaParamForConfig(palette[mode].chroma, palette[mode].hue, keyPalettes[mode], steps, published);
    }
  }

  state.brand = parseBrandConfig(data.brand, state.customPalettes);
  syncColorOverridePoints(state, keyPalettes);
  return state;
}

/**
 * @param {unknown} raw
 * @param {string} [label]
 * @returns {ColorOverride | null}
 */
function parseColorOverrideConfig(raw, label = 'colorOverride') {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${label} must be an object or omitted`);
  }
  const hex = parseBrandHex(/** @type {{ hex?: unknown }} */ (raw).hex);
  if (!hex) {
    throw new Error(`${label}.hex must be a hex color (#rrggbb)`);
  }
  return { hex };
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
  const overrideNearest = Boolean(/** @type {{ overrideNearest?: unknown }} */ (raw).overrideNearest)
    && !perfectFit;
  const paletteRaw = /** @type {{ palette?: unknown }} */ (raw).palette;

  if (typeof paletteRaw === 'string' && paletteRaw.trim()) {
    const paletteName = sanitizePaletteName(paletteRaw);
    // Orphan name (typo / deleted palette) → drop brand; never silently remap.
    if (!customPalettes.some((p) => p.name === paletteName)) return null;
    return { hex, perfectFit, overrideNearest, palette: paletteName };
  }

  return {
    hex,
    perfectFit,
    overrideNearest,
    palette: sanitizePaletteName(customPalettes[0].name),
  };
}

// ---------------------------------------------------------------------------
// Tokens & system output
// ---------------------------------------------------------------------------

/**
 * @param {object} result
 * @param {number[]} steps — published grid steps
 * @param {number} endStep
 * @param {string} prefix
 * @param {string[]} lines
 * @param {'tone' | 'hc'} format
 * @param {boolean} [includePoles=true] — emit min (`0`) / max (`end+10`); false for partial includeSteps
 */
function appendPaletteColorTokens(result, steps, endStep, prefix, lines, format, includePoles = true) {
  if (includePoles) {
    lines.push(`  --${prefix}-0: ${result.min};`);
  }
  for (const step of steps) {
    const data = result.steps[step];
    if (!data) continue;
    if (format === 'tone') {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* T: ${data.tone} */`);
    } else {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* H: ${data.hue}, C: ${data.chroma} */`);
    }
  }
  if (includePoles) {
    lines.push(`  --${prefix}-${endStep + 10}: ${result.max};`);
  }
}

/**
 * Step 0 aliases: `--*-0-state1` → `var(--*-{first})`, `--*-0-state2` → `var(--*-{second})`.
 * Grid jump (not interaction Δ). Build + runtime.
 * @param {number[]} steps
 * @param {string} prefix
 * @param {string[]} lines
 */
function appendGhostZeroStateTokens(steps, prefix, lines) {
  if (steps[0] != null) lines.push(`  --${prefix}-0-state1: var(--${prefix}-${steps[0]});`);
  if (steps[1] != null) lines.push(`  --${prefix}-0-state2: var(--${prefix}-${steps[1]});`);
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
  const cfg = resolveInteractionStates(states);
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
  const cfg = resolveInteractionStates(states);
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
 * Custom: `includeSteps` filter; partial whitelist omits min/max + `0-state*`.
 * Full palettes: `--*-0-state1|2` = `var(--*-10|20)` (grid jump; build + runtime).
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
  const lmStates = resolveModeInteractionStates(state.keyPalette, 'lm');
  const dmStates = resolveModeInteractionStates(state.keyPalette, 'dm');
  const runtime = lmStates.delivery === 'runtime';
  const lmPivotTone = resolvePivotTone(lmStates.pivotTone);
  const dmPivotTone = resolvePivotTone(dmStates.pivotTone);

  const buildStatesComment = [
    '',
    '  /* Build interaction states — precomputed hex from HCT Δ vs bg',
    '   * (|Δ| scales deltaMin→deltaMax by distance to bg; HCT or OKLCH apply per config).',
    '   * state1 ≈ hover, state2 ≈ pressed (e.g. state2Scale).',
    '   * Usage: background: var(--palette-1-50-state1);',
    '   * Tokens: --{palette}-{step}-state1|2 (steps 10…end; LM & DM palette prefixes, e.g. --palette-1-dm-50-state1).',
    '   * Step 0 (full palettes only): --*-0-state1|2 → var(--*-10|20) — hex aliases, not computed states',
    '   *   (e.g. ghost / transparent controls: rest 0, hover 0-state1, pressed 0-state2).',
    '   */',
  ];

  const runtimeStatesComment = [
    '',
    '  /* Runtime interaction states — signed Δ from HCT T vs bg',
    '   * (|Δ| scales deltaMin→deltaMax by distance to bg),',
    '   * applied as OKLCH L (0–100), e.g. --state-10-state1: -5.6;',
    '   * state1 ≈ hover, state2 ≈ pressed (e.g. state2Scale).',
    '   * CSS relative `l` is 0–1, so divide the token by 100. Wrap in rgb() to clip into sRGB',
    '   * (same look on sRGB and P3 under color management):',
    '   *   background: rgb(from oklch(from var(--palette-1-50) calc(l + var(--state-50-state1) / 100) c h) r g b);',
    '   * Δ tokens: LM --state-{step}-state1|2 · DM --state-dm-{step}-state1|2',
    '   * Step 0 (full palettes only): --*-0-state1|2 → var(--*-10|20) — hex aliases, not Δ',
    '   *   (e.g. ghost / transparent controls: rest 0, hover 0-state1, pressed 0-state2).',
    '   */',
  ];

  appendPaletteColorTokens(keyResults.lm, steps, endStep, KEY_PALETTE_NAME, lines, 'tone');
  if (!runtime) lines.push(...buildStatesComment);
  appendGhostZeroStateTokens(steps, KEY_PALETTE_NAME, lines);
  if (!runtime) {
    appendBuildInteractionStateTokens(
      keyResults.lm, steps, KEY_PALETTE_NAME, lines, lmStates, keyResults.lm.min, lmPivotTone,
    );
  }
  appendPaletteColorTokens(keyResults.dm, steps, endStep, `${KEY_PALETTE_NAME}-dm`, lines, 'tone');
  appendGhostZeroStateTokens(steps, `${KEY_PALETTE_NAME}-dm`, lines);
  if (!runtime) {
    appendBuildInteractionStateTokens(
      keyResults.dm, steps, `${KEY_PALETTE_NAME}-dm`, lines, dmStates, keyResults.dm.min, dmPivotTone,
    );
  }

  for (const palette of state.customPalettes) {
    const name = sanitizePaletteName(palette.name);
    const results = customResults[palette.id];
    if (!results) continue;

    const publishedLm = resolvePublishedIncludeSteps(palette, 'lm', steps);
    const publishedDm = resolvePublishedIncludeSteps(palette, 'dm', steps);
    const polesLm = isFullPublishedIncludeSteps(palette, 'lm', steps);
    const polesDm = isFullPublishedIncludeSteps(palette, 'dm', steps);
    appendPaletteColorTokens(results.lm, publishedLm, endStep, name, lines, 'hc', polesLm);
    if (polesLm) appendGhostZeroStateTokens(steps, name, lines);
    if (!runtime) {
      appendBuildInteractionStateTokens(
        results.lm, publishedLm, name, lines, lmStates, keyResults.lm.min, lmPivotTone,
      );
    }
    appendPaletteColorTokens(results.dm, publishedDm, endStep, `${name}-dm`, lines, 'hc', polesDm);
    if (polesDm) appendGhostZeroStateTokens(steps, `${name}-dm`, lines);
    if (!runtime) {
      appendBuildInteractionStateTokens(
        results.dm, publishedDm, `${name}-dm`, lines, dmStates, keyResults.dm.min, dmPivotTone,
      );
    }
  }

  if (runtime) {
    lines.push(...runtimeStatesComment);
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

  // Whitelist with colorOverride: keep offsets around that mode’s override step (hex T).
  syncIncludeStepsFromTones(state, keyPalettes, steps, { requireColorOverride: true });

  applyRelativeCustomChroma(state.customPalettes, keyPalettes, steps);
  clampAllCustomChroma(state.customPalettes, keyPalettes, steps);
  // After chroma remap: lock override interp points to hex H/C (nearest T wins).
  syncColorOverridePoints(state, keyPalettes);

  /** @type {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} */
  const customPalettes = {};
  for (const palette of state.customPalettes) {
    customPalettes[palette.id] = {
      lm: generateCustomPaletteForMode(palette, 'lm', keyPalettes.lm, steps),
      dm: generateCustomPaletteForMode(palette, 'dm', keyPalettes.dm, steps),
    };
  }

  applyColorOverrides(state, keyPalettes, customPalettes);

  return {
    steps,
    endStep,
    keyPalettes,
    customPalettes,
    tokensCss: buildTokensCss(state, keyPalettes, customPalettes, steps, endStep),
    config: exportEngineConfig(state),
  };
}
