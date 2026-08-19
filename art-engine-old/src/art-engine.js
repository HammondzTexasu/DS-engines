/**
 * Art Engine 1.0 — style intent → deterministic LLM guidance.
 * No model calls, API keys, CSS tokens, or component definitions.
 */

/** @typedef {'low' | 'medium' | 'high' | null} Confidence */
/** @typedef {{ id: string, label: string, meaningLow: string, meaningHigh: string }} AxisDefinition */
/** @typedef {AxisDefinition & { value: number, confidence: Confidence }} AxisConfig */
/** @typedef {{ name: string, language: string, code: string, why?: string }} Snippet */
/** @typedef {{ label?: string, note?: string }} SourceReference */
/**
 * @typedef {Object} ArtState
 * @property {{ name: string, summary: string }} styleProfile
 * @property {AxisConfig[]} axes
 * @property {string[]} rules
 * @property {string[]} antiRules
 * @property {string[]} heuristics
 * @property {string[]} notes
 * @property {Snippet[]} snippets
 * @property {SourceReference[]} sourceReferences
 */

export const AXIS_CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);

/** @type {readonly AxisDefinition[]} */
export const DEFAULT_AXIS_DEFINITIONS = Object.freeze([
  {
    id: 'roundedness',
    label: 'Roundedness',
    meaningLow: 'sharp, precise, technical edges',
    meaningHigh: 'soft, friendly, tactile curves',
  },
  {
    id: 'spaciousness',
    label: 'Spaciousness',
    meaningLow: 'compact, dense, utilitarian rhythm',
    meaningHigh: 'airy, calm, generous spacing rhythm',
  },
  {
    id: 'ornament',
    label: 'Ornament',
    meaningLow: 'reduction, discipline, minimal effects',
    meaningHigh: 'decoration, layering, expressive styling',
  },
  {
    id: 'contrast',
    label: 'Contrast',
    meaningLow: 'subtle hierarchy and low visual drama',
    meaningHigh: 'bold separation and strong hierarchy',
  },
  {
    id: 'softness',
    label: 'Softness',
    meaningLow: 'dry surfaces, crisp edges, restrained shadows',
    meaningHigh: 'gentle surfaces, diffused depth, soft transitions',
  },
  {
    id: 'strictness',
    label: 'Strictness',
    meaningLow: 'loose, expressive, less systematic composition',
    meaningHigh: 'order, rhythm, alignment, optical control',
  },
  {
    id: 'playfulness',
    label: 'Playfulness',
    meaningLow: 'serious, restrained, professional tone',
    meaningHigh: 'light, energetic, characterful tone',
  },
  {
    id: 'calmness',
    label: 'Calmness',
    meaningLow: 'dynamic, urgent, high visual tempo',
    meaningHigh: 'calm, stable, low visual noise',
  },
]);

const DEFAULT_AXIS_VALUES = Object.freeze({
  roundedness: 35,
  spaciousness: 58,
  ornament: 18,
  contrast: 52,
  softness: 42,
  strictness: 78,
  playfulness: 24,
  calmness: 72,
});

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
export function clampAxisValue(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 50;
  return Math.min(100, Math.max(0, number));
}

/** @param {unknown} value @returns {Confidence} */
export function normalizeConfidence(value) {
  const confidence = cleanLine(value).toLowerCase();
  if (confidence === 'low' || confidence === 'medium' || confidence === 'high') {
    return confidence;
  }
  return null;
}

/** @param {unknown} value */
export function sanitizeProfileName(value) {
  return (
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'style-profile'
  );
}

/** @param {unknown} value */
export function importStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanLine).filter(Boolean);
}

/** @param {unknown} value @param {AxisDefinition} definition */
export function importAxis(value, definition) {
  const source =
    value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
  return {
    id: definition.id,
    label: definition.label,
    value: clampAxisValue(source.value),
    meaningLow: cleanLine(source.meaningLow) || definition.meaningLow,
    meaningHigh: cleanLine(source.meaningHigh) || definition.meaningHigh,
    confidence: normalizeConfidence(source.confidence),
  };
}

/** @param {unknown} value */
export function importSnippets(value) {
  if (!Array.isArray(value)) return [];
  /** @type {Snippet[]} */
  const snippets = [];
  for (const item of value) {
    const source =
      item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
    const code = String(source.code ?? '').trim();
    if (!code) continue;
    const snippet = {
      name: cleanLine(source.name) || 'snippet',
      language: cleanLine(source.language) || 'text',
      code,
    };
    const why = cleanLine(source.why);
    snippets.push(why ? { ...snippet, why } : snippet);
  }
  return snippets;
}

/** @param {unknown} value */
export function importSourceReferences(value) {
  if (!Array.isArray(value)) return [];
  /** @type {SourceReference[]} */
  const references = [];
  for (const item of value) {
    const source =
      item && typeof item === 'object' ? /** @type {Record<string, unknown>} */ (item) : {};
    const label = cleanLine(source.label);
    const note = cleanLine(source.note);
    if (label || note) references.push({ ...(label ? { label } : {}), ...(note ? { note } : {}) });
  }
  return references;
}

/** @returns {ArtState} */
export function createDefaultState() {
  return {
    styleProfile: {
      name: 'calm-precise',
      summary:
        'Calm, precise and undecorated visual language. Structure and rhythm before decoration; clarity before showcase styling.',
    },
    axes: DEFAULT_AXIS_DEFINITIONS.map((definition) =>
      importAxis(
        {
          value:
            /** @type {Record<string, number>} */ (DEFAULT_AXIS_VALUES)[definition.id] ?? 50,
        },
        definition,
      ),
    ),
    rules: [
      'Prefer structure and rhythm before decoration.',
      'Use styling to support hierarchy, not to replace it.',
      'When uncertain, simplify instead of adding effects.',
      'Use project color and typography tokens when available; do not invent parallel scales.',
    ],
    antiRules: [
      'Do not produce marketing or showcase UI unless explicitly requested.',
      'Do not use glassmorphism, heavy blur stacks, or gradient decoration without a clear reason.',
      'Do not hide weak information architecture behind visual effects.',
      'Do not default to card-heavy layouts when a simpler structure works.',
    ],
    heuristics: [
      'CTA should feel clear and confident, not aggressive.',
      'Higher roundedness does not mean pill shapes everywhere.',
      'Increase spaciousness through section rhythm before random padding inflation.',
      'Prefer borders or surface contrast before adding shadow depth.',
    ],
    notes: [],
    snippets: [],
    sourceReferences: [],
  };
}

/** @param {unknown} axes */
export function normalizeAxes(axes) {
  const source = Array.isArray(axes) ? axes : [];
  const byId = new Map(
    source
      .filter((axis) => axis && typeof axis === 'object')
      .map((axis) => [String(axis.id ?? ''), axis]),
  );

  const canUpdateInPlace =
    source.length === DEFAULT_AXIS_DEFINITIONS.length &&
    source.every(
      (axis, index) =>
        axis &&
        typeof axis === 'object' &&
        String(axis.id ?? '') === DEFAULT_AXIS_DEFINITIONS[index].id,
    );

  if (canUpdateInPlace) {
    for (let index = 0; index < source.length; index++) {
      const definition = DEFAULT_AXIS_DEFINITIONS[index];
      const normalized = importAxis(source[index], definition);
      Object.assign(source[index], normalized);
    }
    return source;
  }

  return DEFAULT_AXIS_DEFINITIONS.map((definition) =>
    importAxis(byId.get(definition.id), definition),
  );
}

/** @param {unknown} snippets */
export function normalizeSnippets(snippets) {
  const source = Array.isArray(snippets) ? snippets : [];
  const imported = importSnippets(source);
  if (
    source.length === imported.length &&
    source.every((snippet) => snippet && typeof snippet === 'object')
  ) {
    for (let index = 0; index < source.length; index++) {
      Object.assign(source[index], imported[index]);
    }
    return source;
  }
  return imported;
}

/** @param {ArtState} state */
export function normalizeState(state) {
  const fallback = createDefaultState();
  state.styleProfile = {
    name: sanitizeProfileName(state.styleProfile?.name),
    summary: cleanLine(state.styleProfile?.summary) || fallback.styleProfile.summary,
  };
  state.axes = normalizeAxes(state.axes);
  state.rules = importStringList(state.rules);
  state.antiRules = importStringList(state.antiRules);
  state.heuristics = importStringList(state.heuristics);
  state.notes = importStringList(state.notes);
  state.snippets = normalizeSnippets(state.snippets);
  state.sourceReferences = importSourceReferences(state.sourceReferences);
  return state;
}

/** @param {unknown} json @returns {ArtState} */
export function importEngineConfig(json) {
  const raw = typeof json === 'string' ? JSON.parse(json) : json;
  const source =
    raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const fallback = createDefaultState();
  const profile =
    source.styleProfile && typeof source.styleProfile === 'object'
      ? /** @type {Record<string, unknown>} */ (source.styleProfile)
      : {};

  return normalizeState({
    styleProfile: {
      name: sanitizeProfileName(profile.name ?? fallback.styleProfile.name),
      summary: cleanLine(profile.summary) || fallback.styleProfile.summary,
    },
    axes: source.axes != null ? normalizeAxes(source.axes) : fallback.axes,
    rules: source.rules != null ? importStringList(source.rules) : fallback.rules,
    antiRules: source.antiRules != null ? importStringList(source.antiRules) : fallback.antiRules,
    heuristics: source.heuristics != null ? importStringList(source.heuristics) : fallback.heuristics,
    notes: source.notes != null ? importStringList(source.notes) : [],
    snippets: source.snippets != null ? importSnippets(source.snippets) : [],
    sourceReferences:
      source.sourceReferences != null ? importSourceReferences(source.sourceReferences) : [],
  });
}

/** @param {ArtState} state */
export function exportEngineConfig(state) {
  normalizeState(state);
  /** @type {Record<string, unknown>} */
  const config = {
    styleProfile: { ...state.styleProfile },
    axes: state.axes.map((axis) => ({
      id: axis.id,
      value: axis.value,
      meaningLow: axis.meaningLow,
      meaningHigh: axis.meaningHigh,
      ...(axis.confidence ? { confidence: axis.confidence } : {}),
    })),
    rules: [...state.rules],
    antiRules: [...state.antiRules],
    heuristics: [...state.heuristics],
  };
  if (state.notes.length) config.notes = [...state.notes];
  if (state.snippets.length) config.snippets = state.snippets.map((snippet) => ({ ...snippet }));
  if (state.sourceReferences.length) {
    config.sourceReferences = state.sourceReferences.map((reference) => ({ ...reference }));
  }
  return config;
}

/** @param {AxisConfig} axis */
export function describeAxis(axis) {
  const value = clampAxisValue(axis.value);
  const band = AXIS_BANDS.find((candidate) => value <= candidate.max) ?? AXIS_BANDS[3];
  const confidence = axis.confidence ? ` Confidence: ${axis.confidence}.` : '';
  return `${axis.label} ${value}/100 — ${band.phrase}. Low pole: ${axis.meaningLow}. High pole: ${axis.meaningHigh}.${confidence}`;
}

/** @param {string[]} items @param {string} [empty] */
function renderList(items, empty = '_None._') {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : empty;
}

/** @param {ArtState} state */
export function buildLlmGuidance(state) {
  normalizeState(state);
  const lines = [
    '# Art direction',
    '',
    `**Profile:** ${state.styleProfile.name}`,
    '',
    state.styleProfile.summary,
    '',
    '## Style axes',
    '',
    ...state.axes.map((axis) => `- ${describeAxis(axis)}`),
    '',
    '## Do',
    '',
    renderList(state.rules),
    '',
    '## Avoid',
    '',
    renderList(state.antiRules),
    '',
    '## Decision heuristics',
    '',
    renderList(state.heuristics),
  ];

  if (state.notes.length) lines.push('', '## Owner notes', '', renderList(state.notes));
  if (state.snippets.length) {
    lines.push('', '## Reference snippets', '');
    for (const snippet of state.snippets) {
      lines.push(`### ${snippet.name}`);
      if (snippet.why) lines.push('', snippet.why);
      lines.push('', `\`\`\`${snippet.language}`, snippet.code, '```', '');
    }
  }
  if (state.sourceReferences.length) {
    lines.push('## Source references', '');
    for (const reference of state.sourceReferences) {
      if (reference.label && reference.note) {
        lines.push(`- **${reference.label}:** ${reference.note}`);
      } else {
        lines.push(`- ${reference.label || reference.note}`);
      }
    }
    lines.push('');
  }
  lines.push(
    '## Integration',
    '',
    '- Use deterministic color and typography tokens from sibling engines when present.',
    '- This profile guides aesthetic decisions. It does not define component libraries or spacing/radius token scales.',
    '- Treat these instructions as constraints for judgment, not as permission to invent a parallel design system.',
  );
  return `${lines.join('\n').trim()}\n`;
}

/** @param {ArtState} state */
export function buildCritiqueChecklist(state) {
  normalizeState(state);
  const checklist = [
    'Does the result match the profile summary and axis intent rather than generic “nice UI”?',
    'Is hierarchy created by structure and rhythm before decoration?',
    'Are color and typography taken from project tokens instead of invented parallel scales?',
  ];
  for (const antiRule of state.antiRules) checklist.push(`Avoid-pattern check: ${antiRule}`);
  for (const axis of state.axes) {
    if (axis.value <= 30 || axis.value >= 70) {
      checklist.push(`Strong axis check — ${describeAxis(axis)}`);
    }
  }
  return checklist;
}

/** @param {string[]} items */
function renderChecklist(items) {
  return items.map((item) => `- [ ] ${item}`).join('\n');
}

/** @param {ArtState} state */
export function buildGenerationPrompt(state) {
  return [
    'Implement the requested UI using the art-direction profile below.',
    'Follow it strictly, while solving the actual product and usability problem first.',
    'Use existing project color and typography tokens whenever available.',
    '',
    buildLlmGuidance(state),
    'Before finishing, self-critique the result and correct style drift.',
  ].join('\n');
}

/** @param {ArtState} state */
export function buildReviewPrompt(state) {
  return [
    'Review the proposed UI against the art-direction profile below.',
    'List concrete violations and risky drift first, then propose minimal corrections.',
    '',
    buildLlmGuidance(state),
    '## Critique checklist',
    '',
    renderChecklist(buildCritiqueChecklist(state)),
  ].join('\n');
}

/** @param {ArtState} state */
export function buildRefineConfigPrompt(state) {
  return [
    'Calibrate the attached art-engine config from screenshots and owner notes.',
    'Return ONLY valid JSON with the same schema shape as the current config below.',
    'Do not create component APIs, spacing scales, radius scales, or CSS tokens.',
    'Update the full profile: axes, rules, antiRules, heuristics, notes, snippets and sourceReferences.',
    'Set axis values from 0 to 100. Add confidence low|medium|high when evidence is uncertain.',
    'Preserve deliberate existing rules unless the references clearly contradict them.',
    '',
    '## Current config',
    '',
    '```json',
    JSON.stringify(exportEngineConfig(state), null, 2),
    '```',
  ].join('\n');
}

/**
 * Normalizes state in place and returns all deterministic guidance artifacts.
 * @param {ArtState} state
 */
export function generateSystem(state) {
  normalizeState(state);
  const critiqueChecklist = buildCritiqueChecklist(state);
  return {
    config: exportEngineConfig(state),
    llmGuidance: buildLlmGuidance(state),
    critiqueChecklist,
    critiqueChecklistMarkdown: renderChecklist(critiqueChecklist),
    generationPrompt: buildGenerationPrompt(state),
    reviewPrompt: buildReviewPrompt(state),
    refineConfigPrompt: buildRefineConfigPrompt(state),
  };
}
