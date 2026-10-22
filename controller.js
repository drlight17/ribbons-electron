// electron related stuff
const { ipcRenderer } = require('electron')
import { updateDateTime, showDateTime, checkContainerMaxSize, setFront, randomizePosition, pauseDateTimeAnimation, resumeDateTimeAnimation, showDRL } from './datetime.js';
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

close_button.addEventListener('click', () => {
    ipcRenderer.send('close-button-clicked');
});

document.addEventListener("mousemove", show_cursor);
document.addEventListener("keydown", show_cursor);
document.addEventListener("click", show_cursor);

/** Stop and dispose current ribbons instance (classic or modern). */
function stop_Ribbons() {
    if (!Ribbons_instance) return;

    if (typeof Ribbons_instance.destroy === 'function') {
        // RibbonsModern
        Ribbons_instance.destroy();
    } else {
        // classic Ribbons
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
        } catch (e) {
            console.warn('stop_Ribbons classic cleanup:', e);
        }
    }
    Ribbons_instance = null;
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
        singleColor: options["singleColor"]
    });
}

/**
 * Map IPC options → RibbonsModern constructor options.
 * Supports both dedicated modern keys and classic-style keys.
 */
function mapModernOptions(got) {
    var mode = "classic";
    if (got.mode === "tricolor" || got.singleColor === 667) {
        mode = "tricolor";
    }

    var speedMap = {
        v_fast: 3,
        fast: 2.2,
        normal: 1.5,
        slow: 0.8
    };
    if (got.horizontalSpeed == "v_fast") {
        got.horizontalSpeed = 3;
    }
    else if (got.horizontalSpeed == "fast") {
        got.horizontalSpeed = 2.5;
    }
    else if (got.horizontalSpeed == "normal") {
        got.horizontalSpeed = 1.5;
    }
    else if (got.horizontalSpeed == "slow") {
        got.horizontalSpeed = 0.5;
    }
    
    var count = got.ribbonCount != null ? got.ribbonCount : (mode === "tricolor" ? 3 : 5);
    if (mode === "tricolor" && count < 3) count = 3;

    // singleColor: false | 666 | 667 | 0..360 (same as classic ribbons.js)
    var singleColor = got.singleColor !== undefined ? got.singleColor : false;
    if (singleColor === 667) {
        mode = "tricolor";
    }

    return {
        mode: mode,
        singleColor: singleColor,
        backgroundMode: got.backgroundMode || "darkGradient",
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
    if (now - lastShow < 1000) {
        return;
    }

    document.body.style.cursor = "default";
    if (lastShow != 0) {
        close_button.classList.remove('hidden');
    }
    lastShow = now;
    clearTimeout(hideCursorTimer);
    hideCursorTimer = setTimeout(() => {
        document.body.style.cursor = "none";
        close_button.classList.add('hidden');
        lastShow = 0;
    }, 2000);
}

ipcRenderer.on('send-stop', (event, flag) => {
    stop_Ribbons();
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
    if (options["theme"] == "lightGradient") { options["theme"] = 'light' };
    if (options["theme"] == "darkGradient") { options["theme"] = 'dark' };
    document.body.classList.add(options["theme"]);

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
        if (options["horizontalSpeed"] == "v_fast") {
            options["delay"] = 1.5;
            options["phase"] = 0.07;
        }
        else if (options["horizontalSpeed"] == "fast") {
            options["delay"] = 2;
            options["phase"] = 0.04;
        }
        else if (options["horizontalSpeed"] == "normal") {
            options["delay"] = 4;
            options["phase"] = 0.014;
        }
        else if (options["horizontalSpeed"] == "slow") {
            options["delay"] = 6;
            options["phase"] = 0.007;
        }
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
          showDateTime();
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
