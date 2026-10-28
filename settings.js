/**
 * Ribbons settings — keys aligned with config.json / electron-store.
 * i18n loaded from ./translations/{locale}.json (same files as main-process i18n.js).
 */
import RibbonsModern from './ribbons_modern.js';
import {
  updateDateTime,
  showDateTime,
  checkContainerMaxSize,
  setFront,
  randomizePosition,
  setFixedPosition,
  pauseDateTimeAnimation,
  resumeDateTimeAnimation
} from './datetime.js';

let RibbonsClassic = null;
try {
  RibbonsClassic = (await import('./ribbons.js')).default;
} catch (e) {
  console.warn('ribbons.js not available:', e.message);
}

const $ = (id) => document.getElementById(id);
const preview = $('preview');
/** Preview bounds for datetime.js randomizePosition (coords relative to #preview). */
function previewBounds() {
  const r = preview.getBoundingClientRect();
  return { width: Math.max(1, r.width), height: Math.max(1, r.height), x: 0, y: 0 };
}

let _dtTimer = null;
let _dtRandTimer = null;
let _dtDurBase = 12;

function stopPreviewDatetime() {
  clearInterval(_dtTimer);
  _dtTimer = null;
  clearTimeout(_dtRandTimer);
  _dtRandTimer = null;
  const el = document.getElementsByClassName('datetime-container')[0];
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('front', 'paused', 'appear-disappear-1', 'appear-disappear-2');
  el.style.top = '';
  el.style.left = '';
  el.style.transform = '';
  el.style.margin = '';
  el.style.removeProperty('--dur');
}

/**
 * Mirror controller.js datetime setup inside the preview stage.
 * Uses the same datetime.js helpers (animations, front z-index, pause).
 */
function startPreviewDatetime(data) {
  stopPreviewDatetime();
  if (!data?.show_datetime) return;

  const locale = data.locale || currentLocale || 'ru';
  updateDateTime(locale);
  _dtTimer = setInterval(() => updateDateTime(locale), 1000);

  const el = document.getElementsByClassName('datetime-container')[0];
  if (!el) return;

  // static front only when not randomizing (controller behavior)
  if (data.datetime_front && !data.randomize_datetime_pos) {
    setFront();
  } else {
    el.classList.remove('front');
  }

  _dtDurBase = Math.floor(Math.random() * 21) + 10;
  checkContainerMaxSize();

  if (data.randomize_datetime_pos) {
    const tick = () => {
      const delay = 1000 + Math.random() * 10000;
      _dtRandTimer = setTimeout(() => {
        if (previewPaused) {
          tick();
          return;
        }
        if (!$('show_datetime')?.checked || !$('randomize_datetime_pos')?.checked) return;
        // bounds = preview stage (like display_bounds for a single monitor)
        randomizePosition(previewBounds(), null, _dtDurBase);
        tick();
      }, delay);
    };
    // first placement soon so animation is visible immediately
    randomizePosition(previewBounds(), null, _dtDurBase);
    tick();
  } else {
    setFixedPosition(data.datetime_pos || 'center', 16);
  }
}

/** Same idea as controller.applyBodyTheme, but on the preview stage only */
function applyPreviewStageTheme(backgroundMode) {
  if (!preview) return;
  const mode = !backgroundMode || backgroundMode === 'auto' ? 'darkGradient' : backgroundMode;
  preview.classList.remove(
    'light', 'dark', 'lightGradient', 'darkGradient', 'transparent', 'glass', 'auto'
  );
  if (mode === 'light' || mode === 'lightGradient') {
    preview.classList.add('light');
  } else {
    preview.classList.add('dark');
  }
  preview.classList.add(mode);
  // Ask main to toggle glasstron blur / window transparency for the settings window
  notifySettingsWindowChrome(mode);
}

/**
 * main.js openRibbonsSettings listens for these and applies acrylic blur / clear body.
 * glass → ribbons-settings-glass, transparent → ribbons-settings-transparent
 */
function notifySettingsWindowChrome(backgroundMode) {
  if (!ipcRenderer) return;
  const mode = backgroundMode || '';
  if (mode === 'glass') {
    ipcRenderer.send('ribbons-settings-glass');
  } else if (mode === 'transparent') {
    ipcRenderer.send('ribbons-settings-transparent');
  }
  // other modes: no IPC — main only special-cases glass/transparent for this window
}

function syncPreviewChrome(data) {
  if (!data) data = readForm();
  applyPreviewStageTheme(data.backgroundMode);
  startPreviewDatetime(data);
  if (previewPaused) {
    pauseDateTimeAnimation();
  } else {
    resumeDateTimeAnimation();
  }
}

/* ── i18n (from /translations/) ───────────────────────────────────── */
let currentLocale = 'ru';
let dict = {};
/** Runtime meta from main: displays list + isPackaged */
let runtimeMeta = {
  isPackaged: false,
  displays: []
};

async function loadLocale(locale) {
  const tag = locale === 'en' ? 'en' : 'ru';
  try {
    const res = await fetch(`./translations/${tag}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dict = await res.json();
    currentLocale = tag;
    return true;
  } catch (e) {
    console.warn('i18n load failed:', e.message);
    if (tag !== 'en') {
      try {
        const res = await fetch('./translations/en.json');
        dict = await res.json();
        currentLocale = 'en';
        return true;
      } catch (_) {}
    }
    dict = {};
    return false;
  }
}

function t(key) {
  return (dict && dict[key] != null) ? dict[key] : key;
}

function applyI18n() {
  document.documentElement.lang = currentLocale;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.title = t('settings_title');
  const eng = getEngine();
  
  document.querySelectorAll('.locale-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.locale === currentLocale);
  });
}

/** Defaults — keys match config.json sample */
const DEFAULTS = {
  locale: 'en',
  engine: 'modern',
  backgroundMode: 'auto',
  ui_theme: 'auto',
  stretched_mode: false,
  selected_displays: 'all',
  singleColor: false,
  colorCycleSpeed: 3,
  ribbonCount: 5,
  horizontalSpeed: 1.5,
  endless: true,
  opacity: 70,
  glow: 66,
  minLength: 1,
  maxLength: 3,
  minWidth: 10,
  maxWidth: 30,
  minCurl: 0.35,
  maxCurl: 1.0,
  minTwist: 0,
  maxTwist: 0,
  curlAmplitude: 0.22,
  colorSaturation: 60,
  colorBrightness: 50,
  colorAlpha: 1,
  verticalPosition: 'random',
  parallaxAmount: -0.3,
  strokeSize: 1,
  ribbonBlur: 30,
  animateSections: true,
  show_datetime: false,
  datetime_front: false,
  randomize_datetime_pos: false,
  datetime_pos: 'center',
  idle_time: 60,
  media_detect: true,
  fullscreen_detect: true,
  user_activity: true,
  hw_acc: true,
  run_at_startup: false,
  logging: false
};

/** Classic presets — fixed delay/phase (same as original tray / controller). */
const CLASSIC_SPEED_KEYS = ['slow', 'normal', 'fast', 'v_fast'];
const CLASSIC_SPEED_PRESETS = {
  slow:   { delay: 6,   phase: 0.007 },
  normal: { delay: 4,   phase: 0.014 },
  fast:   { delay: 2,   phase: 0.04 },
  v_fast: { delay: 1.5, phase: 0.07 }
};

/** Modern numeric multiplier 0.3…3 (and legacy tray strings → number). */
const MODERN_SPEED_MAP = { slow: 0.8, normal: 1.5, fast: 2.2, v_fast: 3 };

function normalizeModernSpeed(v, fallback = 1.5) {
  if (typeof v === 'string' && MODERN_SPEED_MAP[v] != null) return MODERN_SPEED_MAP[v];
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.3, Math.min(3, n));
}

function classicSpeedKey(v) {
  if (typeof v === 'string' && CLASSIC_SPEED_PRESETS[v]) return v;
  // number from modern slider or legacy: snap to nearest preset key by modern map
  const n = normalizeModernSpeed(v, 1.5);
  let best = 'normal';
  let bestDiff = Infinity;
  for (const [k, val] of Object.entries(MODERN_SPEED_MAP)) {
    const d = Math.abs(val - n);
    if (d < bestDiff) { bestDiff = d; best = k; }
  }
  return best;
}

function classicSpeedIndex(key) {
  const i = CLASSIC_SPEED_KEYS.indexOf(classicSpeedKey(key));
  return i < 0 ? 1 : i;
}

/** Configure #horizontalSpeed range for current engine */
function syncSpeedSliderMode(engine) {
  const el = $('horizontalSpeed');
  const valEl = $('horizontalSpeedVal');
  if (!el) return;
  if (engine === 'classic') {
    el.min = '0';
    el.max = '3';
    el.step = '1';
    // keep index if already classic-shaped, else map from value
    const cur = el.value;
    if (!(+cur >= 0 && +cur <= 3 && Number.isInteger(+cur))) {
      el.value = String(classicSpeedIndex(cur));
    }
  } else {
    el.min = '0.3';
    el.max = '3';
    el.step = '0.1';
    const cur = el.value;
    // if discrete classic index, map to modern multiplier
    if (CLASSIC_SPEED_KEYS[+cur]) {
      el.value = String(MODERN_SPEED_MAP[CLASSIC_SPEED_KEYS[+cur]]);
    } else {
      el.value = String(normalizeModernSpeed(cur));
    }
  }
  if (valEl) valEl.textContent = formatHorizontalSpeedLabel(el.value, engine);
}

function formatHorizontalSpeedLabel(v, engine) {
  if (engine === 'classic') {
    const key = CLASSIC_SPEED_KEYS[Math.round(+v)] || 'normal';
    return t(key) !== key ? t(key) : key;
  }
  return Number(v).toFixed(1).replace(/\.0$/, '') + '×';
}

const RANGE_FMT = {
  ribbonCount: (v) => String(Math.round(v)),
  horizontalSpeed: (v) => formatHorizontalSpeedLabel(v, getEngine()),

  idle_time: (v) => {
    const s = Math.round(Number(v) || 0);
    if (s < 60) return s + ' s';
    const m = s / 60;
    if (Number.isInteger(m)) return m + ' min';
    return (Math.round(m * 10) / 10) + ' min';
  },
  opacity: (v) => Math.round(v) + '%',
  glow: (v) => String(Math.round(v)),
  minLength: (v) => Number(v).toFixed(1),
  maxLength: (v) => Number(v).toFixed(1),
  minWidth: (v) => String(Math.round(v)),
  maxWidth: (v) => String(Math.round(v)),
  minCurl: (v) => Number(v).toFixed(2),
  maxCurl: (v) => Number(v).toFixed(2),
  curlAmplitude: (v) => Number(v).toFixed(2),
  minTwist: (v) => Number(v).toFixed(2),
  maxTwist: (v) => Number(v).toFixed(2),
  singleColorCustom: (v) => String(Math.round(v)),
  colorSaturation: (v) => Math.round(v) + '%',
  colorBrightness: (v) => Math.round(v) + '%',
  colorAlpha: (v) => Number(v).toFixed(2),
  parallaxAmount: (v) => Number(v).toFixed(2),
  strokeSize: (v) => String(Math.round(v)),
  ribbonBlur: (v) => String(Math.round(v))
};

let instance = null;
let currentEngine = 'modern';
let ipcRenderer = null;

try {
  const req =
    (typeof require === 'function' && require) ||
    (typeof window !== 'undefined' && window.require);
  if (req) ipcRenderer = req('electron').ipcRenderer;
} catch (_) {
  ipcRenderer = null;
}

function getEngine() {
  return $('engine').value === 'classic' ? 'classic' : 'modern';
}

function resolveUiTheme(uiTheme, backgroundMode) {
  if (uiTheme === 'light' || uiTheme === 'dark') return uiTheme;
  // auto / follow backgroundMode
  const src = backgroundMode || 'dark';
  if (src === 'light' || src === 'lightGradient') return 'light';
  return 'dark';
}

function applyUiTheme(themeName) {
  const tname = themeName === 'light' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', tname);
}

function setEngine(engine, { silent } = {}) {
  const eng = engine === 'classic' ? 'classic' : 'modern';
  $('engine').value = eng;
  currentEngine = eng;
  document.querySelectorAll('.engine-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.engine === eng);
  });
  document.querySelectorAll('.engine-only').forEach((el) => {
    el.hidden = el.dataset.engine !== eng;
  });
  // #backgroundMode is shared by classic and modern — keep its row visible
  const bgMode = $('backgroundMode');
  if (bgMode) {
    let el = bgMode;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('engine-only')) {
        el.hidden = false;
        break;
      }
      el = el.parentElement;
    }
  }
  const badge = $('liveBadge');
  if (eng === 'classic') {
    badge.textContent = 'CLASSIC · LIVE';
    badge.className = 'badge classic';
  } else {
    badge.textContent = 'MODERN · LIVE';
    badge.className = 'badge modern';
  }
  
  updateColorUi();
  syncSpeedSliderMode(eng);
  if (!silent) applyPreview(true);
}

function parseSingleColor() {
  const mode = $('singleColorMode')?.value;
  if (mode === 'false' || mode == null) return false;
  if (mode === 'custom') return +($('singleColorCustom')?.value || 200);
  return +mode;
}

function drawHueSpectrum() {
  const canvas = $('hueCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 12; i++) {
    grad.addColorStop(i / 12, `hsl(${(i / 12) * 360} 90% 50%)`);
  }
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function setCustomHue(hue, { silent } = {}) {
  const h = Math.max(0, Math.min(360, Math.round(+hue || 0)));
  const el = $('singleColorCustom');
  if (el) el.value = String(h);
  const val = $('singleColorCustomVal');
  if (val) val.textContent = h + '°';
  const preview = $('huePreview');
  if (preview) preview.style.background = `hsl(${h} 90% 50%)`;
  const canvas = $('hueCanvas');
  const cursor = $('hueCursor');
  if (canvas && cursor) {
    const rect = canvas.getBoundingClientRect();
    const trackW = rect.width || canvas.width;
    const x = (h / 360) * trackW;
    // cursor is positioned relative to hue-picker; canvas is first cell
    cursor.style.left = canvas.offsetLeft + x + 'px';
    cursor.style.top = canvas.offsetTop + 'px';
    cursor.style.height = (canvas.offsetHeight || 28) + 'px';
  }
  if (!silent && typeof applyPreview === 'function') {
    // applied by pointer handlers
  }
}

function hueFromPointer(clientX) {
  const canvas = $('hueCanvas');
  if (!canvas) return 200;
  const rect = canvas.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(t * 360);
}

function bindHuePicker() {
  const canvas = $('hueCanvas');
  if (!canvas || canvas.dataset.bound === '1') return;
  canvas.dataset.bound = '1';
  drawHueSpectrum();

  let dragging = false;
  const pick = (e) => {
    if ($('singleColorMode')?.value !== 'custom') return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    setCustomHue(hueFromPointer(x));
    // live hue change — no full reset (ribbons keep moving)
    applyPreview(false);
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    pick(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pick(e);
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  window.addEventListener('resize', () => {
    drawHueSpectrum();
    setCustomHue($('singleColorCustom')?.value || 200, { silent: true });
  });
}

function updateColorUi() {
  bindHuePicker();
  const mode = $('singleColorMode')?.value;
  const customRow = $('customHueRow');
  const isCustom = mode === 'custom';
  if (customRow) {
    customRow.hidden = false;
    customRow.classList.toggle('is-disabled', !isCustom);
  }
  const cycle = $('colorCycleSpeed');
  if (cycle) {
    const rainbow = mode === 'false';
    cycle.disabled = !rainbow || getEngine() === 'modern';
  }
  const count = $('ribbonCount');
  if (count && mode === '667') {
    count.min = 3;
    if (+count.value < 3) count.value = 3;
  } else if (count) {
    count.min = 1;
  }
  setCustomHue($('singleColorCustom')?.value || 200, { silent: true });
}

function updateLabels() {
  Object.keys(RANGE_FMT).forEach((id) => {
    const el = $(id);
    const valEl = $(id + 'Val');
    if (el && valEl) valEl.textContent = RANGE_FMT[id](el.value);
  });
}

function syncDatetimeDeps() {
  const on = $('show_datetime')?.checked;
  const stretched = !!$('stretched_mode')?.checked;
  const randEl = $('randomize_datetime_pos');

  // stretched_mode forces randomize (same rule as tray / main.js)
  if (stretched && randEl) {
    randEl.checked = true;
    randEl.disabled = true;
  } else if (randEl) {
    randEl.disabled = !on;
  }

  const rand = !!randEl?.checked;
  if ($('datetime_front')) {
    $('datetime_front').disabled = !on || rand;
  }
  const pos = $('datetime_pos');
  if (pos) pos.disabled = !on || rand;
  const posRow = $('datetimePosRow');
  if (posRow) posRow.hidden = !on;
}

/** Normalize incoming config (store / tray / legacy aliases) */
function normalizeOpts(opts) {
  if (!opts || typeof opts !== 'object') return {};
  const o = { ...opts };
  // runtime meta from main (not stored)
  if (o._meta && typeof o._meta === 'object') {
    runtimeMeta = {
      isPackaged: !!o._meta.isPackaged,
      displays: Array.isArray(o._meta.displays) ? o._meta.displays : []
    };
    delete o._meta;
  }
  // legacy snake_case
  if (o.background_mode != null && o.backgroundMode == null) o.backgroundMode = o.background_mode;
  // legacy theme (light/dark only) → backgroundMode when missing
  if (o.backgroundMode == null && (o.theme === 'light' || o.theme === 'dark')) {
    o.backgroundMode = o.theme;
  }
  delete o.theme;
  if (o.color_cycle_speed != null && o.colorCycleSpeed == null) o.colorCycleSpeed = o.color_cycle_speed;
  if (o.horizontal_speed != null && o.horizontalSpeed == null) o.horizontalSpeed = o.horizontal_speed;
  if (o.max_visible_ribbons != null && o.ribbonCount == null) o.ribbonCount = o.max_visible_ribbons;
  if (o.animationSpeed != null && o.horizontalSpeed == null) {
    o.horizontalSpeed = normalizeModernSpeed(o.animationSpeed);
  }
  delete o.animationSpeed;
  // legacy single_color → singleColor only
  if (o.single_color !== undefined && o.singleColor === undefined) o.singleColor = o.single_color;
  delete o.single_color;
  return o;
}


/** Build / refresh multi-display checkboxes */
function renderDisplaysList(selectedIds) {
  const box = $('displaysList');
  if (!box) return;
  const displays = runtimeMeta.displays || [];
  box.innerHTML = '';
  if (displays.length <= 1) {
    box.hidden = true;
    const modeRow = $('displaysModeRow');
    if (modeRow) modeRow.hidden = true;
    return;
  }
  const modeRow = $('displaysModeRow');
  if (modeRow) modeRow.hidden = false;

  const mode = $('displays_mode')?.value || 'all';
  const stretched = $('stretched_mode')?.checked;
  const custom = mode === 'custom' && !stretched;
  box.hidden = !custom;

  const ids = Array.isArray(selectedIds) ? selectedIds.map(String) : [];
  displays.forEach((d) => {
    const id = String(d.id);
    const label = document.createElement('label');
    label.className = 'display-item check-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = ids.length ? ids.includes(id) : true;
    cb.disabled = !custom;
    cb.addEventListener('change', () => {
      // keep at least one checked
      const checked = box.querySelectorAll('input[type="checkbox"]:checked');
      if (!checked.length) {
        cb.checked = true;
      }
    });
    const span = document.createElement('span');
    span.textContent = d.label || (`Display ${id}`);
    label.appendChild(cb);
    label.appendChild(span);
    box.appendChild(label);
  });
}

function readSelectedDisplays() {
  const displays = runtimeMeta.displays || [];
  if (displays.length <= 1) return 'all';
  if ($('stretched_mode')?.checked) return 'all';
  if ($('displays_mode')?.value !== 'custom') return 'all';
  const box = $('displaysList');
  if (!box) return 'all';
  const ids = [...box.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
  if (!ids.length) return 'all';
  return { displays: ids };
}

function syncDisplaysUi() {
  const displays = runtimeMeta.displays || [];
  const modeRow = $('displaysModeRow');
  const modeSel = $('displays_mode');
  const stretchedRow = $('stretchedModeRow');
  const stretchedEl = $('stretched_mode');
  const stretched = stretchedEl?.checked;
  const multi = displays.length > 1;

  // Hide stretch + monitor picker when only one display (same as tray)
  if (!multi) {
    if (stretchedRow) stretchedRow.hidden = true;
    if (stretchedEl) {
      stretchedEl.checked = false;
      stretchedEl.disabled = true;
    }
    if (modeRow) modeRow.hidden = true;
    if ($('displaysList')) $('displaysList').hidden = true;
    return;
  }

  if (stretchedRow) stretchedRow.hidden = false;
  if (stretchedEl) stretchedEl.disabled = false;
  if (modeRow) modeRow.hidden = false;

  if (stretched) {
    if (modeSel) {
      modeSel.value = 'all';
      modeSel.disabled = true;
    }
  } else if (modeSel) {
    modeSel.disabled = false;
  }

  const selected = readSelectedDisplays();
  const ids = selected === 'all' ? [] : (selected.displays || []);
  // If custom mode, preserve current checkbox state when re-rendering
  let keepIds = ids;
  if ($('displays_mode')?.value === 'custom' && !stretched) {
    const box = $('displaysList');
    if (box && box.children.length) {
      keepIds = [...box.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      if (!keepIds.length) keepIds = (runtimeMeta.displays || []).map((d) => String(d.id));
    } else if (!keepIds.length) {
      keepIds = (runtimeMeta.displays || []).map((d) => String(d.id));
    }
  }
  renderDisplaysList(
    $('displays_mode')?.value === 'custom' && !stretched ? keepIds : []
  );
}

function syncRunAtStartupUi() {
  const el = $('run_at_startup');
  if (!el) return;
  // tray: enabled only when app.isPackaged
  el.disabled = !runtimeMeta.isPackaged;
  const row = el.closest('.check-row');
  if (row) row.title = runtimeMeta.isPackaged ? '' : 'Available only in packaged build';
}

function syncLoggingUi() {
  const el = $('logging');
  if (!el) return;
  if (el.checked) {
    $('btnOpenLog').disabled = false
  } else {
    $('btnOpenLog').disabled = true
  }
}

function parseSelectedDisplaysFromStore(val) {
  if (!val || val === 'all') return { mode: 'all', ids: [] };
  if (typeof val === 'object' && Array.isArray(val.displays)) {
    return { mode: 'custom', ids: val.displays.map(String) };
  }
  return { mode: 'all', ids: [] };
}

/** Read form → store-compatible object (config.json keys) */
function readForm() {
  updateColorUi();
  const engine = getEngine();
  const singleColor = parseSingleColor();
  const ribbonCount = +$('ribbonCount').value;
  const engNow = engine;
  let horizontalSpeed;
  if (engNow === 'classic') {
    horizontalSpeed = CLASSIC_SPEED_KEYS[Math.round(+$('horizontalSpeed')?.value)] || 'normal';
  } else {
    horizontalSpeed = normalizeModernSpeed($('horizontalSpeed')?.value);
  }
  const ui_theme = $('ui_theme').value;

  const data = {
    locale: currentLocale,
    engine,
    ui_theme,
    stretched_mode: $('stretched_mode').checked,
    selected_displays: readSelectedDisplays(),
    singleColor,
    ribbonCount,
    horizontalSpeed,
    show_datetime: $('show_datetime').checked,
    datetime_front: $('datetime_front').checked,
    randomize_datetime_pos: !!$('stretched_mode')?.checked || !!$('randomize_datetime_pos')?.checked,
    datetime_pos: $('datetime_pos')?.value || 'center',
    idle_time: Math.max(5, Math.min(3600, Math.round(+$('idle_time').value || 60))),
    media_detect: $('media_detect').checked,
    fullscreen_detect: $('fullscreen_detect').checked,
    user_activity: $('user_activity').checked,
    hw_acc: $('hw_acc').checked,
    run_at_startup: $('run_at_startup').checked,
    logging: $('logging').checked
  };

  // Shared: both engines use #backgroundMode only (no separate Theme)
  data.backgroundMode = $('backgroundMode')?.value || 'dark';

  if (engine === 'modern') {
    Object.assign(data, {
      endless: $('endless').checked,
      opacity: +$('opacity').value,
      glow: +$('glow').value,
      minLength: +$('minLength').value,
      maxLength: +$('maxLength').value,
      minWidth: +$('minWidth').value,
      maxWidth: +$('maxWidth').value,
      minCurl: +$('minCurl').value,
      maxCurl: +$('maxCurl').value,
      curlAmplitude: +$('curlAmplitude').value,
      minTwist: +$('minTwist').value,
      maxTwist: +$('maxTwist').value,
      mode: singleColor === 667 ? 'tricolor' : 'classic'
    });
    if (data.minLength > data.maxLength) {
      data.maxLength = data.minLength;
      $('maxLength').value = data.maxLength;
    }
    if (data.minWidth > data.maxWidth) {
      data.maxWidth = data.minWidth;
      $('maxWidth').value = data.maxWidth;
    }
    if (data.minCurl > data.maxCurl) {
      data.maxCurl = data.minCurl;
      $('maxCurl').value = data.maxCurl;
    }
    if (data.minTwist > data.maxTwist) {
      data.maxTwist = data.minTwist;
      $('maxTwist').value = data.maxTwist;
    }
    if (singleColor === 667 && data.ribbonCount < 3) {
      data.ribbonCount = 3;
      $('ribbonCount').value = 3;
    }
  } else {
    Object.assign(data, {
      colorCycleSpeed: singleColor ? 0 : +$('colorCycleSpeed').value,
      colorSaturation: +$('colorSaturation').value,
      colorBrightness: +$('colorBrightness').value,
      colorAlpha: +$('colorAlpha').value,
      verticalPosition: $('verticalPosition').value,
      parallaxAmount: +$('parallaxAmount').value,
      strokeSize: +$('strokeSize').value,
      ribbonBlur: +$('ribbonBlur').value,
      animateSections: $('animateSections').checked,
      ...(CLASSIC_SPEED_PRESETS[horizontalSpeed] || CLASSIC_SPEED_PRESETS.normal)
    });
    if (singleColor === 667 && data.ribbonCount < 3) {
      data.ribbonCount = 3;
      $('ribbonCount').value = 3;
    }
  }

  const resolved = resolveUiTheme(ui_theme, data.backgroundMode);
  applyUiTheme(resolved);
  return data;
}

async function writeForm(opts) {
  const o = { ...DEFAULTS, ...normalizeOpts(opts) };
  const engine = o.engine === 'classic' ? 'classic' : 'modern';
  setEngine(engine, { silent: true });

  const wantLocale = o.locale === 'en' ? 'en' : 'ru';
  if (wantLocale !== currentLocale || !Object.keys(dict).length) {
    await loadLocale(wantLocale);
  }

  const sc = o.singleColor;
  const known = [false, 667, 666, 360, 60, 120, 180, 240, 300];
  if (sc === false || sc === undefined || sc === null || sc === 0) {
    $('singleColorMode').value = 'false';
  } else if (known.includes(sc) || known.includes(+sc)) {
    $('singleColorMode').value = String(sc);
  } else {
    $('singleColorMode').value = 'custom';
    setCustomHue(+sc || 200);
  }

  $('stretched_mode').checked = asBool(o.stretched_mode);
  {
    const sd = parseSelectedDisplaysFromStore(o.selected_displays);
    if ($('displays_mode')) {
      $('displays_mode').value = sd.mode;
    }
    renderDisplaysList(sd.ids);
  }
  syncDisplaysUi();
  syncRunAtStartupUi();
  
  $('ribbonCount').value = o.ribbonCount ?? 5;
  syncSpeedSliderMode(engine);
  if (engine === 'classic') {
    $('horizontalSpeed').value = String(classicSpeedIndex(o.horizontalSpeed));
  } else {
    $('horizontalSpeed').value = String(normalizeModernSpeed(o.horizontalSpeed));
  }
  $('show_datetime').checked = asBool(o.show_datetime);
  $('datetime_front').checked = asBool(o.datetime_front);
  $('randomize_datetime_pos').checked =
    asBool(o.stretched_mode) || asBool(o.randomize_datetime_pos);
  if ($('datetime_pos')) {
    const allowed = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
    $('datetime_pos').value = allowed.includes(o.datetime_pos) ? o.datetime_pos : 'center';
  }
  {
    let idle = Number(o.idle_time ?? 60);
    if (!Number.isFinite(idle)) idle = 60;
    idle = Math.max(5, Math.min(3600, Math.round(idle)));
    $('idle_time').value = idle;
  }
  $('media_detect').checked = asBool(o.media_detect);
  $('fullscreen_detect').checked = asBool(o.fullscreen_detect);
  $('user_activity').checked = asBool(o.user_activity);
  $('hw_acc').checked = asBool(o.hw_acc);
  $('run_at_startup').checked = asBool(o.run_at_startup);
  $('logging').checked = asBool(o.logging);
  syncLoggingUi()

  // backgroundMode is shared by classic and modern
  if ($('backgroundMode')) {
    $('backgroundMode').value = o.backgroundMode || 'darkGradient';
  }
  if (engine === 'modern') {
    // backgroundMode already set above
    $('endless').checked = asBool(o.endless);
    $('opacity').value = o.opacity ?? 100;
    $('glow').value = o.glow ?? 66;
    $('minLength').value = o.minLength ?? 1;
    $('maxLength').value = o.maxLength ?? 3;
    $('minWidth').value = o.minWidth ?? 10;
    $('maxWidth').value = o.maxWidth ?? 30;
    $('minCurl').value = o.minCurl ?? 0.35;
    $('maxCurl').value = o.maxCurl ?? 1;
    $('curlAmplitude').value = o.curlAmplitude ?? 0.22;
    $('minTwist').value = o.minTwist ?? 0;
    $('maxTwist').value = o.maxTwist ?? 1;
  } else {
    $('colorCycleSpeed').value = String(o.colorCycleSpeed ?? 3);
    const sat = String(o.colorSaturation ?? 60).replace('%', '');
    const bri = String(o.colorBrightness ?? 50).replace('%', '');
    $('colorSaturation').value = sat;
    $('colorBrightness').value = bri;
    $('colorAlpha').value = o.colorAlpha ?? 1;
    $('verticalPosition').value = o.verticalPosition || 'random';
    $('parallaxAmount').value = o.parallaxAmount ?? -0.3;
    $('strokeSize').value = o.strokeSize ?? 1;
    $('ribbonBlur').value = o.ribbonBlur ?? 30;
    $('animateSections').checked = o.animateSections !== false;
  }

  $('ui_theme').value = o.ui_theme || 'dark';
  const resolved = resolveUiTheme(o.ui_theme, o.backgroundMode);
  applyUiTheme(resolved);

  applyI18n();
  updateColorUi();
  syncDatetimeDeps();
  updateLabels();
}

function destroyInstance() {
  if (!instance) return;
  try {
    if (typeof instance.destroy === 'function') {
      instance.destroy();
    } else {
      // classic fallback if destroy missing
      instance._destroyed = true;
      cancelAnimationFrame(instance._raf || window.AnimationId);
      window.removeEventListener('resize', instance._onResize);
      window.removeEventListener('scroll', instance._onScroll);
      if (instance._canvas?.parentNode) instance._canvas.parentNode.removeChild(instance._canvas);
      if (instance._bgCanvas?.parentNode) instance._bgCanvas.parentNode.removeChild(instance._bgCanvas);
    }
  } catch (e) {
    console.warn('destroyInstance:', e);
  }
  instance = null;
  // remove leftover engine canvases only (keep hue palette canvas outside #preview)
  if (preview) {
    preview.querySelectorAll('canvas.ribbons-canvas, canvas.ribbons-bg-canvas, canvas.ribbons-modern-canvas').forEach((c) => c.remove());
    // also any plain canvas direct children except datetime
    preview.querySelectorAll(':scope > canvas').forEach((c) => c.remove());
  }
}

function embedClassicCanvas(inst) {
  if (!inst) return;
  // classic appends to document.body — relocate into preview like modern container
  const layers = [inst._bgCanvas, inst._canvas].filter(Boolean);
  layers.forEach((canvas, i) => {
    if (canvas.parentNode !== preview) preview.appendChild(canvas);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.zIndex = String(i === 0 ? -1 : 0); // bg under datetime(-1)/ribbons; ribbons at 0
    canvas.style.pointerEvents = 'none';
  });
  // datetime sits at z-index 2 / front 5 — keep on top of canvases in DOM
  const dt = document.getElementsByClassName('datetime-container')[0];
  if (dt && preview) preview.appendChild(dt);
  syncClassicSize(inst);
}

function syncClassicSize(inst) {
  if (!inst || !inst._canvas) return;
  const rect = preview.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  inst._width = w;
  inst._height = h;
  inst._canvas.width = w;
  inst._canvas.height = h;
  if (inst._bgCanvas) {
    inst._bgCanvas.width = w;
    inst._bgCanvas.height = h;
  }
  if (inst._context && inst._options) {
    inst._context.globalAlpha = inst._options.colorAlpha;
  }
  if (typeof inst._drawBackground === 'function') {
    try { inst._drawBackground(); } catch (_) {}
  }
}

function previewBackgroundMode(mode) {
  // Match screensaver: auto → darkGradient for canvas paint; transparent/glass stay clear
  if (!mode || mode === 'auto') return 'darkGradient';
  return mode;
}

function finite(n, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function startModern(data) {
  destroyInstance();
  // Wait until preview has a real size (avoids NaN in createLinearGradient)
  const rect = preview.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    requestAnimationFrame(() => startModern(data));
    return;
  }

  const single = data.singleColor;
  const speed = normalizeModernSpeed(data.horizontalSpeed);

  let minLength = finite(data.minLength, 1);
  let maxLength = finite(data.maxLength, 3);
  if (minLength > maxLength) maxLength = minLength;
  let minWidth = finite(data.minWidth, 10);
  let maxWidth = finite(data.maxWidth, 30);
  if (minWidth > maxWidth) maxWidth = minWidth;
  let minCurl = finite(data.minCurl, 0.35);
  let maxCurl = finite(data.maxCurl, 1);
  if (minCurl > maxCurl) maxCurl = minCurl;
  let minTwist = finite(data.minTwist, 0);
  let maxTwist = finite(data.maxTwist, 1);
  if (minTwist > maxTwist) maxTwist = minTwist;

  // singleColor: false | hue number (not string). 667 = tricolor mode flag.
  let singleColor = false;
  if (single !== false && single != null && single !== '') {
    const n = Number(single);
    singleColor = Number.isFinite(n) ? n : false;
  }

  const opts = {
    mode: singleColor === 667 ? 'tricolor' : 'classic',
    backgroundMode: previewBackgroundMode(data.backgroundMode),
    ribbonCount: Math.max(1, Math.round(finite(data.ribbonCount, 3))),
    opacity: Math.max(1, Math.min(100, finite(data.opacity, 100))),
    glow: Math.max(0, finite(data.glow, 66)),
    horizontalSpeed: speed,
    minLength,
    maxLength,
    minWidth,
    maxWidth,
    endless: !!data.endless,
    minCurl,
    maxCurl,
    minTwist,
    maxTwist,
    curlAmplitude: Math.max(0, finite(data.curlAmplitude, 0.22)),
    singleColor,
    container: preview,
    // same stacking as controller: bg (z-1) < datetime (-1) < ribbons (0) < datetime.front (4)
    zIndex: 0
  };
  instance = new RibbonsModern(opts);
  const dt = document.getElementsByClassName('datetime-container')[0];
  if (dt && preview) preview.appendChild(dt);
}


function startClassic(data) {
  if (!RibbonsClassic) {
    setStatus(t('status_classic_missing'));
    return;
  }
  destroyInstance();
  const speedKey = classicSpeedKey(data.horizontalSpeed);
  const timing = CLASSIC_SPEED_PRESETS[speedKey] || CLASSIC_SPEED_PRESETS.normal;
  let sat = (data.colorSaturation ?? 60) + '%';
  let cycle = data.colorCycleSpeed ?? 3;
  let single = data.singleColor;
  if (single === false || single === undefined) single = false;
  if (single === 666) {
    sat = '0%';
    cycle = 0;
  } else if (single) {
    cycle = 0;
  }
  instance = new RibbonsClassic({
    colorSaturation: sat,
    colorBrightness: (data.colorBrightness ?? 50) + '%',
    colorAlpha: data.colorAlpha ?? 1,
    colorCycleSpeed: cycle,
    verticalPosition: data.verticalPosition || 'random',
    horizontalSpeed: 400,
    delay: data.delay ?? timing.delay,
    phase: data.phase ?? timing.phase,
    ribbonCount: data.ribbonCount ?? 3,
    strokeSize: data.strokeSize ?? 1,
    parallaxAmount: data.parallaxAmount ?? -0.3,
    animateSections: data.animateSections !== false,
    ribbonBlur: data.ribbonBlur ?? 30,
    singleColor: single,
    backgroundMode: previewBackgroundMode(data.backgroundMode)
  });
  embedClassicCanvas(instance);
}


let _previewTimer = null;
let _lastPreviewSig = '';
let _lastDtSig = '';

function datetimeSignature(data) {
  return JSON.stringify({
    show: !!data.show_datetime,
    front: !!data.datetime_front,
    rand: !!data.randomize_datetime_pos,
    pos: data.datetime_pos || 'center',
    locale: data.locale,
    bg: data.backgroundMode
  });
}

/** Options object for RibbonsModern.updateOptions / constructor */
function modernLiveOpts(data) {
  const speed = normalizeModernSpeed(data.horizontalSpeed);
  let singleColor = false;
  if (data.singleColor !== false && data.singleColor != null && data.singleColor !== '') {
    const n = Number(data.singleColor);
    singleColor = Number.isFinite(n) ? n : false;
  }
  const clampPair = (a, b, fa, fb) => {
    let x = finite(a, fa), y = finite(b, fb);
    if (x > y) y = x;
    return [x, y];
  };
  const [minLength, maxLength] = clampPair(data.minLength, data.maxLength, 1, 3);
  const [minWidth, maxWidth] = clampPair(data.minWidth, data.maxWidth, 10, 30);
  const [minCurl, maxCurl] = clampPair(data.minCurl, data.maxCurl, 0.35, 1);
  const [minTwist, maxTwist] = clampPair(data.minTwist, data.maxTwist, 0, 1);
  return {
    mode: singleColor === 667 ? 'tricolor' : 'classic',
    backgroundMode: previewBackgroundMode(data.backgroundMode),
    ribbonCount: Math.max(1, Math.round(finite(data.ribbonCount, 3))),
    opacity: Math.max(1, Math.min(100, finite(data.opacity, 100))),
    glow: Math.max(0, finite(data.glow, 66)),
    horizontalSpeed: speed,
    minLength,
    maxLength,
    minWidth,
    maxWidth,
    endless: !!data.endless,
    minCurl,
    maxCurl,
    minTwist,
    maxTwist,
    curlAmplitude: Math.max(0, finite(data.curlAmplitude, 0.22)),
    singleColor
  };
}


/** Color "mode" bucket — hue number changes stay in 'fixed' (no ribbon respawn). */
function singleColorModeKey(sc) {
  if (sc === false || sc === undefined || sc === null || sc === 0) return 'rainbow';
  if (sc === 667) return 'tricolor';
  if (sc === 666) return 'gray';
  return 'fixed';
}

/** Live patch classic Ribbons._options (no destroy). Returns false if full restart needed. */
function patchClassicLive(data) {
  if (!instance || typeof instance.setOptions !== 'function') return false;
  const speedKey = classicSpeedKey(data.horizontalSpeed);
  const timing = CLASSIC_SPEED_PRESETS[speedKey] || CLASSIC_SPEED_PRESETS.normal;
  let sat = (data.colorSaturation ?? 60) + '%';
  let cycle = data.colorCycleSpeed ?? 3;
  let single = data.singleColor;
  if (single === false || single === undefined) single = false;
  if (single === 666) {
    sat = '0%';
    cycle = 0;
  } else if (single) {
    cycle = 0;
  }
  const prevSingle = instance._options && instance._options.singleColor;
  const prevBg = instance._options && instance._options.backgroundMode;
  const bg = previewBackgroundMode(data.backgroundMode);

  instance.setOptions({
    colorSaturation: sat,
    colorBrightness: (data.colorBrightness ?? 50) + '%',
    colorAlpha: data.colorAlpha ?? 1,
    colorCycleSpeed: cycle,
    verticalPosition: data.verticalPosition || 'random',
    horizontalSpeed: 400,
    delay: data.delay ?? timing.delay,
    phase: data.phase ?? timing.phase,
    ribbonCount: data.ribbonCount ?? 3,
    strokeSize: data.strokeSize ?? 1,
    parallaxAmount: data.parallaxAmount ?? -0.3,
    animateSections: data.animateSections !== false,
    ribbonBlur: data.ribbonBlur ?? 30,
    glow: data.glow,
    singleColor: single,
    backgroundMode: bg
  });

  if (instance._context && instance._options) {
    instance._context.globalAlpha = instance._options.colorAlpha;
  }
  // Respawn only when color *mode* or background changes — not when custom hue slides
  const modeChanged = singleColorModeKey(prevSingle) !== singleColorModeKey(single);
  if (modeChanged || prevBg !== bg) {
    instance._ribbons = [];
    if (typeof instance._drawBackground === 'function') {
      try { instance._drawBackground(); } catch (_) {}
    }
  } else if (
    singleColorModeKey(single) === 'fixed' &&
    prevSingle !== single &&
    Array.isArray(instance._ribbons)
  ) {
    // Live-update hue on existing classic sections
    instance._ribbons.forEach(function (ribbon) {
      if (!Array.isArray(ribbon)) return;
      ribbon.forEach(function (section) {
        if (section) section.color = single;
      });
    });
  }
  // Trim excess ribbons if count dropped
  const max = instance._options.ribbonCount || 3;
  while (instance._ribbons && instance._ribbons.length > max) {
    instance._ribbons.pop();
  }
  return true;
}

function applyPreview(forceRestart) {
  const data = readForm();
  updateLabels();
  syncDatetimeDeps();
  const eng = data.engine;
  const dtSig = datetimeSignature(data);

  const run = () => {
    // datetime / window chrome — independent of ribbons instance
    if (forceRestart || dtSig !== _lastDtSig) {
      _lastDtSig = dtSig;
      syncPreviewChrome(data);
    } else {
      applyPreviewStageTheme(data.backgroundMode);
    }

    // Engine switch or missing instance → full start
    if (forceRestart || eng !== currentEngine || !instance) {
      currentEngine = eng;
      setPauseUi(false);
      destroyInstance();
      if (eng === 'modern') startModern(data);
      else startClassic(data);
      return;
    }

    // Live update without destroy
    if (eng === 'modern' && typeof instance.updateOptions === 'function') {
      try {
        instance.updateOptions(modernLiveOpts(data));
        setPauseUi(previewPaused);
        if (previewPaused && typeof instance.pause === 'function') instance.pause();
        return;
      } catch (e) {
        console.warn('modern live update failed, full restart', e);
      }
    }

    if (eng === 'classic') {
      if (patchClassicLive(data)) {
        setPauseUi(previewPaused);
        return;
      }
    }

    // Fallback full restart
    currentEngine = eng;
    setPauseUi(false);
    destroyInstance();
    if (eng === 'modern') startModern(data);
    else startClassic(data);
  };

  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(run, 40);
}

/** Payload for store — same keys as config.json */
function collectForSave() {
  const d = readForm();
  const out = {
    locale: d.locale,
    engine: d.engine,
    endless: !!d.endless,
    backgroundMode: d.backgroundMode || 'darkGradient',
    opacity: d.opacity ?? 100,
    stretched_mode: !!d.stretched_mode,
    selected_displays: d.selected_displays == null ? 'all' : d.selected_displays,
    singleColor: d.singleColor === undefined ? false : d.singleColor,
    ribbonCount: d.ribbonCount,
    colorCycleSpeed: d.colorCycleSpeed ?? 3,
    horizontalSpeed: d.engine === 'classic'
      ? classicSpeedKey(d.horizontalSpeed)
      : normalizeModernSpeed(d.horizontalSpeed),
    show_datetime: !!d.show_datetime,
    datetime_front: !!d.datetime_front,
    randomize_datetime_pos: !!d.stretched_mode || !!d.randomize_datetime_pos,
    datetime_pos: d.datetime_pos || 'center',
    idle_time: d.idle_time,
    media_detect: !!d.media_detect,
    fullscreen_detect: !!d.fullscreen_detect,
    user_activity: !!d.user_activity,
    hw_acc: !!d.hw_acc,
    run_at_startup: !!d.run_at_startup,
    logging: !!d.logging
  };
  if (d.engine === 'modern') {
    Object.assign(out, {
      glow: d.glow,
      minLength: d.minLength,
      maxLength: d.maxLength,
      minWidth: d.minWidth,
      maxWidth: d.maxWidth,
      minCurl: d.minCurl,
      maxCurl: d.maxCurl,
      minTwist: d.minTwist,
      maxTwist: d.maxTwist,
      curlAmplitude: d.curlAmplitude
    });
  } else {
    Object.assign(out, {
      colorSaturation: d.colorSaturation,
      colorBrightness: d.colorBrightness,
      colorAlpha: d.colorAlpha,
      verticalPosition: d.verticalPosition,
      parallaxAmount: d.parallaxAmount,
      strokeSize: d.strokeSize,
      ribbonBlur: d.ribbonBlur,
      animateSections: d.animateSections
    });
  }
  out.ui_theme = d.ui_theme;
  return out;
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'status' + (kind ? ' ' + kind : '');
  if (msg) {
    clearTimeout(setStatus._t);
    setStatus._t = setTimeout(() => {
      el.textContent = '';
      el.className = 'status';
    }, 2800);
  }
}

// —— events ——
document.querySelectorAll('.engine-tab').forEach((tab) => {
  tab.addEventListener('click', () => setEngine(tab.dataset.engine));
});

document.querySelectorAll('.locale-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const tag = btn.dataset.locale === 'en' ? 'en' : 'ru';
    await loadLocale(tag);
    applyI18n();
  });
});

$('ui_theme').addEventListener('change', () => {
  const data = readForm();
  const resolved = resolveUiTheme(data.ui_theme, data.backgroundMode);
  applyUiTheme(resolved);
});

const liveIds = [
  'backgroundMode', 'stretched_mode', 'displays_mode',
  'singleColorMode', 'colorCycleSpeed',
  'ribbonCount', 'horizontalSpeed',
  'endless', 'opacity', 'glow',
  'minLength', 'maxLength', 'minWidth', 'maxWidth',
  'minCurl', 'maxCurl', 'curlAmplitude', 'minTwist', 'maxTwist',
  'colorSaturation', 'colorBrightness', 'colorAlpha',
  'verticalPosition', 'parallaxAmount', 'strokeSize', 'ribbonBlur', 'animateSections',
  'show_datetime', 'datetime_front', 'randomize_datetime_pos', 'datetime_pos',
  'idle_time', 'media_detect', 'fullscreen_detect', 'user_activity',
  'hw_acc', 'run_at_startup', 'logging'
];

liveIds.forEach((id) => {
  const el = $(id);
  if (!el) return;
  const evt = el.type === 'range' || el.type === 'checkbox' ? 'input' : 'change';
  el.addEventListener(evt, () => {
    if (id === 'singleColorMode') updateColorUi();
    if (id === 'show_datetime' || id === 'randomize_datetime_pos' || id === 'datetime_pos' || id === 'stretched_mode') {
      syncDatetimeDeps();
    }
    // Live path in applyPreview — full restart only on engine switch / force
    applyPreview(false);
  });
});


$('stretched_mode')?.addEventListener('change', () => {
  if ($('stretched_mode').checked && $('randomize_datetime_pos')) {
    $('randomize_datetime_pos').checked = true;
  }
  syncDisplaysUi();
  syncDatetimeDeps();
});
$('displays_mode')?.addEventListener('change', () => {
  syncDisplaysUi();
});

$('btnReset').addEventListener('click', async () => {
  await writeForm({ ...DEFAULTS, engine: getEngine(), locale: currentLocale });
  applyPreview(true);
  setStatus(t('status_reset'));
});

$('btnOpenLog').addEventListener('click', async () => {
  if (ipcRenderer) {
    ipcRenderer.send('ribbons-settings-open-log');
  }
});

let previewPaused = false;

function setPauseUi(paused) {
  previewPaused = !!paused;
  const btn = $('btnPause');
  if (!btn) return;
  btn.textContent = previewPaused ? (t('show_now') || 'Resume') : (t('pause') || 'Pause');
  btn.setAttribute('data-i18n', previewPaused ? 'show_now' : 'pause');
}

$('btnPause')?.addEventListener('click', () => {
  if (!instance) return;
  if (!previewPaused) {
    // same as controller.js send-pause
    if (typeof instance.pause === 'function') {
      instance.pause();
    } else {
      try {
        cancelAnimationFrame(window.AnimationId);
      } catch (_) {}
      if (instance._sto != null) {
        try { clearTimeout(instance._sto); } catch (_) {}
      }
    }
    pauseDateTimeAnimation();
    setPauseUi(true);
  } else {
    // same as controller resume path
    if (typeof instance.resume === 'function') {
      instance.resume();
    } else if (typeof instance._onDraw === 'function') {
      // classic: restart draw loop
      try {
        window.AnimationId = requestAnimationFrame(instance._onDraw.bind(instance));
      } catch (_) {
        applyPreview(true);
        return;
      }
    } else {
      applyPreview(true);
      return;
    }
    resumeDateTimeAnimation();
    setPauseUi(false);
  }
});

$('btnCancel').addEventListener('click', () => {
  self.close();
});

$('btnApply').addEventListener('click', () => {
  const data = collectForSave();
  if (ipcRenderer) {
    ipcRenderer.send('ribbons-settings-save', data);
    setStatus(t('status_saved_store'), 'saved');
  } else {
    try {
      localStorage.setItem('ribbons-settings', JSON.stringify(data));
      setStatus(t('status_saved_ls'), 'saved');
    } catch (e) {
      setStatus('Error: ' + e.message);
    }
    console.log('ribbons settings', data);
  }
});

window.addEventListener('resize', () => {
  if (getEngine() === 'classic' && instance) syncClassicSize(instance);
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (getEngine() === 'classic' && instance) syncClassicSize(instance);
  }).observe(preview);
}

let settingsLoaded = false;

/** Coerce store values that may arrive as 0/1, "true"/"false", etc. */
function asBool(v, fallback = false) {
  if (v === true || v === 1 || v === '1' || v === 'true') return true;
  if (v === false || v === 0 || v === '0' || v === 'false') return false;
  if (v == null) return fallback;
  return !!v;
}

async function boot(initial) {
  settingsLoaded = true;
  const opts = initial || DEFAULTS;
  await writeForm(opts);
  applyPreview(true);
}

if (ipcRenderer) {
  ipcRenderer.on('ribbons-settings-load', (_e, opts) => {
    boot(opts && typeof opts === 'object' ? opts : DEFAULTS);
  });
  ipcRenderer.send('ribbons-settings-ready');
  // Fallback only if main never answered — do NOT wipe a successful load
  setTimeout(() => {
    if (!settingsLoaded) boot(DEFAULTS);
  }, 500);
} else {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem('ribbons-settings') || 'null');
  } catch (_) {}
  boot(stored || DEFAULTS);
}

window.addEventListener('beforeunload', () => destroyInstance());
