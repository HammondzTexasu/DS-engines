import {
  AXIS_CONFIDENCE_LEVELS,
  createDefaultState,
  importEngineConfig,
  exportEngineConfig,
  generateSystem,
  clampAxisValue,
  sanitizeProfileName,
} from '../src/art-engine.js';

/** @type {import('../src/art-engine.js').ArtState} */
let state = createDefaultState();

const app = document.getElementById('app');

/** @type {Set<ResizeObserver>} */
const sliderResizeObservers = new Set();

/** @type {number | null} */
let outputRefreshRaf = null;

function scheduleRefreshOutputs() {
  if (outputRefreshRaf !== null) return;
  outputRefreshRaf = requestAnimationFrame(() => {
    outputRefreshRaf = null;
    refreshOutputs();
  });
}

/**
 * @param {HTMLInputElement | HTMLTextAreaElement} input
 * @param {() => void} commit
 */
function bindLiveCommit(input, commit) {
  input.addEventListener('input', () => {
    commit();
    scheduleRefreshOutputs();
  });
  input.addEventListener('change', () => {
    commit();
    refreshOutputs();
  });
}

async function boot() {
  try {
    const response = await fetch('../config/engine-config.json', { cache: 'no-store' });
    if (response.ok) state = importEngineConfig(await response.json());
  } catch {
    /* engine defaults */
  }
  render();
}

function system() {
  return generateSystem(state);
}

function formatConfigJson() {
  return JSON.stringify(exportEngineConfig(state), null, 2);
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

const RANGE_THUMB_PX = 12;

/** @param {HTMLInputElement} range @param {number} value */
function rangeThumbCenterPx(range, value) {
  const min = Number(range.min);
  const max = Number(range.max);
  const width = range.getBoundingClientRect().width;
  const travel = Math.max(0, width - RANGE_THUMB_PX);
  const t = max === min ? 0 : (value - min) / (max - min);
  return t * travel + RANGE_THUMB_PX / 2;
}

/** @param {HTMLElement} wrap @param {HTMLInputElement} range */
function syncSliderVisuals(wrap, range) {
  const width = range.getBoundingClientRect().width;
  const fill = wrap.querySelector('.slider-track-fill');
  if (fill instanceof HTMLElement && width > 0) {
    fill.style.width = `${rangeThumbCenterPx(range, Number(range.value))}px`;
  }
}

/** @param {HTMLElement} wrap @param {HTMLInputElement} range */
function attachSliderVisualSync(wrap, range) {
  const sync = () => syncSliderVisuals(wrap, range);
  sync();
  const observer = new ResizeObserver(sync);
  sliderResizeObservers.add(observer);
  observer.observe(wrap);
}

/** @param {HTMLInputElement} range */
function attachRangePointerCapture(range) {
  range.addEventListener('pointerdown', (event) => {
    try {
      range.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  });
  const release = (event) => {
    try {
      if (range.hasPointerCapture(event.pointerId)) {
        range.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* ignore */
    }
  };
  range.addEventListener('pointerup', release);
  range.addEventListener('pointercancel', release);
}

/** @param {HTMLElement} wrap */
function createSliderTrack(wrap) {
  const track = document.createElement('div');
  track.className = 'slider-track';
  track.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div');
  fill.className = 'slider-track-fill';
  track.appendChild(fill);
  wrap.appendChild(track);
}

/** @param {number} min @param {number} max @param {number} decimals */
function hugCharsForSliderRange(min, max, decimals) {
  const format = (number) => {
    if (decimals <= 0) return String(Math.round(number));
    const factor = 10 ** decimals;
    return (Math.round(number * factor) / factor).toFixed(decimals);
  };
  return Math.max(2, format(min).length, format(max).length);
}

/**
 * @param {string} label
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {(value: number) => void} onChange
 * @param {{ live?: boolean }} [options]
 */
function createSliderControl(label, value, min, max, onChange, options = {}) {
  const live = options.live !== false;
  const step = 1;
  const applyValue = (raw) => {
    let next = Math.round(Number(raw));
    if (!Number.isFinite(next)) next = min;
    return Math.max(min, Math.min(max, next));
  };

  const group = document.createElement('div');
  group.className = 'control-group slider-control';

  const labelNode = document.createElement('label');
  labelNode.textContent = label;
  group.appendChild(labelNode);

  const row = document.createElement('div');
  row.className = 'slider-control-row';

  const numberInput = document.createElement('input');
  numberInput.type = 'text';
  numberInput.inputMode = 'numeric';
  numberInput.autocomplete = 'off';
  numberInput.spellcheck = false;
  numberInput.className = 'ui-control ui-control--hug';
  numberInput.setAttribute('aria-label', `${label} value`);
  numberInput.style.setProperty('--hug-ch', String(hugCharsForSliderRange(min, max, 0)));

  const wrap = document.createElement('div');
  wrap.className = 'chroma-slider-wrap';
  createSliderTrack(wrap);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(applyValue(value));
  range.setAttribute('aria-label', label);
  attachRangePointerCapture(range);

  const paint = (next, paintOptions = {}) => {
    const syncRange = paintOptions.syncRange !== false;
    const shown = String(next);
    numberInput.value = shown;
    if (syncRange) {
      const current = Number(range.value);
      if (!Number.isFinite(current) || current !== next) range.value = shown;
    }
    syncSliderVisuals(wrap, range);
  };
  paint(applyValue(value));

  numberInput.addEventListener('change', () => {
    const next = applyValue(numberInput.value);
    onChange(next);
    paint(next);
    refreshOutputs();
  });
  range.addEventListener('input', () => {
    const next = applyValue(range.value);
    onChange(next);
    paint(next, { syncRange: false });
    if (live) scheduleRefreshOutputs();
  });
  range.addEventListener('change', () => {
    refreshOutputs();
  });

  row.append(numberInput, wrap);
  wrap.appendChild(range);
  group.appendChild(row);
  attachSliderVisualSync(wrap, range);
  return group;
}

/** @param {string} title @param {HTMLElement} fieldsetBody */
function wrapSection(title, fieldsetBody) {
  const wrap = document.createElement('div');
  wrap.className = 'palette-fieldset-wrap';

  const header = document.createElement('div');
  header.className = 'palette-fieldset-header';

  const titleEl = document.createElement('div');
  titleEl.className = 'palette-fieldset-title';
  const span = document.createElement('span');
  span.className = 'palette-name-text';
  span.textContent = title;
  titleEl.appendChild(span);
  header.appendChild(titleEl);

  const fieldset = document.createElement('fieldset');
  fieldset.appendChild(fieldsetBody);
  wrap.append(header, fieldset);
  return wrap;
}

/** @param {string} title @param {string} panelName @param {HTMLElement} body @param {boolean} [expanded] */
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
  panel.appendChild(toggleBtn);
  panel.appendChild(bodyWrap);
  return panel;
}

/**
 * @param {string} outputKind
 * @param {string} text
 * @param {() => string} currentText
 * @param {string} downloadName
 * @param {string} mime
 */
function createOutputPanelBody(outputKind, text, currentText, downloadName, mime) {
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
  output.dataset.output = outputKind;
  output.textContent = text;
  body.appendChild(output);

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'palette-header-action';
  downloadBtn.textContent = 'Download';
  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([currentText()], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Downloaded.');
  });

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'palette-header-action';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentText());
      setStatus('Copied to clipboard.');
    } catch {
      setStatus('Could not copy to clipboard.', true);
    }
  });

  actions.append(downloadBtn, copyBtn);
  body.append(actions, status);
  return body;
}

function refreshOutputs() {
  const result = system();
  const outputs = {
    guidance: result.llmGuidance,
    checklist: result.critiqueChecklistMarkdown,
    generation: result.generationPrompt,
    review: result.reviewPrompt,
    refine: result.refineConfigPrompt,
    config: JSON.stringify(result.config, null, 2),
  };
  for (const [kind, value] of Object.entries(outputs)) {
    const node = app.querySelector(`[data-output="${kind}"]`);
    if (node) node.textContent = value;
  }
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

function profileControls() {
  const body = document.createElement('div');
  body.className = 'controls controls--global';

  const name = document.createElement('input');
  name.type = 'text';
  name.className = 'ui-control ui-control--block';
  name.value = state.styleProfile.name;
  name.addEventListener('change', () => {
    state.styleProfile.name = sanitizeProfileName(name.value);
    render();
  });

  const summary = document.createElement('textarea');
  summary.className = 'ui-control ui-control--multiline';
  summary.value = state.styleProfile.summary;
  bindLiveCommit(summary, () => {
    state.styleProfile.summary = summary.value;
  });

  body.append(
    labeledControl('profile name', name),
    labeledControl('summary', summary),
  );

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'palette-header-action';
  importBtn.textContent = 'Import file';
  importBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      state = importEngineConfig(await file.text());
      render();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Import failed.');
    }
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'palette-header-action';
  resetBtn.textContent = 'Reset default';
  resetBtn.addEventListener('click', () => {
    state = createDefaultState();
    render();
  });

  actions.append(importBtn, resetBtn, fileInput);
  body.appendChild(actions);
  return body;
}

function axesControls() {
  const body = document.createElement('div');
  body.className = 'axis-list';

  for (let index = 0; index < state.axes.length; index++) {
    const axis = state.axes[index];
    const block = document.createElement('div');
    block.className = 'axis-block';

    const slider = createSliderControl(axis.label, axis.value, 0, 100, (value) => {
      state.axes[index].value = clampAxisValue(value);
    });

    const poles = document.createElement('div');
    poles.className = 'axis-poles';
    const lowPole = document.createElement('span');
    lowPole.textContent = axis.meaningLow;
    const highPole = document.createElement('span');
    highPole.textContent = axis.meaningHigh;
    poles.append(lowPole, highPole);

    const confidence = document.createElement('select');
    confidence.className = 'ui-control ui-control--select';
    for (const [value, label] of [
      ['', 'not set'],
      ...AXIS_CONFIDENCE_LEVELS.map((level) => [level, level]),
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = axis.confidence === value || (!axis.confidence && value === '');
      confidence.appendChild(option);
    }
    confidence.addEventListener('change', () => {
      state.axes[index].confidence =
        confidence.value === 'low' ||
        confidence.value === 'medium' ||
        confidence.value === 'high'
          ? confidence.value
          : null;
      refreshOutputs();
    });

    const low = document.createElement('input');
    low.type = 'text';
    low.className = 'ui-control ui-control--block';
    low.value = axis.meaningLow;
    bindLiveCommit(low, () => {
      state.axes[index].meaningLow = low.value;
      lowPole.textContent = low.value;
    });

    const high = document.createElement('input');
    high.type = 'text';
    high.className = 'ui-control ui-control--block';
    high.value = axis.meaningHigh;
    bindLiveCommit(high, () => {
      state.axes[index].meaningHigh = high.value;
      highPole.textContent = high.value;
    });

    block.append(
      slider,
      poles,
      labeledControl('confidence', confidence),
      labeledControl('low pole meaning', low),
      labeledControl('high pole meaning', high),
    );
    body.appendChild(block);
  }

  return body;
}

/** @param {'rules' | 'antiRules' | 'heuristics' | 'notes'} key @param {string} label */
function listControl(key, label) {
  const input = document.createElement('textarea');
  input.className = 'ui-control ui-control--multiline';
  input.value = state[key].join('\n');
  bindLiveCommit(input, () => {
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
    listControl('notes', 'owner notes'),
  );
  return body;
}

function snippetsControls() {
  const body = document.createElement('div');
  body.className = 'controls';

  if (!state.snippets.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No reference snippets.';
    body.appendChild(empty);
  }

  state.snippets.forEach((snippet, index) => {
    const card = document.createElement('div');
    card.className = 'snippet-card';

    const head = document.createElement('div');
    head.className = 'snippet-head';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'ui-control ui-control--block';
    name.value = snippet.name;

    const language = document.createElement('input');
    language.type = 'text';
    language.className = 'ui-control ui-control--block';
    language.value = snippet.language;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'palette-header-action';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      state.snippets.splice(index, 1);
      render();
    });

    head.append(name, language, remove);

    const why = document.createElement('input');
    why.type = 'text';
    why.className = 'ui-control ui-control--block';
    why.value = snippet.why || '';

    const code = document.createElement('textarea');
    code.className = 'ui-control ui-control--multiline';
    code.value = snippet.code;

    const commitSnippet = () => {
      const current = state.snippets[index];
      if (!current) return;
      current.name = name.value;
      current.language = language.value;
      current.why = why.value;
      current.code = code.value;
    };
    for (const field of [name, language, why, code]) {
      bindLiveCommit(field, commitSnippet);
    }

    card.append(
      head,
      labeledControl('why', why),
      labeledControl('code', code),
    );
    body.appendChild(card);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'palette-header-action';
  add.textContent = 'Add snippet';
  add.addEventListener('click', () => {
    state.snippets.push({ name: 'reference', language: 'css', code: '/* reference */' });
    render();
  });
  body.appendChild(add);
  return body;
}

function referencesControls() {
  const input = document.createElement('textarea');
  input.className = 'ui-control ui-control--multiline';
  input.value = state.sourceReferences
    .map((reference) => `${reference.label || ''} | ${reference.note || ''}`)
    .join('\n');
  bindLiveCommit(input, () => {
    state.sourceReferences = splitLines(input.value).map((line) => {
      const [label, ...noteParts] = line.split('|');
      const cleanLabel = label.trim();
      const cleanNote = noteParts.join('|').trim();
      return {
        ...(cleanLabel ? { label: cleanLabel } : {}),
        ...(cleanNote ? { note: cleanNote } : {}),
      };
    });
  });
  return labeledControl('label | note · one reference per line', input);
}

function render() {
  disconnectSliderResizeObservers();
  const expandedPanels = new Set(
    [...app.querySelectorAll('.collapse-panel:not(.is-collapsed)')]
      .map((panel) => panel.dataset.panel)
      .filter(Boolean),
  );
  const result = system();
  app.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const sidebar = document.createElement('div');
  sidebar.className = 'app-sidebar';

  const header = document.createElement('div');
  header.className = 'app-sidebar-header';
  const title = document.createElement('h1');
  const back = document.createElement('a');
  back.href = '../../';
  back.className = 'app-title-back';
  back.textContent = '←';
  title.append(back, document.createTextNode('Art Engine'));
  header.appendChild(title);

  const sidebarBody = document.createElement('div');
  sidebarBody.className = 'app-sidebar-body';

  const sidebarScroll = document.createElement('div');
  sidebarScroll.className = 'app-sidebar-scroll';
  sidebarScroll.append(
    wrapSection('Profile', profileControls()),
    wrapSection('Style axes', axesControls()),
    wrapSection('Rules', rulesControls()),
    wrapSection('Reference snippets', snippetsControls()),
    wrapSection('Source references', referencesControls()),
  );
  sidebarBody.appendChild(sidebarScroll);

  sidebar.append(header, sidebarBody);

  const main = document.createElement('div');
  main.className = 'app-main';
  main.append(
    wrapSection(
      'LLM guidance',
      createOutputPanelBody(
        'guidance',
        result.llmGuidance,
        () => app.querySelector('[data-output="guidance"]')?.textContent || result.llmGuidance,
        'art-engine-guidance.md',
        'text/markdown',
      ),
    ),
    createCollapsePanel(
      'Critique checklist',
      'checklist',
      createOutputPanelBody(
        'checklist',
        result.critiqueChecklistMarkdown,
        () =>
          app.querySelector('[data-output="checklist"]')?.textContent ||
          result.critiqueChecklistMarkdown,
        'art-engine-checklist.md',
        'text/markdown',
      ),
      expandedPanels.has('checklist'),
    ),
    createCollapsePanel(
      'Generation prompt',
      'generation',
      createOutputPanelBody(
        'generation',
        result.generationPrompt,
        () =>
          app.querySelector('[data-output="generation"]')?.textContent || result.generationPrompt,
        'art-engine-generation-prompt.md',
        'text/markdown',
      ),
      expandedPanels.has('generation'),
    ),
    createCollapsePanel(
      'Review prompt',
      'review',
      createOutputPanelBody(
        'review',
        result.reviewPrompt,
        () => app.querySelector('[data-output="review"]')?.textContent || result.reviewPrompt,
        'art-engine-review-prompt.md',
        'text/markdown',
      ),
      expandedPanels.has('review'),
    ),
    createCollapsePanel(
      'Refine config prompt',
      'refine',
      createOutputPanelBody(
        'refine',
        result.refineConfigPrompt,
        () =>
          app.querySelector('[data-output="refine"]')?.textContent || result.refineConfigPrompt,
        'art-engine-refine-config-prompt.md',
        'text/markdown',
      ),
      expandedPanels.has('refine'),
    ),
    createCollapsePanel(
      'Engine config',
      'config',
      createOutputPanelBody(
        'config',
        formatConfigJson(),
        () => app.querySelector('[data-output="config"]')?.textContent || formatConfigJson(),
        'art-engine-config.json',
        'application/json',
      ),
      expandedPanels.has('config'),
    ),
  );

  shell.append(sidebar, main);
  app.appendChild(shell);
}

boot();
