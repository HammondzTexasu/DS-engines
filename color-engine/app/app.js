import {
  getSteps,
  getEndStep,
  invertBezier,
  generateKeyPalettes,
  generateCustomPaletteForMode,
  sanitizePaletteName,
  formatBezierCss,
  parseBezierCss,
  resolveParam,
  clampChroma,
  peakChromaForSteps,
  clampChromaParamValues,
  CHROMA_UI_MAX,
} from '../src/engine.js';
import {
  createDefaultState,
  createCustomPalette,
  createFixedParam,
  createInterpolateParam,
  DEFAULT_BEZIER,
  exportEngineConfig,
  importEngineConfig,
} from '../src/state.js';

/** @type {ReturnType<typeof createDefaultState>} */
let state = createDefaultState();

/** @type {{ message: string, isError: boolean } | null} */
let pendingConfigStatus = null;

let pageDarkMode = false;

const UI_ACCENT_BASE = '#0066cc';
const UI_DANGER_BASE = '#aa0000';

const UI_FG_LIGHT = '#333333';
const UI_FG_DARK = '#e8e8e8';

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
 * @param {number} channel
 */
function channelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * @param {string} hex
 */
function getRelativeLuminance(hex) {
  const { r, g, b } = parseHexRgb(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
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
  const lum = getRelativeLuminance(surfaceHex);
  if (lum >= 0.5) return 0;
  return ((0.5 - lum) / 0.5) * 0.4;
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
  return getRelativeLuminance(surfaceHex) > 0.5 ? UI_FG_LIGHT : UI_FG_DARK;
}

/**
 * @param {string} surfaceHex
 */
function getUiThemeTokens(surfaceHex) {
  const fg = resolveNeutralFg(surfaceHex);
  const isLight = getRelativeLuminance(surfaceHex) > 0.5;
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
  btn.classList.toggle('is-active', pageDarkMode);
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
  darkModeToggleEl.classList.toggle('is-active', pageDarkMode);
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

/**
 * @param {import('../src/engine.js').ParamConfig} param
 * @param {string} prefix
 * @param {string} paramName
 * @param {string[]} lines
 */
function appendParamInterpolatorTokens(param, prefix, paramName, lines) {
  if (param.mode !== 'interpolate') return;

  const points = [...param.points].sort((a, b) => a.step - b.step);
  for (let i = 0; i < points.length - 1; i++) {
    const segNum = points.length > 2 ? `-${i + 1}` : '';
    const bezier = param.interpolators[i] ?? DEFAULT_BEZIER;
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
 * @param {object} keyResults
 * @param {number[]} steps
 * @param {number} endStep
 */
function buildTokensCss(keyResults, steps, endStep) {
  const lines = [];

  appendPaletteColorTokens(keyResults.lm, steps, endStep, 'key-palette', lines, 'tone');
  lines.push(`  --key-palette-start: ${state.keyPalette.lm.start.tone};`);
  lines.push(`  --key-palette-end: ${state.keyPalette.lm.end.tone};`);
  lines.push(`  --key-tone-interpolator: ${formatBezierCss(state.keyPalette.lm.interpolator)};`);

  const dmBezier = state.keyPalette.dm.interpolatorOverride
    ? state.keyPalette.dm.interpolator
    : invertBezier(state.keyPalette.lm.interpolator);
  appendPaletteColorTokens(keyResults.dm, steps, endStep, 'key-palette-dm', lines, 'tone');
  lines.push(`  --key-palette-dm-start: ${state.keyPalette.dm.start.tone};`);
  lines.push(`  --key-palette-dm-end: ${state.keyPalette.dm.end.tone};`);
  lines.push(`  --key-dm-tone-interpolator: ${formatBezierCss(dmBezier)};`);

  for (const palette of state.customPalettes) {
    const name = sanitizePaletteName(palette.name);

    const lmResult = generateCustomPaletteForMode(palette, 'lm', keyResults.lm, steps);
    appendPaletteColorTokens(lmResult, steps, endStep, name, lines, 'hc');
    appendParamInterpolatorTokens(palette.lm.hue, name, 'hue', lines);
    appendParamInterpolatorTokens(palette.lm.chroma, name, 'chroma', lines);

    const dmResult = generateCustomPaletteForMode(palette, 'dm', keyResults.dm, steps);
    appendPaletteColorTokens(dmResult, steps, endStep, `${name}-dm`, lines, 'hc');
    appendParamInterpolatorTokens(palette.dm.hue, `${name}-dm`, 'hue', lines);
    appendParamInterpolatorTokens(palette.dm.chroma, `${name}-dm`, 'chroma', lines);
  }

  return `:root {\n${lines.join('\n')}\n}`;
}

function patchTokensOutput() {
  const output = app.querySelector('[data-panel="tokens"] .code-output');
  if (!output) return;

  const steps = getSteps(state.stepCount);
  const endStep = getEndStep(state.stepCount);
  const keyResults = generateKeyPalettes(state.keyPalette, steps);
  output.textContent = buildTokensCss(keyResults, steps, endStep);
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
  render();
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
  const steps = getSteps(state.stepCount);
  const endStep = getEndStep(state.stepCount);
  const keyResults = generateKeyPalettes(state.keyPalette, steps);

  app.innerHTML = '';

  const header = document.createElement('header');

  const title = document.createElement('h1');
  title.textContent = 'Color Engine';
  header.appendChild(title);

  app.appendChild(header);

  app.appendChild(createKeyPaletteFieldset(keyResults, steps, endStep));

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
    createCollapsePanel(
      'Generated tokens',
      'tokens',
      createTokensPanelBody(buildTokensCss(keyResults, steps, endStep)),
      tokensPanelExpanded,
    ),
  );

  app.appendChild(
    createCollapsePanel('Config', 'config', createConfigPanelBody(), configPanelExpanded),
  );

  patchThemeSurfaces();
  ensureDarkModeToggle();
}

/**
 * Clamp interpolate chroma points and sync max markers / point inputs.
 * @param {ReturnType<typeof generateKeyPalettes>} keyResults
 * @param {number[]} steps
 */
function clampAllCustomChroma(keyResults, steps) {
  for (const palette of state.customPalettes) {
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      clampChromaParamValues(palette[mode].chroma, palette[mode].hue, keyResults[mode], steps);
      syncChromaControls(palette, mode, steps);
    }
  }
}

/**
 * @param {string} controlKey
 * @param {number} maxChroma
 * @param {number} [scaleMax]
 */
function syncChromaMaxMarker(controlKey, maxChroma) {
  const marker = app.querySelector(`[data-chroma-max-marker="${controlKey}"]`);
  if (!(marker instanceof HTMLElement)) return;
  const range = marker.parentElement?.querySelector('input[type="range"]');
  if (!(range instanceof HTMLInputElement)) return;
  positionChromaMaxMarker(marker, range, maxChroma);
}

/**
 * Sync chroma max markers and clamped point inputs (interpolate).
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} steps
 */
function syncChromaControls(palette, mode, steps) {
  const chroma = palette[mode].chroma;
  if (chroma.mode === 'fixed') {
    syncChromaMaxMarker(
      `${palette.id}:${mode}:fixed`,
      chromaPeakForPalette(palette, mode, steps),
    );
    return;
  }

  chroma.points.forEach((point, i) => {
    const controlKey = `${palette.id}:${mode}:point:${i}`;
    const limit = chromaLimitAtStep(palette, mode, steps, point.step);
    syncChromaMaxMarker(controlKey, limit);

    app.querySelectorAll(`input[data-chroma-control="${controlKey}"]`).forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      const v = Math.min(point.value, limit);
      point.value = v;
      el.value = String(v);
      if (el.type === 'range') {
        const wrap = el.parentElement;
        if (wrap) syncSliderVisuals(wrap, el);
      }
    });
  });
}

function refreshPreviews() {
  const steps = getSteps(state.stepCount);
  const endStep = getEndStep(state.stepCount);
  const keyResults = generateKeyPalettes(state.keyPalette, steps);

  clampAllCustomChroma(keyResults, steps);

  patchPreviewRow('key-lm', keyResults.lm, steps, endStep, 'tone');
  patchPreviewRow('key-dm', keyResults.dm, steps, endStep, 'tone');

  for (const palette of state.customPalettes) {
    for (const mode of /** @type {const} */ (['lm', 'dm'])) {
      const result = generateCustomPaletteForMode(palette, mode, keyResults[mode], steps);
      patchPreviewRow(`custom-${palette.id}-${mode}`, result, steps, endStep, 'hc');
    }
  }

  patchTokensOutput();
  patchConfigOutput();
  patchThemeSurfaces();
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

  const wraps = row.querySelectorAll(':scope > .swatch-wrap');
  const expectedCount = steps.length + 2;
  const textMode = getTextMode(previewId);

  if (wraps.length !== expectedCount) {
    replacePreviewRow(previewId, paletteResult, steps, endStep, valueFormat, getEditOptions(previewId));
    return;
  }

  let i = 0;
  patchSwatchWrap(wraps[i], '0', paletteResult.min, null, valueFormat, i++, expectedCount, textMode);
  for (const step of steps) {
    const data = paletteResult.steps[step];
    patchSwatchWrap(wraps[i], String(step), data.hex, data, valueFormat, i++, expectedCount, textMode);
  }
  patchSwatchWrap(wraps[i], String(endStep + 10), paletteResult.max, null, valueFormat, i, expectedCount, textMode);
}

/**
 * @param {string} previewId
 * @returns {'lm' | 'dm'}
 */
function getTextMode(previewId) {
  return previewId.endsWith('-dm') ? 'dm' : 'lm';
}

/**
 * @param {number} index
 * @param {number} total
 * @param {'lm' | 'dm'} textMode
 */
function getSwatchTextColor(index, total, textMode) {
  const firstHalf = index < total / 2;
  if (textMode === 'lm') {
    return firstHalf ? '#111' : '#fff';
  }
  return firstHalf ? '#fff' : '#111';
}

/**
 * @param {string} previewId
 */
function getEditOptions(previewId) {
  if (previewId === 'key-lm') {
    return {
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
 * @param {number} index
 * @param {number} total
 * @param {'lm' | 'dm'} textMode
 */
function patchSwatchWrap(wrap, name, hex, data, valueFormat, index, total, textMode) {
  const nameEl = wrap.querySelector('.swatch-name');
  const colorEl = wrap.querySelector('.swatch');
  const valueEl = wrap.querySelector('.swatch-value');
  if (!nameEl || !colorEl || !valueEl) return;

  nameEl.textContent = name;

  const colorInput = colorEl.querySelector('.swatch-color-input');
  const pickerActive = colorInput && document.activeElement === colorInput;

  if (!pickerActive) {
    colorEl.style.background = hex;
    if (colorInput instanceof HTMLInputElement) {
      colorInput.value = hex;
    }
    if (colorEl._currentHex !== undefined) {
      colorEl._currentHex = hex;
    }
  }

  const valueText = formatSwatchValue(data, valueFormat);
  valueEl.textContent = valueText;
  valueEl.style.color = getSwatchTextColor(index, total, textMode);

  const isEditable = colorEl.classList.contains('swatch-editable');
  colorEl.title = isEditable
    ? `${name}: ${hex}\nKlikni pro změnu barvy`
    : valueText ? `${name}: ${hex}\n${valueText}` : `${name}: ${hex}`;
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
  const row = createSwatchRow(paletteResult, steps, endStep, valueFormat, editOptions, textMode);
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
  input.addEventListener('change', () => {
    const value = Math.max(1, Math.round(Number(input.value)) || 1);
    input.value = String(value);
    if (value === state.stepCount) return;
    state.stepCount = value;
    syncInterpEndSteps();
    render();
  });
  group.appendChild(input);
  return group;
}

function syncInterpEndSteps() {
  const endStep = getEndStep(state.stepCount);
  const steps = getSteps(state.stepCount);

  for (const palette of state.customPalettes) {
    for (const mode of ['lm', 'dm']) {
      for (const param of ['hue', 'chroma']) {
        const cfg = palette[mode][param];
        if (cfg.mode === 'interpolate') {
          cfg.points = cfg.points.filter((p) => steps.includes(p.step));
          const last = cfg.points[cfg.points.length - 1];
          if (!last || last.step !== endStep) {
            const endPoint = cfg.points.find((p) => p.step === endStep);
            if (!endPoint) {
              const prevEnd = cfg.points.pop();
              cfg.points.push({ step: endStep, value: prevEnd?.value ?? 0 });
            }
          }
          cfg.interpolators = cfg.interpolators.slice(0, Math.max(0, cfg.points.length - 1));
          while (cfg.interpolators.length < cfg.points.length - 1) {
            cfg.interpolators.push([...DEFAULT_BEZIER]);
          }
        }
      }
    }
  }
}

const KEY_PALETTE_NAME = 'key-palette';

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
 */
function createKeyPaletteFieldset(keyResults, steps, endStep) {
  const fs = document.createElement('fieldset');
  fs.className = 'key-palette-fieldset';

  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    const config = state.keyPalette[mode];
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
      onMinChange: (hex) => {
        config.min = hex;
        onThemeSurfaceColorChange();
        scheduleRefreshPreviews();
      },
      onMaxChange: (hex) => {
        config.max = hex;
        scheduleRefreshPreviews();
      },
    }, mode);
    swatchRow.dataset.preview = `key-${mode}`;
    segment.appendChild(swatchRow);

    segment.appendChild(createKeyPaletteControls(config, endStep, isDm));
    fs.appendChild(segment);
  }

  return wrapPaletteFieldset(fs, KEY_PALETTE_NAME, createStepCountControl());
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
    scheduleRefreshPreviews();
  }));

  row1.appendChild(createToneControl(`end (${endStep})`, config.end.tone, (v) => {
    config.end.tone = v;
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

  bezierRow.appendChild(createBezierInputs(bezier, (newBezier) => {
    if (isDm) {
      config.interpolatorOverride = true;
      config.interpolator = newBezier;
    } else {
      config.interpolator = newBezier;
      if (!state.keyPalette.dm.interpolatorOverride) {
        state.keyPalette.dm.interpolator = invertBezier(newBezier);
      }
    }
    refreshPreviews();
  }, isDm && !config.interpolatorOverride));

  controls.appendChild(bezierRow);
  return controls;
}

function formatPaletteModeLabel(safeName, mode) {
  return mode === 'dm' ? `${safeName}-dm` : safeName;
}

function updatePaletteNameLabels(root, name) {
  const safeName = sanitizePaletteName(name);

  root.querySelectorAll('.mode-label[data-mode]').forEach((el) => {
    el.textContent = formatPaletteModeLabel(safeName, el.dataset.mode);
  });

  root.querySelectorAll('.interp-segment-title[data-name-suffix]').forEach((el) => {
    const segNum = el.dataset.segNum;
    const prefix = `${safeName}${el.dataset.nameSuffix}${segNum ? `-${segNum}` : ''}`;
    el.textContent = `${prefix} (${el.dataset.from}→${el.dataset.to})`;
  });
}

function createCustomPaletteFieldset(palette, keyResults, steps, endStep, expandedParamGroups = new Set()) {
  const fs = document.createElement('fieldset');
  fs.className = 'custom-palette-fieldset';
  fs.dataset.paletteId = palette.id;

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'ui-ghost palette-name-input';
  titleInput.value = palette.name;
  titleInput.setAttribute('aria-label', 'Palette name');
  titleInput.addEventListener('input', () => {
    const sanitized = sanitizePaletteName(titleInput.value);
    palette.name = sanitized;
    if (titleInput.value !== sanitized) {
      titleInput.value = sanitized;
    }
    updatePaletteNameLabels(fs, palette.name);
    scheduleRefreshPreviews();
  });

  const safeName = sanitizePaletteName(palette.name);

  for (const mode of /** @type {const} */ (['lm', 'dm'])) {
    const keyResult = keyResults[mode];
    const customResult = generateCustomPaletteForMode(palette, mode, keyResult, steps);
    const modeLabel = formatPaletteModeLabel(safeName, mode);
    const suffix = mode === 'dm' ? '-dm' : '';

    const segment = document.createElement('div');
    segment.className = 'palette-mode-segment';
    segment.dataset.mode = mode;

    const label = document.createElement('div');
    label.className = 'mode-label';
    label.dataset.mode = mode;
    label.textContent = modeLabel;
    segment.appendChild(label);

    const swatchRow = createSwatchRow(customResult, steps, endStep, 'hc', null, mode);
    swatchRow.dataset.preview = `custom-${palette.id}-${mode}`;
    segment.appendChild(swatchRow);

    segment.appendChild(createModeParamGroup(
      palette,
      mode,
      keyResult,
      steps,
      endStep,
      safeName,
      suffix,
      () => render(),
      expandedParamGroups,
    ));

    fs.appendChild(segment);
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'ui-btn danger palette-header-action custom-palette-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    state.customPalettes = state.customPalettes.filter((p) => p.id !== palette.id);
    render();
  });

  return wrapPaletteFieldset(fs, titleInput, removeBtn);
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
 */
function createModeParamGroup(palette, mode, keyResult, steps, endStep, safeName, suffix, onUpdate, expandedParamGroups = new Set()) {
  clampChromaParamValues(palette[mode].chroma, palette[mode].hue, keyResult, steps);

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
  };

  for (const paramName of /** @type {const} */ (['hue', 'chroma'])) {
    const max = paramName === 'hue' ? 360 : CHROMA_UI_MAX;
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
    ));
  }

  group.appendChild(body);
  return group;
}

/**
 * Live HCT chroma ceiling for a palette step (uses current key-palette tones).
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} steps
 * @param {number} step
 */
function chromaLimitAtStep(palette, mode, steps, step) {
  const keyResult = generateKeyPalettes(state.keyPalette, steps)[mode];
  const hue = resolveParam(palette[mode].hue, step, steps);
  const tone = keyResult.steps[step].tone;
  return clampChroma(CHROMA_UI_MAX, hue, tone);
}

/**
 * Live peak chroma for fixed chroma UI.
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} steps
 */
function chromaPeakForPalette(palette, mode, steps) {
  const keyResult = generateKeyPalettes(state.keyPalette, steps)[mode];
  return peakChromaForSteps(palette[mode].hue, keyResult, steps);
}

/**
 * @param {import('../src/engine.js').ParamConfig} param
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} label
 * @param {string} interpolatorPrefix
 * @param {number} max
 * @param {() => void} onUpdate
 * @param {string} nameSuffix
 * @param {{ palette: ReturnType<typeof createCustomPalette>, mode: 'lm' | 'dm', keyResult: ReturnType<typeof generateKeyPalettes>['lm'], steps: number[] } | null} [chromaCtx]
 */
function createParamSection(param, steps, endStep, label, interpolatorPrefix, max, onUpdate, nameSuffix, chromaCtx = null) {
  const section = document.createElement('div');
  section.className = 'param-section';

  const header = document.createElement('div');
  header.className = 'param-section-header';

  const title = document.createElement('h4');
  title.className = 'param-section-title';
  title.textContent = label;
  header.appendChild(title);

  const toggleRow = document.createElement('label');
  toggleRow.className = 'checkbox-row';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.checked = param.mode === 'interpolate';
  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      const val = param.mode === 'fixed' ? param.value : 0;
      Object.assign(param, createInterpolateParam(10, val, endStep, val));
      if (chromaCtx) {
        clampChromaParamValues(param, chromaCtx.palette[chromaCtx.mode].hue, chromaCtx.keyResult, chromaCtx.steps);
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
        clampChromaParamValues(param, chromaCtx.palette[chromaCtx.mode].hue, chromaCtx.keyResult, chromaCtx.steps);
      }
    }
    onUpdate();
  });
  toggleRow.appendChild(toggle);
  toggleRow.appendChild(document.createTextNode(' Interpolate'));
  header.appendChild(toggleRow);
  section.appendChild(header);

  if (param.mode === 'fixed') {
    if (chromaCtx) {
      section.appendChild(createChromaFixedSlider(
        param,
        chromaCtx.palette,
        chromaCtx.mode,
        chromaCtx.steps,
        max,
      ));
    } else {
      section.appendChild(createSliderControl('Value', param.value, 0, max, (v) => {
        param.value = v;
        scheduleRefreshPreviews();
      }));
    }
  } else {
    section.appendChild(createInterpControls(param, steps, endStep, interpolatorPrefix, max, onUpdate, nameSuffix, chromaCtx));
  }

  return section;
}

/**
 * @param {import('../src/engine.js').ParamConfig} param
 * @param {number[]} steps
 * @param {number} endStep
 * @param {string} prefix
 * @param {number} max
 * @param {() => void} onUpdate
 * @param {string} nameSuffix
 * @param {{ palette: ReturnType<typeof createCustomPalette>, mode: 'lm' | 'dm', keyResult: ReturnType<typeof generateKeyPalettes>['lm'], steps: number[] } | null} [chromaCtx]
 */
function createInterpControls(param, steps, endStep, prefix, max, onUpdate, nameSuffix, chromaCtx = null) {
  const container = document.createElement('div');

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
      point.step = step;
      if (chromaCtx) {
        const limit = chromaLimitAtStep(
          chromaCtx.palette,
          chromaCtx.mode,
          chromaCtx.steps,
          point.step,
        );
        point.value = Math.min(point.value, limit);
      }
      param.points.sort((a, b) => a.step - b.step);
      onUpdate();
    }));

    if (chromaCtx) {
      fields.appendChild(createChromaPointSlider(
        point,
        chromaCtx.palette,
        chromaCtx.mode,
        chromaCtx.steps,
        i,
        max,
      ));
    } else {
      fields.appendChild(createSliderControl('Value', point.value, 0, max, (v) => {
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
        param.interpolators[i] = [...DEFAULT_BEZIER];
      }

      seg.appendChild(createBezierInputs(param.interpolators[i], (bez) => {
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
    if (chromaCtx) {
      newVal = Math.min(
        newVal,
        chromaLimitAtStep(chromaCtx.palette, chromaCtx.mode, chromaCtx.steps, newStep),
      );
    }

    param.points.splice(idx, 0, { step: newStep, value: newVal });
    param.interpolators.splice(idx - 1, 0, [...DEFAULT_BEZIER]);
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
 * @param {{ onMinChange?: (hex: string) => void, onMaxChange?: (hex: string) => void, onEditDone?: () => void }} [editOptions]
 */
function createSwatchRow(paletteResult, steps, endStep, valueFormat = 'tone', editOptions = null, textMode = 'lm') {
  const row = document.createElement('div');
  row.className = 'swatch-row';
  row.dataset.textMode = textMode;

  const total = steps.length + 2;
  let index = 0;

  row.appendChild(createSwatch('0', paletteResult.min, null, valueFormat, editOptions?.onMinChange
    ? { onChange: editOptions.onMinChange, onDone: editOptions.onEditDone }
    : null, index++, total, textMode));

  for (const step of steps) {
    const data = paletteResult.steps[step];
    row.appendChild(createSwatch(String(step), data.hex, data, valueFormat, null, index++, total, textMode));
  }

  row.appendChild(createSwatch(String(endStep + 10), paletteResult.max, null, valueFormat, editOptions?.onMaxChange
    ? { onChange: editOptions.onMaxChange, onDone: editOptions.onEditDone }
    : null, index, total, textMode));
  return row;
}

/**
 * @param {string} name
 * @param {string} hex
 * @param {{ tone?: number, hue?: number, chroma?: number } | null} data
 * @param {'tone' | 'hue' | 'chroma' | 'hc'} valueFormat
 * @param {{ onChange: (hex: string) => void, onDone?: () => void } | null} [editHandler]
 * @param {number} [index]
 * @param {number} [total]
 * @param {'lm' | 'dm'} [textMode]
 */
function createSwatch(name, hex, data, valueFormat, editHandler = null, index = 0, total = 1, textMode = 'lm') {
  const wrap = document.createElement('div');
  wrap.className = 'swatch-wrap';

  const nameEl = document.createElement('div');
  nameEl.className = 'swatch-name';
  nameEl.textContent = name;
  wrap.appendChild(nameEl);

  const color = document.createElement('div');
  color.className = 'swatch';
  color.style.background = hex;

  const valueText = formatSwatchValue(data, valueFormat);
  color.title = editHandler
    ? `${name}: ${hex}\nKlikni pro změnu barvy`
    : valueText ? `${name}: ${hex}\n${valueText}` : `${name}: ${hex}`;

  const valueEl = document.createElement('div');
  valueEl.className = 'swatch-value';
  valueEl.textContent = valueText;
  valueEl.style.color = getSwatchTextColor(index, total, textMode);
  color.appendChild(valueEl);

  if (editHandler) {
    attachSwatchColorEdit(color, hex, editHandler);
  }

  wrap.appendChild(color);
  return wrap;
}

/**
 * @param {HTMLElement} colorEl
 * @param {string} initialHex
 * @param {{ onChange: (hex: string) => void, onDone?: () => void }} handler
 */
function attachSwatchColorEdit(colorEl, initialHex, handler) {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = initialHex;
  input.className = 'swatch-color-input';

  let currentHex = initialHex;
  colorEl._currentHex = initialHex;
  colorEl.classList.add('swatch-editable');

  colorEl.addEventListener('click', () => {
    input.value = colorEl._currentHex;
    input.click();
  });

  input.addEventListener('input', () => {
    currentHex = input.value;
    colorEl._currentHex = currentHex;
    colorEl.style.background = currentHex;
    handler.onChange(currentHex);
  });

  input.addEventListener('change', () => {
    currentHex = input.value;
    colorEl._currentHex = currentHex;
    handler.onChange(currentHex);
    handler.onDone?.();
  });

  colorEl.appendChild(input);
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

  const applyValue = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = min;
    v = Math.round(v);
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
    ariaLabel: `${label} value`,
    controlKey: options.controlKey ?? null,
  });

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
 * Fixed chroma: free 0–UI max, informational peak marker + editable number.
 * @param {import('../src/engine.js').ParamConfig} param
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} steps
 * @param {number} uiMax
 */
function createChromaFixedSlider(param, palette, mode, steps, uiMax) {
  const controlKey = `${palette.id}:${mode}:fixed`;
  return createSliderControl('Value', param.value, 0, uiMax, (v) => {
    param.value = v;
    scheduleRefreshPreviews();
  }, {
    controlKey,
    markerKey: controlKey,
    getMarkerMax: () => chromaPeakForPalette(palette, mode, steps),
    hardClampToMarker: false,
  });
}

/**
 * Interpolate chroma point: marker = hard ceiling for that step.
 * @param {{ step: number, value: number }} point
 * @param {ReturnType<typeof createCustomPalette>} palette
 * @param {'lm' | 'dm'} mode
 * @param {number[]} steps
 * @param {number} pointIndex
 * @param {number} uiMax
 */
function createChromaPointSlider(point, palette, mode, steps, pointIndex, uiMax) {
  const controlKey = `${palette.id}:${mode}:point:${pointIndex}`;
  const limit = chromaLimitAtStep(palette, mode, steps, point.step);
  const initial = Math.min(point.value, limit);
  point.value = initial;

  return createSliderControl('Value', initial, 0, uiMax, (v) => {
    point.value = v;
    scheduleRefreshPreviews();
  }, {
    controlKey,
    markerKey: controlKey,
    getMarkerMax: () => chromaLimitAtStep(palette, mode, steps, point.step),
    hardClampToMarker: true,
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
 * @param {import('../src/engine.js').Bezier} bezier
 * @param {(b: import('../src/engine.js').Bezier) => void} onChange
 * @param {boolean} [disabled]
 */
function createBezierInputs(bezier, onChange, disabled = false) {
  const wrap = document.createElement('div');
  wrap.className = 'bezier-input';

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
  return wrap;
}

try {
  render();
} catch (err) {
  showError(err);
}
