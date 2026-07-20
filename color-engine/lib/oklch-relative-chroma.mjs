/**
 * Slim OKLCH helpers for build-time relative chroma + gamut clamp (sRGB / Display P3).
 *
 * Relative-chroma approach inspired by dokozero/postcss-oklch-relative-chroma (MIT):
 * find max C at (L, H) in gamut, then absoluteC = (relative% / 100) * maxC.
 * https://github.com/dokozero/postcss-oklch-relative-chroma
 *
 * No PostCSS — plain ESM for the color engine.
 */

/** @typedef {'srgb' | 'p3'} OklchGamut */

const MAX_C_SEARCH = 0.5;

/**
 * @param {number} n
 * @returns {number}
 */
function srgbTransfer(n) {
  const abs = Math.abs(n);
  return abs > 0.0031308
    ? Math.sign(n) * (1.055 * abs ** (1 / 2.4) - 0.055)
    : 12.92 * n;
}

/**
 * @param {number} n
 * @returns {number}
 */
function srgbInvTransfer(n) {
  const abs = Math.abs(n);
  return abs > 0.04045
    ? Math.sign(n) * ((abs + 0.055) / 1.055) ** 2.4
    : n / 12.92;
}

/**
 * OKLCH (L 0–1, C, H deg) → linear RGB (unbounded).
 * @param {number} l
 * @param {number} c
 * @param {number} h
 * @returns {[number, number, number]}
 */
function oklchToLinearRgb(l, c, h) {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  return [
    +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

/**
 * Linear sRGB → Display P3 linear.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {[number, number, number]}
 */
function linearSrgbToLinearP3(r, g, b) {
  return [
    0.822461969 * r + 0.177538031 * g + 0.000000000 * b,
    0.033194199 * r + 0.966805801 * g + 0.000000000 * b,
    0.017082631 * r + 0.07239744 * g + 0.910519928 * b,
  ];
}

/**
 * @param {[number, number, number]} rgb
 * @returns {boolean}
 */
function channelsInUnit(rgb) {
  return rgb.every((v) => v >= -1e-8 && v <= 1 + 1e-8);
}

/**
 * @param {number} l 0–1
 * @param {number} c
 * @param {number} h
 * @param {OklchGamut} gamut
 */
function oklchInGamut(l, c, h, gamut) {
  const lin = oklchToLinearRgb(l, c, h);
  if (gamut === 'p3') {
    return channelsInUnit(linearSrgbToLinearP3(lin[0], lin[1], lin[2]));
  }
  return channelsInUnit(lin);
}

/**
 * Max absolute OKLCH chroma at L (0–100) + H for gamut.
 * @param {number} lightness 0–100
 * @param {number} hue 0–360
 * @param {OklchGamut} [gamut='srgb']
 * @returns {number}
 */
export function maxOklchChroma(lightness, hue, gamut = 'srgb') {
  const l = Math.min(100, Math.max(0, Number(lightness))) / 100;
  const h = ((Number(hue) % 360) + 360) % 360;
  let lo = 0;
  let hi = MAX_C_SEARCH;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (oklchInGamut(l, mid, h, gamut)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Relative chroma % (0–100) → absolute OKLCH C (dokozero-style cross-multiply).
 * @param {number} lightness 0–100
 * @param {number} relativeChroma 0–100
 * @param {number} hue
 * @param {OklchGamut} [gamut='srgb']
 */
export function absoluteChromaFromRelative(lightness, relativeChroma, hue, gamut = 'srgb') {
  const max = maxOklchChroma(lightness, hue, gamut);
  const rc = Math.min(100, Math.max(0, Number(relativeChroma)));
  return (rc / 100) * max;
}

/**
 * @param {number} r 0–255
 * @param {number} g
 * @param {number} b
 * @returns {{ l: number, c: number, h: number }} L 0–100
 */
function srgb255ToOklch(r, g, b) {
  let lr = srgbInvTransfer(r / 255);
  let lg = srgbInvTransfer(g / 255);
  let lb = srgbInvTransfer(b / 255);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bOk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bOk * bOk);
  let H = (Math.atan2(bOk, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L * 100, c: C, h: H };
}

/**
 * @param {string} hex
 * @returns {{ l: number, c: number, h: number, hex: string }}
 */
export function hexToOklch(hex) {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3
    ? raw.split('').map((ch) => ch + ch).join('')
    : raw.slice(0, 6);
  const n = parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const oklch = srgb255ToOklch(r, g, b);
  return { ...oklch, hex: `#${full.toLowerCase()}` };
}

/**
 * @param {number} lightness 0–100
 * @param {number} chroma absolute
 * @param {number} hue
 * @param {OklchGamut} [gamut='srgb']
 * @returns {string}
 */
export function oklchToHex(lightness, chroma, hue, gamut = 'srgb') {
  const l = Math.min(100, Math.max(0, Number(lightness))) / 100;
  let c = Math.max(0, Number(chroma));
  const h = ((Number(hue) % 360) + 360) % 360;

  if (!oklchInGamut(l, c, h, gamut)) {
    c = maxOklchChroma(lightness, h, gamut);
  }

  const lin = oklchToLinearRgb(l, c, h);
  const r = Math.round(Math.min(255, Math.max(0, srgbTransfer(lin[0]) * 255)));
  const g = Math.round(Math.min(255, Math.max(0, srgbTransfer(lin[1]) * 255)));
  const b = Math.round(Math.min(255, Math.max(0, srgbTransfer(lin[2]) * 255)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Shift OKLCH L; optionally keep relative chroma % of gamut.
 * @param {string} hex
 * @param {number} nextLightness 0–100
 * @param {{ relativeChroma?: boolean, gamut?: OklchGamut }} [opts]
 * @returns {{ l: number, c: number, h: number, hex: string }}
 */
export function oklchAtLightness(hex, nextLightness, opts = {}) {
  const gamut = opts.gamut === 'p3' ? 'p3' : 'srgb';
  const src = hexToOklch(hex);
  const l = Math.min(100, Math.max(0, Number(nextLightness)));
  const useRelative = opts.relativeChroma !== false;

  let c;
  if (useRelative) {
    const maxFrom = maxOklchChroma(src.l, src.h, gamut);
    const rc = maxFrom > 0 ? (src.c / maxFrom) * 100 : 0;
    c = absoluteChromaFromRelative(l, rc, src.h, gamut);
  } else {
    c = Math.min(src.c, maxOklchChroma(l, src.h, gamut));
  }

  const outHex = oklchToHex(l, c, src.h, gamut);
  return { l, c, h: src.h, hex: outHex };
}
