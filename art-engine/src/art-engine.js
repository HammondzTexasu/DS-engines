/**
 * Art Engine — art-direction config → one deterministic AI prompt.
 * No model calls, API keys, CSS tokens, or component definitions.
 */

/** @typedef {'low' | 'medium' | 'high' | null} Confidence */
/** @typedef {{ language: string, code: string, note?: string }} AxisSnippet */
/**
 * @typedef {Object} ArtAxis
 * @property {string} name
 * @property {number} value
 * @property {string} meaningLow
 * @property {string} meaningHigh
 * @property {Confidence} confidence
 * @property {AxisSnippet[]} snippets
 */
/**
 * @typedef {Object} ArtState
 * @property {{ name: string, summary: string }} styleProfile
 * @property {ArtAxis[]} axes
 * @property {string[]} rules
 * @property {string[]} antiRules
 * @property {string[]} heuristics
 */

export const AXIS_CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const MAX_AXIS_SNIPPETS = 8;

/** @type {readonly Omit<ArtAxis, 'confidence' | 'snippets'>[]} */
const DEFAULT_AXES = Object.freeze([
  {
    name: 'Roundedness',
    value: 35,
    meaningLow: 'sharp, precise, technical edges',
    meaningHigh: 'soft, friendly, tactile curves',
  },
  {
    name: 'Spaciousness',
    value: 58,
    meaningLow: 'compact, dense, utilitarian rhythm',
    meaningHigh: 'airy, calm, generous spacing rhythm',
  },
  {
    name: 'Ornament',
    value: 18,
    meaningLow: 'reduction, discipline, minimal effects',
    meaningHigh: 'decoration, layering, expressive styling',
  },
  {
    name: 'Contrast',
    value: 52,
    meaningLow: 'subtle hierarchy and low visual drama',
    meaningHigh: 'bold separation and strong hierarchy',
  },
]);

const AXIS_BANDS = Object.freeze([
  { max: 25, phrase: 'strongly toward the low pole' },
  { max: 50, phrase: 'leaning toward the low pole' },
  { max: 75, phrase: 'leaning toward the high pole' },
  { max: 100, phrase: 'strongly toward the high pole' },
]);

/** @param {unknown} value */
function cleanLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** @param {unknown} value */
export function sanitizeId(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'profile'
  );
}

/** @param {unknown} value */
export function clampAxisValue(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 50;
  return Math.min(100, Math.max(0, number));
}

/** @param {unknown} value @returns {Confidence} */
export function normalizeConfidence(value) {
  const confidence = cleanLine(value).toLowerCase();
  return AXIS_CONFIDENCE_LEVELS.includes(confidence) ? /** @type {Confidence} */ (confidence) : null;
}

/** @param {unknown} value */
function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanLine).filter(Boolean);
}

/** @param {unknown} value @returns {AxisSnippet | null} */
export function normalizeAxisSnippet(value) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const code = String(source.code ?? '').trim();
  if (!code) return null;
  const language = cleanLine(source.language) || 'text';
  const note = cleanLine(source.note);
  return note ? { language, code, note } : { language, code };
}

/** @param {unknown} value @param {unknown} [legacySnippet] */
export function normalizeAxisSnippets(value, legacySnippet) {
  const source = Array.isArray(value) ? value : legacySnippet != null ? [legacySnippet] : [];
  return source.map(normalizeAxisSnippet).filter(Boolean).slice(0, MAX_AXIS_SNIPPETS);
}

/** @param {unknown} value */
function readAxisName(value, index) {
  if (!value || typeof value !== 'object') return `Axis ${index + 1}`;
  const source = /** @type {Record<string, unknown>} */ (value);
  return (
    cleanLine(source.name) ||
    cleanLine(source.label) ||
    cleanLine(source.id) ||
    `Axis ${index + 1}`
  );
}

/**
 * @param {unknown} value
 * @param {Set<string>} usedKeys
 */
export function assignUniqueAxisName(value, usedKeys) {
  const root = cleanLine(value) || 'axis';
  let name = root;
  let key = sanitizeId(name);
  let suffix = 2;
  while (usedKeys.has(key)) {
    name = `${root}-${suffix}`;
    key = sanitizeId(name);
    suffix += 1;
  }
  usedKeys.add(key);
  return name;
}

/**
 * @param {unknown} value
 * @param {number} index
 * @param {Set<string>} usedKeys
 * @returns {ArtAxis | null}
 */
function normalizeAxis(value, index, usedKeys) {
  if (!value || typeof value !== 'object') return null;
  const source = /** @type {Record<string, unknown>} */ (value);
  const name = assignUniqueAxisName(readAxisName(source, index), usedKeys);

  return {
    name,
    value: clampAxisValue(source.value),
    meaningLow: cleanLine(source.meaningLow) || `low ${name.toLowerCase()}`,
    meaningHigh: cleanLine(source.meaningHigh) || `high ${name.toLowerCase()}`,
    confidence: normalizeConfidence(source.confidence),
    snippets: normalizeAxisSnippets(source.snippets, source.snippet),
  };
}

/** @param {unknown} value */
export function normalizeAxes(value) {
  if (!Array.isArray(value)) return [];
  const usedKeys = new Set();
  return value.map((axis, index) => normalizeAxis(axis, index, usedKeys)).filter(Boolean);
}

/** @returns {ArtState} */
export function createDefaultState() {
  return {
    styleProfile: {
      name: 'calm-precise',
      summary:
        'Calm, precise and undecorated visual language. Structure and rhythm before decoration; clarity before showcase styling.',
    },
    axes: normalizeAxes(DEFAULT_AXES),
    rules: [
      'Prefer structure and rhythm before decoration.',
      'Use styling to support hierarchy, not to replace it.',
      'Use project color and typography tokens when available.',
    ],
    antiRules: [
      'Do not hide weak information architecture behind visual effects.',
      'Do not default to card-heavy layouts when a simpler structure works.',
    ],
    heuristics: [
      'When uncertain, simplify instead of adding effects.',
      'Prefer borders or surface contrast before adding shadow depth.',
    ],
  };
}

/** @param {unknown} value @returns {ArtState} */
export function importEngineConfig(value) {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!raw || typeof raw !== 'object') throw new TypeError('Art Engine config must be an object.');
  const source = /** @type {Record<string, unknown>} */ (raw);
  const fallback = createDefaultState();
  const profile =
    source.styleProfile && typeof source.styleProfile === 'object'
      ? /** @type {Record<string, unknown>} */ (source.styleProfile)
      : {};

  return {
    styleProfile: {
      name: sanitizeId(profile.name || fallback.styleProfile.name),
      summary: cleanLine(profile.summary) || fallback.styleProfile.summary,
    },
    axes: source.axes == null ? fallback.axes : normalizeAxes(source.axes),
    rules: source.rules == null ? fallback.rules : normalizeStringList(source.rules),
    antiRules:
      source.antiRules == null ? fallback.antiRules : normalizeStringList(source.antiRules),
    heuristics:
      source.heuristics == null ? fallback.heuristics : normalizeStringList(source.heuristics),
  };
}

/** @param {ArtState} state */
export function exportEngineConfig(state) {
  const normalized = importEngineConfig(state);
  return {
    styleProfile: { ...normalized.styleProfile },
    axes: normalized.axes.map((axis) => ({
      name: axis.name,
      value: axis.value,
      meaningLow: axis.meaningLow,
      meaningHigh: axis.meaningHigh,
      ...(axis.confidence ? { confidence: axis.confidence } : {}),
      ...(axis.snippets.length
        ? { snippets: axis.snippets.map((snippet) => ({ ...snippet })) }
        : {}),
    })),
    rules: [...normalized.rules],
    antiRules: [...normalized.antiRules],
    heuristics: [...normalized.heuristics],
  };
}

/** @param {ArtAxis} axis */
export function describeAxis(axis) {
  const value = clampAxisValue(axis.value);
  const band = AXIS_BANDS.find((candidate) => value <= candidate.max) ?? AXIS_BANDS[3];
  const confidence = axis.confidence ? ` Confidence: ${axis.confidence}.` : '';
  return `${axis.name} ${value}/100 — ${band.phrase}. Low pole: ${axis.meaningLow}. High pole: ${axis.meaningHigh}.${confidence}`;
}

/** @param {string[]} items */
function renderList(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '_None._';
}

/**
 * Generates the single prompt used when designing, implementing, or evaluating UI.
 * @param {ArtState} state
 */
export function generatePrompt(state) {
  const config = exportEngineConfig(state);
  const lines = [
    '# Art direction',
    '',
    'Use this art direction while designing, implementing, or evaluating the requested UI.',
    'Solve the product, usability, and accessibility problem first; then apply the visual intent consistently.',
    'Use existing project color and typography tokens when available.',
    '',
    `**Profile:** ${config.styleProfile.name}`,
    '',
    config.styleProfile.summary,
  ];

  if (config.axes.length) {
    lines.push('', '## Style axes', '');
    for (const axis of config.axes) {
      lines.push(`- ${describeAxis(axis)}`);
      for (const snippet of axis.snippets ?? []) {
        lines.push(
          '',
          `  **Reference override for ${axis.name}:**${snippet.note ? ` ${snippet.note}` : ''}`,
          '',
          `  \`\`\`${snippet.language}`,
          ...snippet.code.split('\n').map((line) => `  ${line}`),
          '  ```',
          '',
        );
      }
    }
  }

  lines.push(
    '',
    '## Do',
    '',
    renderList(config.rules),
    '',
    '## Avoid',
    '',
    renderList(config.antiRules),
    '',
    '## Decision heuristics',
    '',
    renderList(config.heuristics),
    '',
    '## Boundaries',
    '',
    '- Treat this profile as guidance for aesthetic judgment, not as a component library.',
    '- Do not invent parallel color, typography, spacing, radius, or shadow token systems.',
    '- Before finishing, compare the result against this full prompt and correct clear style drift.',
  );

  return `${lines.join('\n').trim()}\n`;
}

/** @param {ArtState} state */
export function generateSystem(state) {
  const config = exportEngineConfig(state);
  return { config, prompt: generatePrompt(config) };
}
