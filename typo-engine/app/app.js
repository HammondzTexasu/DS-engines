import {
  createDefaultState,
  importEngineConfig,
  exportEngineConfig,
  generateSystem,
  formatBezierCss,
  parseBezierCss,
  filterStyleNameInput,
  sanitizeStyleName,
  PREVIEW_SENTENCE,
  ICON_SOURCES,
  ICON_STYLES,
  iconFontFamilyName,
  iconSizeNameForIndex,
  normalizeIconStyle,
  materialSymbolsCssUrl,
  formatRem,
  formatEm,
  LINEAR_BEZIER,
} from '../src/typo-engine.js';

/** @type {import('../src/typo-engine.js').EngineState} */
let state = createDefaultState();

/** Preview sample text (UI-only; not in engine config). */
let previewSentence = PREVIEW_SENTENCE;

/** Preview icon ligature (UI-only; not in engine config). */
const PREVIEW_ICON_DEFAULT = 'home';
let previewIconName = PREVIEW_ICON_DEFAULT;

/** @type {Set<string>} */
const expandedStyles = new Set();

/** @type {{ message: string, isError: boolean } | null} */
let pendingConfigStatus = null;

/** @type {null | (() => void)} */
let closeActiveFloating = null;

/** Prevent re-entrant render when dismissFloatingPanels runs onClose → render. */
let renderLock = false;

const app = document.getElementById('app');

function dismissFloatingPanels() {
  const fn = closeActiveFloating;
  closeActiveFloating = null;
  fn?.();
}

async function boot() {
  try {
    const res = await fetch('../config/typo-config.json', { cache: 'no-store' });
    if (res.ok) {
      state = importEngineConfig(await res.json());
    }
  } catch {
    /* engine defaults */
  }
  render();
}

function system() {
  return generateSystem(state);
}

/** @type {number | null} */
let derivedRaf = null;

/** @type {boolean} */
let derivedSyncOpenTitles = false;

/**
 * Live update preview / style titles / tokens without tearing down slider DOM.
 * @param {{ syncOpenStyleTitles?: boolean }} [options]
 */
function scheduleRefreshDerived(options = {}) {
  const syncOpenStyleTitles = Boolean(options.syncOpenStyleTitles);
  if (derivedRaf !== null) {
    if (syncOpenStyleTitles) derivedSyncOpenTitles = true;
    return;
  }
  derivedSyncOpenTitles = syncOpenStyleTitles;
  derivedRaf = requestAnimationFrame(() => {
    derivedRaf = null;
    const openTitles = derivedSyncOpenTitles;
    derivedSyncOpenTitles = false;
    refreshDerived({ syncOpenStyleTitles: openTitles });
  });
}

/**
 * @param {{ syncOpenStyleTitles?: boolean }} [opts]
 */
function refreshDerived(opts = {}) {
  const { tokensCss, styles } = system();

  const grid = app.querySelector('.preview-grid');
  if (grid) {
    const familyMatch = tokensCss.match(/--typo-font-family:\s*([^;]+);/);
    if (familyMatch) {
      grid.style.fontFamily = familyMatch[1].trim();
    }

    for (const role of /** @type {const} */ (['regular', 'bold'])) {
      const col = grid.querySelector(`.preview-col[data-role="${role}"]`);
      if (!col) continue;
      const rows = col.querySelectorAll('.preview-row');
      // Structural mismatch (e.g. styleCount mid-drag) → full remount.
      if (rows.length !== styles.length) {
        render();
        return;
      }
      for (let i = 0; i < rows.length; i++) {
        const resolved = styles[i];
        const row = rows[i];
        const meta = row.querySelector('.preview-meta');
        const sample = row.querySelector('.preview-sample');
        if (!(meta instanceof HTMLElement) || !(sample instanceof HTMLElement)) continue;
        const weight = role === 'regular' ? resolved.weightRegular : resolved.weightBold;
        meta.textContent = `${resolved.name}-${role} · ${formatRem(resolved.fontSizeRem)} · w${weight} · lh ${resolved.lineHeight} · ls ${formatEm(resolved.letterSpacing)}`;
        sample.style.fontSize = formatRem(resolved.fontSizeRem);
        sample.style.fontWeight = String(weight);
        sample.style.lineHeight = String(resolved.lineHeight);
        sample.style.letterSpacing = formatEm(resolved.letterSpacing);
        sample.style.marginBottom = formatRem(resolved.paragraphSpacingRem);
      }
    }
  }

  const stylePanels = app.querySelectorAll('.style-panel[data-style-index]');
  stylePanels.forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    // Open panel: skip during drag — title reflow makes override sliders jump under the pointer.
    if (!panel.classList.contains('is-collapsed') && !opts.syncOpenStyleTitles) return;
    const index = Number(panel.dataset.styleIndex);
    const resolved = styles[index];
    if (!resolved) return;
    const titleText = panel.querySelector('.style-panel-title-text');
    if (titleText) {
      titleText.textContent = `${resolved.name} · ${formatRem(resolved.fontSizeRem)} / ${resolved.lineHeight} / ${formatEm(resolved.letterSpacing)}`;
    }
  });

  const tokensPre = app.querySelector('.collapse-panel[data-panel="tokens"] .code-output');
  if (tokensPre) {
    tokensPre.textContent = tokensCss;
  }

  const configPre = app.querySelector('.collapse-panel[data-panel="config"] .code-output');
  if (configPre) {
    configPre.textContent = formatEngineConfigJson();
  }

  if (!syncIconPreviewDom()) return;
}

/** @type {Map<string, { promise: Promise<'load' | 'error' | 'timeout'>, url: string }>} */
const stylesheetInflight = new Map();

/**
 * @param {string} linkId
 * @param {string} url
 * @returns {Promise<'load' | 'error' | 'timeout'>}
 */
function syncStylesheetLink(linkId, url) {
  const link = document.getElementById(linkId);
  if (!link) return Promise.resolve(/** @type {const} */ ('error'));

  const inflight = stylesheetInflight.get(linkId);
  if (inflight && inflight.url === url) return inflight.promise;

  // Cross-origin sheets often have link.sheet === null even when loaded — never
  // reload just because sheet is missing when href already matches.
  if (link.getAttribute('href') === url) {
    return Promise.resolve(/** @type {const} */ ('load'));
  }

  const promise = new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    /** @param {'load' | 'error' | 'timeout'} result */
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      link.removeEventListener('load', onLoad);
      link.removeEventListener('error', onError);
      resolve(result);
    };
    const onLoad = () => done('load');
    const onError = () => done('error');
    link.addEventListener('load', onLoad);
    link.addEventListener('error', onError);
    link.setAttribute('href', url);
    timer = window.setTimeout(() => done('timeout'), 8000);
  }).finally(() => {
    const cur = stylesheetInflight.get(linkId);
    if (cur && cur.url === url) stylesheetInflight.delete(linkId);
  });

  stylesheetInflight.set(linkId, { promise, url });
  return promise;
}

/**
 * @param {string} url
 * @returns {Promise<'load' | 'error' | 'timeout'>}
 */
function syncFontLink(url) {
  return syncStylesheetLink('typo-font-link', url);
}

/** Families where the variable-axis Google CSS 400'd (static fonts). Timeouts are not cached. */
const googleFontsRangeFailed = new Set();

/**
 * Prefer `100..900` (any weight on a variable font). If Google 400s, use discrete cuts.
 * @param {string} family
 * @param {string} variableUrl
 * @param {string} staticUrl
 * @returns {Promise<'load' | 'error' | 'timeout'>}
 */
async function syncFontLinkPreferVariable(family, variableUrl, staticUrl) {
  const key = String(family || '').trim().toLowerCase();
  if (!googleFontsRangeFailed.has(key)) {
    const first = await syncFontLink(variableUrl);
    if (first === 'load') return 'load';
    if (first === 'error' && key) googleFontsRangeFailed.add(key);
  }
  return syncFontLink(staticUrl);
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function previewIconLigature(raw = previewIconName) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '');
}

/**
 * Official SVG cuts exist at 100, 200, …, 700. Intermediate weights snap to nearest cut.
 * Weight 400 has no `wght` suffix in the filename.
 * @param {number} weight
 * @returns {100 | 200 | 300 | 400 | 500 | 600 | 700}
 */
function iconSvgWeightCut(weight) {
  const n = Number(weight);
  if (!Number.isFinite(n)) return 400;
  const cut = Math.round(n / 100) * 100;
  return /** @type {100 | 200 | 300 | 400 | 500 | 600 | 700} */ (
    Math.min(700, Math.max(100, cut))
  );
}

/**
 * Official Google 24px drawing (opsz 24). Display size is CSS only.
 * @param {string} style
 * @param {string} ligature
 * @param {number} weight
 * @returns {string}
 */
function iconSvgPreviewUrl(style, ligature, weight) {
  const folder = `materialsymbols${normalizeIconStyle(style)}`;
  const name = String(ligature || PREVIEW_ICON_DEFAULT).replace(/[^a-z0-9_]/g, '');
  const cut = iconSvgWeightCut(weight);
  const wght = cut === 400 ? '' : `_wght${cut}`;
  return `https://cdn.jsdelivr.net/gh/google/material-design-icons@master/symbols/web/${name}/${folder}/${name}${wght}_24px.svg`;
}

/** @type {Map<string, string | Promise<string | null>>} */
const iconSvgCache = new Map();

/**
 * @param {string} url
 * @returns {Promise<string | null>}
 */
function loadIconSvgMarkup(url) {
  const cached = iconSvgCache.get(url);
  if (typeof cached === 'string') return Promise.resolve(cached);
  if (cached) return cached;

  const pending = fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        iconSvgCache.delete(url);
        return null;
      }
      const text = await res.text();
      iconSvgCache.set(url, text);
      return text;
    })
    .catch(() => {
      iconSvgCache.delete(url);
      return null;
    });

  iconSvgCache.set(url, pending);
  return pending;
}

/**
 * @param {SVGElement} svg
 * @param {number} px
 */
function sizePreviewSvg(svg, px) {
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.style.width = `${px}px`;
  svg.style.height = `${px}px`;
}

/**
 * @param {string} markup
 * @param {number} px
 * @returns {SVGElement | null}
 */
function parsePreviewSvg(markup, px) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!(svg instanceof SVGElement) || svg.tagName.toLowerCase() !== 'svg') return null;
  svg.classList.add('icon-preview-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.querySelectorAll('[fill]').forEach((el) => {
    if (el.getAttribute('fill') !== 'none') el.setAttribute('fill', 'currentColor');
  });
  svg.setAttribute('fill', 'currentColor');
  sizePreviewSvg(svg, px);
  return /** @type {SVGElement} */ (document.importNode(svg, true));
}

/**
 * @param {HTMLElement} glyph
 * @param {import('../src/typo-engine.js').EngineState['icons']['style']} style
 * @param {import('../src/typo-engine.js').IconSizeConfig} size
 */
function applyIconPreviewGlyph(glyph, style, size) {
  const family = iconFontFamilyName(style);
  const px = size.fontSizePx;
  glyph.textContent = previewIconLigature() || PREVIEW_ICON_DEFAULT;
  glyph.style.fontFamily = `"${family}"`;
  glyph.style.fontSize = `${px}px`;
  glyph.style.fontWeight = String(size.weight);
  glyph.style.fontOpticalSizing = 'auto';
  // Do not set "opsz" — font-optical-sizing: auto maps it from font-size.
  glyph.style.fontVariationSettings = `"FILL" 0, "wght" ${size.weight}, "GRAD" 0`;
}

let iconPreviewGen = 0;

/**
 * @returns {boolean} false if a full remount was triggered
 */
function syncIconPreviewDom() {
  const row = app.querySelector('.icon-preview-row');
  if (!row) return true;
  const sizes = state.icons.sizes;
  const cells = row.querySelectorAll('.icon-preview-cell');
  if (cells.length !== sizes.length) {
    render();
    return false;
  }
  const gen = ++iconPreviewGen;
  void Promise.all(
    [...cells].map((cell, i) => {
      if (!(cell instanceof HTMLElement)) return Promise.resolve();
      return fillIconPreviewCell(cell, sizes[i], i, gen);
    }),
  );
  return true;
}

/**
 * @param {HTMLElement} cell
 * @param {import('../src/typo-engine.js').IconSizeConfig} size
 * @param {number} index
 * @param {number} gen
 */
async function fillIconPreviewCell(cell, size, index, gen) {
  const ligature = previewIconLigature() || PREVIEW_ICON_DEFAULT;
  const slot = iconSizeNameForIndex(index);
  const meta = cell.querySelector('.preview-meta');
  const mark = cell.querySelector('.icon-preview-mark');
  if (meta instanceof HTMLElement) {
    const src = state.icons.source;
    meta.textContent = `${ligature} · ${slot} · ${size.fontSizePx}px · w${size.weight}${src === 'svg' ? ' · svg' : ''}`;
  }
  if (!(mark instanceof HTMLElement)) return;

  if (state.icons.source !== 'svg') {
    delete mark.dataset.svgKey;
    let glyph = mark.querySelector('.icon-preview-glyph');
    if (!(glyph instanceof HTMLElement) || mark.querySelector('svg')) {
      mark.replaceChildren();
      glyph = document.createElement('span');
      glyph.className = 'icon-preview-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      mark.appendChild(glyph);
    }
    applyIconPreviewGlyph(glyph, state.icons.style, size);
    return;
  }

  const url = iconSvgPreviewUrl(state.icons.style, ligature, size.weight);
  const px = size.fontSizePx;
  const existing = mark.querySelector('svg');
  if (existing instanceof SVGElement && mark.dataset.svgKey === url) {
    sizePreviewSvg(existing, px);
    return;
  }

  const markup = await loadIconSvgMarkup(url);
  if (gen !== iconPreviewGen || !mark.isConnected) return;

  mark.dataset.svgKey = url;
  mark.replaceChildren();
  if (!markup) {
    const miss = document.createElement('span');
    miss.className = 'icon-preview-missing';
    miss.textContent = '—';
    mark.appendChild(miss);
    return;
  }
  const svg = parsePreviewSvg(markup, px);
  if (svg) mark.appendChild(svg);
}

/**
 * @param {string} family
 * @returns {boolean}
 */
function isFontFamilyAvailable(family) {
  const name = String(family || '').trim().replace(/"/g, '');
  if (!name) return false;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const sample = 'giItT1WQy@!-/#mw';
  /** @param {string} font */
  const width = (font) => {
    ctx.font = font;
    return ctx.measureText(sample).width;
  };

  const mono = width('72px monospace');
  if (width(`72px "${name}", monospace`) !== mono) return true;

  const serif = width('72px serif');
  return width(`72px "${name}", serif`) !== serif;
}

/**
 * @param {string} family
 * @param {number} [ms]
 * @returns {Promise<void>}
 */
function loadFamilyFaces(family, ms = 8000) {
  const safe = String(family || '').trim().replace(/"/g, '');
  if (!safe || !document.fonts?.load) return Promise.resolve();

  const loads = Promise.all([
    document.fonts.load(`400 48px "${safe}"`),
    document.fonts.load(`700 48px "${safe}"`),
    document.fonts.ready.catch(() => undefined),
  ]).then(() => undefined);

  const timeout = new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

  return Promise.race([loads, timeout]).then(() => undefined);
}

/** @type {number} */
let fontCheckGen = 0;

/**
 * Config keeps the typed name; UI only reports when preview falls back.
 * @param {string} family
 * @param {HTMLElement} statusEl
 * @param {string} googleFontsUrl
 * @param {string} googleFontsUrlStatic
 */
async function refreshFontFallbackStatus(family, statusEl, googleFontsUrl, googleFontsUrlStatic) {
  const gen = ++fontCheckGen;
  const name = String(family || '').trim() || 'Inter';

  const clearStatus = () => {
    if (!statusEl.isConnected) return;
    statusEl.hidden = true;
    statusEl.textContent = '';
    statusEl.classList.remove('is-fallback');
  };

  const showFallback = () => {
    if (!statusEl.isConnected) return;
    statusEl.hidden = false;
    statusEl.classList.add('is-fallback');
    statusEl.textContent = 'Fallback: system-ui';
  };

  const stale = () => gen !== fontCheckGen || !statusEl.isConnected;

  clearStatus();

  const linkResult = await syncFontLinkPreferVariable(
    name,
    googleFontsUrl,
    googleFontsUrlStatic,
  );
  if (stale()) return;

  // System fonts often work even when Google CSS 404s — always metric-check.
  await loadFamilyFaces(name);
  if (stale()) return;

  if (isFontFamilyAvailable(name)) {
    clearStatus();
    return;
  }

  // Stylesheet `load` ≠ woff2 ready. Retry after settling.
  if (linkResult === 'load') {
    for (const delay of [150, 400, 1000]) {
      await new Promise((r) => setTimeout(r, delay));
      if (stale()) return;
      if (isFontFamilyAvailable(name)) {
        clearStatus();
        return;
      }
    }
  }

  showFallback();
}

function collectCollapsePanelExpanded(panelName) {
  const panel = app.querySelector(`.collapse-panel[data-panel="${panelName}"]`);
  return panel ? !panel.classList.contains('is-collapsed') : false;
}

function formatEngineConfigJson() {
  return JSON.stringify(exportEngineConfig(state), null, 2);
}

/**
 * @param {string} title
 * @param {HTMLElement} fieldsetBody
 * @returns {HTMLElement}
 */
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

  const fs = document.createElement('fieldset');
  fs.appendChild(fieldsetBody);

  wrap.append(header, fs);
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
  output.textContent = text;
  body.appendChild(output);

  const actions = document.createElement('div');
  actions.className = 'config-actions';

  const currentCss = () => output.textContent || generateSystem(state).tokensCss;

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'palette-header-action';
  downloadBtn.textContent = 'Download CSS';
  downloadBtn.addEventListener('click', () => {
    const css = currentCss();
    const blob = new Blob([css], { type: 'text/css' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'typo-engine-tokens.css';
    link.click();
    URL.revokeObjectURL(url);
    setStatus('Tokens downloaded.');
  });
  actions.appendChild(downloadBtn);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'palette-header-action';
  copyBtn.textContent = 'Copy CSS';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentCss());
      setStatus('Tokens copied to clipboard.');
    } catch {
      setStatus('Could not copy to clipboard.', true);
    }
  });
  actions.appendChild(copyBtn);

  body.append(actions, status);
  return body;
}

function applyImportedConfig(raw) {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  state = importEngineConfig(parsed);
  expandedStyles.clear();
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
    const blob = new Blob([formatEngineConfigJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'typo-config.json';
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
  body.append(applyBtn, status);

  if (pendingConfigStatus) {
    setStatus(pendingConfigStatus.message, pendingConfigStatus.isError);
    pendingConfigStatus = null;
  }

  return body;
}

/** @type {Set<ResizeObserver>} */
const sliderResizeObservers = new Set();

function disconnectSliderResizeObservers() {
  for (const ro of sliderResizeObservers) ro.disconnect();
  sliderResizeObservers.clear();
}

const RANGE_THUMB_PX = 12;

/**
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
 */
function attachSliderVisualSync(wrap, range) {
  const sync = () => syncSliderVisuals(wrap, range);
  sync();
  const ro = new ResizeObserver(sync);
  sliderResizeObservers.add(ro);
  ro.observe(wrap);
}

/**
 * @param {HTMLInputElement} range
 */
function attachRangePointerCapture(range) {
  range.addEventListener('pointerdown', (e) => {
    try {
      range.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  });
  const release = (e) => {
    try {
      if (range.hasPointerCapture(e.pointerId)) {
        range.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  };
  range.addEventListener('pointerup', release);
  range.addEventListener('pointercancel', release);
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
 * Widest string for values in [min, max] at step decimals — drives input hug width.
 * @param {number} min
 * @param {number} max
 * @param {number} decimals
 */
function hugCharsForSliderRange(min, max, decimals) {
  const fmt = (n) => {
    if (decimals <= 0) return String(Math.round(n));
    const f = 10 ** decimals;
    return (Math.round(n * f) / f).toFixed(decimals);
  };
  return Math.max(2, fmt(min).length, fmt(max).length);
}

/**
 * Label + hug number + range (same layout as color-engine, no chroma markers).
 * @param {string} label
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {(v: number) => void} onChange — mutate state only (no render)
 * @param {{ step?: number, structural?: boolean }} [options]
 *   `structural: true` — count/layout; no live generate during drag.
 */
function createSliderControl(label, value, min, max, onChange, options = {}) {
  const step = options.step ?? 1;
  const structural = Boolean(options.structural);
  const decimals = (() => {
    const s = String(step);
    const i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  })();

  const snap = (n) => {
    const snapped = Math.round(n / step) * step;
    if (decimals <= 0) return snapped;
    return Number(snapped.toFixed(decimals));
  };

  const applyValue = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = min;
    return Math.max(min, Math.min(max, snap(v)));
  };

  const group = document.createElement('div');
  group.className = 'control-group slider-control';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  group.appendChild(lbl);

  const row = document.createElement('div');
  row.className = 'slider-control-row';

  const numberInput = document.createElement('input');
  numberInput.type = 'text';
  numberInput.inputMode = decimals > 0 ? 'decimal' : 'numeric';
  numberInput.autocomplete = 'off';
  numberInput.spellcheck = false;
  numberInput.className = 'ui-control ui-control--hug';
  numberInput.setAttribute('aria-label', `${label} value`);
  numberInput.style.setProperty('--hug-ch', String(hugCharsForSliderRange(min, max, decimals)));

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

  const paint = (v, opts = {}) => {
    const syncRange = opts.syncRange !== false;
    const shown = decimals > 0 ? String(Number(v.toFixed(decimals))) : String(v);
    numberInput.value = shown;
    if (syncRange) {
      const cur = Number(range.value);
      if (!Number.isFinite(cur) || Math.abs(cur - v) > step / 4) {
        range.value = String(v);
      }
    }
    syncSliderVisuals(wrap, range);
  };
  paint(applyValue(value));

  numberInput.addEventListener('change', () => {
    const v = applyValue(numberInput.value);
    onChange(v);
    paint(v);
    render();
  });
  range.addEventListener('input', () => {
    const v = applyValue(range.value);
    onChange(v);
    // Never assign range.value during an active drag — kills further input events.
    paint(v, { syncRange: false });
    // Structural (styleCount): defer generate/normalize until mouseup remount.
    if (!structural) scheduleRefreshDerived();
  });
  range.addEventListener('change', () => {
    render();
  });

  row.appendChild(numberInput);
  wrap.appendChild(range);
  row.appendChild(wrap);
  group.appendChild(row);
  attachSliderVisualSync(wrap, range);
  return group;
}

/**
 * Inherit/override slider: empty number = inherit; Escape clears override.
 * @param {string} label
 * @param {number | null | undefined} override
 * @param {number} inheritedValue
 * @param {number} min
 * @param {number} max
 * @param {(v: number | null) => void} onChange
 * @param {{ step?: number }} [options]
 */
function createInheritSliderControl(label, override, inheritedValue, min, max, onChange, options = {}) {
  const step = options.step ?? 1;
  const decimals = (() => {
    const s = String(step);
    const i = s.indexOf('.');
    return i === -1 ? 0 : s.length - i - 1;
  })();

  const snap = (n) => {
    const snapped = Math.round(n / step) * step;
    if (decimals <= 0) return snapped;
    return Number(snapped.toFixed(decimals));
  };

  const applyValue = (raw) => {
    let v = Number(raw);
    if (!Number.isFinite(v)) v = inheritedValue;
    return Math.max(min, Math.min(max, snap(v)));
  };

  const hasOverride = override != null && Number.isFinite(Number(override));
  const effective = hasOverride ? Number(override) : inheritedValue;

  const group = document.createElement('div');
  group.className = 'control-group slider-control';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  group.appendChild(lbl);

  const row = document.createElement('div');
  row.className = 'slider-control-row';

  const numberInput = document.createElement('input');
  numberInput.type = 'text';
  numberInput.inputMode = decimals > 0 ? 'decimal' : 'numeric';
  numberInput.autocomplete = 'off';
  numberInput.spellcheck = false;
  numberInput.className = 'ui-control ui-control--hug';
  numberInput.placeholder = String(snap(inheritedValue));
  numberInput.setAttribute('aria-label', `${label} value`);
  numberInput.style.setProperty('--hug-ch', String(hugCharsForSliderRange(min, max, decimals)));
  numberInput.value = hasOverride ? String(snap(Number(override))) : '';

  const wrap = document.createElement('div');
  wrap.className = 'chroma-slider-wrap';
  createSliderTrack(wrap);

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(applyValue(effective));
  range.setAttribute('aria-label', label);
  attachRangePointerCapture(range);

  const paint = (v, asOverride, opts = {}) => {
    const syncRange = opts.syncRange !== false;
    const shown = decimals > 0 ? String(Number(v.toFixed(decimals))) : String(v);
    numberInput.value = asOverride ? shown : '';
    numberInput.placeholder = String(snap(inheritedValue));
    if (syncRange) {
      const cur = Number(range.value);
      if (!Number.isFinite(cur) || Math.abs(cur - v) > step / 4) {
        range.value = String(v);
      }
    }
    syncSliderVisuals(wrap, range);
  };
  paint(applyValue(effective), hasOverride);

  numberInput.addEventListener('change', () => {
    const raw = numberInput.value.trim();
    if (raw === '') {
      onChange(null);
      paint(applyValue(inheritedValue), false);
      scheduleRefreshDerived({ syncOpenStyleTitles: true });
      return;
    }
    const v = applyValue(raw);
    onChange(v);
    paint(v, true);
    scheduleRefreshDerived({ syncOpenStyleTitles: true });
  });
  numberInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      onChange(null);
      paint(applyValue(inheritedValue), false);
      scheduleRefreshDerived({ syncOpenStyleTitles: true });
    }
  });
  range.addEventListener('input', () => {
    const v = applyValue(range.value);
    onChange(v);
    // Never assign range.value during an active drag — kills further input events.
    paint(v, true, { syncRange: false });
    scheduleRefreshDerived();
  });
  range.addEventListener('change', () => {
    // Avoid full remount of open style panel (causes slider jump / scroll loss).
    scheduleRefreshDerived({ syncOpenStyleTitles: true });
  });

  row.appendChild(numberInput);
  wrap.appendChild(range);
  row.appendChild(wrap);
  group.appendChild(row);
  attachSliderVisualSync(wrap, range);
  return group;
}

/**
 * @param {HTMLElement} parent
 * @param {string} label
 * @param {() => HTMLElement} controlFactory
 */
function controlGroup(parent, label, controlFactory) {
  const group = document.createElement('div');
  group.className = 'control-group';
  const lab = document.createElement('label');
  lab.textContent = label;
  group.append(lab, controlFactory());
  parent.appendChild(group);
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
  dismissFloatingPanels();

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
    window.removeEventListener('pointercancel', onPointerUp);
  };

  /**
   * @param {1 | 2} which
   * @param {PointerEvent} e
   */
  const startHandleDrag = (which, e) => {
    e.preventDefault();
    e.stopPropagation();
    draggingHandle = which;
    try {
      (e.target instanceof Element ? e.target : handle1).setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
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
    try {
      panel.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
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
    if (closeActiveFloating === close) closeActiveFloating = null;
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
  closeActiveFloating = close;
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
 * @param {boolean | { disabled?: boolean, showGraphBtn?: boolean, onEditorClose?: () => void }} [options]
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
      }, () => {
        opts.onEditorClose?.();
      });
    });

    wrap.appendChild(graphBtn);
  }

  return wrap;
}

/**
 * @param {HTMLElement} parent
 * @param {import('../src/typo-engine.js').RangeCurve} curve
 * @param {{ startLabel: string, endLabel: string, step: number, min: number, max: number }} labels
 */
function rangeCurveControls(parent, curve, labels) {
  const rangeRow = document.createElement('div');
  rangeRow.className = 'control-row';

  rangeRow.appendChild(
    createSliderControl(labels.startLabel, curve.start, labels.min, labels.max, (n) => {
      curve.start = n;
    }, { step: labels.step }),
  );

  rangeRow.appendChild(
    createSliderControl(labels.endLabel, curve.end, labels.min, labels.max, (n) => {
      curve.end = n;
    }, { step: labels.step }),
  );

  parent.appendChild(rangeRow);

  const interpRow = document.createElement('div');
  interpRow.className = 'control-row control-row--full';

  const group = controlGroup(interpRow, 'interpolator', () =>
    createBezierInputs(curve.interpolator, (next) => {
      curve.interpolator = [...next];
      scheduleRefreshDerived({ syncOpenStyleTitles: true });
      if (!closeActiveFloating) render();
    }, { onEditorClose: () => render() }),
  );
  group.classList.add('control-group--bezier');

  parent.appendChild(interpRow);
}

function render() {
  if (renderLock) return;
  renderLock = true;
  try {
    if (derivedRaf !== null) {
      cancelAnimationFrame(derivedRaf);
      derivedRaf = null;
    }
    dismissFloatingPanels();
    disconnectSliderResizeObservers();
    const configPanelExpanded = collectCollapsePanelExpanded('config');
    const tokensPanelExpanded = collectCollapsePanelExpanded('tokens');

    const { tokensCss, styles, googleFontsUrl, googleFontsUrlStatic } = system();

    // Drop expansion keys for styles removed by styleCount remap.
    const liveNames = new Set(styles.map((s) => s.name));
    for (const name of [...expandedStyles]) {
      if (!liveNames.has(name)) expandedStyles.delete(name);
    }

    app.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const sidebar = document.createElement('aside');
  sidebar.className = 'app-sidebar';

  const header = document.createElement('header');
  header.className = 'app-sidebar-header';
  const title = document.createElement('h1');
  const back = document.createElement('a');
  back.className = 'app-title-back';
  back.href = '../../index.html';
  back.setAttribute('aria-label', 'Back to DS Engines');
  back.textContent = '←';
  title.append(back, document.createTextNode('Typo Engine'));
  header.appendChild(title);
  sidebar.appendChild(header);

  const sidebarBody = document.createElement('div');
  sidebarBody.className = 'app-sidebar-body';

  const main = document.createElement('div');
  main.className = 'app-main';

  // —— Global ——
  const globalControls = document.createElement('div');
  globalControls.className = 'controls controls--global';

  const fontRow = document.createElement('div');
  fontRow.className = 'control-row control-row--full';
  const fontGroup = controlGroup(fontRow, 'font family', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-control ui-control--block';
    input.value = state.fontFamily;
    input.spellcheck = false;
    input.placeholder = 'Inter, Arial, Poppins…';
    input.addEventListener('change', () => {
      state.fontFamily = input.value.trim() || 'Inter';
      render();
    });
    return input;
  });
  const fontStatus = document.createElement('div');
  fontStatus.className = 'font-fallback-status';
  fontStatus.setAttribute('aria-live', 'polite');
  fontStatus.hidden = true;
  fontGroup.appendChild(fontStatus);
  globalControls.appendChild(fontRow);
  void refreshFontFallbackStatus(
    state.fontFamily,
    fontStatus,
    googleFontsUrl,
    googleFontsUrlStatic,
  );
  void syncStylesheetLink('typo-icon-font-link', materialSymbolsCssUrl(state.icons.style)).then(
    () => loadFamilyFaces(iconFontFamilyName(state.icons.style)),
  );

  const scaleRow = document.createElement('div');
  scaleRow.className = 'control-row';
  scaleRow.appendChild(
    createSliderControl('styles', state.styleCount, 1, 24, (n) => {
      state.styleCount = n;
    }, { step: 1, structural: true }),
  );
  scaleRow.appendChild(
    createSliderControl('size scale', state.sizeScale, 1, 1.5, (n) => {
      state.sizeScale = n;
    }, { step: 0.01 }),
  );
  globalControls.appendChild(scaleRow);

  const baseRow = document.createElement('div');
  baseRow.className = 'control-row';
  controlGroup(baseRow, 'base style', () => {
    const select = document.createElement('select');
    select.className = 'ui-control ui-control--select ui-control--block';
    const name = sanitizeStyleName(state.baseStyle);
    for (const style of state.styles) {
      const opt = document.createElement('option');
      opt.value = style.name;
      opt.textContent = style.name;
      if (style.name === name) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      state.baseStyle = select.value;
      render();
    });
    return select;
  });
  baseRow.appendChild(
    createSliderControl('base size (px)', state.baseSizePx, 8, 72, (n) => {
      state.baseSizePx = n;
    }, { step: 1 }),
  );
  globalControls.appendChild(baseRow);

  const weightRow = document.createElement('div');
  weightRow.className = 'control-row';
  weightRow.appendChild(
    createSliderControl('weight regular', state.weightRegular, 100, 900, (n) => {
      state.weightRegular = n;
    }, { step: 50 }),
  );
  weightRow.appendChild(
    createSliderControl('weight bold', state.weightBold, 100, 900, (n) => {
      state.weightBold = n;
    }, { step: 50 }),
  );
  globalControls.appendChild(weightRow);

  rangeCurveControls(globalControls, state.letterSpacing, {
    startLabel: 'letter-spacing (em) min',
    endLabel: 'letter-spacing (em) max',
    step: 0.01,
    min: -0.1,
    max: 0.1,
  });

  rangeCurveControls(globalControls, state.lineHeight, {
    startLabel: 'line-height min',
    endLabel: 'line-height max',
    step: 0.01,
    min: 0.5,
    max: 2,
  });

  const iconRow = document.createElement('div');
  iconRow.className = 'control-row';
  controlGroup(iconRow, 'icon source', () => {
    const select = document.createElement('select');
    select.className = 'ui-control ui-control--select ui-control--block';
    const sourceLabels = { font: 'Font (variable)', svg: 'SVG' };
    for (const value of ICON_SOURCES) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = sourceLabels[value];
      if (value === state.icons.source) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      state.icons.source = select.value === 'svg' ? 'svg' : 'font';
      render();
    });
    return select;
  });
  controlGroup(iconRow, 'icon style', () => {
    const select = document.createElement('select');
    select.className = 'ui-control ui-control--select ui-control--block';
    const styleLabels = { outlined: 'Outlined', rounded: 'Rounded', sharp: 'Sharp' };
    for (const value of ICON_STYLES) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = styleLabels[value];
      if (value === state.icons.style) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const v = select.value;
      state.icons.style = v === 'rounded' || v === 'sharp' ? v : 'outlined';
      render();
    });
    return select;
  });
  globalControls.appendChild(iconRow);

  const iconCountRow = document.createElement('div');
  iconCountRow.className = 'control-row';
  iconCountRow.appendChild(
    createSliderControl('icon sizes', state.icons.sizeCount, 1, 4, (n) => {
      state.icons.sizeCount = n;
    }, { step: 1, structural: true }),
  );
  globalControls.appendChild(iconCountRow);

  state.icons.sizes.forEach((size, i) => {
    const name = iconSizeNameForIndex(i, state.icons.sizes.length);
    const sizeRow = document.createElement('div');
    sizeRow.className = 'control-row';
    sizeRow.appendChild(
      createSliderControl(`${name} size (px)`, size.fontSizePx, 12, 64, (n) => {
        size.fontSizePx = n;
      }, { step: 1 }),
    );
    sizeRow.appendChild(
      createSliderControl(`${name} weight`, size.weight, 100, 700, (n) => {
        size.weight = n;
      }, { step: 50 }),
    );
    globalControls.appendChild(sizeRow);
  });

  sidebarBody.appendChild(wrapSection('Global', globalControls));
  sidebar.appendChild(sidebarBody);
  shell.appendChild(sidebar);

  // —— Styles ——
  const list = document.createElement('div');
  list.className = 'style-list';

  styles.forEach((resolved, index) => {
    const style = state.styles[index];
    const id = resolved.name;
    const open = expandedStyles.has(id);

    const panel = document.createElement('div');
    panel.className = `style-panel${open ? '' : ' is-collapsed'}`;
    panel.dataset.styleIndex = String(index);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ui-ghost style-panel-toggle';
    toggle.setAttribute('aria-expanded', String(open));

    const chevron = document.createElement('span');
    chevron.className = 'collapse-panel-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '▾';

    const titleText = document.createElement('span');
    titleText.className = 'style-panel-title-text';
    titleText.textContent = `${resolved.name} · ${formatRem(resolved.fontSizeRem)} / ${resolved.lineHeight} / ${formatEm(resolved.letterSpacing)}`;
    toggle.append(chevron, titleText);
    toggle.addEventListener('click', () => {
      if (expandedStyles.has(id)) expandedStyles.delete(id);
      else expandedStyles.add(id);
      render();
    });
    panel.appendChild(toggle);

    const body = document.createElement('div');
    body.className = 'style-panel-body';

    const nameRow = document.createElement('div');
    nameRow.className = 'style-name-row';
    controlGroup(nameRow, 'name', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ui-control ui-control--block';
      input.value = style.name;
      input.addEventListener('input', () => {
        input.value = filterStyleNameInput(input.value);
      });
      input.addEventListener('change', () => {
        const next = sanitizeStyleName(input.value);
        const wasBase = sanitizeStyleName(state.baseStyle) === style.name;
        const wasExpanded = expandedStyles.has(style.name);
        style.name = next;
        if (wasBase) state.baseStyle = next;
        if (wasExpanded) {
          expandedStyles.delete(id);
          expandedStyles.add(next);
        }
        render();
      });
      return input;
    });
    body.appendChild(nameRow);

    const ovRow = document.createElement('div');
    ovRow.className = 'control-row';

    ovRow.appendChild(
      createInheritSliderControl(
        'font-size (px)',
        style.fontSizePx,
        resolved.fontSizePx,
        6,
        120,
        (n) => {
          style.fontSizePx = n;
        },
        { step: 1 },
      ),
    );
    ovRow.appendChild(
      createInheritSliderControl(
        'letter-spacing (em)',
        style.letterSpacing,
        resolved.letterSpacing,
        -0.1,
        0.1,
        (n) => {
          style.letterSpacing = n;
        },
        { step: 0.01 },
      ),
    );
    ovRow.appendChild(
      createInheritSliderControl(
        'line-height',
        style.lineHeight,
        resolved.lineHeight,
        0.5,
        2,
        (n) => {
          style.lineHeight = n;
        },
        { step: 0.01 },
      ),
    );
    ovRow.appendChild(
      createInheritSliderControl(
        'paragraph-spacing (rem)',
        style.paragraphSpacingRem,
        resolved.paragraphSpacingRem,
        0,
        8,
        (n) => {
          style.paragraphSpacingRem = n;
        },
        { step: 0.0001 },
      ),
    );
    ovRow.appendChild(
      createInheritSliderControl(
        'weight regular',
        style.weightRegular,
        resolved.weightRegular,
        100,
        900,
        (n) => {
          style.weightRegular = n;
        },
        { step: 50 },
      ),
    );
    ovRow.appendChild(
      createInheritSliderControl(
        'weight bold',
        style.weightBold,
        resolved.weightBold,
        100,
        900,
        (n) => {
          style.weightBold = n;
        },
        { step: 50 },
      ),
    );

    body.appendChild(ovRow);
    panel.appendChild(body);
    list.appendChild(panel);
  });

  main.appendChild(wrapSection('Styles', list));

  // —— Preview ——
  const previewBody = document.createElement('div');
  previewBody.className = 'preview-body';

  const sentenceRow = document.createElement('div');
  sentenceRow.className = 'control-row control-row--full';
  controlGroup(sentenceRow, 'sample sentence', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-control ui-control--block';
    input.value = previewSentence;
    input.spellcheck = true;
    input.setAttribute('aria-label', 'Preview sample sentence');
    input.addEventListener('input', () => {
      previewSentence = input.value;
      app.querySelectorAll('.preview-sample').forEach((el) => {
        el.textContent = previewSentence;
      });
    });
    return input;
  });
  previewBody.appendChild(sentenceRow);

  const grid = document.createElement('div');
  grid.className = 'preview-grid';

  const familyMatch = tokensCss.match(/--typo-font-family:\s*([^;]+);/);
  if (familyMatch) {
    grid.style.fontFamily = familyMatch[1].trim();
  }

  for (const role of /** @type {const} */ (['regular', 'bold'])) {
    const col = document.createElement('div');
    col.className = 'preview-col';
    col.dataset.role = role;
    const h = document.createElement('div');
    h.className = 'palette-name-text preview-col-title';
    h.textContent = role;
    col.appendChild(h);

    for (const resolved of styles) {
      const row = document.createElement('div');
      row.className = 'preview-row';

      const meta = document.createElement('p');
      meta.className = 'preview-meta';
      const tokenName = `${resolved.name}-${role}`;
      const weight = role === 'regular' ? resolved.weightRegular : resolved.weightBold;
      meta.textContent = `${tokenName} · ${formatRem(resolved.fontSizeRem)} · w${weight} · lh ${resolved.lineHeight} · ls ${formatEm(resolved.letterSpacing)}`;
      row.appendChild(meta);

      const sample = document.createElement('p');
      sample.className = 'preview-sample';
      sample.textContent = previewSentence;
      sample.style.fontSize = formatRem(resolved.fontSizeRem);
      sample.style.fontWeight = String(weight);
      sample.style.lineHeight = String(resolved.lineHeight);
      sample.style.letterSpacing = formatEm(resolved.letterSpacing);
      sample.style.marginBottom = formatRem(resolved.paragraphSpacingRem);
      row.appendChild(sample);

      col.appendChild(row);
    }
    grid.appendChild(col);
  }

  previewBody.appendChild(grid);
  main.appendChild(wrapSection('Preview', previewBody));

  const iconPreviewBody = document.createElement('div');
  iconPreviewBody.className = 'preview-body icon-preview-body';

  const iconNameRow = document.createElement('div');
  iconNameRow.className = 'control-row control-row--full';
  controlGroup(iconNameRow, 'icon name', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ui-control ui-control--block';
    input.value = previewIconName;
    input.spellcheck = false;
    input.placeholder = PREVIEW_ICON_DEFAULT;
    input.setAttribute('aria-label', 'Preview icon name');
    input.addEventListener('input', () => {
      previewIconName = input.value;
      syncIconPreviewDom();
    });
    return input;
  });
  iconPreviewBody.appendChild(iconNameRow);

  const iconRowPreview = document.createElement('div');
  iconRowPreview.className = 'icon-preview-row';
  state.icons.sizes.forEach((size, i) => {
    const cell = document.createElement('div');
    cell.className = 'icon-preview-cell';
    const meta = document.createElement('p');
    meta.className = 'preview-meta';
    cell.appendChild(meta);
    const mark = document.createElement('div');
    mark.className = 'icon-preview-mark';
    cell.appendChild(mark);
    iconRowPreview.appendChild(cell);
    void fillIconPreviewCell(cell, size, i, iconPreviewGen);
  });
  iconPreviewBody.appendChild(iconRowPreview);

  main.appendChild(wrapSection('Icon preview', iconPreviewBody));

  main.appendChild(
    createCollapsePanel('Engine config', 'config', createConfigPanelBody(), configPanelExpanded),
  );
  main.appendChild(
    createCollapsePanel(
      'Generated tokens',
      'tokens',
      createTokensPanelBody(tokensCss),
      tokensPanelExpanded,
    ),
  );

  shell.appendChild(main);
  app.appendChild(shell);
  } finally {
    renderLock = false;
  }
}

boot();
