/**
 * Color Engine — headless HCT palette system (config + token generation).
 *
 *   import { importEngineConfig, generateSystem } from './color-engine.js';
 *   const { tokensCss, config } = generateSystem(importEngineConfig(json));
 *
 * generateSystem may update interpolate chroma points in the passed state (relative gamut %).
 */

import { Hct, hexFromArgb, argbFromHex } from '../lib/material-color-utilities.mjs';

/** @typedef {[number, number, number, number]} Bezier */
/**
 * Interpolate control point.
 * For chroma: `ratio` (0–1 of HCT gamut at the point) is the stable intent; `value` is derived.
 * `gamutLimit` is runtime-only (last limit used) — not written to config JSON.
 * @typedef {{ step: number, value: number, ratio?: number, gamutLimit?: number }} ParamPoint
 */
/** @typedef {{ mode: 'fixed', value: number } | { mode: 'interpolate', points: ParamPoint[], interpolators: Bezier[] }} ParamConfig */
/** @typedef {{ min: string, max: string, start: { tone: number }, end: { tone: number }, interpolator: Bezier, interpolatorOverride?: boolean }} KeyPaletteConfig */
/** @typedef {{ lm: KeyPaletteConfig, dm: KeyPaletteConfig & { interpolatorOverride: boolean } }} KeyPaletteState */
/** @typedef {{ name: string, lm: { hue: ParamConfig, chroma: ParamConfig }, dm: { hue: ParamConfig, chroma: ParamConfig } }} CustomPaletteConfig */
/** @typedef {{ stepCount: number, keyPalette: KeyPaletteState, customPalettes: Array<CustomPaletteConfig & { id: string }> }} EngineState */

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
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 * @returns {boolean}
 */
export function clampChromaParamValues(chromaParam, hueParam, keyResult, steps) {
  if (chromaParam.mode === 'fixed') return false;

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
    const chroma = clampChroma(requested, hue, tone);
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
    },
    dm: {
      min: '#000000',
      max: '#ffffff',
      start: { tone: 8 },
      end: { tone: 93 },
      interpolator: [0.32, 0.23, 0.68, 0.82],
      interpolatorOverride: false,
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
 * @returns {EngineState}
 */
export function createDefaultState() {
  return {
    stepCount: 10,
    keyPalette: createDefaultKeyPalette(),
    customPalettes: [createCustomPalette()],
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
    return createFixedParam(value.value);
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
    return { mode: 'interpolate', points, interpolators };
  }

  throw new Error(`Unknown parameter mode: ${String(value.mode)}`);
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {KeyPaletteConfig}
 */
function parseKeyPaletteMode(value, label) {
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
  };

  if ('interpolatorOverride' in value) {
    config.interpolatorOverride = Boolean(value.interpolatorOverride);
  }

  return config;
}

/**
 * Clamp chroma for config import/export (mutates chromaParam).
 * Fixed → peak across steps; interpolate → relative remap then per-step HCT limit.
 * Live GUI state must not use this for fixed (slider may sit past the peak).
 * @param {ParamConfig} chromaParam
 * @param {ParamConfig} hueParam
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
function clampChromaParamForConfig(chromaParam, hueParam, keyResult, steps) {
  if (chromaParam.mode === 'fixed') {
    const peak = peakChromaForSteps(hueParam, keyResult, steps);
    chromaParam.value = Math.min(Math.max(0, Math.round(Number(chromaParam.value)) || 0), peak);
    return;
  }
  applyRelativeChromaParam(chromaParam, hueParam, keyResult, steps);
  clampChromaParamValues(chromaParam, hueParam, keyResult, steps);
  for (const point of chromaParam.points) {
    delete point.gamutLimit;
  }
}

/**
 * Deep-clone palette H/C params with chroma clamped for config (does not touch live state).
 * @param {{ hue: ParamConfig, chroma: ParamConfig }} modeParams
 * @param {ReturnType<typeof generateKeyPalette>} keyResult
 * @param {number[]} steps
 */
function cloneModeParamsForConfig(modeParams, keyResult, steps) {
  const cloned = JSON.parse(JSON.stringify(modeParams));
  clampChromaParamForConfig(cloned.chroma, cloned.hue, keyResult, steps);
  return cloned;
}

/**
 * Serialize engine state to JSON config.
 * Export copy clamps fixed chroma to peak; interpolate keeps ratio + absolute value at current gamut.
 * @param {EngineState} state
 */
export function exportEngineConfig(state) {
  const steps = getSteps(state.stepCount);
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);

  return {
    version: ENGINE_CONFIG_VERSION,
    stepCount: state.stepCount,
    keyPalette: JSON.parse(JSON.stringify(state.keyPalette)),
    customPalettes: state.customPalettes.map(({ name, lm, dm }) => ({
      name: sanitizePaletteName(name),
      lm: cloneModeParamsForConfig(lm, keyPalettes.lm, steps),
      dm: cloneModeParamsForConfig(dm, keyPalettes.dm, steps),
    })),
  };
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
    lm: parseKeyPaletteMode(data.keyPalette.lm, 'keyPalette.lm'),
    dm: {
      ...parseKeyPaletteMode(data.keyPalette.dm, 'keyPalette.dm'),
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
  };

  const steps = getSteps(state.stepCount);
  const keyPalettes = generateKeyPalettes(state.keyPalette, steps);
  for (const palette of state.customPalettes) {
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      clampChromaParamForConfig(palette[mode].chroma, palette[mode].hue, keyPalettes[mode], steps);
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Tokens & system output
// ---------------------------------------------------------------------------

/**
 * @param {ParamConfig} param
 * @param {string} prefix
 * @param {string} paramName
 * @param {string[]} lines
 */
function appendParamInterpolatorTokens(param, prefix, paramName, lines) {
  if (param.mode !== 'interpolate') return;

  const points = [...param.points].sort((a, b) => a.step - b.step);
  for (let i = 0; i < points.length - 1; i++) {
    const segNum = points.length > 2 ? `-${i + 1}` : '';
    const bezier = param.interpolators[i] ?? LINEAR_BEZIER;
    lines.push(`  --${prefix}-${paramName}-interpolator${segNum}: ${formatBezierCss(bezier)};`);
  }
}

/**
 * @param {object} result
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} prefix
 * @param {string[]} lines
 * @param {'tone' | 'hc'} format
 */
function appendPaletteColorTokens(result, steps, endStep, prefix, lines, format) {
  lines.push(`  --${prefix}-0: ${result.min};`);
  for (const step of steps) {
    const data = result.steps[step];
    if (format === 'tone') {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* T: ${data.tone} */`);
    } else {
      lines.push(`  --${prefix}-${step}: ${data.hex}; /* H: ${data.hue}, C: ${data.chroma} */`);
    }
  }
  lines.push(`  --${prefix}-${endStep + 10}: ${result.max};`);
}

/**
 * Build `:root { … }` CSS custom properties from engine state + already-generated palettes.
 * Does not regenerate colors — pass results from `generateSystem` / `generateCustomPaletteForMode`.
 * @param {EngineState} state
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {Record<string, { lm: ReturnType<typeof generateCustomPaletteForMode>, dm: ReturnType<typeof generateCustomPaletteForMode> }>} customResults
 * @param {number[]} steps
 * @param {number} endStep
 * @returns {string}
 */
export function buildTokensCss(state, keyResults, customResults, steps, endStep) {
  const lines = [];

  appendPaletteColorTokens(keyResults.lm, steps, endStep, KEY_PALETTE_NAME, lines, 'tone');
  lines.push(`  --${KEY_PALETTE_NAME}-start: ${state.keyPalette.lm.start.tone};`);
  lines.push(`  --${KEY_PALETTE_NAME}-end: ${state.keyPalette.lm.end.tone};`);
  lines.push(`  --key-tone-interpolator: ${formatBezierCss(state.keyPalette.lm.interpolator)};`);

  const dmBezier = state.keyPalette.dm.interpolatorOverride
    ? state.keyPalette.dm.interpolator
    : invertBezier(state.keyPalette.lm.interpolator);
  appendPaletteColorTokens(keyResults.dm, steps, endStep, `${KEY_PALETTE_NAME}-dm`, lines, 'tone');
  lines.push(`  --${KEY_PALETTE_NAME}-dm-start: ${state.keyPalette.dm.start.tone};`);
  lines.push(`  --${KEY_PALETTE_NAME}-dm-end: ${state.keyPalette.dm.end.tone};`);
  lines.push(`  --key-dm-tone-interpolator: ${formatBezierCss(dmBezier)};`);

  for (const palette of state.customPalettes) {
    const name = sanitizePaletteName(palette.name);
    const results = customResults[palette.id];
    if (!results) continue;

    appendPaletteColorTokens(results.lm, steps, endStep, name, lines, 'hc');
    appendParamInterpolatorTokens(palette.lm.hue, name, 'hue', lines);
    appendParamInterpolatorTokens(palette.lm.chroma, name, 'chroma', lines);

    appendPaletteColorTokens(results.dm, steps, endStep, `${name}-dm`, lines, 'hc');
    appendParamInterpolatorTokens(palette.dm.hue, `${name}-dm`, 'hue', lines);
    appendParamInterpolatorTokens(palette.dm.chroma, `${name}-dm`, 'chroma', lines);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Generate the full color system from engine state.
 * Side effect: remaps interpolate chroma points in `state` (relative gamut %), then safety-clamps.
 * Fixed chroma in live state is left as requested; per-step render still clamps.
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

  return {
    steps,
    endStep,
    keyPalettes,
    customPalettes,
    tokensCss: buildTokensCss(state, keyPalettes, customPalettes, steps, endStep),
    config: exportEngineConfig(state),
  };
}
