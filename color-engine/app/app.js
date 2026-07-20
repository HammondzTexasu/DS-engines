import {
  invertBezier,
  generateKeyPalettes,
  generateCustomPaletteForMode,
  sanitizePaletteName,
  filterPaletteNameInput,
  formatBezierCss,
  parseBezierCss,
  peakChromaForSteps,
  clampChromaParamValues,
  applyRelativeChromaParam,
  chromaLimitAtStep,
  lockChromaPointRatio,
  clampChroma,
  isClampInterpolatedChroma,
  maxChromaForHueTone,
  hexToHct,
  hctToHex,
  colorAtInteractionState,
  createDefaultInteractionStates,
  getSteps,
  CHROMA_MAX,
  KEY_PALETTE_NAME,
  LINEAR_BEZIER,
  createDefaultState,
  createCustomPalette,
  moveCustomPalette,
  createFixedParam,
  createInterpolateParam,
  normalizeStateForStepCount,
  exportEngineConfig,
  importEngineConfig,
  generateSystem,
  formatIncludeSteps,
  parseIncludeStepsInput,
  resolveIncludeSteps,
  normalizeIncludeSteps,
  collapseParamsForSingleIncludeStep,
  isSingleIncludeStep,
  applyRelativeFixedChromaAtStep,
  applyBrandColor,
  parseBrandHex,
} from '../src/color-engine.js';

/** @type {ReturnType<typeof createDefaultState>} */
let state = createDefaultState();

/** Project config next to app/src — loaded at boot when present. */
const LOCAL_CONFIG_URL = new URL('../config/engine-config.json', import.meta.url);

/**
 * Prefer `config/engine-config.json`; fall back to engine `createDefaultState()`.
 * @returns {Promise<ReturnType<typeof createDefaultState>>}
 */
async function loadInitialState() {
  try {
    const res = await fetch(LOCAL_CONFIG_URL.href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return importEngineConfig(await res.json());
  } catch (err) {
    console.warn('[color-engine] Local config not loaded, using engine default.', err);
    return createDefaultState();
  }
}

/** @type {{ message: string, isError: boolean } | null} */
let pendingConfigStatus = null;

/**
 * GUI-only brand seed link (not part of engine config).
 * @type {{ hex: string, paletteId: string } | null}
 */
let brandLink = null;

/** Perfect fit toggle (bend LM key curve). Persists in GUI session only. */
let brandPerfectFit = false;

let pageDarkMode = false;

/**
 * GUI-only HCT memory for color pickers (not part of engine config).
 * Key e.g. `key-lm:min`. Survives reopen within the session while hex still matches.
 * @type {Map<string, { hue: number, chroma: number, tone: number, hex: string }>}
 */
const hctPickerMemory = new Map();

/**
 * @param {string | null | undefined} key
 * @param {string} currentHex
 * @returns {{ hue: number, chroma: number, tone: number, hex: string } | null}
 */
function recallHctPicker(key, currentHex) {
  if (!key) return null;
  const saved = hctPickerMemory.get(key);
  if (!saved) return null;
  if (saved.hex !== String(currentHex).toLowerCase()) {
    hctPickerMemory.delete(key);
    return null;
  }
  return { ...saved };
}

/**
 * @param {string | null | undefined} key
 * @param {number} hue
 * @param {number} chroma
 * @param {number} tone
 * @param {string} hex
 */
function rememberHctPicker(key, hue, chroma, tone, hex) {
  if (!key) return;
  hctPickerMemory.set(key, {
    hue,
    chroma,
    tone,
    hex: String(hex).toLowerCase(),
  });
}

const UI_ACCENT_BASE = '#0066cc';
const UI_DANGER_BASE = '#aa0000';

const UI_FG_LIGHT = '#333333';
const UI_FG_DARK = '#e8e8e8';

/** Surface HCT tone ≥ this → light UI (dark fg); below → dark UI (light fg). */
const UI_SURFACE_TONE_LIGHT_MIN = 60;

/**
 * @param {string} hex
 */
function parseHexRgb(hex) {
  const match = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return { r: 255, g: 255, b: 255 };
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/**
 * @param {string} surfaceHex
 * @returns {number}
 */
function getSurfaceTone(surfaceHex) {
  return hexToHct(surfaceHex).tone;
}

/**
 * @param {string} surfaceHex
 * @returns {boolean}
 */
function isLightUiSurface(surfaceHex) {
  return getSurfaceTone(surfaceHex) >= UI_SURFACE_TONE_LIGHT_MIN;
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 */
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * @param {string} hex
 * @param {string} targetHex
 * @param {number} amount
 */
function mixHex(hex, targetHex, amount) {
  const a = parseHexRgb(hex);
  const t = parseHexRgb(targetHex);
  const mix = (from, to) => Math.round(from + (to - from) * amount);
  return rgbToHex(mix(a.r, t.r), mix(a.g, t.g), mix(a.b, t.b));
}

/**
 * @param {string} hex
 * @param {number} amount
 */
function lightenHex(hex, amount) {
  return mixHex(hex, '#ffffff', amount);
}

/**
 * @param {string} surfaceHex
 */
function getSemanticLightenAmount(surfaceHex) {
  const tone = getSurfaceTone(surfaceHex);
  if (tone >= UI_SURFACE_TONE_LIGHT_MIN) return 0;
  return ((UI_SURFACE_TONE_LIGHT_MIN - tone) / UI_SURFACE_TONE_LIGHT_MIN) * 0.4;
}

/**
 * @param {string} baseHex
 * @param {string} surfaceHex
 */
function resolveSemanticColor(baseHex, surfaceHex) {
  const amount = getSemanticLightenAmount(surfaceHex);
  if (amount <= 0) return baseHex;
  return lightenHex(baseHex, amount);
}

/**
 * @param {string} hex
 */
function encodeSelectArrow(hex) {
  const color = hex.replace('#', '').toLowerCase();
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23${color}' stroke='none' d='M1 1l4 4 4-4'/%3E%3C/svg%3E")`;
}

/**
 * @param {string} surfaceHex
 */
function resolveNeutralFg(surfaceHex) {
  return isLightUiSurface(surfaceHex) ? UI_FG_LIGHT : UI_FG_DARK;
}

/**
 * @param {string} surfaceHex
 */
function getUiThemeTokens(surfaceHex) {
  const fg = resolveNeutralFg(surfaceHex);
  const isLight = isLightUiSurface(surfaceHex);
  const accent = resolveSemanticColor(UI_ACCENT_BASE, surfaceHex);
  const danger = resolveSemanticColor(UI_DANGER_BASE, surfaceHex);
  const fgMuted = mixHex(fg, surfaceHex, 0.42);
  const border = mixHex(fg, surfaceHex, 0.7);
  const disabledFg = mixHex(fg, surfaceHex, 0.5);

  return {
    isLight,
    '--ui-fg': fg,
    '--ui-fg-muted': fgMuted,
    '--ui-border': border,
    '--ui-disabled-fg': disabledFg,
    '--ui-accent': accent,
    '--ui-danger': danger,
    '--ui-hover-bg': mixHex(fg, surfaceHex, 0.88),
    '--ui-raised-bg': mixHex(fg, surfaceHex, 0.92),
    '--ui-control-bg': mixHex(fg, surfaceHex, isLight ? 0.9 : 0.84),
    '--ui-control-border-hover': mixHex(fg, surfaceHex, 0.52),
    '--ui-input-bg-invalid': mixHex(danger, surfaceHex, 0.88),
    '--ui-select-arrow': encodeSelectArrow(fgMuted),
    '--ui-select-arrow-disabled': encodeSelectArrow(disabledFg),
  };
}

/**
 * @param {string} surfaceHex
 */
function applyUiTheme(surfaceHex) {
  const theme = getUiThemeTokens(surfaceHex);
  const root = document.documentElement;

  for (const [name, value] of Object.entries(theme)) {
    if (name === 'isLight') continue;
    root.style.setProperty(name, value);
  }

  root.style.colorScheme = 'light';
}

function getThemeSurfaceColor() {
  return pageDarkMode ? state.keyPalette.dm.min : state.keyPalette.lm.min;
}

function patchThemeSurfaces() {
  const color = getThemeSurfaceColor();
  document.documentElement.style.setProperty('--ui-surface-bg', color);
  applyUiTheme(color);
}

function onThemeSurfaceColorChange() {
  patchThemeSurfaces();
}

/** @type {HTMLButtonElement | null} */
let darkModeToggleEl = null;

function createDarkModeToggle() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-btn dark-mode-toggle';
  btn.setAttribute('aria-label', 'Dark mode');
  btn.setAttribute('aria-pressed', String(pageDarkMode));
  btn.innerHTML = `<svg class="dark-mode-toggle-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
  btn.addEventListener('click', () => {
    pageDarkMode = !pageDarkMode;
    syncDarkModeToggle();
    patchThemeSurfaces();
  });
  return btn;
}

function syncDarkModeToggle() {
  if (!darkModeToggleEl) return;
  darkModeToggleEl.setAttribute('aria-pressed', String(pageDarkMode));
}

function ensureDarkModeToggle() {
  if (!darkModeToggleEl) {
    darkModeToggleEl = createDarkModeToggle();
    document.body.appendChild(darkModeToggleEl);
    return;
  }
  syncDarkModeToggle();
}

const app = document.getElementById('app');

function showError(err) {
  app.innerHTML = `<div style="padding:16px;color:#900;background:#fee;border:1px solid #fcc;border-radius:4px;">
    <strong>Chyba načtení Color Engine:</strong><br>${err.message}
    <pre style="margin-top:8px;font-size:12px;white-space:pre-wrap;">${err.stack ?? ''}</pre>
  </div>`;
}

function collectExpandedParamGroups() {
  /** @type {Set<string>} */
  const expanded = new Set();
  for (const group of app.querySelectorAll('.param-settings-group:not(.is-collapsed)')) {
    if (group.dataset.groupKey) {
      expanded.add(group.dataset.groupKey);
      continue;
    }
    const fieldset = group.closest('.custom-palette-fieldset');
    const segment = group.closest('.palette-mode-segment');
    const paletteId = fieldset?.dataset.paletteId;
    const mode = segment?.dataset.mode;
    if (paletteId && mode) {
      expanded.add(`${paletteId}:${mode}`);
    }
  }
  return expanded;
}

function collectCollapsePanelExpanded(panelName) {
  const panel = app.querySelector(`.collapse-panel[data-panel="${panelName}"]`);
  return panel ? !panel.classList.contains('is-collapsed') : false;
}

function formatEngineConfigJson() {
  return JSON.stringify(exportEngineConfig(state), null, 2);
}

/** @param {string} [tokensCss] */
function patchTokensOutput(tokensCss) {
  const output = app.querySelector('[data-panel="tokens"] .code-output');
  if (!output) return;
  output.textContent = tokensCss ?? generateSystem(state).tokensCss;
}

function patchConfigOutput() {
  const output = app.querySelector('[data-panel="config"] .code-output');
  if (output) {
    output.textContent = formatEngineConfigJson();
  }
}

/**
 * @param {string} title
 * @param {string} panelName
 * @param {HTMLElement} body
 * @param {boolean} [expanded]
 */
function createCollapsePanel(title, panelName, body, expanded = false) {
  const panel = document.createElement('div');
  panel.className = `collapse-panel${expanded ? '' : ' is-collapsed'}`;
  panel.dataset.panel = panelName;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'ui-ghost collapse-panel-toggle';
  toggleBtn.setAttribute('aria-expanded', String(expanded));

  const chevron = document.createElement('span');
  chevron.className = 'collapse-panel-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  const titleText = document.createElement('span');
  titleText.textContent = title;

  toggleBtn.appendChild(chevron);
  toggleBtn.appendChild(titleText);
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('is-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!panel.classList.contains('is-collapsed')));
  });
  panel.appendChild(toggleBtn);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'collapse-panel-body';
  bodyWrap.appendChild(body);
  panel.appendChild(bodyWrap);

  return panel;
}

/**
 * @param {string} text
 */
function createTokensPanelBody(text) {
  const body = document.createElement('div');

  const output = document.createElement('pre');
  output.className = 'code-output';
  output.textContent = text;
  body.appendChild(output);

  return body;
}

function applyImportedConfig(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  state = importEngineConfig(parsed);
  hctPickerMemory.clear();
  brandLink = null;
  render();
}

/**
 * Clear GUI brand seed link (config values may have been edited by hand).
 */
function clearBrandLink() {
  if (!brandLink) return;
  brandLink = null;
  const input = app?.querySelector('.ui-control--brand-hex');
  if (input instanceof HTMLInputElement) {
    input.value = '';
  }
}

/**
 * After key grid changes, re-bend LM curve so Perfect fit still lands on brand T.
 * No-op when Perfect fit is off (H/C are independent of stepCount).
 */
function reapplyBrandPerfectFitAfterStepCountChange() {
  if (!brandLink || !brandPerfectFit) return;
  try {
    const result = applyBrandColor(state, brandLink.hex, {
      perfectFit: true,
      paletteId: brandLink.paletteId,
    });
    brandLink = { hex: result.hex, paletteId: result.paletteId };
  } catch {
    /* keep previous link + curve */
  }
}

function createConfigPanelBody() {
  const body = document.createElement('div');
  body.className = 'config-panel-body';

  const status = document.createElement('div');
  status.className = 'config-status';
  status.setAttribute('aria-live', 'polite');

  /** @param {string} message @param {boolean} [isError] */
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };

  const output = document.createElement('pre');
  output.className = 'code-output';
  output.textContent = formatEngineConfigJson();
  body.appendChild(output);

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'palette-header-action';
  downloadBtn.textContent = 'Download JSON';
  downloadBtn.addEventListener('click', () => {
    const json = formatEngineConfigJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'color-engine-config.json';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Config downloaded.');
  });
  actions.appendChild(downloadBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'palette-header-action';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formatEngineConfigJson());
      setStatus('Config copied to clipboard.');
    } catch {
      setStatus('Could not copy to clipboard.', true);
    }
  });
  actions.appendChild(copyBtn);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const fileBtn = document.createElement('button');
  fileBtn.type = 'button';
  fileBtn.className = 'palette-header-action';
  fileBtn.textContent = 'Import file';
  fileBtn.addEventListener('click', () => fileInput.click());
  actions.appendChild(fileBtn);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    try {
      pendingConfigStatus = { message: `Imported config from ${file.name}.`, isError: false };
      applyImportedConfig(await file.text());
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed.', true);
    }
  });

  body.appendChild(actions);
  body.appendChild(fileInput);

  const importLabel = document.createElement('label');
  importLabel.className = 'config-import-label';
  importLabel.textContent = 'Import JSON';
  body.appendChild(importLabel);

  const importInput = document.createElement('textarea');
  importInput.className = 'ui-control ui-control--multiline';
  importInput.spellcheck = false;
  importInput.placeholder = 'Paste exported config JSON here…';
  body.appendChild(importInput);

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'palette-header-action config-apply-btn';
  applyBtn.textContent = 'Apply import';
  applyBtn.addEventListener('click', () => {
    const raw = importInput.value.trim();
    if (!raw) {
      setStatus('Paste JSON config before applying import.', true);
      return;
    }

    try {
      pendingConfigStatus = { message: 'Config imported.', isError: false };
      applyImportedConfig(raw);
      importInput.value = '';
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Import failed.', true);
    }
  });
  body.appendChild(applyBtn);
  body.appendChild(status);

  if (pendingConfigStatus) {
    setStatus(pendingConfigStatus.message, pendingConfigStatus.isError);
    pendingConfigStatus = null;
  }

  return body;
}

function render() {
  const expandedParamGroups = collectExpandedParamGroups();
  const tokensPanelExpanded = collectCollapsePanelExpanded('tokens');
  const configPanelExpanded = collectCollapsePanelExpanded('config');

  const system = generateSystem(state);
  const { steps, endStep, keyPalettes: keyResults, tokensCss } = system;

  app.innerHTML = '';

  const header = document.createElement('header');

  const title = document.createElement('h1');
  title.textContent = 'Color Engine';
  header.appendChild(title);
  app.appendChild(header);

  app.appendChild(createKeyPaletteFieldset(keyResults, steps, endStep, expandedParamGroups));

  for (const palette of state.customPalettes) {
    app.appendChild(createCustomPaletteFieldset(palette, keyResults, steps, endStep, expandedParamGroups));
  }

  const addWrap = document.createElement('div');
  addWrap.className = 'palette-fieldset-wrap palette-add-wrap';

  const addHeader = document.createElement('div');
  addHeader.className = 'palette-fieldset-header';

  const addSpacer = document.createElement('div');
  addSpacer.className = 'palette-fieldset-title';
  addSpacer.setAttribute('aria-hidden', 'true');
  addHeader.appendChild(addSpacer);

  const addBtn = document.createElement('button');
  addBtn.className = 'ui-btn add-palette-btn palette-header-action';
  addBtn.textContent = '+ Add palette';
  addBtn.addEventListener('click', () => {
    state.customPalettes.push(createCustomPalette(`palette-${state.customPalettes.length + 1}`));
    render();
  });
  addHeader.appendChild(addBtn);

  addWrap.appendChild(addHeader);
  app.appendChild(addWrap);

  app.appendChild(
    createCollapsePanel('Engine config', 'config', createConfigPanelBody(), configPanelExpanded),
  );

  app.appendChild(
    createCollapsePanel(
      'Generated tokens',
      'tokens',
      createTokensPanelBody(tokensCss),
      tokensPanelExpanded,
    ),
  );

  patchThemeSurfaces();
  ensureDarkModeToggle();
}

/**
 * Fresh key-palette result for the current engine state (avoids stale closures after tone edits).
 * @param {'lm' | 'dm'} mode
 */
function getLiveKeyResult(mode) {
  const steps = getSteps(state.stepCount);
  return {
    steps,
    keyResult: generateKeyPalettes(state.keyPalette, steps)[mode],
  };
}

/**
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number} step
 */
function liveChromaLimitAtStep(palette, mode, step) {
  const { steps, keyResult } = getLiveKeyResult(mode);
  return chromaLimitAtStep(palette[mode].hue, keyResult, steps, step);
}

/**
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 */
function livePeakChromaForPalette(palette, mode) {
  const { steps, keyResult } = getLiveKeyResult(mode);
  return peakChromaForSteps(palette[mode].hue, keyResult, steps);
}

/**
 * @param {string} controlKey
 * @param {number} maxChroma
 */
function syncChromaMaxMarker(controlKey, maxChroma) {
  const marker = app.querySelector(`[data-chroma-max-marker="${controlKey}"]`);
  if (!(marker instanceof HTMLElement)) return;
  const range = marker.parentElement?.querySelector('input[type="range"]');
  if (!(range instanceof HTMLInputElement)) return;
  positionChromaMaxMarker(marker, range, maxChroma);
}

/**
 * Sync chroma max markers and interpolate point inputs after limit remap.
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {ReturnType<typeof generateKeyPalettes>['lm']} keyResult
 * @param {number[]} steps
 */
function syncChromaControls(palette, mode, keyResult, steps) {
  const chroma = palette[mode].chroma;
  const published = resolveIncludeSteps(palette.includeSteps, steps);

  if (chroma.mode === 'fixed') {
    if (isSingleIncludeStep(palette.includeSteps, steps)) {
      const step = published[0];
      const controlKey = `${palette.id}:${mode}:single:${step}`;
      const limit = chromaLimitAtStep(palette[mode].hue, keyResult, steps, step);
      syncChromaMaxMarker(controlKey, limit);
      app.querySelectorAll(`input[data-chroma-control="${controlKey}"]`).forEach((el) => {
        if (!(el instanceof HTMLInputElement)) return;
        el.value = String(chroma.value);
        if (el.type === 'range') {
          const wrap = el.parentElement;
          if (wrap) syncSliderVisuals(wrap, el);
        }
      });
      return;
    }
    syncChromaMaxMarker(
      `${palette.id}:${mode}:fixed`,
      peakChromaForSteps(palette[mode].hue, keyResult, steps),
    );
    return;
  }

  chroma.points.forEach((point, i) => {
    const controlKey = `${palette.id}:${mode}:point:${i}`;
    const limit = chromaLimitAtStep(palette[mode].hue, keyResult, steps, point.step);
    syncChromaMaxMarker(controlKey, limit);

    app.querySelectorAll(`input[data-chroma-control="${controlKey}"]`).forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      el.value = String(point.value);
      if (el.type === 'range') {
        const wrap = el.parentElement;
        if (wrap) syncSliderVisuals(wrap, el);
      }
    });
  });
}

function refreshPreviews() {
  const steps = getSteps(state.stepCount);
  const system = generateSystem(state);
  const { endStep, keyPalettes, customPalettes, tokensCss } = system;

  for (const palette of state.customPalettes) {
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      syncChromaControls(palette, mode, keyPalettes[mode], steps);
    }
  }

  patchPreviewRow('key-lm', keyPalettes.lm, steps, endStep, 'tone');
  patchPreviewRow('key-dm', keyPalettes.dm, steps, endStep, 'tone');

  for (const palette of state.customPalettes) {
    const results = customPalettes[palette.id];
    if (!results) continue;
    const published = resolveIncludeSteps(palette.includeSteps, steps);
    patchPreviewRow(`custom-${palette.id}-lm`, results.lm, published, endStep, 'hc');
    patchPreviewRow(`custom-${palette.id}-dm`, results.dm, published, endStep, 'hc');
  }

  patchTokensOutput(tokensCss);
  patchConfigOutput();
  patchThemeSurfaces();
  syncKeyDmAutoInterpolatorField();
}

/**
 * Disabled DM tone interpolator is built at render; keep its text in sync when LM curve changes
 * without a full re-render (refreshPreviews only).
 */
function syncKeyDmAutoInterpolatorField() {
  if (state.keyPalette.dm.interpolatorOverride) return;
  const input = app.querySelector('[data-dm-auto-interpolator] input.ui-ghost');
  if (!(input instanceof HTMLInputElement)) return;
  input.value = formatBezierCss(invertBezier(state.keyPalette.lm.interpolator));
}

let previewRaf = null;

function scheduleRefreshPreviews() {
  if (previewRaf !== null) return;
  previewRaf = requestAnimationFrame(() => {
    previewRaf = null;
    refreshPreviews();
  });
}

/**
 * @param {string} previewId
 * @param {object} paletteResult
 * @param {number[]} steps
 * @param {number} endStep
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 */
function patchPreviewRow(previewId, paletteResult, steps, endStep, valueFormat) {
  const row = app.querySelector(`[data-preview="${previewId}"]`);
  if (!row) return;

  if (row instanceof HTMLElement) {
    row.style.setProperty('--swatch-cols', String(getSteps(state.stepCount).length + 2));
  }

  const wraps = row.querySelectorAll(':scope > .swatch-wrap');
  const expectedCount = steps.length + 2;

  if (wraps.length !== expectedCount) {
    replacePreviewRow(previewId, paletteResult, steps, endStep, valueFormat, getEditOptions(previewId));
    return;
  }

  let i = 0;
  patchSwatchWrap(wraps[i], '0', paletteResult.min, null, valueFormat);
  i += 1;
  for (const step of steps) {
    const data = paletteResult.steps[step];
    patchSwatchWrap(wraps[i], String(step), data.hex, data, valueFormat);
    i += 1;
  }
  patchSwatchWrap(wraps[i], String(endStep + 10), paletteResult.max, null, valueFormat);
}

/**
 * @param {string} previewId
 * @returns {'lm' | 'dm'}
 */
function getTextMode(previewId) {
  return previewId.endsWith('-dm') ? 'dm' : 'lm';
}

const supportsContrastColor = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && CSS.supports('color', 'contrast-color(red)');

/**
 * Swatch face fill + label contrast (`--swatch-bg` for CSS `contrast-color()`, HCT tone fallback).
 * @param {HTMLElement} el
 * @param {string} hex
 */
function setSwatchFaceColor(el, hex) {
  el.style.setProperty('--swatch-bg', hex);
  el.style.background = hex;
  if (!supportsContrastColor) {
    el.style.color = hexToHct(hex).tone > 50 ? '#111' : '#fff';
  } else {
    el.style.removeProperty('color');
  }
}

/**
 * @param {string} previewId
 */
function getEditOptions(previewId) {
  if (previewId === 'key-lm') {
    return {
      minMemoryKey: 'key-lm:min',
      maxMemoryKey: 'key-lm:max',
      onMinChange: (hex) => {
        state.keyPalette.lm.min = hex;
        onThemeSurfaceColorChange();
        scheduleRefreshPreviews();
      },
      onMaxChange: (hex) => {
        state.keyPalette.lm.max = hex;
        scheduleRefreshPreviews();
      },
    };
  }
  if (previewId === 'key-dm') {
    return {
      minMemoryKey: 'key-dm:min',
      maxMemoryKey: 'key-dm:max',
      onMinChange: (hex) => {
        state.keyPalette.dm.min = hex;
        onThemeSurfaceColorChange();
        scheduleRefreshPreviews();
      },
      onMaxChange: (hex) => {
        state.keyPalette.dm.max = hex;
        scheduleRefreshPreviews();
      },
    };
  }
  return null;
}

/**
 * @param {Element} wrap
 * @param {string} name
 * @param {string} hex
 * @param {{ tone?: number, hue?: number, chroma?: number } | null} data
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 */
function patchSwatchWrap(wrap, name, hex, data, valueFormat) {
  const nameEl = wrap.querySelector('.swatch-name');
  const colorEl = wrap.querySelector('.swatch');
  const valueEl = wrap.querySelector('.swatch-value');
  if (!nameEl || !colorEl || !valueEl || !(colorEl instanceof HTMLElement)) return;

  nameEl.textContent = name;

  const pickerActive = colorEl.classList.contains('hct-picker-open');
  const interactionActive = colorEl.classList.contains('swatch-interactive')
    && colorEl._interaction
    && colorEl._interaction.level !== 0;

  if (!pickerActive && !interactionActive) {
    setSwatchFaceColor(colorEl, hex);
    if (colorEl._currentHex !== undefined) {
      colorEl._currentHex = hex;
    }
  }

  if (colorEl._interaction && data && typeof data.tone === 'number') {
    colorEl._interaction.restHex = hex;
    colorEl._interaction.hue = data.hue ?? 0;
    colorEl._interaction.chroma = data.chroma ?? 0;
    colorEl._interaction.tone = data.tone;
    if (colorEl._interaction.level !== 0) {
      const bgTone = hexToHct(colorEl._interaction.getBgHex()).tone;
      const next = colorAtInteractionState(
        {
          hue: colorEl._interaction.hue,
          chroma: colorEl._interaction.chroma,
          tone: colorEl._interaction.tone,
        },
        bgTone,
        colorEl._interaction.getStates(),
        colorEl._interaction.level,
      );
      setSwatchFaceColor(colorEl, next.hex);
    }
  }

  const valueText = formatSwatchValue(data, valueFormat);
  valueEl.textContent = valueText;

  const isEditable = colorEl.classList.contains('swatch-editable');
  const isInteractive = colorEl.classList.contains('swatch-interactive');
  colorEl.title = isEditable
    ? `${name}: ${hex}\nKlikni pro změnu barvy`
    : isInteractive
      ? `${name}: ${hex}\nHover = state1, pressed = state2`
      : valueText ? `${name}: ${hex}\n${valueText}` : `${name}: ${hex}`;
}

/**
 * Playground default: interaction `bgTone` from key min (page surface).
 * Production callers should pass the tone of whatever sits behind the color.
 * @param {string} previewId
 * @returns {{
 *   mode: 'lm' | 'dm',
 *   getBgHex: () => string,
 *   getStates: () => import('../src/color-engine.js').InteractionStatesConfig,
 * } | null}
 */
function getInteractionForPreview(previewId) {
  const mode = getTextMode(previewId);
  if (previewId.startsWith('key-') || previewId.startsWith('custom-')) {
    return {
      mode,
      // Demo underlay = step 0; engine accepts any bg hex → tone.
      getBgHex: () => state.keyPalette[mode].min,
      getStates: () => {
        if (!state.keyPalette[mode].states) {
          state.keyPalette[mode].states = createDefaultInteractionStates();
        }
        return state.keyPalette[mode].states;
      },
    };
  }
  return null;
}

/**
 * @param {string} previewId
 * @param {object} paletteResult
 * @param {number[]} steps
 * @param {number} endStep
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 * @param {object} [editOptions]
 */
function replacePreviewRow(previewId, paletteResult, steps, endStep, valueFormat, editOptions = null) {
  const existing = app.querySelector(`[data-preview="${previewId}"]`);
  if (!existing) return;
  const textMode = getTextMode(previewId);
  const row = createSwatchRow(
    paletteResult,
    steps,
    endStep,
    valueFormat,
    editOptions,
    textMode,
    getInteractionForPreview(previewId),
  );
  row.dataset.preview = previewId;
  existing.replaceWith(row);
}

/**
 * Single factory for every compact number field (Steps, slider values, …).
 * Uses type=text + inputmode so Chrome cannot apply native number-field height.
 * @param {{ id?: string, value: number, min?: number, max?: number, step?: number, ariaLabel?: string, controlKey?: string | null }} opts
 */
function createUiNumberInput(opts) {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.className = 'ui-control ui-control--number';
  if (opts.id) input.id = opts.id;
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  if (opts.step !== undefined) input.step = String(opts.step);
  input.value = String(opts.value);
  if (opts.ariaLabel) input.setAttribute('aria-label', opts.ariaLabel);
  if (opts.controlKey) input.dataset.chromaControl = opts.controlKey;
  return input;
}

/**
 * Hug-to-content width for Steps fields (min 3 monospace chars).
 * Uses value when set, otherwise placeholder (default key grid).
 * @param {HTMLInputElement} input
 */
function syncHugInputWidth(input) {
  const text = input.value || input.placeholder || '';
  const len = Math.max(3, text.length);
  input.style.width = `calc(${len}ch + 2 * var(--ui-control-px) + 2px)`;
}

function createStepCountControl() {
  const group = document.createElement('div');
  group.className = 'control-group steps-control';

  const label = document.createElement('label');
  label.htmlFor = 'step-count-input';
  label.textContent = 'Steps';
  group.appendChild(label);

  const input = createUiNumberInput({
    id: 'step-count-input',
    value: state.stepCount,
    min: 1,
    step: 1,
    ariaLabel: 'Steps',
  });
  input.classList.remove('ui-control--number');
  input.classList.add('ui-control--hug');
  syncHugInputWidth(input);
  input.addEventListener('input', () => syncHugInputWidth(input));
  input.addEventListener('change', () => {
    const value = Math.max(1, Math.round(Number(input.value)) || 1);
    input.value = String(value);
    syncHugInputWidth(input);
    if (value === state.stepCount) return;
    state.stepCount = value;
    normalizeStateForStepCount(state);
    reapplyBrandPerfectFitAfterStepCountChange();
    render();
  });
  group.appendChild(input);
  return group;
}

/**
 * Power-user whitelist of published grid steps for a custom palette.
 * Default (`includeSteps === null`): empty value + muted placeholder = key `stepCount`.
 * Clear → back to default (full key grid published).
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {number[]} gridSteps
 */
function createIncludeStepsControl(palette, gridSteps) {
  const group = document.createElement('div');
  group.className = 'control-group steps-control include-steps-control';

  const inputId = `include-steps-${palette.id}`;
  const label = document.createElement('label');
  label.htmlFor = inputId;
  label.textContent = 'Steps';
  group.appendChild(label);

  const defaultPlaceholder = String(state.stepCount);
  const input = document.createElement('input');
  input.type = 'text';
  input.id = inputId;
  input.className = 'ui-control ui-control--hug';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Published steps');
  input.placeholder = defaultPlaceholder;
  if (palette.includeSteps == null) {
    input.value = '';
  } else {
    input.value = formatIncludeSteps(resolveIncludeSteps(palette.includeSteps, gridSteps));
  }
  syncHugInputWidth(input);

  const commit = () => {
    const raw = input.value.trim();
    if (!raw) {
      palette.includeSteps = null;
      input.value = '';
      input.placeholder = defaultPlaceholder;
      syncHugInputWidth(input);
      render();
      return;
    }

    const next = normalizeIncludeSteps(
      parseIncludeStepsInput(raw, gridSteps),
      gridSteps,
    );
    palette.includeSteps = next;
    if (next == null) {
      input.value = '';
      input.placeholder = defaultPlaceholder;
    } else {
      input.value = formatIncludeSteps(next);
      if (isSingleIncludeStep(next, gridSteps)) {
        collapseParamsForSingleIncludeStep(palette, gridSteps);
      }
    }
    syncHugInputWidth(input);
    render();
  };

  input.addEventListener('input', () => syncHugInputWidth(input));
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });

  group.appendChild(input);
  return group;
}

/**
 * @param {HTMLElement} fs
 * @param {HTMLElement | string} titleContent
 * @param {HTMLElement} [headerAction]
 */
function wrapPaletteFieldset(fs, titleContent, headerAction = null) {
  const wrap = document.createElement('div');
  wrap.className = 'palette-fieldset-wrap';

  const header = document.createElement('div');
  header.className = 'palette-fieldset-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'palette-fieldset-title';

  if (typeof titleContent === 'string') {
    const span = document.createElement('span');
    span.className = 'palette-name-text';
    span.textContent = titleContent;
    titleEl.appendChild(span);
  } else {
    titleEl.appendChild(titleContent);
  }

  header.appendChild(titleEl);
  if (headerAction) {
    header.appendChild(headerAction);
  }

  wrap.appendChild(header);
  wrap.appendChild(fs);
  return wrap;
}

/**
 * @param {object} keyResults
 * @param {number[]} steps
 * @param {number} endStep
 * @param {Set<string>} [expandedParamGroups]
 */
function createKeyPaletteFieldset(keyResults, steps, endStep, expandedParamGroups = new Set()) {
  const fs = document.createElement('fieldset');
  fs.className = 'key-palette-fieldset';

  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    const config = state.keyPalette[mode];
    if (!config.states) {
      config.states = createDefaultInteractionStates();
    }
    const paletteResult = keyResults[mode];
    const isDm = mode === 'dm';

    const segment = document.createElement('div');
    segment.className = 'palette-mode-segment';
    segment.dataset.mode = mode;

    const label = document.createElement('div');
    label.className = 'mode-label';
    label.dataset.mode = mode;
    label.textContent = formatPaletteModeLabel(KEY_PALETTE_NAME, mode);
    segment.appendChild(label);

    const swatchRow = createSwatchRow(paletteResult, steps, endStep, 'tone', {
      minMemoryKey: `key-${mode}:min`,
      maxMemoryKey: `key-${mode}:max`,
      onMinChange: (hex) => {
        config.min = hex;
        onThemeSurfaceColorChange();
        scheduleRefreshPreviews();
      },
      onMaxChange: (hex) => {
        config.max = hex;
        scheduleRefreshPreviews();
      },
    }, mode, {
      mode,
      getBgHex: () => state.keyPalette[mode].min,
      getStates: () => state.keyPalette[mode].states,
    });
    swatchRow.dataset.preview = `key-${mode}`;
    segment.appendChild(swatchRow);

    segment.appendChild(createKeyPaletteControls(config, endStep, isDm));
    segment.appendChild(createStatesDeltaGroup(config, mode, expandedParamGroups));
    fs.appendChild(segment);
  }

  return wrapPaletteFieldset(fs, createKeyPaletteTitle(), createStepCountControl());
}

/**
 * key-palette label + brand color controls (inline next to title).
 */
function createKeyPaletteTitle() {
  const title = document.createElement('div');
  title.className = 'key-palette-title-row';

  const name = document.createElement('span');
  name.className = 'palette-name-text';
  name.textContent = KEY_PALETTE_NAME;
  title.appendChild(name);
  title.appendChild(createBrandColorControl());
  return title;
}

/**
 * Brand hex input + Perfect fit toggle (GUI-only link; engine applyBrandColor).
 */
function createBrandColorControl() {
  const group = document.createElement('div');
  group.className = 'control-group steps-control brand-color-control';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ui-control ui-control--brand-hex';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'brand color';
  input.setAttribute('aria-label', 'Brand color');
  input.value = brandLink?.hex ?? '';

  const commit = () => {
    const raw = input.value.trim();
    if (!raw) {
      brandLink = null;
      input.value = '';
      return;
    }
    const hex = parseBrandHex(raw);
    if (!hex) {
      input.value = brandLink?.hex ?? '';
      return;
    }
    try {
      const result = applyBrandColor(state, hex, {
        perfectFit: brandPerfectFit,
        paletteId: brandLink?.paletteId,
      });
      brandLink = { hex: result.hex, paletteId: result.paletteId };
      input.value = result.hex;
      render();
    } catch {
      input.value = brandLink?.hex ?? '';
    }
  };

  input.addEventListener('change', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    }
  });

  const toggleRow = document.createElement('label');
  toggleRow.className = 'checkbox-row brand-perfect-fit';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = brandPerfectFit;
  toggle.addEventListener('change', () => {
    brandPerfectFit = toggle.checked;
    if (!brandLink) return;
    try {
      const result = applyBrandColor(state, brandLink.hex, {
        perfectFit: brandPerfectFit,
        paletteId: brandLink.paletteId,
      });
      brandLink = { hex: result.hex, paletteId: result.paletteId };
      render();
    } catch {
      /* keep link */
    }
  });
  toggleRow.appendChild(toggle);
  toggleRow.appendChild(document.createTextNode(' Perfect fit'));

  group.appendChild(input);
  group.appendChild(toggleRow);
  return group;
}

/**
 * @param {import('../src/color-engine.js').KeyPaletteConfig} config
 * @param {'lm' | 'dm'} mode
 * @param {Set<string>} expandedParamGroups
 */
function createStatesDeltaGroup(config, mode, expandedParamGroups) {
  if (!config.states) {
    config.states = createDefaultInteractionStates();
  }
  const states = config.states;
  if (typeof states.relativeChroma !== 'boolean') {
    states.relativeChroma = true;
  }
  const groupKey = `key:${mode}:states`;
  const isExpanded = expandedParamGroups.has(groupKey);

  const group = document.createElement('div');
  group.className = `param-settings-group${isExpanded ? '' : ' is-collapsed'}`;
  group.dataset.groupKey = groupKey;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'ui-ghost param-settings-toggle';
  toggleBtn.setAttribute('aria-expanded', String(isExpanded));

  const chevron = document.createElement('span');
  chevron.className = 'param-settings-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  const titleText = document.createElement('span');
  titleText.textContent = `States delta (${mode.toUpperCase()})`;

  toggleBtn.appendChild(chevron);
  toggleBtn.appendChild(titleText);
  toggleBtn.addEventListener('click', () => {
    group.classList.toggle('is-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!group.classList.contains('is-collapsed')));
  });
  group.appendChild(toggleBtn);

  const body = document.createElement('div');
  body.className = 'param-settings-body states-delta-body';

  const relativeRow = document.createElement('label');
  relativeRow.className = 'checkbox-row';
  const relativeCb = document.createElement('input');
  relativeCb.type = 'checkbox';
  relativeCb.checked = states.relativeChroma !== false;
  relativeCb.addEventListener('change', () => {
    states.relativeChroma = relativeCb.checked;
    scheduleRefreshPreviews();
  });
  relativeRow.appendChild(relativeCb);
  relativeRow.appendChild(document.createTextNode(' Relative Chroma'));
  body.appendChild(relativeRow);

  const row = document.createElement('div');
  row.className = 'control-row';

  row.appendChild(createSliderControl('Delta min (near bg)', states.deltaMin, 0, 40, (v) => {
    states.deltaMin = v;
    if (states.deltaMax < states.deltaMin) states.deltaMax = states.deltaMin;
    scheduleRefreshPreviews();
  }));

  row.appendChild(createSliderControl('Delta max (far from bg)', states.deltaMax, 0, 40, (v) => {
    states.deltaMax = v;
    if (states.deltaMin > states.deltaMax) states.deltaMin = states.deltaMax;
    scheduleRefreshPreviews();
  }));

  row.appendChild(createSliderControl('State2 scale (pressed)', states.state2Scale, 1, 4, (v) => {
    states.state2Scale = v;
    scheduleRefreshPreviews();
  }, { step: 0.1 }));

  body.appendChild(row);

  group.appendChild(body);
  return group;
}

/**
 * @param {object} config
 * @param {number} endStep
 * @param {boolean} isDm
 */
function createKeyPaletteControls(config, endStep, isDm) {
  const controls = document.createElement('div');
  controls.className = 'controls key-palette-controls';

  const row1 = document.createElement('div');
  row1.className = 'control-row';

  row1.appendChild(createToneControl('start (10)', config.start.tone, (v) => {
    config.start.tone = v;
    if (!isDm) clearBrandLink();
    scheduleRefreshPreviews();
  }));

  row1.appendChild(createToneControl(`end (${endStep})`, config.end.tone, (v) => {
    config.end.tone = v;
    if (!isDm) clearBrandLink();
    scheduleRefreshPreviews();
  }));

  controls.appendChild(row1);

  const bezierLabel = isDm ? 'key-dm-tone-interpolator' : 'key-tone-interpolator';
  const bezierRow = document.createElement('div');
  bezierRow.className = 'control-group';

  const bezierTitle = document.createElement('label');
  bezierTitle.textContent = bezierLabel;
  bezierRow.appendChild(bezierTitle);

  if (isDm) {
    const overrideRow = document.createElement('label');
    overrideRow.className = 'checkbox-row';
    const overrideCb = document.createElement('input');
    overrideCb.type = 'checkbox';
    overrideCb.checked = config.interpolatorOverride;
    overrideCb.addEventListener('change', () => {
      config.interpolatorOverride = overrideCb.checked;
      if (!config.interpolatorOverride) {
        config.interpolator = invertBezier(state.keyPalette.lm.interpolator);
      }
      render();
    });
    overrideRow.appendChild(overrideCb);
    overrideRow.appendChild(document.createTextNode(' Manual override'));
    bezierRow.appendChild(overrideRow);
  }

  const bezier = isDm && !config.interpolatorOverride
    ? invertBezier(state.keyPalette.lm.interpolator)
    : config.interpolator;

  const bezierInputs = createBezierInputs(bezier, (newBezier) => {
    if (isDm) {
      config.interpolatorOverride = true;
      config.interpolator = newBezier;
    } else {
      config.interpolator = newBezier;
      clearBrandLink();
      if (!state.keyPalette.dm.interpolatorOverride) {
        state.keyPalette.dm.interpolator = invertBezier(newBezier);
      }
    }
    refreshPreviews();
  }, isDm && !config.interpolatorOverride);

  if (isDm && !config.interpolatorOverride) {
    bezierInputs.dataset.dmAutoInterpolator = '';
  }
  bezierRow.appendChild(bezierInputs);

  controls.appendChild(bezierRow);
  return controls;
}

function formatPaletteModeLabel(name, mode) {
  return mode === 'dm' ? `${name}-dm` : name;
}

function updatePaletteNameLabels(root, name) {
  const tokenName = sanitizePaletteName(name);

  root.querySelectorAll('.mode-label[data-mode]').forEach((el) => {
    el.textContent = formatPaletteModeLabel(tokenName, el.dataset.mode);
  });

  root.querySelectorAll('.interp-segment-title[data-name-suffix]').forEach((el) => {
    const segNum = el.dataset.segNum;
    const prefix = `${tokenName}${el.dataset.nameSuffix}${segNum ? `-${segNum}` : ''}`;
    el.textContent = `${prefix} (${el.dataset.from}→${el.dataset.to})`;
  });
}

/**
 * @param {HTMLInputElement} titleInput
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {HTMLElement} fs
 */
function commitPaletteNameInput(titleInput, palette, fs) {
  const next = sanitizePaletteName(titleInput.value);
  titleInput.value = next;
  palette.name = next;
  updatePaletteNameLabels(fs, next);
  scheduleRefreshPreviews();
}

function createCustomPaletteFieldset(palette, keyResults, steps, endStep, expandedParamGroups = new Set()) {
  const fs = document.createElement('fieldset');
  fs.className = 'custom-palette-fieldset';
  fs.dataset.paletteId = palette.id;

  palette.name = sanitizePaletteName(palette.name);
  if (palette.includeSteps === undefined) {
    palette.includeSteps = null;
  }

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'ui-ghost palette-name-input';
  titleInput.value = palette.name;
  titleInput.spellcheck = false;
  titleInput.autocapitalize = 'off';
  titleInput.setAttribute('aria-label', 'Palette name');
  titleInput.addEventListener('input', () => {
    const filtered = filterPaletteNameInput(titleInput.value);
    if (titleInput.value !== filtered) {
      titleInput.value = filtered;
    }
    palette.name = filtered;
    updatePaletteNameLabels(fs, filtered);
    scheduleRefreshPreviews();
  });
  titleInput.addEventListener('blur', () => {
    commitPaletteNameInput(titleInput, palette, fs);
  });
  titleInput.addEventListener('change', () => {
    commitPaletteNameInput(titleInput, palette, fs);
  });

  const tokenName = palette.name;
  const publishedSteps = resolveIncludeSteps(palette.includeSteps, steps);
  const singleStep = isSingleIncludeStep(palette.includeSteps, steps)
    ? publishedSteps[0]
    : null;

  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    const keyResult = keyResults[mode];
    const customResult = generateCustomPaletteForMode(palette, mode, keyResult, steps);
    const modeLabel = formatPaletteModeLabel(tokenName, mode);
    const suffix = mode === 'dm' ? '-dm' : '';

    const segment = document.createElement('div');
    segment.className = 'palette-mode-segment';
    segment.dataset.mode = mode;

    const label = document.createElement('div');
    label.className = 'mode-label';
    label.dataset.mode = mode;
    label.textContent = modeLabel;
    segment.appendChild(label);

    const swatchRow = createSwatchRow(customResult, publishedSteps, endStep, 'hc', null, mode, {
      mode,
      getBgHex: () => state.keyPalette[mode].min,
      getStates: () => {
        if (!state.keyPalette[mode].states) {
          state.keyPalette[mode].states = createDefaultInteractionStates();
        }
        return state.keyPalette[mode].states;
      },
    });
    swatchRow.dataset.preview = `custom-${palette.id}-${mode}`;
    segment.appendChild(swatchRow);

    segment.appendChild(createModeParamGroup(
      palette,
      mode,
      keyResult,
      steps,
      endStep,
      tokenName,
      suffix,
      () => render(),
      expandedParamGroups,
      singleStep,
    ));

    fs.appendChild(segment);
  }

  const actions = document.createElement('div');
  actions.className = 'palette-header-actions';

  actions.appendChild(createIncludeStepsControl(palette, steps));

  const index = state.customPalettes.findIndex((p) => p.id === palette.id);
  const count = state.customPalettes.length;

  if (count > 1 && index > 0) {
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'ui-btn add-palette-btn palette-header-action';
    upBtn.textContent = '↑';
    upBtn.setAttribute('aria-label', 'Move palette up');
    upBtn.addEventListener('click', () => {
      if (moveCustomPalette(state, palette.id, -1)) render();
    });
    actions.appendChild(upBtn);
  }

  if (count > 1 && index >= 0 && index < count - 1) {
    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'ui-btn add-palette-btn palette-header-action';
    downBtn.textContent = '↓';
    downBtn.setAttribute('aria-label', 'Move palette down');
    downBtn.addEventListener('click', () => {
      if (moveCustomPalette(state, palette.id, 1)) render();
    });
    actions.appendChild(downBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'ui-btn danger palette-header-action custom-palette-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    if (brandLink?.paletteId === palette.id) clearBrandLink();
    state.customPalettes = state.customPalettes.filter((p) => p.id !== palette.id);
    render();
  });
  actions.appendChild(removeBtn);

  return wrapPaletteFieldset(fs, titleInput, actions);
}

/**
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {ReturnType<typeof generateKeyPalettes>['lm']} keyResult
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} safeName
 * @param {string} suffix
 * @param {() => void} onUpdate
 * @param {Set<string>} [expandedParamGroups]
 * @param {number | null} [singlePublishedStep]
 */
function createModeParamGroup(palette, mode, keyResult, steps, endStep, safeName, suffix, onUpdate, expandedParamGroups = new Set(), singlePublishedStep = null) {
  if (singlePublishedStep != null) {
    applyRelativeFixedChromaAtStep(
      palette[mode].chroma,
      palette[mode].hue,
      keyResult,
      steps,
      singlePublishedStep,
    );
  } else {
    applyRelativeChromaParam(palette[mode].chroma, palette[mode].hue, keyResult, steps);
    clampChromaParamValues(palette[mode].chroma, palette[mode].hue, keyResult, steps);
  }

  const group = document.createElement('div');
  const groupKey = `${palette.id}:${mode}`;
  const isExpanded = expandedParamGroups.has(groupKey);
  group.className = `param-settings-group${isExpanded ? '' : ' is-collapsed'}`;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'ui-ghost param-settings-toggle';
  toggleBtn.setAttribute('aria-expanded', String(isExpanded));

  const chevron = document.createElement('span');
  chevron.className = 'param-settings-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  const titleText = document.createElement('span');
  titleText.textContent = `Hue & Chroma (${mode.toUpperCase()})`;

  toggleBtn.appendChild(chevron);
  toggleBtn.appendChild(titleText);
  toggleBtn.addEventListener('click', () => {
    group.classList.toggle('is-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!group.classList.contains('is-collapsed')));
  });
  group.appendChild(toggleBtn);

  const body = document.createElement('div');
  body.className = 'param-settings-body';

  const chromaCtx = {
    palette,
    mode,
    keyResult,
    steps,
    singlePublishedStep,
  };

  const onParamTouch = () => {
    if (brandLink && palette.id === brandLink.paletteId && mode === 'lm') {
      clearBrandLink();
    }
  };

  for (const paramName of /** @type {const} */ (['hue', 'chroma'])) {
    const max = paramName === 'hue' ? 360 : CHROMA_MAX;
    const paramLabel = `${paramName.charAt(0).toUpperCase() + paramName.slice(1)} (${mode.toUpperCase()})`;
    body.appendChild(createParamSection(
      palette[mode][paramName],
      steps,
      endStep,
      paramLabel,
      `${safeName}${suffix}-${paramName}-interpolator`,
      max,
      onUpdate,
      `${suffix}-${paramName}-interpolator`,
      paramName === 'chroma' ? chromaCtx : null,
      singlePublishedStep,
      onParamTouch,
    ));
  }

  group.appendChild(body);
  return group;
}

/**
 * @param {import('../src/color-engine.js').ParamConfig} param
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} label
 * @param {string} interpolatorPrefix
 * @param {number} max
 * @param {() => void} onUpdate
 * @param {string} nameSuffix
 * @param {{ palette: ReturnType<typeof createCustomPalette>, mode: 'lm' | 'dm', keyResult: ReturnType<typeof generateKeyPalettes>['lm'], steps: number[], singlePublishedStep?: number | null } | null} [chromaCtx]
 * @param {number | null} [singlePublishedStep]
 * @param {(() => void) | null} [onParamTouch]
 */
function createParamSection(param, steps, endStep, label, interpolatorPrefix, max, onUpdate, nameSuffix, chromaCtx = null, singlePublishedStep = null, onParamTouch = null) {
  const section = document.createElement('div');
  section.className = 'param-section';

  const header = document.createElement('div');
  header.className = 'param-section-header';

  const title = document.createElement('h4');
  title.className = 'param-section-title';
  title.textContent = label;
  header.appendChild(title);

  const forceSingle = singlePublishedStep != null;
  const touch = () => onParamTouch?.();

  if (!forceSingle) {
    const toggleRow = document.createElement('label');
    toggleRow.className = 'checkbox-row';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = param.mode === 'interpolate';
    toggle.addEventListener('change', () => {
      touch();
      if (toggle.checked) {
        const val = param.mode === 'fixed' ? param.value : 0;
        Object.assign(param, createInterpolateParam(10, val, endStep, val));
        if (chromaCtx) {
          const { steps: liveSteps, keyResult } = getLiveKeyResult(chromaCtx.mode);
          applyRelativeChromaParam(param, chromaCtx.palette[chromaCtx.mode].hue, keyResult, liveSteps);
          clampChromaParamValues(param, chromaCtx.palette[chromaCtx.mode].hue, keyResult, liveSteps);
        }
        const group = section.closest('.param-settings-group');
        if (group) {
          group.classList.remove('is-collapsed');
          group.querySelector('.param-settings-toggle')?.setAttribute('aria-expanded', 'true');
        }
      } else {
        const val = param.mode === 'interpolate'
          ? param.points[0]?.value ?? 0
          : param.value;
        Object.assign(param, createFixedParam(val));
        if (chromaCtx) {
          const { steps: liveSteps, keyResult } = getLiveKeyResult(chromaCtx.mode);
          clampChromaParamValues(param, chromaCtx.palette[chromaCtx.mode].hue, keyResult, liveSteps);
        }
      }
      onUpdate();
    });
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(document.createTextNode(' Interpolate'));
    header.appendChild(toggleRow);

    if (chromaCtx && param.mode === 'interpolate') {
      const clampRow = document.createElement('label');
      clampRow.className = 'checkbox-row';
      const clampToggle = document.createElement('input');
      clampToggle.type = 'checkbox';
      clampToggle.checked = isClampInterpolatedChroma(param);
      clampToggle.addEventListener('change', () => {
        touch();
        if (clampToggle.checked) {
          delete /** @type {Record<string, unknown>} */ (param).clampInterpolatedChroma;
          const { steps: liveSteps, keyResult } = getLiveKeyResult(chromaCtx.mode);
          applyRelativeChromaParam(param, chromaCtx.palette[chromaCtx.mode].hue, keyResult, liveSteps);
          clampChromaParamValues(param, chromaCtx.palette[chromaCtx.mode].hue, keyResult, liveSteps);
        } else {
          param.clampInterpolatedChroma = false;
          for (const point of param.points) {
            delete point.ratio;
            delete point.gamutLimit;
          }
        }
        onUpdate();
      });
      clampRow.appendChild(clampToggle);
      clampRow.appendChild(document.createTextNode(' Clamp interpolated chroma'));
      header.appendChild(clampRow);
    }
  }

  section.appendChild(header);

  if (forceSingle) {
    if (param.mode !== 'fixed') {
      const val = param.mode === 'interpolate' ? (param.points[0]?.value ?? 0) : 0;
      Object.assign(param, createFixedParam(val));
      delete /** @type {Record<string, unknown>} */ (param).points;
      delete /** @type {Record<string, unknown>} */ (param).interpolators;
    }
    if (chromaCtx && singlePublishedStep != null) {
      section.appendChild(createChromaSingleStepSlider(
        param,
        chromaCtx.palette,
        chromaCtx.mode,
        singlePublishedStep,
        max,
        touch,
      ));
    } else {
      section.appendChild(createSliderControl('Value', param.value, 0, max, (v) => {
        touch();
        param.value = v;
        scheduleRefreshPreviews();
      }));
    }
  } else if (param.mode === 'fixed') {
    if (chromaCtx) {
      section.appendChild(createChromaFixedSlider(
        param,
        chromaCtx.palette,
        chromaCtx.mode,
        max,
        touch,
      ));
    } else {
      section.appendChild(createSliderControl('Value', param.value, 0, max, (v) => {
        touch();
        param.value = v;
        scheduleRefreshPreviews();
      }));
    }
  } else {
    section.appendChild(createInterpControls(param, steps, endStep, interpolatorPrefix, max, onUpdate, nameSuffix, chromaCtx, touch));
  }

  return section;
}

/**
 * @param {import('../src/color-engine.js').ParamConfig} param
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} prefix
 * @param {number} max
 * @param {() => void} onUpdate
 * @param {string} nameSuffix
 * @param {{ palette: ReturnType<typeof createCustomPalette>, mode: 'lm' | 'dm', keyResult: ReturnType<typeof generateKeyPalettes>['lm'], steps: number[] } | null} [chromaCtx]
 * @param {(() => void) | null} [onParamTouch]
 */
function createInterpControls(param, steps, endStep, prefix, max, onUpdate, nameSuffix, chromaCtx = null, onParamTouch = null) {
  const container = document.createElement('div');
  const touch = () => onParamTouch?.();

  const pointsWrap = document.createElement('div');
  pointsWrap.className = 'interp-points';

  param.points.sort((a, b) => a.step - b.step);

  for (let i = 0; i < param.points.length; i++) {
    const point = param.points[i];
    const isEndpoint = i === 0 || i === param.points.length - 1;

    const row = document.createElement('div');
    row.className = 'interp-point';

    const fields = document.createElement('div');
    fields.className = 'interp-point-fields';

    fields.appendChild(createStepSelect('Step', point.step, steps, isEndpoint, (step) => {
      touch();
      point.step = step;
      if (chromaCtx) {
        const limit = liveChromaLimitAtStep(chromaCtx.palette, chromaCtx.mode, point.step);
        const clampOn = isClampInterpolatedChroma(param);
        if (clampOn) {
          if (typeof point.ratio === 'number' && Number.isFinite(point.ratio)) {
            lockChromaPointRatio(point, Math.round(point.ratio * limit), limit);
          } else {
            lockChromaPointRatio(point, point.value, limit);
          }
        }
      }
      param.points.sort((a, b) => a.step - b.step);
      onUpdate();
    }));

    if (chromaCtx) {
      fields.appendChild(createChromaPointSlider(
        point,
        chromaCtx.palette,
        chromaCtx.mode,
        i,
        max,
        touch,
        isClampInterpolatedChroma(param),
      ));
    } else {
      fields.appendChild(createSliderControl('Value', point.value, 0, max, (v) => {
        touch();
        point.value = v;
        scheduleRefreshPreviews();
      }));
    }

    row.appendChild(fields);

    if (!isEndpoint) {
      row.classList.add('interp-point--with-remove');
      const action = document.createElement('div');
      action.className = 'interp-point-action';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'interp-point-remove';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remove point');
      removeBtn.addEventListener('click', () => {
        touch();
        param.points.splice(i, 1);
        param.interpolators.splice(i - 1, 1);
        onUpdate();
      });
      action.appendChild(removeBtn);
      row.appendChild(action);
    }

    pointsWrap.appendChild(row);

    if (i < param.points.length - 1) {
      const p0 = param.points[i];
      const p1 = param.points[i + 1];
      const segWrap = document.createElement('div');
      segWrap.className = 'interp-segment-wrap';

      const seg = document.createElement('div');
      seg.className = 'interp-segment';

      const segTitle = document.createElement('div');
      segTitle.className = 'interp-segment-title';
      const segNum = param.points.length > 2 ? String(i + 1) : '';
      segTitle.dataset.nameSuffix = nameSuffix;
      segTitle.dataset.segNum = segNum;
      segTitle.dataset.from = String(p0.step);
      segTitle.dataset.to = String(p1.step);
      segTitle.textContent = `${prefix}${segNum ? `-${segNum}` : ''} (${p0.step}→${p1.step})`;
      seg.appendChild(segTitle);

      if (!param.interpolators[i]) {
        param.interpolators[i] = [...LINEAR_BEZIER];
      }

      seg.appendChild(createBezierInputs(param.interpolators[i], (bez) => {
        touch();
        param.interpolators[i] = bez;
        scheduleRefreshPreviews();
      }));
      segWrap.appendChild(seg);
      pointsWrap.appendChild(segWrap);
    }
  }

  container.appendChild(pointsWrap);

  const addRow = document.createElement('div');
  addRow.className = 'interp-add-row';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'palette-header-action';
  addBtn.textContent = '+ Add point';
  addBtn.addEventListener('click', () => {
    touch();
    const usedSteps = new Set(param.points.map((p) => p.step));
    const available = steps.filter((s) => !usedSteps.has(s));
    if (available.length === 0) return;

    const midIdx = Math.floor(available.length / 2);
    const newStep = available[midIdx];
    const insertIdx = param.points.findIndex((p) => p.step > newStep);
    const idx = insertIdx === -1 ? param.points.length - 1 : insertIdx;

    const prev = param.points[idx - 1];
    const next = param.points[idx];
    let newVal = Math.round((prev.value + next.value) / 2);
    if (chromaCtx && isClampInterpolatedChroma(param)) {
      newVal = Math.min(
        newVal,
        liveChromaLimitAtStep(chromaCtx.palette, chromaCtx.mode, newStep),
      );
    }

    /** @type {{ step: number, value: number, ratio?: number, gamutLimit?: number }} */
    const newPoint = { step: newStep, value: newVal };
    if (chromaCtx && isClampInterpolatedChroma(param)) {
      lockChromaPointRatio(
        newPoint,
        newVal,
        liveChromaLimitAtStep(chromaCtx.palette, chromaCtx.mode, newStep),
      );
    }
    param.points.splice(idx, 0, newPoint);
    param.interpolators.splice(idx - 1, 0, [...LINEAR_BEZIER]);
    onUpdate();
  });
  addRow.appendChild(addBtn);
  container.appendChild(addRow);

  return container;
}

/**
 * @param {object} paletteResult
 * @param {number[]} steps
 * @param {number} endStep
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 * @param {{
 *   onMinChange?: (hex: string) => void,
 *   onMaxChange?: (hex: string) => void,
 *   onEditDone?: () => void,
 *   minMemoryKey?: string,
 *   maxMemoryKey?: string,
 * }} [editOptions]
 * @param {'lm' | 'dm'} [textMode]
 * @param {{
 *   mode: 'lm' | 'dm',
 *   getBgHex: () => string,
 *   getStates: () => import('../src/color-engine.js').InteractionStatesConfig,
 * } | null} [interaction]
 */
function createSwatchRow(paletteResult, steps, endStep, valueFormat = 'tone', editOptions = null, textMode = 'lm', interaction = null) {
  const row = document.createElement('div');
  row.className = 'swatch-row';
  row.dataset.textMode = textMode;
  // Always size cells like the key palette grid (whitelist may show fewer swatches).
  row.style.setProperty('--swatch-cols', String(getSteps(state.stepCount).length + 2));

  row.appendChild(createSwatch('0', paletteResult.min, null, valueFormat, editOptions?.onMinChange
    ? {
      onChange: editOptions.onMinChange,
      onDone: editOptions.onEditDone,
      memoryKey: editOptions.minMemoryKey,
    }
    : null, null));

  for (const step of steps) {
    const data = paletteResult.steps[step];
    row.appendChild(createSwatch(
      String(step),
      data.hex,
      data,
      valueFormat,
      null,
      interaction,
    ));
  }

  row.appendChild(createSwatch(String(endStep + 10), paletteResult.max, null, valueFormat, editOptions?.onMaxChange
    ? {
      onChange: editOptions.onMaxChange,
      onDone: editOptions.onEditDone,
      memoryKey: editOptions.maxMemoryKey,
    }
    : null, null));

  return row;
}

/**
 * @param {string} name
 * @param {string} hex
 * @param {{ tone?: number, hue?: number, chroma?: number } | null} data
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 * @param {{ onChange: (hex: string) => void, onDone?: () => void, memoryKey?: string } | null} [editHandler]
 * @param {{
 *   mode: 'lm' | 'dm',
 *   getBgHex: () => string,
 *   getStates: () => import('../src/color-engine.js').InteractionStatesConfig,
 * } | null} [interaction]
 */
function createSwatch(name, hex, data, valueFormat, editHandler = null, interaction = null) {
  const wrap = document.createElement('div');
  wrap.className = 'swatch-wrap';

  const nameEl = document.createElement('div');
  nameEl.className = 'swatch-name';
  nameEl.textContent = name;
  wrap.appendChild(nameEl);

  const color = document.createElement('div');
  color.className = 'swatch';
  setSwatchFaceColor(color, hex);

  const valueText = formatSwatchValue(data, valueFormat);
  color.title = editHandler
    ? `${name}: ${hex}\nKlikni pro změnu barvy`
    : interaction
      ? `${name}: ${hex}\nHover = state1, pressed = state2`
      : valueText ? `${name}: ${hex}\n${valueText}` : `${name}: ${hex}`;

  const valueEl = document.createElement('div');
  valueEl.className = 'swatch-value';
  valueEl.textContent = valueText;
  color.appendChild(valueEl);

  if (editHandler) {
    attachSwatchColorEdit(color, hex, editHandler);
  } else if (interaction && data && typeof data.tone === 'number') {
    attachSwatchInteraction(color, {
      restHex: hex,
      hue: data.hue ?? 0,
      chroma: data.chroma ?? 0,
      tone: data.tone,
      getBgHex: interaction.getBgHex,
      getStates: interaction.getStates,
    });
  }

  wrap.appendChild(color);
  return wrap;
}

/**
 * Live state1 (hover) / state2 (pressed) preview on palette steps.
 * @param {HTMLElement} colorEl
 * @param {{
 *   restHex: string,
 *   hue: number,
 *   chroma: number,
 *   tone: number,
 *   getBgHex: () => string,
 *   getStates: () => import('../src/color-engine.js').InteractionStatesConfig,
 * }} opts
 */
function attachSwatchInteraction(colorEl, opts) {
  colorEl.classList.add('swatch-interactive');
  colorEl._interaction = {
    restHex: opts.restHex,
    hue: opts.hue,
    chroma: opts.chroma,
    tone: opts.tone,
    getBgHex: opts.getBgHex,
    getStates: opts.getStates,
    level: /** @type {0 | 1 | 2} */ (0),
  };

  const showLevel = (level) => {
    const ctx = colorEl._interaction;
    if (!ctx) return;
    ctx.level = level;
    if (level === 0) {
      setSwatchFaceColor(colorEl, ctx.restHex);
      return;
    }
    const bgTone = hexToHct(ctx.getBgHex()).tone;
    const next = colorAtInteractionState(
      { hue: ctx.hue, chroma: ctx.chroma, tone: ctx.tone },
      bgTone,
      ctx.getStates(),
      level,
    );
    setSwatchFaceColor(colorEl, next.hex);
  };

  colorEl.addEventListener('pointerenter', () => {
    if (colorEl._interaction?.level === 2) return;
    showLevel(1);
  });
  colorEl.addEventListener('pointerleave', () => showLevel(0));
  colorEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    showLevel(2);
  });
  colorEl.addEventListener('pointerup', () => {
    if (colorEl.matches(':hover')) showLevel(1);
    else showLevel(0);
  });
  colorEl.addEventListener('pointercancel', () => showLevel(0));
}

/**
 * @param {HTMLElement} colorEl
 * @param {string} initialHex
 * @param {{ onChange: (hex: string) => void, onDone?: () => void, memoryKey?: string }} handler
 */
function attachSwatchColorEdit(colorEl, initialHex, handler) {
  colorEl._currentHex = initialHex;
  colorEl.classList.add('swatch-editable');
  colorEl.tabIndex = 0;
  colorEl.setAttribute('role', 'button');
  colorEl.setAttribute('aria-label', 'Edit color (HCT)');

  const open = () => {
    openHctColorPicker(colorEl, colorEl._currentHex || initialHex, {
      onChange: (hex) => {
        colorEl._currentHex = hex;
        setSwatchFaceColor(colorEl, hex);
        handler.onChange(hex);
      },
      onDone: () => handler.onDone?.(),
      memoryKey: handler.memoryKey,
    });
  };

  colorEl.addEventListener('click', (e) => {
    e.stopPropagation();
    open();
  });
  colorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
}

/**
 * Snap near-neutrals to clean HCT (H=0, C=0).
 * Hex cannot store hue when chroma is ~0, so hex→HCT invents residual H/C —
 * treat small chroma as gray so reopen matches what the user set.
 * @param {string} hexIn
 * @returns {{ hue: number, chroma: number, tone: number, hex: string }}
 */
function normalizeHctFromHex(hexIn) {
  const parsed = hexToHct(hexIn);
  let { hue, chroma, tone } = parsed;

  if (tone >= 100) {
    tone = 100;
    chroma = 0;
    hue = 0;
  } else if (tone <= 0) {
    tone = 0;
    chroma = 0;
    hue = 0;
  } else {
    chroma = clampChroma(chroma, hue, tone);
    // Residual from encoding gray (e.g. C≈2, H≈209 for mid gray)
    if (chroma <= 4) {
      chroma = 0;
      hue = 0;
    }
  }

  return {
    hue,
    chroma,
    tone,
    hex: hctToHex(hue, chroma, tone),
  };
}

/**
 * Floating HCT color picker (replaces native HSL/RGB `<input type="color">`).
 * @param {HTMLElement} anchor
 * @param {string} initialHex
 * @param {{ onChange: (hex: string) => void, onDone?: () => void, memoryKey?: string }} handlers
 */
function openHctColorPicker(anchor, initialHex, handlers) {
  document.querySelector('.hct-picker-panel')?.remove();
  document.querySelectorAll('.hct-picker-open').forEach((el) => {
    el.classList.remove('hct-picker-open');
  });

  const memoryKey = handlers.memoryKey;
  const recalled = recallHctPicker(memoryKey, initialHex);

  let hue;
  let chroma;
  let tone;
  let hex;
  if (recalled) {
    hue = recalled.hue;
    chroma = recalled.chroma;
    tone = recalled.tone;
    // Keep the swatch hex from state; channels come from GUI memory.
    hex = String(initialHex).toLowerCase();
  } else {
    ({ hue, chroma, tone, hex } = normalizeHctFromHex(initialHex));
  }

  anchor.classList.add('hct-picker-open');

  const panel = document.createElement('div');
  panel.className = 'hct-picker-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'HCT color picker');

  const header = document.createElement('div');
  header.className = 'hct-picker-header';

  const title = document.createElement('span');
  title.className = 'hct-picker-title';
  title.textContent = 'HCT';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ui-btn danger easing-editor-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = `<svg class="easing-editor-close-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const previewRow = document.createElement('div');
  previewRow.className = 'hct-picker-preview-row';

  const preview = document.createElement('div');
  preview.className = 'hct-picker-preview';
  preview.style.background = hex;
  previewRow.appendChild(preview);

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'ui-control hct-picker-hex';
  hexInput.value = hex;
  hexInput.setAttribute('aria-label', 'Hex color');
  hexInput.spellcheck = false;
  previewRow.appendChild(hexInput);
  panel.appendChild(previewRow);

  /**
   * @param {string} label
   * @param {number} value
   * @param {number} min
   * @param {number} max
   * @param {(v: number) => void} onInput
   * @param {{ getMarkerMax?: () => number } | null} [chromaOpts]
   */
  const addChannel = (label, value, min, max, onInput, chromaOpts = null) => {
    const group = document.createElement('div');
    group.className = 'hct-picker-channel';

    const top = document.createElement('div');
    top.className = 'hct-picker-channel-top';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    top.appendChild(lbl);

    const num = createUiNumberInput({
      value,
      min,
      max,
      ariaLabel: label,
    });
    top.appendChild(num);
    group.appendChild(top);

    const wrap = document.createElement('div');
    wrap.className = 'chroma-slider-wrap hct-picker-slider-wrap';
    createSliderTrack(wrap);

    /** @type {HTMLElement | null} */
    let marker = null;
    if (chromaOpts?.getMarkerMax) {
      marker = createChromaMaxMarker('hct-picker-c');
      wrap.appendChild(marker);
    }

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.value = String(value);
    range.setAttribute('aria-label', label);
    attachRangePointerCapture(range);
    wrap.appendChild(range);
    group.appendChild(wrap);

    const syncVisual = () => {
      syncSliderVisuals(wrap, range);
      if (marker && chromaOpts?.getMarkerMax) {
        const peak = chromaOpts.getMarkerMax();
        if (peak <= 0) {
          marker.hidden = true;
        } else {
          marker.hidden = false;
          positionChromaMaxMarker(marker, range, peak);
        }
      }
    };

    const commit = (raw) => {
      let v = Math.round(Number(raw));
      if (!Number.isFinite(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      if (chromaOpts?.getMarkerMax) {
        v = Math.min(v, chromaOpts.getMarkerMax());
      }
      num.value = String(v);
      range.value = String(v);
      syncVisual();
      onInput(v);
    };

    num.addEventListener('change', () => commit(num.value));
    range.addEventListener('input', () => commit(range.value));
    panel.appendChild(group);

    return {
      setValue: (v) => {
        num.value = String(v);
        range.value = String(v);
        syncVisual();
      },
      syncVisual,
    };
  };

  /** @type {{ setValue: (v: number) => void, syncVisual: () => void } | null} */
  let hueUi = null;
  /** @type {{ setValue: (v: number) => void, syncVisual: () => void } | null} */
  let chromaUi = null;
  /** @type {{ setValue: (v: number) => void, syncVisual: () => void } | null} */
  let toneUi = null;

  /**
   * @param {{ silent?: boolean }} [opts]
   */
  const emit = (opts = {}) => {
    if (tone >= 100) {
      tone = 100;
      chroma = 0;
    } else if (tone <= 0) {
      tone = 0;
      chroma = 0;
    } else {
      chroma = clampChroma(chroma, hue, tone);
    }
    hex = hctToHex(hue, chroma, tone);
    preview.style.background = hex;
    if (document.activeElement !== hexInput) {
      hexInput.value = hex;
    }
    hueUi?.setValue(hue);
    toneUi?.setValue(tone);
    chromaUi?.setValue(chroma);
    rememberHctPicker(memoryKey, hue, chroma, tone, hex);
    if (!opts.silent) {
      handlers.onChange(hex);
    }
  };

  hueUi = addChannel('Hue', hue, 0, 360, (v) => {
    hue = v;
    emit();
  });

  chromaUi = addChannel('Chroma', chroma, 0, CHROMA_MAX, (v) => {
    chroma = v;
    emit();
  }, {
    getMarkerMax: () => (tone <= 0 || tone >= 100 ? 0 : maxChromaForHueTone(hue, tone)),
  });

  toneUi = addChannel('Tone', tone, 0, 100, (v) => {
    tone = v;
    emit();
  });

  hexInput.addEventListener('change', () => {
    const raw = hexInput.value.trim();
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    try {
      const next = normalizeHctFromHex(normalized);
      hue = next.hue;
      chroma = next.chroma;
      tone = next.tone;
      hueUi?.setValue(hue);
      toneUi?.setValue(tone);
      emit();
    } catch {
      hexInput.value = hex;
    }
  });

  // Drag panel by header (like easing editor)
  /** @type {{ ox: number, oy: number, left: number, top: number } | null} */
  let draggingPanel = null;

  const onPointerMove = (e) => {
    if (!draggingPanel) return;
    panel.style.left = `${draggingPanel.left + (e.clientX - draggingPanel.ox)}px`;
    panel.style.top = `${draggingPanel.top + (e.clientY - draggingPanel.oy)}px`;
  };

  const onPointerUp = () => {
    draggingPanel = null;
    panel.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  header.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    draggingPanel = {
      ox: e.clientX,
      oy: e.clientY,
      left: rect.left,
      top: rect.top,
    };
    panel.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });

  const placeNearAnchor = () => {
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 8;
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${top}px`;
    document.body.appendChild(panel);
    const panelRect = panel.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - panelRect.width - 8,
    );
    panel.style.left = `${left}px`;
    if (panelRect.bottom > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelRect.height - 8);
      panel.style.top = `${top}px`;
    }
  };

  const syncAllVisuals = () => {
    hueUi?.syncVisual();
    chromaUi?.syncVisual();
    toneUi?.syncVisual();
  };

  const close = () => {
    onPointerUp();
    panel.remove();
    anchor.classList.remove('hct-picker-open');
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onOutside, true);
    handlers.onDone?.();
  };

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };

  /** @param {PointerEvent} e */
  const onOutside = (e) => {
    if (e.target instanceof Node && !panel.contains(e.target) && !anchor.contains(e.target)) {
      close();
    }
  };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(() => {
    document.addEventListener('pointerdown', onOutside, true);
  });

  placeNearAnchor();
  if (recalled) {
    // Don't re-encode hex on open — keep state hex so memory stays valid.
    rememberHctPicker(memoryKey, hue, chroma, tone, hex);
  } else {
    emit({ silent: true });
  }
  // Layout must finish before measuring track width for fills / marker.
  requestAnimationFrame(() => {
    syncAllVisuals();
    requestAnimationFrame(syncAllVisuals);
  });
}

/**
 * @param {{ tone?: number, hue?: number, chroma?: number } | null} data
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 */
function formatSwatchValue(data, valueFormat) {
  if (!data) return '';

  switch (valueFormat) {
    case 'tone':
      return data.tone !== undefined ? `T: ${data.tone}` : '';
    case 'hue':
      return data.hue !== undefined ? `H: ${data.hue}` : '';
    case 'chroma':
      return data.chroma !== undefined ? `C: ${data.chroma}` : '';
    case 'hc':
      if (data.hue === undefined) return '';
      return `H: ${data.hue}\nC: ${data.chroma}`;
    default:
      return '';
  }
}

const RANGE_THUMB_PX = 12;

/**
 * Pixel position of range thumb center for a value.
 * @param {HTMLInputElement} range
 * @param {number} value
 */
function rangeThumbCenterPx(range, value) {
  const min = Number(range.min);
  const max = Number(range.max);
  const width = range.getBoundingClientRect().width;
  const travel = Math.max(0, width - RANGE_THUMB_PX);
  const t = max === min ? 0 : (value - min) / (max - min);
  return t * travel + RANGE_THUMB_PX / 2;
}

/**
 * @param {HTMLElement} marker
 * @param {HTMLInputElement} range
 * @param {number} value
 */
function positionChromaMaxMarker(marker, range, value) {
  const width = range.getBoundingClientRect().width;
  if (width <= 0) return;
  const centerPx = rangeThumbCenterPx(range, value);
  marker.style.left = `${(centerPx / width) * 100}%`;
  marker.title = `Max chroma: ${value}`;
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLInputElement} range
 */
function syncSliderVisuals(wrap, range) {
  const width = range.getBoundingClientRect().width;
  const fill = wrap.querySelector('.slider-track-fill');
  if (fill instanceof HTMLElement && width > 0) {
    fill.style.width = `${rangeThumbCenterPx(range, Number(range.value))}px`;
  }
}

/**
 * @param {HTMLElement} wrap
 * @param {HTMLInputElement} range
 * @param {string} [markerKey]
 * @param {(() => number) | null} [getMarkerMax]
 */
function attachSliderVisualSync(wrap, range, markerKey = null, getMarkerMax = null) {
  const sync = () => {
    syncSliderVisuals(wrap, range);
    if (markerKey && getMarkerMax) {
      const marker = wrap.querySelector(`[data-chroma-max-marker="${markerKey}"]`);
      if (marker instanceof HTMLElement) {
        positionChromaMaxMarker(marker, range, getMarkerMax());
      }
    }
  };
  sync();
  const ro = new ResizeObserver(sync);
  ro.observe(wrap);
}

function createToneControl(label, value, onChange) {
  return createSliderControl(label, value, 0, 100, onChange);
}

/**
 * @param {HTMLInputElement} range
 */
function attachRangePointerCapture(range) {
  range.addEventListener('pointerdown', (e) => {
    range.setPointerCapture(e.pointerId);
  });
  range.addEventListener('pointerup', (e) => {
    if (range.hasPointerCapture(e.pointerId)) {
      range.releasePointerCapture(e.pointerId);
    }
  });
  range.addEventListener('pointercancel', (e) => {
    if (range.hasPointerCapture(e.pointerId)) {
      range.releasePointerCapture(e.pointerId);
    }
  });
}

/**
 * @param {string} markerKey
 */
function createChromaMaxMarker(markerKey) {
  const marker = document.createElement('div');
  marker.className = 'chroma-slider-max';
  marker.dataset.chromaMaxMarker = markerKey;
  marker.setAttribute('aria-hidden', 'true');
  return marker;
}

/**
 * @param {HTMLElement} wrap
 */
function createSliderTrack(wrap) {
  const track = document.createElement('div');
  track.className = 'slider-track';
  track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div');
  fill.className = 'slider-track-fill';
  track.appendChild(fill);
  wrap.appendChild(track);
}

/**
 * Shared layout: label + number input + range (optional chroma marker).
 * @param {string} label
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {(v: number) => void} onChange
 * @param {{
 *   transform?: (v: number) => number,
 *   step?: number,
 *   controlKey?: string | null,
 *   hardClampToMarker?: boolean,
 *   getMarkerMax?: () => number,
 *   markerKey?: string | null,
 * }} [options]
 */
function createSliderControl(label, value, min, max, onChange, options = {}) {
  const group = document.createElement('div');
  group.className = 'control-group slider-control';

  const transform = options.transform ?? ((v) => v);
  const getMarkerMax = options.getMarkerMax;
  const hardClamp = Boolean(options.hardClampToMarker && getMarkerMax);
  const step = options.step ?? 1;
  const decimals = (() => {
    const s = String(step);
    const i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  })();

  const snap = (n) => {
    if (decimals <= 0) return Math.round(n);
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
  };

  const applyValue = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = min;
    v = snap(v);
    v = Math.max(min, Math.min(max, v));
    if (hardClamp && getMarkerMax) {
      v = Math.min(v, getMarkerMax());
    }
    v = transform(v);
    return v;
  };

  const lbl = document.createElement('label');
  lbl.textContent = label;
  group.appendChild(lbl);

  const row = document.createElement('div');
  row.className = 'slider-control-row';

  const numberInput = createUiNumberInput({
    value,
    min,
    max,
    step,
    ariaLabel: `${label} value`,
    controlKey: options.controlKey ?? null,
  });
  if (decimals > 0) {
    numberInput.inputMode = 'decimal';
  }

  const wrap = document.createElement('div');
  wrap.className = 'chroma-slider-wrap';
  createSliderTrack(wrap);

  if (getMarkerMax && options.markerKey) {
    wrap.appendChild(createChromaMaxMarker(options.markerKey));
  }

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  range.setAttribute('aria-label', label);
  if (options.controlKey) {
    range.dataset.chromaControl = options.controlKey;
  }
  attachRangePointerCapture(range);

  const commit = (raw) => {
    const v = applyValue(raw);
    numberInput.value = String(v);
    range.value = String(v);
    syncSliderVisuals(wrap, range);
    if (getMarkerMax && options.markerKey) {
      const marker = wrap.querySelector(`[data-chroma-max-marker="${options.markerKey}"]`);
      if (marker instanceof HTMLElement) {
        positionChromaMaxMarker(marker, range, getMarkerMax());
      }
    }
    onChange(v);
  };

  numberInput.addEventListener('change', () => commit(numberInput.value));
  range.addEventListener('input', () => commit(range.value));

  row.appendChild(numberInput);
  wrap.appendChild(range);
  row.appendChild(wrap);
  group.appendChild(row);

  attachSliderVisualSync(
    wrap,
    range,
    options.markerKey ?? null,
    getMarkerMax ?? null,
  );

  return group;
}

/**
 * Fixed chroma: free 0–CHROMA_MAX; peak marker is informational (no hard clamp).
 * Keeps the requested value when hue changes shrink the peak, then restore it.
 * @param {import('../src/color-engine.js').ParamConfig} param
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number} uiMax
 * @param {(() => void) | null} [onTouch]
 */
function createChromaFixedSlider(param, palette, mode, uiMax, onTouch = null) {
  const controlKey = `${palette.id}:${mode}:fixed`;
  return createSliderControl('Value', param.value, 0, uiMax, (v) => {
    onTouch?.();
    param.value = v;
    scheduleRefreshPreviews();
  }, {
    controlKey,
    markerKey: controlKey,
    getMarkerMax: () => livePeakChromaForPalette(palette, mode),
    hardClampToMarker: false,
  });
}

/**
 * Single published step: chroma behaves like an interpolate point (relative % + hard clamp).
 * @param {import('../src/color-engine.js').ParamConfig} param
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number} step
 * @param {number} uiMax
 * @param {(() => void) | null} [onTouch]
 */
function createChromaSingleStepSlider(param, palette, mode, step, uiMax, onTouch = null) {
  if (param.mode !== 'fixed') return createChromaFixedSlider(param, palette, mode, uiMax, onTouch);

  const controlKey = `${palette.id}:${mode}:single:${step}`;
  const limit = liveChromaLimitAtStep(palette, mode, step);
  lockChromaPointRatio(param, Math.min(param.value, limit), limit);

  return createSliderControl('Value', param.value, 0, uiMax, (v) => {
    onTouch?.();
    lockChromaPointRatio(param, v, liveChromaLimitAtStep(palette, mode, step));
    scheduleRefreshPreviews();
  }, {
    controlKey,
    markerKey: controlKey,
    getMarkerMax: () => liveChromaLimitAtStep(palette, mode, step),
    hardClampToMarker: true,
  });
}

/**
 * Interpolate chroma point: with clamp on, marker is hard ceiling + relative %;
 * with clamp off, absolute C may sit past the peak (like multi-step fixed).
 * @param {{ step: number, value: number, ratio?: number, gamutLimit?: number }} point
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number} pointIndex
 * @param {number} uiMax
 * @param {(() => void) | null} [onTouch]
 * @param {boolean} [clampOn=true]
 */
function createChromaPointSlider(point, palette, mode, pointIndex, uiMax, onTouch = null, clampOn = true) {
  const controlKey = `${palette.id}:${mode}:point:${pointIndex}`;
  const limit = liveChromaLimitAtStep(palette, mode, point.step);
  if (clampOn) {
    lockChromaPointRatio(point, Math.min(point.value, limit), limit);
  }

  return createSliderControl('Value', point.value, 0, uiMax, (v) => {
    onTouch?.();
    if (clampOn) {
      lockChromaPointRatio(point, v, liveChromaLimitAtStep(palette, mode, point.step));
    } else {
      point.value = v;
      delete point.ratio;
      delete point.gamutLimit;
    }
    scheduleRefreshPreviews();
  }, {
    controlKey,
    markerKey: controlKey,
    getMarkerMax: () => liveChromaLimitAtStep(palette, mode, point.step),
    hardClampToMarker: clampOn,
  });
}

function createStepSelect(label, value, steps, disabled, onChange) {
  const group = document.createElement('div');
  group.className = 'control-group control-group--step';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  group.appendChild(lbl);

  const select = document.createElement('select');
  select.className = 'ui-control ui-control--select';
  select.disabled = disabled;
  for (const step of steps) {
    const opt = document.createElement('option');
    opt.value = String(step);
    opt.textContent = String(step);
    if (step === value) opt.selected = true;
    select.appendChild(opt);
  }
  if (!disabled) {
    select.addEventListener('change', () => onChange(Number(select.value)));
  }
  group.appendChild(select);
  return group;
}

/**
 * @typedef {[number, number, number, number]} Bezier
 */

/** @type {{ name: string, bezier: Bezier }[]} */
const EASING_PRESETS = [
  { name: 'Linear', bezier: [0, 0, 1, 1] },
  { name: 'In', bezier: [0.42, 0, 1, 1] },
  { name: 'Out', bezier: [0, 0, 0.58, 1] },
  { name: 'In-Out', bezier: [0.42, 0, 0.58, 1] },
];

/**
 * Sample cubic Bézier easing curve for drawing (CSS timing function).
 * @param {Bezier} bezier
 * @param {number} steps
 * @returns {{ x: number, y: number }[]}
 */
function sampleCubicBezier(bezier, steps = 48) {
  const [x1, y1, x2, y2] = bezier;
  /** @type {{ x: number, y: number }[]} */
  const points = [{ x: 0, y: 0 }];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    points.push({
      x: 3 * uu * t * x1 + 3 * u * tt * x2 + ttt,
      y: 3 * uu * t * y1 + 3 * u * tt * y2 + ttt,
    });
  }
  points.push({ x: 1, y: 1 });
  return points;
}

/**
 * @param {Bezier} initial
 * @param {HTMLElement} anchor
 * @param {(b: Bezier) => void} onChange
 * @param {() => void} onClose
 */
function openBezierGraphEditor(initial, anchor, onChange, onClose) {
  document.querySelector('.easing-editor-panel')?.remove();

  /** @type {Bezier} */
  let current = [...initial];

  const panel = document.createElement('div');
  panel.className = 'easing-editor-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Easing graph editor');

  const header = document.createElement('div');
  header.className = 'easing-editor-header';

  const presets = document.createElement('div');
  presets.className = 'easing-editor-presets';
  for (const preset of EASING_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ui-btn easing-preset-btn';
    btn.textContent = preset.name;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      current = [...preset.bezier];
      draw();
      applyBezier([...current]);
      syncPresetActive();
    });
    presets.appendChild(btn);
  }
  header.appendChild(presets);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ui-btn danger easing-editor-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML = `<svg class="easing-editor-close-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'easing-editor-canvas-wrap';

  const svgNS = 'http://www.w3.org/2000/svg';
  const size = 220;
  const pad = 16;
  const plot = size - pad * 2;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'easing-editor-svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const grid = document.createElementNS(svgNS, 'g');
  grid.setAttribute('class', 'easing-editor-grid');
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = pad + t * plot;
    const y = pad + t * plot;
    const v = document.createElementNS(svgNS, 'line');
    v.setAttribute('x1', String(x));
    v.setAttribute('y1', String(pad));
    v.setAttribute('x2', String(x));
    v.setAttribute('y2', String(pad + plot));
    grid.appendChild(v);
    const h = document.createElementNS(svgNS, 'line');
    h.setAttribute('x1', String(pad));
    h.setAttribute('y1', String(y));
    h.setAttribute('x2', String(pad + plot));
    h.setAttribute('y2', String(y));
    grid.appendChild(h);
  }
  svg.appendChild(grid);

  const diag = document.createElementNS(svgNS, 'line');
  diag.setAttribute('class', 'easing-editor-diag');
  diag.setAttribute('x1', String(pad));
  diag.setAttribute('y1', String(pad + plot));
  diag.setAttribute('x2', String(pad + plot));
  diag.setAttribute('y2', String(pad));
  svg.appendChild(diag);

  const handleLine1 = document.createElementNS(svgNS, 'line');
  handleLine1.setAttribute('class', 'easing-editor-handle-line');
  svg.appendChild(handleLine1);

  const handleLine2 = document.createElementNS(svgNS, 'line');
  handleLine2.setAttribute('class', 'easing-editor-handle-line');
  svg.appendChild(handleLine2);

  const curvePath = document.createElementNS(svgNS, 'path');
  curvePath.setAttribute('class', 'easing-editor-curve');
  svg.appendChild(curvePath);

  const startDot = document.createElementNS(svgNS, 'circle');
  startDot.setAttribute('class', 'easing-editor-endpoint');
  startDot.setAttribute('r', '4');
  startDot.setAttribute('cx', String(pad));
  startDot.setAttribute('cy', String(pad + plot));
  svg.appendChild(startDot);

  const endDot = document.createElementNS(svgNS, 'circle');
  endDot.setAttribute('class', 'easing-editor-endpoint');
  endDot.setAttribute('r', '4');
  endDot.setAttribute('cx', String(pad + plot));
  endDot.setAttribute('cy', String(pad));
  svg.appendChild(endDot);

  const handle1 = document.createElementNS(svgNS, 'circle');
  handle1.setAttribute('class', 'easing-editor-handle');
  handle1.setAttribute('r', '7');
  handle1.dataset.handle = '1';
  svg.appendChild(handle1);

  const handle2 = document.createElementNS(svgNS, 'circle');
  handle2.setAttribute('class', 'easing-editor-handle');
  handle2.setAttribute('r', '7');
  handle2.dataset.handle = '2';
  svg.appendChild(handle2);

  canvasWrap.appendChild(svg);
  panel.appendChild(canvasWrap);

  /** @type {HTMLInputElement | null} */
  let bezierTextInput = null;

  /**
   * @param {Bezier} next
   * @param {{ skipInput?: boolean }} [opts]
   */
  const applyBezier = (next, opts = {}) => {
    current = [...next];
    if (!opts.skipInput && bezierTextInput) {
      bezierTextInput.value = formatBezierCss(current);
      bezierTextInput.classList.remove('invalid');
    }
    onChange([...current]);
  };

  const bezierField = createBezierInputs(current, (next) => {
    current = [...next];
    draw();
    syncPresetActive();
    onChange([...current]);
  }, { showGraphBtn: false });
  bezierTextInput = bezierField.querySelector('input');
  panel.appendChild(bezierField);

  /**
   * @param {number} nx 0–1
   * @param {number} ny 0–1
   */
  const toSvg = (nx, ny) => ({
    x: pad + nx * plot,
    y: pad + (1 - ny) * plot,
  });

  /**
   * @param {number} clientX
   * @param {number} clientY
   */
  const fromClient = (clientX, clientY) => {
    const rect = svg.getBoundingClientRect();
    const sx = ((clientX - rect.left) / rect.width) * size;
    const sy = ((clientY - rect.top) / rect.height) * size;
    const nx = Math.max(0, Math.min(1, (sx - pad) / plot));
    const ny = Math.max(0, Math.min(1, 1 - (sy - pad) / plot));
    return { x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 };
  };

  const syncPresetActive = () => {
    const buttons = presets.querySelectorAll('.easing-preset-btn');
    EASING_PRESETS.forEach((preset, i) => {
      const match = preset.bezier.every((n, j) => n === current[j]);
      buttons[i]?.classList.toggle('is-active', match);
    });
  };

  const draw = () => {
    const [x1, y1, x2, y2] = current;
    const p0 = toSvg(0, 0);
    const p1 = toSvg(x1, y1);
    const p2 = toSvg(x2, y2);
    const p3 = toSvg(1, 1);

    handleLine1.setAttribute('x1', String(p0.x));
    handleLine1.setAttribute('y1', String(p0.y));
    handleLine1.setAttribute('x2', String(p1.x));
    handleLine1.setAttribute('y2', String(p1.y));

    handleLine2.setAttribute('x1', String(p3.x));
    handleLine2.setAttribute('y1', String(p3.y));
    handleLine2.setAttribute('x2', String(p2.x));
    handleLine2.setAttribute('y2', String(p2.y));

    handle1.setAttribute('cx', String(p1.x));
    handle1.setAttribute('cy', String(p1.y));
    handle2.setAttribute('cx', String(p2.x));
    handle2.setAttribute('cy', String(p2.y));

    const samples = sampleCubicBezier(current);
    const d = samples
      .map((pt, i) => {
        const s = toSvg(pt.x, pt.y);
        return `${i === 0 ? 'M' : 'L'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`;
      })
      .join(' ');
    curvePath.setAttribute('d', d);
    if (bezierTextInput) {
      bezierTextInput.value = formatBezierCss(current);
      bezierTextInput.classList.remove('invalid');
    }
  };

  /** @type {1 | 2 | null} */
  let draggingHandle = null;
  /** @type {{ ox: number, oy: number, left: number, top: number } | null} */
  let draggingPanel = null;

  const onPointerMove = (e) => {
    if (draggingHandle) {
      const pt = fromClient(e.clientX, e.clientY);
      if (draggingHandle === 1) {
        current[0] = pt.x;
        current[1] = pt.y;
      } else {
        current[2] = pt.x;
        current[3] = pt.y;
      }
      draw();
      applyBezier([...current], { skipInput: false });
      syncPresetActive();
      return;
    }
    if (draggingPanel) {
      const nextLeft = draggingPanel.left + (e.clientX - draggingPanel.ox);
      const nextTop = draggingPanel.top + (e.clientY - draggingPanel.oy);
      panel.style.left = `${Math.max(8, nextLeft)}px`;
      panel.style.top = `${Math.max(8, nextTop)}px`;
    }
  };

  const onPointerUp = () => {
    draggingHandle = null;
    draggingPanel = null;
    panel.classList.remove('is-dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
  };

  /**
   * @param {1 | 2} which
   * @param {PointerEvent} e
   */
  const startHandleDrag = (which, e) => {
    e.preventDefault();
    e.stopPropagation();
    draggingHandle = which;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  handle1.addEventListener('pointerdown', (e) => startHandleDrag(1, e));
  handle2.addEventListener('pointerdown', (e) => startHandleDrag(2, e));

  panel.addEventListener('pointerdown', (e) => {
    if (!(e.target instanceof Element)) return;
    if (e.target.closest('button, input, .easing-editor-handle, .easing-editor-svg, .easing-editor-canvas-wrap')) return;
    e.preventDefault();
    const rect = panel.getBoundingClientRect();
    draggingPanel = {
      ox: e.clientX,
      oy: e.clientY,
      left: rect.left,
      top: rect.top,
    };
    panel.classList.add('is-dragging');
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  });

  const placeNearAnchor = () => {
    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 8;
    panel.style.left = `${Math.max(8, rect.left)}px`;
    panel.style.top = `${top}px`;
    document.body.appendChild(panel);
    const panelRect = panel.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, rect.left),
      window.innerWidth - panelRect.width - 8,
    );
    panel.style.left = `${left}px`;
    if (panelRect.bottom > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelRect.height - 8);
      panel.style.top = `${top}px`;
    }
  };

  const close = () => {
    onPointerUp();
    panel.remove();
    window.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onOutside, true);
    onClose();
  };

  /** @param {KeyboardEvent} e */
  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };

  /** @param {PointerEvent} e */
  const onOutside = (e) => {
    if (e.target instanceof Node && !panel.contains(e.target) && !anchor.contains(e.target)) {
      close();
    }
  };

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });
  window.addEventListener('keydown', onKeyDown);
  // Defer so the opening click does not immediately close.
  requestAnimationFrame(() => {
    document.addEventListener('pointerdown', onOutside, true);
  });

  placeNearAnchor();
  draw();
  syncPresetActive();
}

/**
 * @param {Bezier} bezier
 * @param {(b: Bezier) => void} onChange
 * @param {boolean | { disabled?: boolean, showGraphBtn?: boolean }} [options]
 */
function createBezierInputs(bezier, onChange, options = {}) {
  const opts = typeof options === 'boolean' ? { disabled: options } : options;
  const disabled = Boolean(opts.disabled);
  const showGraphBtn = opts.showGraphBtn !== false;

  const wrap = document.createElement('div');
  wrap.className = `bezier-input${disabled ? ' is-disabled' : ''}${showGraphBtn ? '' : ' bezier-input--plain'}`;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ui-ghost ui-ghost--block';
  input.value = formatBezierCss(bezier);
  input.disabled = disabled;
  input.spellcheck = false;
  input.placeholder = 'cubic-bezier(0.32, 0.18, 0.68, 0.77)';

  input.addEventListener('change', () => {
    try {
      const parsed = parseBezierCss(input.value);
      input.value = formatBezierCss(parsed);
      input.classList.remove('invalid');
      onChange(parsed);
    } catch {
      input.classList.add('invalid');
    }
  });

  wrap.appendChild(input);

  if (showGraphBtn) {
    const graphBtn = document.createElement('button');
    graphBtn.type = 'button';
    graphBtn.className = 'bezier-graph-btn';
    graphBtn.disabled = disabled;
    graphBtn.setAttribute('aria-label', 'Open easing graph editor');
    graphBtn.title = 'Easing graph';
    graphBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 13C2 13 4.5 3 8 3s6 10 6 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="8" r="1.5" fill="currentColor"/><circle cx="11" cy="6" r="1.5" fill="currentColor"/></svg>`;

    graphBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      let current;
      try {
        current = parseBezierCss(input.value);
      } catch {
        current = [...LINEAR_BEZIER];
      }
      openBezierGraphEditor(current, wrap, (next) => {
        input.value = formatBezierCss(next);
        input.classList.remove('invalid');
        onChange(next);
      }, () => {});
    });

    wrap.appendChild(graphBtn);
  }

  return wrap;
}

async function boot() {
  try {
    state = await loadInitialState();
    render();
  } catch (err) {
    showError(err);
  }
}

boot();
