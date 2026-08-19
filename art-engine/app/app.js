import {
  AXIS_CONFIDENCE_LEVELS,
  MAX_AXIS_SNIPPETS,
  assignUniqueAxisName,
  clampAxisValue,
  createDefaultState,
  generateSystem,
  importEngineConfig,
  sanitizeId,
} from '../src/art-engine.js';

/** @type {import('../src/art-engine.js').ArtState} */
let state = createDefaultState();

const app = document.getElementById('app');
const sliderResizeObservers = new Set();
const expandedSnippetAxes = new WeakSet();
let refreshRaf = null;

/** @type {{ message: string, isError: boolean } | null} */
let pendingConfigStatus = null;

/** Prefer `config/art-config.json`; fall back to engine `createDefaultState()`. */
async function loadInitialState() {
  try {
    const response = await fetch('../config/art-config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return importEngineConfig(await response.json());
  } catch {
    return createDefaultState();
  }
}

async function boot() {
  state = await loadInitialState();
  render();
}

function currentSystem() {
  return generateSystem(state);
}

function configJson() {
  return JSON.stringify(currentSystem().config, null, 2);
}

function scheduleRefresh() {
  if (refreshRaf !== null) return;
  refreshRaf = requestAnimationFrame(() => {
    refreshRaf = null;
    refreshOutputs();
  });
}

function refreshOutputs() {
  const result = currentSystem();
  const prompt = app.querySelector('[data-panel="prompt"] [data-output="prompt"]');
  const config = app.querySelector('[data-panel="config"] [data-output="config"]');
  if (prompt) prompt.textContent = result.prompt;
  if (config) config.textContent = JSON.stringify(result.config, null, 2);
}

/** @param {string} panelName */
function collectCollapsePanelExpanded(panelName) {
  const panel = app.querySelector(`.collapse-panel[data-panel="${panelName}"]`);
  return panel ? !panel.classList.contains('is-collapsed') : false;
}

/**
 * @param {HTMLInputElement | HTMLTextAreaElement} input
 * @param {() => void} commit
 */
function bindLive(input, commit) {
  input.addEventListener('input', () => {
    commit();
    scheduleRefresh();
  });
  input.addEventListener('change', () => {
    commit();
    refreshOutputs();
  });
}

/** @param {string} value */
function splitLines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function disconnectSliderResizeObservers() {
  for (const observer of sliderResizeObservers) observer.disconnect();
  sliderResizeObservers.clear();
}

/** @param {string} label @param {HTMLElement} control */
function labeledControl(label, control) {
  const group = document.createElement('div');
  group.className = 'control-group';
  const labelNode = document.createElement('label');
  labelNode.textContent = label;
  group.append(labelNode, control);
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
  if (headerAction) header.appendChild(headerAction);

  wrap.appendChild(header);
  wrap.appendChild(fs);
  return wrap;
}

/** @param {string} title @param {HTMLElement} body */
function wrapSection(title, body) {
  const wrap = document.createElement('div');
  wrap.className = 'palette-fieldset-wrap';

  const header = document.createElement('div');
  header.className = 'palette-fieldset-header';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'palette-fieldset-title';
  const titleNode = document.createElement('span');
  titleNode.className = 'palette-name-text';
  titleNode.textContent = title;
  titleWrap.appendChild(titleNode);
  header.appendChild(titleWrap);

  const fieldset = document.createElement('fieldset');
  fieldset.appendChild(body);
  wrap.append(header, fieldset);
  return wrap;
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
  toggleBtn.append(chevron, titleText);
  toggleBtn.addEventListener('click', () => {
    panel.classList.toggle('is-collapsed');
    toggleBtn.setAttribute('aria-expanded', String(!panel.classList.contains('is-collapsed')));
  });

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'collapse-panel-body';
  bodyWrap.appendChild(body);
  panel.append(toggleBtn, bodyWrap);
  return panel;
}

/**
 * @param {string} text
 * @param {string} filename
 * @param {string} type
 */
function downloadText(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * @param {HTMLElement} status
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(status, message, isError = false) {
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

/**
 * @param {string} text
 * @param {HTMLElement} status
 * @param {string} message
 */
async function copyText(text, status, message) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(status, message);
  } catch {
    setStatus(status, 'Could not copy to clipboard.', true);
  }
}

function profileControls() {
  const body = document.createElement('div');
  body.className = 'controls';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'ui-control ui-control--block';
  name.value = state.styleProfile.name;
  name.addEventListener('change', () => {
    state.styleProfile.name = sanitizeId(name.value);
    name.value = state.styleProfile.name;
    refreshOutputs();
  });

  const summary = document.createElement('textarea');
  summary.className = 'ui-control ui-control--multiline';
  summary.value = state.styleProfile.summary;
  bindLive(summary, () => {
    state.styleProfile.summary = summary.value;
  });

  body.append(labeledControl('profile name', name), labeledControl('summary', summary));
  return body;
}

const RANGE_THUMB_PX = 12;

/** @param {HTMLElement} wrap @param {HTMLInputElement} range */
function syncSliderVisuals(wrap, range) {
  const width = range.getBoundingClientRect().width;
  const fill = wrap.querySelector('.slider-track-fill');
  if (!(fill instanceof HTMLElement) || width <= 0) return;
  const min = Number(range.min);
  const max = Number(range.max);
  const travel = Math.max(0, width - RANGE_THUMB_PX);
  const ratio = max === min ? 0 : (Number(range.value) - min) / (max - min);
  fill.style.width = `${ratio * travel + RANGE_THUMB_PX / 2}px`;
}

/**
 * @param {string} label
 * @param {number} value
 * @param {(value: number) => void} commit
 */
function createSliderControl(label, value, commit) {
  const group = document.createElement('div');
  group.className = 'control-group';

  const labelNode = document.createElement('label');
  labelNode.textContent = label;

  const row = document.createElement('div');
  row.className = 'slider-control-row';

  const number = document.createElement('input');
  number.type = 'text';
  number.inputMode = 'numeric';
  number.className = 'ui-control ui-control--hug';
  number.style.setProperty('--hug-ch', '3');

  const wrap = document.createElement('div');
  wrap.className = 'chroma-slider-wrap';
  const track = document.createElement('div');
  track.className = 'slider-track';
  const fill = document.createElement('div');
  fill.className = 'slider-track-fill';
  track.appendChild(fill);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.step = '1';
  range.value = String(clampAxisValue(value));
  range.setAttribute('aria-label', label);

  const paint = (next) => {
    number.value = String(next);
    range.value = String(next);
    syncSliderVisuals(wrap, range);
  };
  paint(clampAxisValue(value));

  range.addEventListener('input', () => {
    const next = clampAxisValue(range.value);
    number.value = String(next);
    commit(next);
    syncSliderVisuals(wrap, range);
    scheduleRefresh();
  });
  range.addEventListener('change', refreshOutputs);

  number.addEventListener('change', () => {
    const next = clampAxisValue(number.value);
    commit(next);
    paint(next);
    refreshOutputs();
  });

  wrap.append(track, range);
  row.append(number, wrap);
  group.append(labelNode, row);

  const observer = new ResizeObserver(() => syncSliderVisuals(wrap, range));
  observer.observe(wrap);
  sliderResizeObservers.add(observer);

  return {
    element: group,
    setLabel(next) {
      labelNode.textContent = next;
      range.setAttribute('aria-label', next);
    },
  };
}

/**
 * @param {import('../src/art-engine.js').ArtAxis} axis
 * @param {number} index
 */
function createDimensionFieldset(axis, index) {
  const fs = document.createElement('fieldset');
  fs.className = 'dimension-fieldset';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'ui-ghost palette-name-input';
  nameInput.value = axis.name;
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'Dimension name');

  const slider = createSliderControl('value', axis.value, (value) => {
    const current = state.axes[index];
    if (current) current.value = value;
  });

  const poles = document.createElement('div');
  poles.className = 'axis-poles';
  const lowPole = document.createElement('span');
  lowPole.textContent = axis.meaningLow;
  const highPole = document.createElement('span');
  highPole.textContent = axis.meaningHigh;
  poles.append(lowPole, highPole);

  const fields = document.createElement('div');
  fields.className = 'axis-fields';

  const low = document.createElement('input');
  low.type = 'text';
  low.className = 'ui-control ui-control--block';
  low.value = axis.meaningLow;

  const high = document.createElement('input');
  high.type = 'text';
  high.className = 'ui-control ui-control--block';
  high.value = axis.meaningHigh;

  const confidence = document.createElement('select');
  confidence.className = 'ui-control ui-control--select';
  for (const value of ['', ...AXIS_CONFIDENCE_LEVELS]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value || 'not set';
    option.selected = (axis.confidence || '') === value;
    confidence.appendChild(option);
  }

  fields.append(
    labeledControl('low pole meaning', low),
    labeledControl('high pole meaning', high),
    labeledControl('confidence', confidence),
  );

  bindLive(nameInput, () => {
    const current = state.axes[index];
    if (!current) return;
    current.name = nameInput.value;
    refreshOutputs();
  });
  nameInput.addEventListener('change', () => {
    const current = state.axes[index];
    if (!current) return;
    const usedKeys = new Set(
      state.axes.filter((_, i) => i !== index).map((axis) => sanitizeId(axis.name)),
    );
    current.name = assignUniqueAxisName(nameInput.value, usedKeys);
    nameInput.value = current.name;
    refreshOutputs();
  });
  bindLive(low, () => {
    const current = state.axes[index];
    if (!current) return;
    current.meaningLow = low.value;
    lowPole.textContent = low.value;
  });
  bindLive(high, () => {
    const current = state.axes[index];
    if (!current) return;
    current.meaningHigh = high.value;
    highPole.textContent = high.value;
  });
  confidence.addEventListener('change', () => {
    const current = state.axes[index];
    if (!current) return;
    current.confidence = AXIS_CONFIDENCE_LEVELS.includes(confidence.value)
      ? confidence.value
      : null;
    refreshOutputs();
  });

  fs.append(slider.element, poles, fields);
  fs.appendChild(createAxisSnippetControl(axis, index));

  const actions = document.createElement('div');
  actions.className = 'palette-header-actions';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'ui-btn danger palette-header-action custom-palette-remove';
  removeBtn.textContent = 'Remove';
  removeBtn.addEventListener('click', () => {
    state.axes.splice(index, 1);
    render();
  });
  actions.appendChild(removeBtn);

  return wrapPaletteFieldset(fs, nameInput, actions);
}

/**
 * @param {import('../src/art-engine.js').ArtAxis} axis
 * @param {number} index
 */
function createAxisSnippetControl(axis, index) {
  if (!Array.isArray(axis.snippets)) axis.snippets = [];

  const panel = document.createElement('div');
  const expanded = expandedSnippetAxes.has(axis);
  panel.className = `axis-snippet-panel${expanded ? '' : ' is-collapsed'}`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ui-ghost axis-snippet-toggle';
  toggle.setAttribute('aria-expanded', String(expanded));

  const chevron = document.createElement('span');
  chevron.className = 'collapse-panel-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '▾';

  const title = document.createElement('span');
  title.textContent = 'Reference overrides';
  toggle.append(chevron, title);
  toggle.addEventListener('click', () => {
    const isCollapsed = panel.classList.toggle('is-collapsed');
    toggle.setAttribute('aria-expanded', String(!isCollapsed));
    if (isCollapsed) expandedSnippetAxes.delete(axis);
    else expandedSnippetAxes.add(axis);
  });

  const body = document.createElement('div');
  body.className = 'axis-snippet-body';

  const persisted = axis.snippets;
  const editors = persisted.length ? persisted : [{ language: 'css', code: '', note: '' }];
  const ephemeral = persisted.length === 0;

  editors.forEach((snippet, snippetIndex) => {
    const item = document.createElement('div');
    item.className = 'axis-snippet-item';

    const language = document.createElement('input');
    language.type = 'text';
    language.className = 'ui-control ui-control--block';
    language.value = snippet.language;

    const note = document.createElement('input');
    note.type = 'text';
    note.className = 'ui-control ui-control--block';
    note.value = snippet.note || '';
    note.placeholder = 'When and where this override applies';

    const code = document.createElement('textarea');
    code.className = 'ui-control ui-control--multiline axis-snippet-code';
    code.spellcheck = false;
    code.value = snippet.code;
    code.placeholder = 'Saved only when code is not empty';

    const commitFields = () => {
      const currentAxis = state.axes[index];
      if (!currentAxis) return;
      const next = {
        language: language.value.trim() || 'css',
        code: code.value,
        ...(note.value.trim() ? { note: note.value } : {}),
      };
      if (ephemeral) {
        if (!next.code.trim()) return;
        currentAxis.snippets.push(next);
        render();
        return;
      }
      const current = currentAxis.snippets[snippetIndex];
      if (!current) return;
      current.language = next.language;
      current.code = next.code;
      if (next.note) current.note = next.note;
      else delete current.note;
    };

    bindLive(language, commitFields);
    bindLive(note, commitFields);
    bindLive(code, commitFields);

    const actions = document.createElement('div');
    actions.className = 'axis-snippet-actions';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'palette-header-action axis-snippet-remove';
    removeBtn.textContent = 'Remove override';
    removeBtn.addEventListener('click', () => {
      const current = state.axes[index];
      if (!current) return;
      if (!ephemeral) current.snippets.splice(snippetIndex, 1);
      render();
    });
    actions.appendChild(removeBtn);

    const canAdd = (ephemeral ? 0 : persisted.length) < MAX_AXIS_SNIPPETS;
    if (canAdd && snippetIndex === editors.length - 1) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'palette-header-action axis-snippet-add';
      addBtn.textContent = 'Add override';
      addBtn.addEventListener('click', () => {
        const current = state.axes[index];
        if (!current || current.snippets.length >= MAX_AXIS_SNIPPETS) return;
        current.snippets.push({ language: 'css', code: '' });
        expandedSnippetAxes.add(current);
        render();
      });
      actions.appendChild(addBtn);
    }

    item.append(
      labeledControl('language', language),
      labeledControl('note · optional', note),
      labeledControl('code', code),
      actions,
    );
    body.appendChild(item);
  });

  panel.append(toggle, body);
  return panel;
}

function createAddDimensionWrap() {
  const wrap = document.createElement('div');
  wrap.className = 'palette-fieldset-wrap palette-add-wrap';

  const header = document.createElement('div');
  header.className = 'palette-fieldset-header';

  const spacer = document.createElement('div');
  spacer.className = 'palette-fieldset-title';
  spacer.setAttribute('aria-hidden', 'true');
  header.appendChild(spacer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'ui-btn add-palette-btn palette-header-action';
  addBtn.textContent = '+ Add dimension';
  addBtn.addEventListener('click', () => {
    const usedKeys = new Set(state.axes.map((axis) => sanitizeId(axis.name)));
    state.axes.push({
      name: assignUniqueAxisName('New dimension', usedKeys),
      value: 50,
      meaningLow: 'low expression',
      meaningHigh: 'high expression',
      confidence: null,
      snippets: [],
    });
    render();
  });
  header.appendChild(addBtn);

  wrap.appendChild(header);
  return wrap;
}

/** @param {'rules' | 'antiRules' | 'heuristics'} key @param {string} label */
function listControl(key, label) {
  const input = document.createElement('textarea');
  input.className = 'ui-control ui-control--multiline';
  input.value = state[key].join('\n');
  bindLive(input, () => {
    state[key] = splitLines(input.value);
  });
  return labeledControl(`${label} · one item per line`, input);
}

function rulesControls() {
  const body = document.createElement('div');
  body.className = 'controls';
  body.append(
    listControl('rules', 'do'),
    listControl('antiRules', 'avoid'),
    listControl('heuristics', 'decision heuristics'),
  );
  return body;
}

/** @param {unknown} raw */
function applyImportedConfig(raw) {
  state = importEngineConfig(typeof raw === 'string' ? JSON.parse(raw) : raw);
  render();
}

function configControls() {
  const body = document.createElement('div');
  body.className = 'config-panel-body';

  const status = document.createElement('div');
  status.className = 'config-status';
  status.setAttribute('aria-live', 'polite');

  const output = document.createElement('pre');
  output.className = 'code-output';
  output.dataset.output = 'config';
  output.textContent = configJson();
  body.appendChild(output);

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'palette-header-action';
  downloadBtn.textContent = 'Download JSON';
  downloadBtn.addEventListener('click', () => {
    downloadText(configJson(), 'art-config.json', 'application/json');
    setStatus(status, 'Config downloaded.');
  });
  actions.appendChild(downloadBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'palette-header-action';
  copyBtn.textContent = 'Copy JSON';
  copyBtn.addEventListener('click', () => {
    void copyText(configJson(), status, 'Config copied to clipboard.');
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
    } catch (error) {
      pendingConfigStatus = null;
      setStatus(status, error instanceof Error ? error.message : 'Import failed.', true);
    }
  });

  body.append(actions, fileInput);

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
      setStatus(status, 'Paste JSON config before applying import.', true);
      return;
    }
    try {
      pendingConfigStatus = { message: 'Config imported.', isError: false };
      applyImportedConfig(raw);
    } catch (error) {
      pendingConfigStatus = null;
      setStatus(status, error instanceof Error ? error.message : 'Import failed.', true);
    }
  });
  body.append(applyBtn, status);

  if (pendingConfigStatus) {
    setStatus(status, pendingConfigStatus.message, pendingConfigStatus.isError);
    pendingConfigStatus = null;
  }

  return body;
}

function promptControls() {
  const body = document.createElement('div');
  body.className = 'config-panel-body';

  const status = document.createElement('div');
  status.className = 'config-status';
  status.setAttribute('aria-live', 'polite');

  const output = document.createElement('pre');
  output.className = 'code-output';
  output.dataset.output = 'prompt';
  output.textContent = currentSystem().prompt;
  body.appendChild(output);

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'palette-header-action';
  downloadBtn.textContent = 'Download prompt';
  downloadBtn.addEventListener('click', () => {
    downloadText(currentSystem().prompt, 'art-direction.md', 'text/markdown');
    setStatus(status, 'Prompt downloaded.');
  });
  actions.appendChild(downloadBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'palette-header-action';
  copyBtn.textContent = 'Copy prompt';
  copyBtn.addEventListener('click', () => {
    void copyText(currentSystem().prompt, status, 'Prompt copied to clipboard.');
  });
  actions.appendChild(copyBtn);

  body.append(actions, status);
  return body;
}

function render() {
  disconnectSliderResizeObservers();
  const configExpanded = collectCollapsePanelExpanded('config');
  const promptExpanded = collectCollapsePanelExpanded('prompt');
  app.replaceChildren();

  const header = document.createElement('header');
  const heading = document.createElement('h1');
  const back = document.createElement('a');
  back.href = '../../index.html';
  back.className = 'app-title-back';
  back.setAttribute('aria-label', 'Back to DS Engines');
  back.textContent = '←';
  heading.append(back, document.createTextNode('Art Engine'));
  header.appendChild(heading);
  app.appendChild(header);

  app.appendChild(wrapSection('Profile', profileControls()));

  for (const [index, axis] of state.axes.entries()) {
    app.appendChild(createDimensionFieldset(axis, index));
  }

  app.appendChild(createAddDimensionWrap());
  app.appendChild(wrapSection('Rules', rulesControls()));
  app.appendChild(createCollapsePanel('Engine config', 'config', configControls(), configExpanded));
  app.appendChild(
    createCollapsePanel('Art direction prompt', 'prompt', promptControls(), promptExpanded),
  );
}

boot();
