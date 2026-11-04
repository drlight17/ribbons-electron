/*global document, window, console, requestAnimationFrame, cancelAnimationFrame, ResizeObserver*/
/**
 * RibbonsModern Class File.
 * Creates smooth 3D-perspective ribbons background (classic / tricolor).
 * Compatible with controller.js patterns used by ribbons.js.
 *
 * Usage:
 *   const instance = new RibbonsModern({ mode: 'classic', ribbonCount: 5, ... });
 *   instance.pause(); instance.resume(); instance.destroy();
 */
var RibbonsModern = (function () {
    "use strict";
    var clamp = function (value, min, max) {
        return Math.max(min, Math.min(max, value));
    };
    var rand = function (min, max) {
        return min + Math.random() * (max - min);
    };
    // Random mode uses procedural HSL (see _randomTriple) — no fixed palette.
    // Tricolor keeps a small explicit set for white / blue / red parity with classic.
    var tricolorPalette = [
        ["#ffffff", "#ffffff", "#ffffff"],
        ["#2867e8", "#2867e8", "#2867e8"],
        ["#ff414d", "#ff414d", "#ff414d"]
    ];
    var Factory = function (options) {
        this._canvas = null;
        this._context = null;
        this._bgCanvas = null;
        this._bgContext = null;
        this._container = null;
        this._width = 1;
        this._height = 1;
        this._dpr = 1;
        this._ribbons = [];
        this._raf = null;
        this._lastTs = 0;
        this._paused = false;
        this._destroyed = false;
        this._resizeObserver = null;
        // last random hue / tricolor index — avoid immediate repeats
        this._lastColorIndex = -1;
        this._lastHue = null;
        this._options = {
            // classic | tricolor (also set automatically when singleColor === 667)
            mode: "classic",
            /**
             * singleColor — same semantics as classic ribbons.js:
             *   false      — random palette colors
             *   667        — tricolor (white / blue / red)
             *   666        — grayscale
             *   0..360     — fixed HSL hue for every ribbon
             */
            singleColor: false,
            // darkGradient | lightGradient | light | dark | transparent | glass
            // transparent/glass = no background fill (for glasstron / acrylic blur windows)
            backgroundMode: "darkGradient",
            // how many ribbons on screen
            ribbonCount: 5,
            // opacity 0..100
            opacity: 100,
            // glow intensity 0..200 (additive silhouette fill — not canvas shadowBlur)
            glow: 66,
            /**
             * Soft bloom via ctx.shadowBlur applied to the center shaft only
             * (does not touch ribbon body / edgeSoftness). 0 = off; 80 = strong.
             */
            blur: 0,
            /**
             * Center light-shaft strength (0..100).
             * 0 = off; at 100 outer shaft spans ~72% of ribbon width
             * (more than half) with a soft gradient from hot core to edges.
             */
            shaftBrightness: 40,
            /**
             * Edge softness (0..100).
             * 0 = hard opaque edges (classic look);
             * 100 = strong soft fade of ribbon borders into transparency.
             */
            edgeSoftness: 40,
            // animation speed multiplier
            horizontalSpeed: 1.5,
            // visible span factors
            minLength: 1,
            maxLength: 3,
            // ribbon width in px
            minWidth: 10,
            maxWidth: 30,
            // if true, ribbons grow from edge instead of traveling
            endless: false,
            /**
             * Path curl (how many times the centerline bends / winds).
             * Unit = turns; 1 ≈ full 360° of lateral wave along the ribbon.
             * 0 = nearly straight cubic (old look), 1 = up to one full wind,
             * >1 = multiple bends (e.g. 2 = two full periods).
             */
            minCurl: 0.35,
            maxCurl: 1.0,
            /**
             * Surface twist (corkscrew of the ribbon strip around its axis).
             * Unit = turns; 1 = 360° twist from start to end of the path.
             * 0 = flat strip, 0.5 = 180° flip, 1 = full twist.
             */
            minTwist: 0,
            maxTwist: 1.0,
            /**
             * Lateral amplitude of curl as a fraction of normalized screen space
             * (scaled further per-ribbon). Higher = wider loops.
             */
            curlAmplitude: 0.22,
            // append canvas to this element (default: document.body)
            container: null,
            // z-index of ribbons canvas (bg canvas is zIndex - 1)
            // Stacking: bg (z-1) < datetime (-1) < ribbons (0) < datetime.front (4)
            zIndex: 0
        };
        this._onFrame = this._onFrame.bind(this);
        this._onResize = this._onResize.bind(this);
        this.setOptions(options);
        this.init();
    };
    Factory.prototype = {
        constructor: Factory,
        setOptions: function (options) {
            var key;
            if (typeof options === "object" && options) {
                for (key in options) {
                    if (Object.prototype.hasOwnProperty.call(options, key)) {
                        this._options[key] = options[key];
                    }
                }
            }
            // singleColor 667 ↔ tricolor mode (classic ribbons.js parity)
            if (this._options.singleColor === 667) {
                this._options.mode = "tricolor";
            } else if (this._options.mode === "tricolor" && this._options.singleColor === false) {
                // explicit mode without singleColor still works
            } else if (this._options.singleColor !== false && this._options.singleColor !== 667) {
                // fixed hue / gray — not tricolor
                if (this._options.mode === "tricolor") {
                    this._options.mode = "classic";
                }
            }
            // tricolor needs at least 3 ribbons for white/blue/red cycle
            if ((this._options.mode === "tricolor" || this._options.singleColor === 667) &&
                this._options.ribbonCount < 3) {
                this._options.ribbonCount = 3;
            }
            if (this._options.minLength > this._options.maxLength) {
                this._options.maxLength = this._options.minLength;
            }
            if (this._options.minWidth > this._options.maxWidth) {
                this._options.maxWidth = this._options.minWidth;
            }
            if (this._options.minCurl > this._options.maxCurl) {
                this._options.maxCurl = this._options.minCurl;
            }
            if (this._options.minTwist > this._options.maxTwist) {
                this._options.maxTwist = this._options.minTwist;
            }
        },
        _styleCanvas: function (el, zIndex) {
            el.style.display = "block";
            el.style.margin = "0";
            el.style.padding = "0";
            el.style.border = "0";
            el.style.outline = "0";
            el.style.left = "0";
            el.style.top = "0";
            el.style.width = "100%";
            el.style.height = "100%";
            el.style.zIndex = String(zIndex);
            el.style.pointerEvents = "none";
            el.style.background = "transparent";
            if (this._container === document.body) {
                el.style.position = "fixed";
            } else {
                el.style.position = "absolute";
            }
        },
        init: function () {
            try {
                this._container = this._options.container || document.body;
                if (this._container !== document.body) {
                    var cs = window.getComputedStyle(this._container);
                    if (cs.position === "static") {
                        this._container.style.position = "relative";
                    }
                    this._container.style.overflow = "hidden";
                }
                var ribZ = this._options.zIndex != null ? this._options.zIndex : 0;
                var bgZ = ribZ - 1; // below datetime (-1) when ribZ is 0
                // Background canvas — solid / gradient fill (below datetime)
                this._bgCanvas = document.createElement("canvas");
                this._bgCanvas.className = "ribbons-bg-canvas";
                this._styleCanvas(this._bgCanvas, bgZ);
                this._bgContext = this._bgCanvas.getContext("2d");
                this._container.appendChild(this._bgCanvas);
                // Ribbons canvas — transparent, only ribbons (above datetime)
                this._canvas = document.createElement("canvas");
                this._canvas.className = "ribbons-modern-canvas";
                this._styleCanvas(this._canvas, ribZ);
                this._context = this._canvas.getContext("2d");
                this._container.appendChild(this._canvas);
                this._onResize();
                if (typeof ResizeObserver !== "undefined") {
                    this._resizeObserver = new ResizeObserver(this._onResize);
                    this._resizeObserver.observe(
                        this._container === document.body ? document.documentElement : this._container
                    );
                } else {
                    window.addEventListener("resize", this._onResize);
                }
                this.reset();
                this._lastTs = 0;
                this._raf = requestAnimationFrame(this._onFrame);
                if (typeof window !== "undefined") {
                    window.AnimationId = this._raf;
                }
            } catch (e) {
                console.warn("RibbonsModern init error: " + e.toString());
            }
        },
        /**
         * Build [glow, main, highlight] triple from an HSL hue (classic singleColor).
         * 666 → grayscale; other numbers → saturated hue (tweaked for current backgroundMode).
         */
        _isLightBackground: function () {
            var bg = this._options.backgroundMode;
            return bg === "light" || bg === "lightGradient";
        },
        _hsl: function (h, s, l) {
            return "hsl(" + Math.round(h) + ", " + Math.round(s) + "%, " + Math.round(l) + "%)";
        },
        _tripleFromHue: function (hue) {
            if (hue === 666) {
                if (this._isLightBackground()) {
                    return ["#5a5a5a", "#3a3a3a", "#6e6e6e"];
                }
                return ["#f5f5f5", "#9a9a9a", "#d8d8d8"];
            }
            var h = ((Number(hue) % 360) + 360) % 360;
            var light = this._isLightBackground();
            if (light) {
                return [
                    this._hsl(h, 88, 48),
                    this._hsl(h, 82, 38),
                    this._hsl(h, 85, 55)
                ];
            }
            return [
                this._hsl(h, 90, 72),
                this._hsl(h, 80, 52),
                this._hsl(h, 85, 78)
            ];
        },
        /**
         * Procedural [glow, main, highlight] for random mode.
         * Saturation / lightness ranges depend on backgroundMode so ribbons
         * stay readable on light fills and vivid on dark ones.
         */
        _randomTriple: function () {
            var light = this._isLightBackground();
            var h = rand(0, 360);
            // Avoid hues too close to the previous ribbon
            if (this._lastHue != null) {
                var delta = ((h - this._lastHue + 540) % 360) - 180;
                if (Math.abs(delta) < 32) {
                    h = (this._lastHue + 32 + Math.random() * (360 - 64)) % 360;
                }
            }
            this._lastHue = h;

            var s, lMain, lGlow, lHi;
            if (light) {
                // Punchy mid-dark colors on light / lightGradient
                s = rand(70, 96);
                lMain = rand(30, 46);
                lGlow = clamp(lMain + rand(6, 16), 38, 58);
                lHi = clamp(lMain + rand(12, 22), 44, 64);
                // Yellow-green band washes out on light gray — keep it deeper
                if (h >= 38 && h <= 85) {
                    lMain = Math.min(lMain, 40);
                    lGlow = Math.min(lGlow, 52);
                    s = Math.max(s, 78);
                }
                // Very light cyans can disappear — bias saturation up
                if (h >= 160 && h <= 200) {
                    s = Math.max(s, 75);
                    lMain = Math.min(lMain, 42);
                }
            } else {
                // Neon / luminous on dark, darkGradient, transparent, glass
                s = rand(76, 100);
                lMain = rand(48, 64);
                lGlow = clamp(lMain + rand(10, 22), 58, 84);
                lHi = clamp(lMain + rand(16, 28), 66, 90);
                // Deep reds & violets: slightly lower main for depth
                if (h < 18 || h > 265) {
                    lMain = rand(44, 58);
                    lGlow = clamp(lMain + rand(14, 26), 60, 82);
                }
                // Yellows pop hard on dark — slight desat so they don't blow out
                if (h >= 45 && h <= 70) {
                    s = rand(72, 92);
                    lMain = clamp(lMain, 50, 60);
                }
            }

            return [
                this._hsl(h, s, lGlow),
                this._hsl(h, clamp(s * 0.92, 55, 100), lMain),
                this._hsl(h, clamp(s * 0.95, 55, 100), lHi)
            ];
        },
        /**
         * Pick colors for a new ribbon.
         * Honour singleColor like classic ribbons.js:
         *   false  → procedural random (backgroundMode-aware)
         *   667    → tricolor cycle
         *   666    → gray
         *   number → fixed hue for every ribbon
         */
        _colorsFor: function (i) {
            var sc = this._options.singleColor;
            var isTricolor =
                this._options.mode === "tricolor" || sc === 667;
            if (isTricolor) {
                var n = tricolorPalette.length;
                var index;
                if (typeof i === "number" && i >= 0) {
                    index = i % n;
                } else {
                    index = Math.floor(Math.random() * n);
                    if (index === this._lastColorIndex) {
                        index = (index + 1) % n;
                    }
                }
                this._lastColorIndex = index;
                return tricolorPalette[index];
            }
            // Fixed single color (including gray 666)
            if (sc !== false && sc !== undefined && sc !== null && sc !== 0) {
                return this._tripleFromHue(sc);
            }
            // Procedural random — infinite variety, tuned to backgroundMode
            return this._randomTriple();
        },
        _makeRibbon: function (i) {
            var minW = this._options.minWidth;
            var maxW = this._options.maxWidth;
            var minCurl = this._options.minCurl;
            var maxCurl = this._options.maxCurl;
            var minTwist = this._options.minTwist;
            var maxTwist = this._options.maxTwist;
            var side = function () {
                return Math.floor(Math.random() * 4);
            };
            var edgePoint = function (s) {
                var m = rand(0.45, 0.85);
                if (s === 0) return { x: -m, y: rand(-0.15, 1.15) };
                if (s === 1) return { x: 1 + m, y: rand(-0.15, 1.15) };
                if (s === 2) return { x: rand(-0.15, 1.15), y: -m };
                return { x: rand(-0.15, 1.15), y: 1 + m };
            };
            var a = side();
            var b = side();
            while (b === a) b = side();
            // Curl / twist in turns (1 = 360°). Direction is random per ribbon.
            var curlTurns = rand(minCurl, maxCurl);
            var twistTurns = rand(minTwist, maxTwist);
            var curlDir = Math.random() < 0.5 ? 1 : -1;
            var twistDir = Math.random() < 0.5 ? 1 : -1;
            var curlHarmonic = 2.0;
            var curlHarmonicMix = rand(0.05, 0.15);
            var baseAmp = this._options.curlAmplitude * rand(0.75, 1.05);
            var curlAmp = Math.min(0.22, baseAmp * (0.45 + 0.3 * clamp(curlTurns, 0, 2)));
            // Spiral bias: growing lateral amp along path when curl is high
            var spiralBias = curlTurns > 0.7
                ? clamp((curlTurns - 0.5) / 1.8, 0, 1) * rand(0.4, 1)
                : 0;
            var spread = 0.35 + 0.3 * clamp(curlTurns, 0, 2);
            return {
                id: Math.random(),
                depthTime: rand(0, Math.PI * 2),
                drawOrder: Math.random(),
                width: rand(minW, maxW),
                life: rand(26, 39) * rand(0.72, 1.28),
                lengthFactor: rand(0.55, 1),
                age: -rand(0, 10),
                depth: rand(0, Math.PI * 2),
                depthSpeed: rand(0.18, 0.34),
                depthAmt: rand(0.5, 1.15),
                colors: this._colorsFor(i),
                p0: edgePoint(a),
                p1: { x: rand(-spread, 1 + spread), y: rand(-spread, 1 + spread) },
                p2: { x: rand(-spread, 1 + spread), y: rand(-spread, 1 + spread) },
                p3: edgePoint(b),
                // multi-turn path + surface corkscrew
                curlTurns: curlTurns,
                curlDir: curlDir,
                curlAmp: curlAmp,
                spiralBias: spiralBias,
                curlHarmonic: curlHarmonic,
                curlHarmonicMix: curlHarmonicMix,
                curlPhase: rand(0, Math.PI * 2),
                twistTurns: twistTurns,
                twistDir: twistDir,
                twistPhase: rand(0, Math.PI * 2)
            };
        },
        reset: function () {
            var n = this._options.ribbonCount;
            var i;
            this._ribbons = [];
            this._lastColorIndex = -1;
            this._lastHue = null;
            for (i = 0; i < n; i++) {
                this._ribbons.push(this._makeRibbon(i));
            }
        },
        recolor: function () {
            var self = this;
            // Reset so the first recolored ribbon is free to pick any color
            this._lastColorIndex = -1;
            this._lastHue = null;
            this._ribbons.forEach(function (ribbon) {
                ribbon.colors = self._colorsFor();
            });
        },
        _onResize: function () {
            if (this._destroyed || !this._canvas) return;
            var el = this._container === document.body ? document.documentElement : this._container;
            var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
            var nw = Math.max(1, rect.width || window.innerWidth || 1);
            var nh = Math.max(1, rect.height || window.innerHeight || 1);
            var changed = Math.abs(nw - this._width) > 0.5 || Math.abs(nh - this._height) > 0.5;
            this._width = nw;
            this._height = nh;
            this._dpr = Math.min(window.devicePixelRatio || 1, 2);
            var cw = Math.round(this._width * this._dpr);
            var ch = Math.round(this._height * this._dpr);
            this._canvas.width = cw;
            this._canvas.height = ch;
            if (this._context) {
                this._context.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
            }
            if (this._bgCanvas) {
                this._bgCanvas.width = cw;
                this._bgCanvas.height = ch;
                if (this._bgContext) {
                    this._bgContext.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
                }
            }
            if (changed && this._ribbons.length) {
                this.reset();
            }
            this._drawBackground();
        },
        /**
         * Cubic Bézier in normalized space + multi-turn lateral curl.
         * Curl displaces the point perpendicular to the local tangent so the
         * ribbon can wind several times (up to maxCurl turns ≈ 360° each).
         */
        /**
         * Aspect used to keep ribbon path proportions on ultra-wide / stretched canvases.
         * Reference ≈ single 16:9 panel; wider virtual desktops get compensated spans.
         */
        _aspectSpanScale: function () {
            var W = Math.max(1, this._width);
            var H = Math.max(1, this._height);
            var aspect = W / H;
            var ref = 16 / 9;
            // At 16:9 → 1; at 3×16:9 (triple) → ~0.33 so ribbons stay similar pixel length
            return clamp(ref / aspect, 0.22, 1);
        },
        _point: function (r, u) {
            var W = this._width;
            var H = this._height;
            var v = 1 - u;
            var k = 3 * v * v * u;
            var l = 3 * v * u * u;
            // Base cubic in normalized 0..1 (still spans full virtual desktop)
            var nx = v * v * v * r.p0.x + k * r.p1.x + l * r.p2.x + u * u * u * r.p3.x;
            var ny = v * v * v * r.p0.y + k * r.p1.y + l * r.p2.y + u * u * u * r.p3.y;
            // Cubic derivative in normalized space → convert to pixel-space tangent
            // so curl / width offsets stay circular (not stretched) on ultra-wide canvases.
            var tnx = 3 * v * v * (r.p1.x - r.p0.x) + 6 * v * u * (r.p2.x - r.p1.x) + 3 * u * u * (r.p3.x - r.p2.x);
            var tny = 3 * v * v * (r.p1.y - r.p0.y) + 6 * v * u * (r.p2.y - r.p1.y) + 3 * u * u * (r.p3.y - r.p2.y);
            var tpx = tnx * W;
            var tpy = tny * H;
            var tlen = Math.hypot(tpx, tpy) || 1;
            tpx /= tlen;
            tpy /= tlen;
            // Unit perpendicular in pixel space
            var ppx = -tpy;
            var ppy = tpx;
            // Multi-turn lateral wave — pure sinusoid
            var turns = r.curlTurns || 0;
            var phase = (r.curlPhase || 0) + u * Math.PI * 2 * turns * (r.curlDir || 1);
            var harm = Math.min(0.08, r.curlHarmonicMix || 0);
            var wave = Math.sin(phase) + harm * Math.sin(phase * 2.0);
            var uu = clamp(u, 0, 1);
            var spiralBias = clamp(r.spiralBias || 0, 0, 1);
            var envelope = Math.sin(Math.PI * uu) * (1 - spiralBias * 0.7) + Math.pow(uu, 0.75) * spiralBias;
            var unit = Math.min(W, H);
            var ampPx = Math.min(0.22, (r.curlAmp || 0)) * envelope * unit;
            var x = nx * W + ppx * wave * ampPx;
            var y = ny * H + ppy * wave * ampPx;
            // Gentler depth — high-frequency z was causing shimmering kinks under perspective
            var z = Math.sin(r.depthTime + r.depth + u * 1.8) * r.depthAmt * 2.2;
            if (r.twistTurns) {
                z += Math.sin(r.twistPhase + u * Math.PI * 2 * r.twistTurns * r.twistDir)
                    * r.depthAmt * (0.6 + 0.9 * clamp(r.twistTurns, 0, 2));
            }
            var perspective = 1 / (1 + z * 0.1);
            var cx = W * 0.5;
            var cy = H * 0.5;
            return {
                x: cx + (x - cx) * perspective,
                y: cy + (y - cy) * perspective,
                z: z,
                persp: perspective,
                u: u,
                // Pixel-space tangent (for consumers that need it)
                tx: tpx,
                ty: tpy
            };
        },
        _widthAt: function (r, u, p) {
            // Mild edge taper only — main taper is applied in _drawRibbon.
            // Keep depth wobble subtle so minWidth/maxWidth stay readable.
            var depthWobble = 0.94 + 0.06 * Math.sin(u * 3.2 + r.depth);
            var persp = p && p.persp ? p.persp : 1;
            return r.width * persp * depthWobble;
        },
        _drawRibbon: function (r) {
            if (r.age < 0) return;
            var ctx = this._context;
            var opts = this._options;
            var progress = clamp(r.age / r.life, 0, 1);
            var reveal = clamp((progress - 0.03) / (0.48 * r.lengthFactor), 0, 1);
            if (reveal <= 0 || r.age >= r.life) return;
            // Map minLength/maxLength → visible fraction of the path (clearer range than before)
            var maxVisibleSpan = 0.12 + ((clamp(opts.maxLength, 0.1, 6) - 0.1) / 5.9) * 0.88;
            var minVisibleSpan = 0.06 + ((clamp(opts.minLength, 0.1, 6) - 0.1) / 5.9) * 0.88;
            var effectiveMinSpan = Math.min(minVisibleSpan, maxVisibleSpan);
            var effectiveMaxSpan = Math.max(minVisibleSpan, maxVisibleSpan);
            var visibleSpan = effectiveMinSpan + (effectiveMaxSpan - effectiveMinSpan) * r.lengthFactor;
            // Ultra-wide / stretched: path spans the whole virtual desktop — shorten the
            // visible fraction so ribbon pixel length stays close to a single-panel look.
            visibleSpan *= this._aspectSpanScale();
            var travel = opts.endless ? 0 : clamp((progress - 0.53) / 0.47, 0, 1);
            var start = opts.endless ? 0 : travel * (1 + visibleSpan) - visibleSpan;
            var end = opts.endless ? reveal : start + visibleSpan * reveal;
            // Freeze pose before disappearance — stop sliding along the path
            var freezeAt = 0.75;
            if (progress >= freezeAt) {
                if (r._fzS == null) {
                    r._fzS = start;
                    r._fzE = end;
                }
                start = r._fzS;
                end = r._fzE;
            } else {
                r._fzS = null;
                r._fzE = null;
            }
            // Samples denser with curl/twist. Smoothness comes from stable normals +
            // de-spiking edges — not only from high sample counts.
            var complexity = Math.max(r.curlTurns || 0, r.twistTurns || 0);
            // Cap samples lower when edge/shaft effects add extra fills per frame
            var fx = 0;
            if (opts.edgeSoftness) fx += clamp(opts.edgeSoftness, 0, 100) / 100;
            if (opts.shaftBrightness) fx += clamp(opts.shaftBrightness, 0, 100) / 100;
            var sampleCount = Math.round(clamp(80 + complexity * 40, 80, 180));
            var pts = [];
            var i;
            for (i = 0; i <= sampleCount; i++) {
                var uu = start + (end - start) * (i / sampleCount);
                pts.push(this._point(r, uu));
            }
            // Light centerline smooth only
            if (pts.length > 4) {
                for (var cpass = 0; cpass < 2; cpass++) {
                    var sx = pts.map(function (p) { return p.x; });
                    var sy = pts.map(function (p) { return p.y; });
                    for (i = 1; i < pts.length - 1; i++) {
                        pts[i].x = sx[i] * 0.5 + (sx[i - 1] + sx[i + 1]) * 0.25;
                        pts[i].y = sy[i] * 0.5 + (sy[i - 1] + sy[i + 1]) * 0.25;
                    }
                }
            }
            var left = [];
            var right = [];
            var twistTurns = r.twistTurns || 0;
            var twistDir = r.twistDir || 1;
            var twistPhase = r.twistPhase || 0;
            var nPts = pts.length;
            // Tangents from neighbors
            var smoothTx = new Array(nPts);
            var smoothTy = new Array(nPts);
            for (i = 0; i < nPts; i++) {
                var i0 = Math.max(0, i - 1);
                var i1 = Math.min(nPts - 1, i + 1);
                var sdx = pts[i1].x - pts[i0].x;
                var sdy = pts[i1].y - pts[i0].y;
                var slen = Math.hypot(sdx, sdy) || 1;
                smoothTx[i] = sdx / slen;
                smoothTy[i] = sdy / slen;
            }
            // One light tangent smooth pass
            for (i = 1; i < nPts - 1; i++) {
                var bx = smoothTx[i - 1] + smoothTx[i] * 2 + smoothTx[i + 1];
                var by = smoothTy[i - 1] + smoothTy[i] * 2 + smoothTy[i + 1];
                var bl = Math.hypot(bx, by) || 1;
                smoothTx[i] = bx / bl;
                smoothTy[i] = by / bl;
            }
            // Parallel-transport normals
            var nrmX = new Array(nPts);
            var nrmY = new Array(nPts);
            nrmX[0] = -smoothTy[0];
            nrmY[0] = smoothTx[0];
            var nl0 = Math.hypot(nrmX[0], nrmY[0]) || 1;
            nrmX[0] /= nl0;
            nrmY[0] /= nl0;
            for (i = 1; i < nPts; i++) {
                var tx = smoothTx[i];
                var ty = smoothTy[i];
                var px = nrmX[i - 1];
                var py = nrmY[i - 1];
                var proj = px * tx + py * ty;
                var nx = px - tx * proj;
                var ny = py - ty * proj;
                var nl = Math.hypot(nx, ny);
                if (nl < 1e-5) {
                    nx = -ty;
                    ny = tx;
                    nl = Math.hypot(nx, ny) || 1;
                }
                nrmX[i] = nx / nl;
                nrmY[i] = ny / nl;
                if (nrmX[i] * nrmX[i - 1] + nrmY[i] * nrmY[i - 1] < 0) {
                    nrmX[i] = -nrmX[i];
                    nrmY[i] = -nrmY[i];
                }
            }
            for (i = 0; i < nPts; i++) {
                var p = pts[i];
                var nx = nrmX[i];
                var ny = nrmY[i];
                var twistAngle = twistPhase + p.u * Math.PI * 2 * twistTurns * twistDir;
                var ca = Math.cos(twistAngle);
                var sa = Math.sin(twistAngle);
                var mix = twistTurns <= 0 ? 0 : (0.15 + 0.35 * clamp(twistTurns, 0, 1.25) / 1.25);
                var rx = nx * (1 - mix + mix * ca) - ny * (mix * sa);
                var ry = nx * (mix * sa) + ny * (1 - mix + mix * ca);
                var rlen = Math.hypot(rx, ry) || 1;
                rx /= rlen;
                ry /= rlen;
                if (rx * nx + ry * ny < 0) {
                    rx = -rx;
                    ry = -ry;
                }
                var taper = Math.sin((Math.PI * i) / Math.max(1, nPts - 1));
                var taperW = Math.pow(Math.max(0, taper), 0.55);
                var baseW = this._widthAt(r, p.u, p) * taperW;
                var minFloor = r.width * 0.35 * (p.persp || 1) * taper;
                var w = Math.max(minFloor, baseW * (0.9 + 0.1 * Math.abs(ca)));
                left.push({ x: p.x + rx * w, y: p.y + ry * w });
                right.push({ x: p.x - rx * w, y: p.y - ry * w });
            }
            var first = pts[0];
            var lastp = pts[pts.length - 1];
            var fadeIn = clamp(r.age / 1.2, 0, 1) * clamp((progress - 0.03) / 0.18, 0, 1);
            // Fade only while frozen in place (last 25% of life)
            var fadeOut = 1;
            if (progress >= 0.75) {
                fadeOut = clamp((1 - progress) / 0.25, 0, 1);
                fadeOut = fadeOut * fadeOut * (3 - 2 * fadeOut);
            }
            var alpha = fadeIn * fadeOut * (opts.opacity / 100);
            if (alpha <= 0 || pts.length < 3 || Math.hypot(lastp.x - first.x, lastp.y - first.y) < 0.5) {
                return;
            }
            // Smooth poly-line via quadratic midpoints (same sample budget, less faceting)
            function strokeSide(arr, reverse) {
                var n = arr.length;
                if (n < 2) return;
                if (!reverse) {
                    ctx.lineTo(arr[0].x, arr[0].y);
                    for (var k = 1; k < n - 1; k++) {
                        var mx = (arr[k].x + arr[k + 1].x) * 0.5;
                        var my = (arr[k].y + arr[k + 1].y) * 0.5;
                        ctx.quadraticCurveTo(arr[k].x, arr[k].y, mx, my);
                    }
                    ctx.lineTo(arr[n - 1].x, arr[n - 1].y);
                } else {
                    ctx.lineTo(arr[n - 1].x, arr[n - 1].y);
                    for (var k = n - 2; k > 0; k--) {
                        var mx = (arr[k].x + arr[k - 1].x) * 0.5;
                        var my = (arr[k].y + arr[k - 1].y) * 0.5;
                        ctx.quadraticCurveTo(arr[k].x, arr[k].y, mx, my);
                    }
                    ctx.lineTo(arr[0].x, arr[0].y);
                }
            }
            var lightBackground =
                opts.backgroundMode === "light" || opts.backgroundMode === "lightGradient";

            // Scale left/right edges toward center by factor t (1 = full width).
            // Optional spatial noise breaks visible banding between concentric layers
            // without extra fills — amplitude in px, stable per ribbon (no flicker).
            function scaleEdges(t, noiseAmp, noiseSeed) {
                var L = [];
                var R = [];
                var amp = noiseAmp || 0;
                var seed = noiseSeed || 0;
                for (var si = 0; si < left.length; si++) {
                    var cx = (left[si].x + right[si].x) * 0.5;
                    var cy = (left[si].y + right[si].y) * 0.5;
                    var lx = cx + (left[si].x - cx) * t;
                    var ly = cy + (left[si].y - cy) * t;
                    var rx = cx + (right[si].x - cx) * t;
                    var ry = cy + (right[si].y - cy) * t;
                    if (amp > 0.05) {
                        // cheap deterministic noise in [-1,1]
                        var n1 = Math.sin(si * 12.9898 + seed * 78.233 + t * 45.1) * 43758.5453;
                        n1 = n1 - Math.floor(n1);
                        var n2 = Math.sin(si * 23.1406 + seed * 11.17 + t * 19.7) * 23758.1234;
                        n2 = n2 - Math.floor(n2);
                        var nx = (n1 * 2 - 1) * amp;
                        var ny = (n2 * 2 - 1) * amp;
                        lx += nx;
                        ly += ny;
                        rx += nx * 0.85;
                        ry += ny * 0.85;
                    }
                    L.push({ x: lx, y: ly });
                    R.push({ x: rx, y: ry });
                }
                return { L: L, R: R };
            }

            function smooth01(x) {
                x = clamp(x, 0, 1);
                return x * x * (3 - 2 * x);
            }

            // Stable ribbon seed for noise (id is random 0..1 at spawn)
            var ribSeed = (typeof r.id === "number" ? r.id : 0.5) * 1000;

            // Body / shaft fills. No path-following shadowBlur on twisted geometry
            // (it warps at folds). Overlaps use "lighter" so light only intensifies.
            function fillBand(e, fillStyle, a, composite, blurPx, shadowCol) {
                ctx.save();
                ctx.globalCompositeOperation = composite || "source-over";
                ctx.globalAlpha = a;
                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                var b = blurPx || 0;
                if (b > 0) {
                    ctx.shadowBlur = b;
                    ctx.shadowColor = shadowCol || fillStyle;
                } else {
                    ctx.shadowBlur = 0;
                }
                ctx.beginPath();
                ctx.moveTo(e.L[0].x, e.L[0].y);
                strokeSide(e.L, false);
                strokeSide(e.R, true);
                ctx.closePath();
                ctx.fillStyle = fillStyle;
                ctx.fill();
                ctx.restore();
            }

            // Body color
            var bodyFill;
            if (!lightBackground) {
                bodyFill = r.colors[1];
            } else {
                var grad = ctx.createLinearGradient(0, first.y, 0, lastp.y + 1);
                grad.addColorStop(0, r.colors[2]);
                grad.addColorStop(0.28, r.colors[0]);
                grad.addColorStop(0.68, r.colors[1]);
                grad.addColorStop(1, r.colors[2]);
                bodyFill = grad;
            }

            var widthBoost = clamp((r.width - 22) / 58, 0, 1);

            // Edge softness 0..100 — hard fill at 0, soft fade at 100 (alpha layers)
            var edgeSoft = clamp(
                opts.edgeSoftness != null ? opts.edgeSoftness : 0,
                0,
                100
            ) / 100;

            // Body first (hard or feathered). Blur halo is drawn AFTER so it does
            // not cover soft edges with an opaque solid pass.
            if (edgeSoft < 0.02) {
                fillBand({ L: left, R: right }, bodyFill, alpha, "source-over");
                if (lightBackground) {
                    ctx.save();
                    ctx.globalCompositeOperation = "source-over";
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = "rgba(22,34,55,.58)";
                    ctx.lineWidth = 1.5;
                    ctx.lineJoin = "round";
                    ctx.shadowBlur = 0;
                    ctx.beginPath();
                    ctx.moveTo(left[0].x, left[0].y);
                    strokeSide(left, false);
                    strokeSide(right, true);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                }
            } else {
                var featherN = 4 + Math.round(edgeSoft * 3) + Math.round(widthBoost * 4);
                var tInner = 1.0 - (0.12 + 0.30 * edgeSoft);
                var layerA = alpha * (1.1 / featherN);
                var edgeNoise = (0.35 + 1.4 * widthBoost) * edgeSoft;
                for (var fi = 0; fi < featherN; fi++) {
                    var fu = fi / (featherN - 1);
                    var ft = 1.0 - (1.0 - tInner) * fu;
                    var aJitter = 0.92 + 0.16 * (
                        Math.sin(fi * 17.13 + ribSeed) * 0.5 + 0.5
                    );
                    fillBand(
                        scaleEdges(ft, edgeNoise * (1 - fu * 0.5), ribSeed + fi * 3.1),
                        bodyFill,
                        layerA * aJitter,
                        "source-over"
                    );
                }
            }

            // Ribbon glow: continuous full-path additive fills (no short segments —
            // those caused visible cross-banding / stripes along the ribbon).
            // Crossings of different ribbons still brighten via "lighter".
            var glowAmt = clamp(opts.glow != null ? opts.glow : 0, 0, 200);
            if (glowAmt > 0) {
                var g = glowAmt / 100;
                var gOuter = scaleEdges(1.0 + 0.08 * Math.min(g, 1.5), 0, 0);
                var gInner = scaleEdges(0.85, 0, 0);
                var gCol = r.colors[0];
                fillBand(
                    gOuter,
                    gCol,
                    alpha * (0.1 + 0.2 * Math.min(g, 1.5)),
                    "lighter"
                );
                fillBand(
                    gInner,
                    gCol,
                    alpha * (0.08 + 0.16 * Math.min(g, 1.5)),
                    "lighter"
                );
            }

            // Center light-shaft. ctx.shadowBlur is expensive (GPU Gaussian) — apply
            // it ONCE on a single core bloom pass, never on every shaft layer.
            var shaft = clamp(opts.shaftBrightness != null ? opts.shaftBrightness : 0, 0, 100);
            var blurAmt = clamp(opts.blur != null ? opts.blur : 0, 0, 80);
            var shaftDraw = shaft > 0 || blurAmt > 0;
            if (shaftDraw && left.length >= 3) {
                var shaftLevel = shaft > 0 ? shaft / 100 : 0.3;
                var tOuter = 0.22 + 0.50 * shaftLevel;
                var layers = shaft > 0
                    ? (4 + Math.round(shaftLevel * 2) + Math.round(widthBoost * 3))
                    : 2;

                function parseRgb(col) {
                    if (!col || typeof col !== "string") return [255, 255, 255];
                    if (col.charAt(0) === "#" && col.length === 7) {
                        return [
                            parseInt(col.slice(1, 3), 16),
                            parseInt(col.slice(3, 5), 16),
                            parseInt(col.slice(5, 7), 16)
                        ];
                    }
                    var m = col.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
                    if (m) return [+m[1], +m[2], +m[3]];
                    return [255, 255, 255];
                }

                var edgeRgb = lightBackground ? [255, 255, 255] : parseRgb(r.colors[2]);
                var coreRgb = [255, 255, 255];
                var shaftNoise = (0.25 + 0.9 * widthBoost) * shaftLevel * 0.5;
                var blurCol = r.colors[0] || "rgb(255,255,255)";

                // 1) Shaft body layers — no shadowBlur (cheap)
                if (shaft > 0) {
                    for (var li = 0; li < layers; li++) {
                        var u = li / Math.max(1, layers - 1);
                        var t = tOuter * (1 - u * 0.88);
                        if (t < 0.03) continue;
                        var bright = smooth01(u);
                        var a = alpha * shaftLevel * (0.08 + 0.4 * Math.pow(bright, 1.15));
                        a *= 0.9 + 0.2 * (Math.sin(li * 13.7 + ribSeed * 0.7) * 0.5 + 0.5);
                        var er = edgeRgb[0] + (coreRgb[0] - edgeRgb[0]) * bright;
                        var eg = edgeRgb[1] + (coreRgb[1] - edgeRgb[1]) * bright;
                        var eb = edgeRgb[2] + (coreRgb[2] - edgeRgb[2]) * bright;
                        var fillStyle = "rgb(" + (er | 0) + "," + (eg | 0) + "," + (eb | 0) + ")";
                        fillBand(
                            scaleEdges(t, shaftNoise * (1 - u * 0.6), ribSeed + 50 + li * 5.3),
                            fillStyle,
                            a,
                            "lighter"
                        );
                    }
                }

                // 2) Single bloom pass with shadowBlur (one Gaussian per ribbon)
                if (blurAmt > 0) {
                    var bloomT = Math.max(0.08, tOuter * 0.45);
                    var bloomA = alpha * (0.2 + 0.45 * (blurAmt / 80));
                    if (shaft > 0) bloomA *= 0.55 + 0.45 * shaftLevel;
                    // Cap blur radius — cost grows ~r²; visual gain flattens past ~48
                    var bloomBlur = Math.min(48, blurAmt * 0.85 + 4);
                    fillBand(
                        scaleEdges(bloomT, 0, 0),
                        blurCol,
                        bloomA,
                        "lighter",
                        bloomBlur,
                        blurCol
                    );
                }
            }
        },
        /**
         * Paint background on the dedicated bg canvas (below datetime).
         * Ribbons canvas is cleared transparent each frame so datetime (z-index: -1)
         * sits between background and ribbons.
         *
         * backgroundMode values:
         *   "darkGradient" | "lightGradient" | "dark" | "light" | "transparent" | "glass"
         *   "transparent" | "glass" — no fill (for glasstron / acrylic blur windows)
         */
        _drawBackground: function () {
            var ctx = this._bgContext || this._context;
            if (!ctx) return;
            var W = this._width;
            var H = this._height;
            var mode = this._options.backgroundMode;
            ctx.clearRect(0, 0, W, H);

            // Transparent / glass — leave canvas fully transparent for glasstron blur
            if (mode === "transparent" || mode === "glass") {
                return;
            }

            if (mode === "light") {
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, W, H);
            } else if (mode === "dark") {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, W, H);
            } else if (mode === "lightGradient") {
                var bgL = ctx.createRadialGradient(
                    W * 0.5, H * 0.42, 0,
                    W * 0.5, H * 0.48, Math.max(W, H) * 0.78
                );
                bgL.addColorStop(0, "#e9edf4");
                bgL.addColorStop(0.48, "#c6cfde");
                bgL.addColorStop(1, "#8998b0");
                ctx.fillStyle = bgL;
                ctx.fillRect(0, 0, W, H);
            } else if (mode === "darkGradient" || mode === "auto" || !mode) {
                var bg = ctx.createRadialGradient(
                    W * 0.5, H * 0.48, 0,
                    W * 0.5, H * 0.48, Math.max(W, H) * 0.75
                );
                bg.addColorStop(0, "#111b39");
                bg.addColorStop(0.55, "#080d1c");
                bg.addColorStop(1, "#03050c");
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, W, H);
            } else {
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, W, H);
            }
        },
        _onFrame: function (ts) {
            if (this._destroyed) return;
            this._raf = requestAnimationFrame(this._onFrame);
            if (typeof window !== "undefined") {
                window.AnimationId = this._raf;
            }
            if (!this._lastTs) this._lastTs = ts;
            var dt = Math.min(0.05, (ts - this._lastTs) / 1000);
            this._lastTs = ts;
            this._drawBackground();
            // Ribbons layer: clear only (keep transparent over datetime)
            if (this._context) {
                this._context.clearRect(0, 0, this._width, this._height);
            }
            var speed = this._options.horizontalSpeed;
            var i;
            if (!this._paused) {
                for (i = 0; i < this._ribbons.length; i++) {
                    var ribbon = this._ribbons[i];
                    ribbon.age += dt * 1.7 * speed;
                    // Stop depth wobble once pose is frozen (last 25% of life)
                    var pr = ribbon.life > 0 ? ribbon.age / ribbon.life : 1;
                    if (pr < 0.75) {
                        ribbon.depthTime += dt * ribbon.depthSpeed * speed;
                    }
                    if (ribbon.age >= ribbon.life) {
                        this._ribbons[i] = this._makeRibbon(i);
                    }
                }
            }
            var sorted = this._ribbons.slice().sort(function (a, b) {
                return a.drawOrder - b.drawOrder;
            });
            for (i = 0; i < sorted.length; i++) {
                this._drawRibbon(sorted[i]);
            }
        },
        // --- public API (controller-friendly) ---
        pause: function () {
            this._paused = true;
        },
        resume: function () {
            this._paused = false;
            this._lastTs = 0;
        },
        /** Replace one random ribbon */
        spawnNew: function () {
            if (!this._ribbons.length) return;
            var index = Math.floor(Math.random() * this._ribbons.length);
            this._ribbons[index] = this._makeRibbon(index);
        },
        /**
         * Apply new options at runtime without destroying the animation.
         * Full reset only when engine mode / color mode family changes.
         * Width, curl, twist, amplitude, count, endless → live remap.
         */
        updateOptions: function (options) {
            var prevMode = this._options.mode;
            var prevBg = this._options.backgroundMode;
            var prevCount = this._options.ribbonCount;
            var prevMinW = this._options.minWidth;
            var prevMaxW = this._options.maxWidth;
            var prevMinCurl = this._options.minCurl;
            var prevMaxCurl = this._options.maxCurl;
            var prevMinTwist = this._options.minTwist;
            var prevMaxTwist = this._options.maxTwist;
            var prevCurlAmp = this._options.curlAmplitude;
            var prevSingle = this._options.singleColor;
            this.setOptions(options);

            var singleMode = function (sc) {
                if (sc === false || sc === undefined || sc === null || sc === 0) return 'rainbow';
                if (sc === 667) return 'tricolor';
                if (sc === 666) return 'gray';
                return 'fixed';
            };
            var singleModeChanged = singleMode(prevSingle) !== singleMode(this._options.singleColor);
            // Only hard reset when ribbon "family" changes (tricolor path / color system)
            var needReset =
                this._options.mode !== prevMode ||
                singleModeChanged;
            var needRecolor =
                this._options.backgroundMode !== prevBg ||
                this._options.mode !== prevMode ||
                this._options.singleColor !== prevSingle;

            if (needReset) {
                this.reset();
                if (this._options.backgroundMode !== prevBg) {
                    this._drawBackground();
                }
                return;
            }

            if (needRecolor) {
                this.recolor();
            }
            if (this._options.backgroundMode !== prevBg) {
                this._drawBackground();
            }

            var minW = this._options.minWidth;
            var maxW = this._options.maxWidth;
            var minCurl = this._options.minCurl;
            var maxCurl = this._options.maxCurl;
            var minTwist = this._options.minTwist;
            var maxTwist = this._options.maxTwist;
            var curlAmpOpt = this._options.curlAmplitude;

            var widthChanged = minW !== prevMinW || maxW !== prevMaxW;
            var curlChanged =
                minCurl !== prevMinCurl ||
                maxCurl !== prevMaxCurl ||
                curlAmpOpt !== prevCurlAmp;
            var twistChanged = minTwist !== prevMinTwist || maxTwist !== prevMaxTwist;

            // Remap existing ribbons into new ranges (keep age / path / colors)
            if (widthChanged || curlChanged || twistChanged) {
                var oldCurlSpan = (prevMaxCurl - prevMinCurl) || 1e-6;
                var oldTwistSpan = (prevMaxTwist - prevMinTwist) || 1e-6;
                this._ribbons.forEach(function (r) {
                    if (widthChanged) {
                        // Keep relative position inside old width range when possible
                        var oldWSpan = (prevMaxW - prevMinW) || 1e-6;
                        var wt = clamp((r.width - prevMinW) / oldWSpan, 0, 1);
                        r.width = minW + wt * (maxW - minW);
                    }
                    if (curlChanged) {
                        var ct = clamp((r.curlTurns - prevMinCurl) / oldCurlSpan, 0, 1);
                        r.curlTurns = minCurl + ct * (maxCurl - minCurl);
                        var baseAmp = curlAmpOpt * (0.75 + 0.35 * (r.id || Math.random()));
                        // id is random 0..1 — use stable-ish factor from existing curlAmp if present
                        if (typeof r.curlAmp === 'number' && prevCurlAmp > 0) {
                            baseAmp = curlAmpOpt * clamp(r.curlAmp / (prevCurlAmp * 0.9 || 1e-6), 0.6, 1.3);
                        }
                        r.curlAmp = Math.min(
                            0.2,
                            baseAmp * (0.4 + 0.28 * clamp(r.curlTurns, 0, 1.5))
                        );
                    }
                    if (twistChanged) {
                        var tt = clamp((r.twistTurns - prevMinTwist) / oldTwistSpan, 0, 1);
                        r.twistTurns = minTwist + tt * (maxTwist - minTwist);
                    }
                });
            }

            // ribbonCount: add or drop without respawning the rest
            var count = this._options.ribbonCount;
            if (count !== prevCount) {
                while (this._ribbons.length > count) {
                    this._ribbons.pop();
                }
                while (this._ribbons.length < count) {
                    this._ribbons.push(this._makeRibbon(this._ribbons.length));
                }
            }
            // endless / minLength / maxLength / opacity / glow / speed — read each frame
        },
        destroy: function () {
            this._destroyed = true;
            if (this._raf != null) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            } else {
                window.removeEventListener("resize", this._onResize);
            }
            if (this._canvas && this._canvas.parentNode) {
                this._canvas.parentNode.removeChild(this._canvas);
            }
            if (this._bgCanvas && this._bgCanvas.parentNode) {
                this._bgCanvas.parentNode.removeChild(this._bgCanvas);
            }
            this._canvas = null;
            this._context = null;
            this._bgCanvas = null;
            this._bgContext = null;
            this._ribbons = [];
        }
    };
    return Factory;
})();
if (typeof window === "object") {
    window.RibbonsModern = RibbonsModern;
}
export default RibbonsModern;
