// electron related stuff
const { ipcRenderer } = require('electron')
import { updateDateTime, showDateTime, setFixedPosition, checkContainerMaxSize, setFront, randomizePosition, pauseDateTimeAnimation, resumeDateTimeAnimation, showDRL } from './datetime.js';
import Ribbons from './ribbons.js';
import RibbonsModern from './ribbons_modern.js';

let Ribbons_instance = null;
var colorCycleSpeed = null;
var colorSaturation = null;
var options = [];
var AnimationId = null;
let paused = false;
let delay;
let engine ;
//let lastSoundTime = Date.now();
let close_button = document.getElementById('close-button');
let hideCursorTimer;
let lastShow = 0;

function debug(text){
    ipcRenderer.send('debug', text);
}

function allCloseButtons() {
    return document.querySelectorAll('#close-button, .close-button-extra');
}

function bindCloseClick(btn) {
    if (!btn || btn.dataset.closeBound === '1') return;
    btn.dataset.closeBound = '1';
    btn.addEventListener('click', () => {
        ipcRenderer.send('close-button-clicked');
    });
}

/**
 * Place a close button at the center of every physical monitor.
 * Matches style.css: top/right 50% + translate for single display.
 * In stretched mode one BrowserWindow spans all displays — clone a
 * centered button into each src_bounds region.
 */
function setupCloseButtons(opts) {
    document.querySelectorAll('.close-button-extra').forEach((el) => el.remove());

    const mainBtn = document.getElementById('close-button');
    if (!mainBtn) return;
    if (opts && opts.closeBtnTitle) {
        mainBtn.title = opts.closeBtnTitle;
    }
    bindCloseClick(mainBtn);

    const src = opts && opts.src_bounds;
    const win = opts && opts.display_bounds;

    // Single monitor or non-stretched: rely on CSS (centered)
    if (!Array.isArray(src) || src.length <= 1 || !win) {
        mainBtn.style.left = '50%';
        mainBtn.style.width = '10vw';
        mainBtn.style.height = '10vw';
        mainBtn.style.top = '50%';
        mainBtn.style.transform = 'translate(-50%, -50%)';
        //mainBtn.querySelector('span').style.fontSize = '8vw';
        return;
    }

    const originX = win.x || 0;
    const originY = win.y || 0;

    src.forEach((b, i) => {
        if (!b || b.width == null || b.height == null) return;
        const relLeft = (b.x || 0) - originX;
        const relTop = (b.y || 0) - originY;
        // Center of this physical display inside the stretched window
        const cx = relLeft + b.width / 2;
        const cy = relTop + b.height / 2;

        const btn = i === 0 ? mainBtn : mainBtn.cloneNode(true);
        if (i > 0) {
            btn.id = '';
            btn.classList.add('close-button-extra');
            btn.classList.add('hidden');
            // cloneNode copies data-close-bound from main — clear so click binds
            delete btn.dataset.closeBound;
            if (opts && opts.closeBtnTitle) {
                btn.title = opts.closeBtnTitle;
            }
            document.body.appendChild(btn);
            bindCloseClick(btn);
        }
        btn.style.position = 'absolute';
        btn.style.right = 'auto';
        btn.style.left = cx + 'px';
        btn.style.top = cy + 'px';
        const side = Math.min(b.width, b.height);
        const btnPx = Math.max(36, Math.round(side * 0.2));
        btn.style.width = btnPx + 'px';
        btn.style.height = btnPx + 'px';
        //btn.querySelector('span').style.fontSize = '2vw';
        btn.style.transform = 'translate(-50%, -50%)';
    });
}

bindCloseClick(close_button);
/*document.addEventListener("mousemove", show_cursor);
document.addEventListener("keydown", show_cursor);
document.addEventListener("click", show_cursor);*/

/** Stop and dispose current ribbons instance (classic or modern). */
function stop_Ribbons() {
    if (!Ribbons_instance) return;
    if (typeof Ribbons_instance.destroy === 'function') {
        // RibbonsModern
        Ribbons_instance.destroy();
    } else {
        // classic Ribbons — remove both ribbons canvas and bg canvas
        try {
            if (Ribbons_instance._context && Ribbons_instance._canvas) {
                Ribbons_instance._context.clearRect(
                    0, 0,
                    Ribbons_instance._canvas.width,
                    Ribbons_instance._canvas.height
                );
            }
            cancelAnimationFrame(AnimationId || window.AnimationId);
            if (Ribbons_instance._canvas) {
                Ribbons_instance._canvas.remove();
            }
            if (Ribbons_instance._bgCanvas) {
                Ribbons_instance._bgCanvas.remove();
            }
        } catch (e) {
            console.warn('stop_Ribbons classic cleanup:', e);
        }
    }
    Ribbons_instance = null;
}

/**
 * Apply body class for UI styling (buttons, datetime, etc.).
 * Background itself is painted by the ribbons engine on canvas.
 *   light / lightGradient → body.light  (light UI)
 *   dark / darkGradient / transparent → body.dark (or no light class)
 */
function applyBodyTheme(theme) {
    document.body.classList.remove('light', 'dark', 'lightGradient', 'darkGradient', 'transparent');
    if (theme === 'light' || theme === 'lightGradient' || theme === 'transparent') {
        document.body.classList.add('light');
    } else {
        document.body.classList.add('dark');
    }
    // Keep the exact theme class too (useful for CSS hooks / debugging)
    if (theme) {
        document.body.classList.add(theme);
    }
}

function start_Ribbons(colorSaturation, colorCycleSpeed, options) {
    stop_Ribbons();
    engine = 'classic';
    Ribbons_instance = new Ribbons({
        colorSaturation: colorSaturation,
        colorBrightness: "50%",
        colorAlpha: 1,
        colorCycleSpeed: colorCycleSpeed,
        verticalPosition: "random",
        horizontalSpeed: options["horizontalSpeed"],
        delay: options["delay"],
        phase: options["phase"],
        ribbonCount: options["ribbonCount"],
        strokeSize: 1,
        parallaxAmount: -0.3,
        animateSections: true,
        glow: options["glow"],
        singleColor: options["singleColor"],
        // Canvas-painted background (same modes as modern)
        backgroundMode: options["backgroundMode"] || "darkGradient"
    });
}

/**
 * Map IPC options → RibbonsModern constructor options.
 * Supports both dedicated modern keys and classic-style keys.
 */
/** Modern: tray string or number → multiplier 0.3…3 */
function normalizeModernSpeed(v) {
    var SPEED_MAP = { slow: 0.8, normal: 1.5, fast: 2.2, v_fast: 3 };
    if (typeof v === "string" && SPEED_MAP[v] != null) return SPEED_MAP[v];
    var n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 1.5;
    return Math.max(0.3, Math.min(3, n));
}

/** Classic: fixed delay/phase presets (original tray values). */
var CLASSIC_SPEED_PRESETS = {
    slow:   { delay: 6,   phase: 0.007 },
    normal: { delay: 4,   phase: 0.014 },
    fast:   { delay: 2,   phase: 0.04 },
    v_fast: { delay: 1.5, phase: 0.07 }
};

function classicSpeedKey(v) {
    if (typeof v === "string" && CLASSIC_SPEED_PRESETS[v]) return v;
    // numeric (from modern) → nearest preset label
    var n = normalizeModernSpeed(v);
    var map = { slow: 0.8, normal: 1.5, fast: 2.2, v_fast: 3 };
    var best = "normal", bestDiff = Infinity, k;
    for (k in map) {
        var d = Math.abs(map[k] - n);
        if (d < bestDiff) { bestDiff = d; best = k; }
    }
    return best;
}

function mapModernOptions(got) {
    var mode = "classic";
    if (got.mode === "tricolor" || got.singleColor === 667) {
        mode = "tricolor";
    }
    got.horizontalSpeed = normalizeModernSpeed(got.horizontalSpeed);

    var count = got.ribbonCount != null ? got.ribbonCount : (mode === "tricolor" ? 3 : 5);
    if (mode === "tricolor" && count < 3) count = 3;
    // singleColor: false | 666 | 667 | 0..360 (same as classic ribbons.js)
    var singleColor = got.singleColor !== undefined ? got.singleColor : false;
    if (singleColor === 667) {
        mode = "tricolor";
    }
   
    var bg = got.backgroundMode || "darkGradient";
    return {
        mode: mode,
        singleColor: singleColor,
        backgroundMode: bg,
        ribbonCount: count,
        opacity: got.opacity != null ? got.opacity : 70,
        glow: got.glow != null ? got.glow : 66,
        horizontalSpeed: got.horizontalSpeed != null ? got.horizontalSpeed : 1.5,
        minLength: got.minLength != null ? got.minLength : 1,
        maxLength: got.maxLength != null ? got.maxLength : 3,
        minWidth: got.minWidth != null ? got.minWidth : 10,
        maxWidth: got.maxWidth != null ? got.maxWidth : 30,
        minCurl: got.minCurl != null ? got.minCurl : 1,
        maxCurl: got.maxCurl != null ? got.maxCurl : 3,
        minTwist: got.minTwist != null ? got.minTwist : 0,
        maxTwist: got.maxTwist != null ? got.maxTwist : 0,
        curlAmplitude: got.curlAmplitude != null ? got.curlAmplitude : 0.22,
        endless: !!got.endless,
        zIndex: -1
    };
}

function start_RibbonsModern(got_options) {
    stop_Ribbons();
    engine = 'modern';
    Ribbons_instance = new RibbonsModern(mapModernOptions(got_options));
}

function show_cursor(){
    const now = Date.now();
    // slow down a little
    if (now - lastShow < 100) {
        return;
    }
    document.body.style.cursor = "default";
    if (lastShow != 0) {
        allCloseButtons().forEach((btn) => btn.classList.remove('hidden'));
    }
    lastShow = now;
    clearTimeout(hideCursorTimer);
    hideCursorTimer = setTimeout(() => {
        document.body.style.cursor = "none";
        allCloseButtons().forEach((btn) => btn.classList.add('hidden'));
        lastShow = 0;
    }, 2000);
}

ipcRenderer.on('send-stop', (event, flag) => {
    stop_Ribbons();
});

ipcRenderer.on('show-close-btn', (event, flag) => {
    //debug('show close button!')
    show_cursor();
});

ipcRenderer.on('send-pause', (event) => {
    if (Ribbons_instance && typeof Ribbons_instance.pause === 'function') {
        Ribbons_instance.pause();
    } else {
        cancelAnimationFrame(AnimationId || window.AnimationId);
    }
    pauseDateTimeAnimation();
    paused = true;
    console.log('Pause animation');
});

ipcRenderer.on('send-options', (event, got_options, pause) => {
    if (!pause) {
        if (Ribbons_instance && typeof Ribbons_instance.resume === 'function') {
            Ribbons_instance.resume();
        }
        resumeDateTimeAnimation();
        console.log('Animation were paused. Resume.');
        paused = false;
    }
    options = got_options;

    // Close button on every physical monitor (stretched mode spans one window)
    setupCloseButtons(options);

    // Resolve theme (support both theme and legacy backgroundMode)
    var theme = options["backgroundMode"] || "dark";

    // Body class only for UI styling (buttons, datetime colors) — background is on canvas
    applyBodyTheme(theme);

    // engine: 'modern' | 'classic' (default classic for backward compatibility)
    var useModern = options["engine"] === "modern" || options["engine"] === "ribbons_modern";
    if (useModern) {
        start_RibbonsModern(options);
    } else {
        var colorCycleSpeed = options["colorCycleSpeed"];
        var colorSaturation = "60%";
        if ((options["singleColor"]) || (options["singleColor"] == 666) || (options["singleColor"] == 667)) {
            colorCycleSpeed = 0;
        }
        if (options["singleColor"] == 666) {
            colorSaturation = "0%";
        }
        // Classic: fixed delay/phase from preset; pixel speed always 400
        var speedKey = classicSpeedKey(options["horizontalSpeed"]);
        var timing = CLASSIC_SPEED_PRESETS[speedKey] || CLASSIC_SPEED_PRESETS.normal;
        options["delay"] = timing.delay;
        options["phase"] = timing.phase;
        options["horizontalSpeed"] = 400;
        start_Ribbons(colorSaturation, colorCycleSpeed, options);
    }
    // call datetime if it is on
    if (options["show_datetime"]) {
        updateDateTime(options["locale"]);
        setInterval(() => updateDateTime(options["locale"]), 1000);
        if (options["datetime_front"]) {
            setFront();
        }
        let dur_base = Math.floor(Math.random() * 21) + 10;
        checkContainerMaxSize();
        if (options["randomize_datetime_pos"]) {
          const randomizeWithJitter = () => {
            delay = 1000 + Math.random() * 10000;
            setTimeout(() => {
                if (!paused) {
                    randomizePosition(options['display_bounds'], options['src_bounds'], dur_base);
                    randomizeWithJitter();
                }
            }, delay);
          };
          randomizeWithJitter();
        } else {
          setFixedPosition(options["datetime_pos"] || 'center');
        }
    }
    const randomizeDRLWithJitter = () => {
        delay = Math.floor(Math.random() * 300000) + 60000;
        setTimeout(() => {
            showDRL();
            randomizeDRLWithJitter();
        }, delay);
    }
    randomizeDRLWithJitter();
});
