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

    // Saturated warm hues so yellow / orange / red stand out on dark backgrounds.
    var palette = [
        ["#7df9ff", "#287dff", "#b6fbff"],
        ["#ff8de1", "#a14dff", "#ffd2f4"],
        ["#8bffb0", "#15b9b1", "#d7ffe7"],
        ["#fff000", "#ffd400", "#fffca8"],
        ["#ff3b30", "#e00024", "#ffaaa3"],
        ["#ff7a00", "#ff4500", "#ffd0a1"],
        ["#ffcf00", "#ff8c00", "#fff1a6"],
        ["#ff1744", "#c4002f", "#ff9bb1"],
        ["#ff5e00", "#f02d00", "#ffc09b"],
        ["#ffb86b", "#f044b8", "#ffe0a8"],
        ["#a6a4ff", "#5274ff", "#e4e5ff"],
        ["#8ef0ff", "#00a6a6", "#d1ffff"],
        ["#d6ff75", "#64a817", "#f0ffc7"],
        ["#ffa0a0", "#e32636", "#ffd6d6"],
        ["#c4a1ff", "#7028e4", "#f0dfff"],
        ["#fff08a", "#e39b00", "#fffbd0"],
        ["#7fffd4", "#008f87", "#c7fff0"],
        ["#ff9f6e", "#d83b12", "#ffe0c9"],
        ["#9ebcff", "#263fbb", "#e1eaff"],
        ["#f6a6ff", "#b321d1", "#ffe0ff"],
        ["#c5f36b", "#3f8e3d", "#eaffc7"]
    ];

    // Darker variants for light backgrounds.
    var lightPalette = [
        ["#00a6bd", "#0755d9", "#51d7e8"],
        ["#d51a9b", "#7123c9", "#f06ac6"],
        ["#168b43", "#087d78", "#50c98a"],
        ["#c49a00", "#e6b800", "#ffe45c"],
        ["#d90024", "#b50020", "#ff687b"],
        ["#d94b00", "#f05a00", "#ff9b52"],
        ["#d46b00", "#d92858", "#f5a33b"],
        ["#493cc7", "#254fd1", "#8b83f4"],
        ["#c34200", "#a91c75", "#f07a37"],
        ["#007c9c", "#0048b8", "#24c3d8"],
        ["#548400", "#28752e", "#91bd28"],
        ["#c21832", "#8d1028", "#f05b6c"],
        ["#5d35bd", "#321b91", "#9670e8"],
        ["#a16a00", "#bd4d00", "#e5a51b"],
        ["#007d69", "#005c67", "#1db69a"],
        ["#b52e0a", "#8c1f16", "#e86b36"],
        ["#2443a8", "#152a7b", "#6285e7"],
        ["#9d159f", "#6b197e", "#d34be0"],
        ["#39752b", "#245d2b", "#76a83e"]
    ];

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
        // last palette index used — next ribbon must pick a different one
        this._lastColorIndex = -1;

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
            // darkGradient | lightGradient | light | dark
            backgroundMode: "darkGradient",
            // how many ribbons on screen
            ribbonCount: 5,
            // opacity 0..100
            opacity: 100,
            // glow intensity 0..200
            glow: 66,
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
         * 666 → grayscale; other numbers → saturated hue.
         */
        _tripleFromHue: function (hue) {
            if (hue === 666) {
                // Grayscale — mirrors classic s=0%
                return ["#f5f5f5", "#9a9a9a", "#d8d8d8"];
            }
            var h = ((Number(hue) % 360) + 360) % 360;
            // glow / main / highlight as CSS hsl (canvas accepts these)
            return [
                "hsl(" + h + ", 90%, 72%)",
                "hsl(" + h + ", 80%, 52%)",
                "hsl(" + h + ", 85%, 78%)"
            ];
        },

        /**
         * Pick colors for a new ribbon.
         * Honour singleColor like classic ribbons.js:
         *   false  → random palette (no immediate repeat)
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
                    // sequential when creating a batch (reset) — white, blue, red…
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

            // Random from light/dark palette
            var bg = this._options.backgroundMode;
            var light =
                bg === "light" ||
                bg === "lightGradient" ||
                (bg === "darkGradient" && document.body && document.body.classList.contains("light"));
            var colors = light ? lightPalette : palette;
            var n2 = colors.length;
            if (n2 <= 1) {
                this._lastColorIndex = 0;
                return colors[0];
            }
            var idx = Math.floor(Math.random() * n2);
            if (idx === this._lastColorIndex) {
                idx = (idx + 1 + Math.floor(Math.random() * (n2 - 1))) % n2;
            }
            this._lastColorIndex = idx;
            return colors[idx];
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

            // Secondary harmonic (kept mild so path does not collapse into a thread)
            var curlHarmonic = 2.0;
            var curlHarmonicMix = rand(0.05, 0.15);

            // Amplitude in normalized screen space — clamp hard to avoid self-erasing loops
            var baseAmp = this._options.curlAmplitude * rand(0.75, 1.1);
            var curlAmp = Math.min(0.26, baseAmp * (0.45 + 0.3 * clamp(curlTurns, 0, 1.5)));

            // Control points: moderate spread (too much = folded thin ribbons)
            var spread = 0.35 + 0.25 * clamp(curlTurns, 0, 1.5);
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
            for (i = 0; i < n; i++) {
                this._ribbons.push(this._makeRibbon(i));
            }
        },

        recolor: function () {
            var self = this;
            // Reset so the first recolored ribbon is free to pick any color
            this._lastColorIndex = -1;
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
        _point: function (r, u) {
            var W = this._width;
            var H = this._height;
            var v = 1 - u;
            var k = 3 * v * v * u;
            var l = 3 * v * u * u;

            // Base cubic
            var nx = v * v * v * r.p0.x + k * r.p1.x + l * r.p2.x + u * u * u * r.p3.x;
            var ny = v * v * v * r.p0.y + k * r.p1.y + l * r.p2.y + u * u * u * r.p3.y;

            // Approximate tangent from cubic derivative
            var tx = 3 * v * v * (r.p1.x - r.p0.x) + 6 * v * u * (r.p2.x - r.p1.x) + 3 * u * u * (r.p3.x - r.p2.x);
            var ty = 3 * v * v * (r.p1.y - r.p0.y) + 6 * v * u * (r.p2.y - r.p1.y) + 3 * u * u * (r.p3.y - r.p2.y);
            var tlen = Math.hypot(tx, ty) || 1;
            tx /= tlen;
            ty /= tlen;
            // Perpendicular in normalized space
            var px = -ty;
            var py = tx;

            // Multi-turn lateral wave — smooth sinusoid only (no sharp harmonics)
            var turns = r.curlTurns || 0;
            var phase = (r.curlPhase || 0) + u * Math.PI * 2 * turns * (r.curlDir || 1);
            // Mild 2nd harmonic for shape variety, amplitude kept low to avoid kinks
            var harm = Math.min(0.18, r.curlHarmonicMix || 0);
            var wave = Math.sin(phase) + harm * Math.sin(phase * 2.0);
            // C²-ish envelope (smoothstep-ish) so ends don't jerk
            var uu = clamp(u, 0, 1);
            var envelope = uu * uu * (3 - 2 * uu) * (1 - uu) * (1 - uu) * (3 - 2 * (1 - uu)) * 6.75;
            // 6.75 scales peak of u²(3-2u)*(1-u)²(3-2(1-u)) ≈ 1 near mid
            envelope = Math.sin(Math.PI * uu); // reliable smooth 0..1..0
            var amp = (r.curlAmp || 0) * envelope;
            nx += px * wave * amp;
            ny += py * wave * amp;

            // Gentler depth — high-frequency z was causing shimmering kinks under perspective
            var z = Math.sin(r.depthTime + r.depth + u * 1.8) * r.depthAmt * 2.2;
            if (r.twistTurns) {
                z += Math.sin(r.twistPhase + u * Math.PI * 2 * r.twistTurns * r.twistDir)
                    * r.depthAmt * (0.6 + 0.9 * clamp(r.twistTurns, 0, 2));
            }
            var perspective = 1 / (1 + z * 0.1);

            return {
                x: W * 0.5 + (nx * W - W * 0.5) * perspective,
                y: H * 0.5 + (ny * H - H * 0.5) * perspective,
                z: z,
                persp: perspective,
                u: u,
                tx: tx,
                ty: ty
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
            var travel = opts.endless ? 0 : clamp((progress - 0.53) / 0.47, 0, 1);
            var start = opts.endless ? 0 : travel * (1 + visibleSpan) - visibleSpan;
            var end = opts.endless ? reveal : start + visibleSpan * reveal;

            // Samples: denser with curl, but capped — smoothness comes from normal
            // parallel-transport + path smoothing, not from huge sample counts.
            var complexity = Math.max(r.curlTurns || 0, r.twistTurns || 0);
            var sampleCount = Math.round(clamp(72 + complexity * 36, 72, 160));

            var pts = [];
            var i;
            for (i = 0; i <= sampleCount; i++) {
                var uu = start + (end - start) * (i / sampleCount);
                pts.push(this._point(r, uu));
            }

            // One-pass Laplacian smooth on centerline (kills micro-jaggies cheaply)
            if (pts.length > 4) {
                var sx = new Array(pts.length);
                var sy = new Array(pts.length);
                for (i = 0; i < pts.length; i++) {
                    sx[i] = pts[i].x;
                    sy[i] = pts[i].y;
                }
                for (i = 1; i < pts.length - 1; i++) {
                    pts[i].x = sx[i] * 0.5 + (sx[i - 1] + sx[i + 1]) * 0.25;
                    pts[i].y = sy[i] * 0.5 + (sy[i - 1] + sy[i + 1]) * 0.25;
                }
            }

            var left = [];
            var right = [];
            var twistTurns = r.twistTurns || 0;
            var twistDir = r.twistDir || 1;
            var twistPhase = r.twistPhase || 0;

            // Tangents from wider stencil, then parallel-transport normals so they
            // never flip when the path folds — this is what removed the "glitch kinks".
            var nPts = pts.length;
            var smoothTx = new Array(nPts);
            var smoothTy = new Array(nPts);
            for (i = 0; i < nPts; i++) {
                var i0 = Math.max(0, i - 2);
                var i1 = Math.min(nPts - 1, i + 2);
                var sdx = pts[i1].x - pts[i0].x;
                var sdy = pts[i1].y - pts[i0].y;
                var slen = Math.hypot(sdx, sdy);
                if (slen < 1e-4) {
                    if (i > 0) {
                        sdx = smoothTx[i - 1];
                        sdy = smoothTy[i - 1];
                        slen = Math.hypot(sdx, sdy) || 1;
                    } else {
                        sdx = 1;
                        sdy = 0;
                        slen = 1;
                    }
                }
                smoothTx[i] = sdx / slen;
                smoothTy[i] = sdy / slen;
            }
            // Blend tangents with neighbours (low-pass)
            for (var pass = 0; pass < 2; pass++) {
                var tx2 = smoothTx.slice();
                var ty2 = smoothTy.slice();
                for (i = 1; i < nPts - 1; i++) {
                    var bx = tx2[i - 1] + tx2[i] * 2 + tx2[i + 1];
                    var by = ty2[i - 1] + ty2[i] * 2 + ty2[i + 1];
                    var bl = Math.hypot(bx, by) || 1;
                    smoothTx[i] = bx / bl;
                    smoothTy[i] = by / bl;
                }
            }

            // Parallel transport of side normal
            var nrmX = new Array(nPts);
            var nrmY = new Array(nPts);
            nrmX[0] = -smoothTy[0];
            nrmY[0] = smoothTx[0];
            var nl0 = Math.hypot(nrmX[0], nrmY[0]) || 1;
            nrmX[0] /= nl0;
            nrmY[0] /= nl0;
            for (i = 1; i < nPts; i++) {
                // Project previous normal onto plane perpendicular to new tangent
                var tx = smoothTx[i];
                var ty = smoothTy[i];
                var dot = nrmX[i - 1] * tx + nrmY[i - 1] * ty;
                var nx = nrmX[i - 1] - tx * dot;
                var ny = nrmY[i - 1] - ty * dot;
                var nl = Math.hypot(nx, ny);
                if (nl < 1e-5) {
                    nx = -ty;
                    ny = tx;
                    nl = Math.hypot(nx, ny) || 1;
                }
                nrmX[i] = nx / nl;
                nrmY[i] = ny / nl;
                // Keep orientation continuous (no 180° flips)
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
                var mix = twistTurns <= 0 ? 0 : (0.25 + 0.55 * clamp(twistTurns, 0, 1.25) / 1.25);
                var rx = nx * (1 - mix + mix * ca) - ny * (mix * sa);
                var ry = nx * (mix * sa) + ny * (1 - mix + mix * ca);
                var rlen = Math.hypot(rx, ry) || 1;
                rx /= rlen;
                ry /= rlen;
                // Keep continuous with base normal
                if (rx * nx + ry * ny < 0) {
                    rx = -rx;
                    ry = -ry;
                }

                var shear = sa * mix * 0.22;

                var taper = Math.sin((Math.PI * i) / Math.max(1, nPts - 1));
                var taperW = Math.pow(Math.max(0, taper), 0.55);
                var baseW = this._widthAt(r, p.u, p) * taperW;
                var minFloor = r.width * 0.35 * (p.persp || 1) * taper;
                var twistScale = 0.85 + 0.15 * Math.abs(ca);
                var w = Math.max(minFloor, baseW * twistScale);

                left.push({
                    x: p.x + rx * w + smoothTx[i] * w * shear,
                    y: p.y + ry * w + smoothTy[i] * w * shear
                });
                right.push({
                    x: p.x - rx * w + smoothTx[i] * w * shear,
                    y: p.y - ry * w + smoothTy[i] * w * shear
                });
            }

            var first = pts[0];
            var lastp = pts[pts.length - 1];
            var fadeIn = clamp(r.age / 1.2, 0, 1) * clamp((progress - 0.03) / 0.18, 0, 1);
            var fadeOut = opts.endless ? clamp((1 - progress) / 0.12, 0, 1) : 1;
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

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(left[0].x, left[0].y);
            strokeSide(left, false);
            strokeSide(right, true);
            ctx.closePath();

            var lightBackground =
                opts.backgroundMode === "light" || opts.backgroundMode === "lightGradient";
            var grad = ctx.createLinearGradient(0, first.y, 0, lastp.y + 1);
            if (!lightBackground) {
                grad.addColorStop(0, r.colors[1]);
                grad.addColorStop(0.5, r.colors[1]);
                grad.addColorStop(1, r.colors[1]);
            } else {
                grad.addColorStop(0, r.colors[2]);
                grad.addColorStop(0.28, r.colors[0]);
                grad.addColorStop(0.68, r.colors[1]);
                grad.addColorStop(1, r.colors[2]);
            }
            ctx.fillStyle = grad;
            ctx.shadowBlur = opts.glow * 0.65;
            ctx.shadowColor = r.colors[0];
            ctx.fill();
            ctx.shadowBlur = 0;
            if (lightBackground) {
                ctx.strokeStyle = "rgba(22,34,55,.58)";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        },

        /**
         * Paint background on the dedicated bg canvas (below datetime).
         * Ribbons canvas is cleared transparent each frame so datetime (z-index: -1)
         * sits between background and ribbons.
         */
        _drawBackground: function () {
            var ctx = this._bgContext || this._context;
            if (!ctx) return;
            var W = this._width;
            var H = this._height;
            var mode = this._options.backgroundMode;
            ctx.clearRect(0, 0, W, H);

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
                    ribbon.depthTime += dt * ribbon.depthSpeed * speed;
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
         * Apply new options at runtime.
         * Geometry-affecting keys trigger reset(); background/mode triggers recolor.
         */
        updateOptions: function (options) {
            var prevMode = this._options.mode;
            var prevBg = this._options.backgroundMode;
            var prevCount = this._options.ribbonCount;
            var prevEndless = this._options.endless;
            var prevMinW = this._options.minWidth;
            var prevMaxW = this._options.maxWidth;
            var prevMinCurl = this._options.minCurl;
            var prevMaxCurl = this._options.maxCurl;
            var prevMinTwist = this._options.minTwist;
            var prevMaxTwist = this._options.maxTwist;
            var prevCurlAmp = this._options.curlAmplitude;
            var prevSingle = this._options.singleColor;

            this.setOptions(options);

            var needReset =
                this._options.mode !== prevMode ||
                this._options.ribbonCount !== prevCount ||
                this._options.endless !== prevEndless ||
                this._options.minCurl !== prevMinCurl ||
                this._options.maxCurl !== prevMaxCurl ||
                this._options.minTwist !== prevMinTwist ||
                this._options.maxTwist !== prevMaxTwist ||
                this._options.curlAmplitude !== prevCurlAmp ||
                this._options.minWidth !== prevMinW ||
                this._options.maxWidth !== prevMaxW ||
                this._options.singleColor !== prevSingle;

            var needRecolor =
                this._options.backgroundMode !== prevBg ||
                this._options.mode !== prevMode ||
                this._options.singleColor !== prevSingle;

            if (needReset) {
                this.reset();
            } else if (needRecolor) {
                this.recolor();
            }
            if (this._options.backgroundMode !== prevBg) {
                this._drawBackground();
            }

            // Live width remap if only width changed mid-flight (reset path already sets width)
            if (
                !needReset &&
                (this._options.minWidth !== prevMinW || this._options.maxWidth !== prevMaxW)
            ) {
                var minW = this._options.minWidth;
                var maxW = this._options.maxWidth;
                this._ribbons.forEach(function (r) {
                    r.width = rand(minW, maxW);
                });
            }

            // Live twist/curl remap on existing ribbons when ranges change but reset already handles it.
            // minLength/maxLength are read from this._options every frame — no reset needed.
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
