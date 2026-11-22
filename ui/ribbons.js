/*global document, window, console, Ribbons*/
/**
 * Ribbons Class File.
 * Creates low-poly ribbons background effect inside a target container.
 *
 * Background is painted on a dedicated canvas (same approach as RibbonsModern).
 * backgroundMode: "dark" | "light" | "darkGradient" | "lightGradient" | "transparent"
 */
const Ribbons = (function (name, factory) {
    "use strict";
    const result = factory();
    if (typeof window === "object") {
        window[name] = result;
    }
    return result;
})("Ribbons", function () {
    
    "use strict";
    
    var _w = window,
        _b = document.body,
        _d = document.documentElement;
    // random helper
    var random = function () {
        if (arguments.length === 1) { // only 1 argument
            
            if (Array.isArray(arguments[0])) { // extract index from array
                var index = Math.round(random(0, arguments[0].length - 1));
                return arguments[0][index];
            }
            return random(0, arguments[0]); // assume numeric
            
        } else if (arguments.length === 2) { // two arguments range
            return Math.random() * (arguments[1] - arguments[0]) + arguments[0];
        }
        return 0; // default
    };
    // screen helper
    var screenInfo = function (e) {
        var width = Math.max(0, _w.innerWidth || _d.clientWidth || _b.clientWidth || 0),
            height = Math.max(0, _w.innerHeight || _d.clientHeight || _b.clientHeight || 0),
            scrollx = Math.max(0, _w.pageXOffset || _d.scrollLeft || _b.scrollLeft || 0) - (_d.clientLeft || 0),
            scrolly = Math.max(0, _w.pageYOffset || _d.scrollTop || _b.scrollTop || 0) - (_d.clientTop || 0);
        
        return {
            width: width,
            height: height,
            ratio: width / height,
            centerx: width / 2,
            centery: height / 2,
            scrollx: scrollx,
            scrolly: scrolly
        };
    };
    // mouse/input helper
    var mouseInfo = function (e) {
        var screen = screenInfo(e),
            mousex = e ? Math.max(0, e.pageX || e.clientX || 0) : 0,
            mousey = e ? Math.max(0, e.pageY || e.clientY || 0) : 0;
        return {
            mousex: mousex,
            mousey: mousey,
            centerx: mousex - (screen.width / 2),
            centery: mousey - (screen.height / 2)
        };
    };
    // point object
    var Point = function (x, y) {
        this.x = 0;
        this.y = 0;
        this.set(x, y);
    };
    Point.prototype = {
        constructor: Point,
        set: function (x, y) {
            this.x = (x || 0);
            this.y = (y || 0);
        },
        copy: function (point) {
            this.x = (point.x || 0);
            this.y = (point.y || 0);
            return this;
        },
        multiply: function (x, y) {
            this.x *= (x || 1);
            this.y *= (y || 1);
            return this;
        },
        divide: function (x, y) {
            this.x /= (x || 1);
            this.y /= (y || 1);
            return this;
        },
        add: function (x, y) {
            this.x += (x || 0);
            this.y += (y || 0);
            return this;
        },
        subtract: function (x, y) {
            this.x -= (x || 0);
            this.y -= (y || 0);
            return this;
        },
        clampX: function (min, max) {
            this.x = Math.max(min, Math.min(this.x, max));
            return this;
        },
        clampY: function (min, max) {
            this.y = Math.max(min, Math.min(this.y, max));
            return this;
        },
        flipX: function () {
            this.x *= -1;
            return this;
        },
        flipY: function () {
            this.y *= -1;
            return this;
        }
    };
    // class constructor
    var Factory = function (options) {
        this._canvas = null;
        this._context = null;
        this._bgCanvas = null;
        this._bgContext = null;
        this._sto = null;
        this._width = 0;
        this._height = 0;
        this._scroll = 0;
        this._ribbons = [];
        this._saved_color_index = 0;
        this._options = {
            // ribbon color HSL saturation amount
            colorSaturation: "80%",
            // ribbon color HSL brightness amount
            colorBrightness: "60%",
            // ribbon color opacity amount
            colorAlpha: 0.65,
            // how fast to cycle through colors in the HSL color space
            colorCycleSpeed: 6,
            // where to start from on the Y axis on each side (top|min, middle|center, bottom|max, random)
            verticalPosition: "center",
            // how fast to get to the other side of the screen
            horizontalSpeed: 150,
            delay: 4, //set delay
            phase: 0.014, //set phase
            // how many ribbons to keep on screen at any given time
            ribbonCount: 3,
            // add stroke along with ribbon fill colors
            strokeSize: 0,
            // move ribbons vertically by a factor on page scroll
            parallaxAmount: -0.5,
            // add animation effect to each ribbon section over time
            animateSections: true,
            // add blur shadow effect to each ribbon with radius
            glow: 10,
            // single color default is off (random ribbons colors)
            singleColor: false,
            /**
             * Background backgroundMode — painted on dedicated bg canvas (same as RibbonsModern).
             *   "dark"          — solid black
             *   "light"         — solid white
             *   "darkGradient"  — radial dark blue gradient
             *   "lightGradient" — radial light gray gradient
             *   "transparent"   — no fill (for glasstron / acrylic blur)
             *
             */
            backgroundMode: "dark"
        };
        this._onDraw = this._onDraw.bind(this);
        this._onResize = this._onResize.bind(this);
        this._onScroll = this._onScroll.bind(this);
        this._destroyed = false;
        this.setOptions(options);
        this.init();
    };
    // class prototype
    Factory.prototype = {
        constructor: Factory,
        // Set and merge local options
        setOptions: function (options) {
            
            var key;
            
            if (typeof options === "object") {
                for (key in options) {
                    if (Object.prototype.hasOwnProperty.call(options, key)) {
                        this._options[key] = options[key];
                    }
                }
            }
            // horizontalSpeed: tray strings or modern-style multiplier (0.3–3)
            // Classic engine uses pixel step (~150). Map small multipliers up.
            var SPEED_MAP = { slow: 80, normal: 150, fast: 220, v_fast: 300 };
            var hs = this._options.horizontalSpeed;
            if (typeof hs === "string" && SPEED_MAP[hs] != null) {
                this._options.horizontalSpeed = SPEED_MAP[hs];
            } else {
                hs = Number(hs);
                if (Number.isFinite(hs) && hs > 0 && hs <= 10) {
                    // multiplier from settings slider → pixel speed
                    this._options.horizontalSpeed = Math.round(hs * 100);
                } else if (!Number.isFinite(hs) || hs <= 0) {
                    this._options.horizontalSpeed = 150;
                }
            }
            // delay / phase: if missing, derive from approximate speed
            var px = Number(this._options.horizontalSpeed) || 150;
            var mult = Math.max(0.3, Math.min(3, px / 100));
            var t = (mult - 0.3) / (3 - 0.3);
            if (this._options.delay == null) this._options.delay = 6.5 - t * 5;
            if (this._options.phase == null) this._options.phase = 0.005 + t * 0.065;
        },
        _styleLayer: function (el, zIndex) {
            el.style.display = "block";
            el.style.position = "fixed";
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
        },
        /**
         * Background on its own canvas (z-index -2).
         * Ribbons canvas stays transparent at z-index 0 so
         * .datetime-container (z-index: -1) sits between them;
         * .datetime-container.front (z-index: 4) goes above ribbons.
         */
        _drawBackground: function () {
            var ctx = this._bgContext;
            if (!ctx) return;
            var W = this._width;
            var H = this._height;
            var mode = this._options.backgroundMode || "dark";

            ctx.clearRect(0, 0, W, H);

            // Transparent — leave canvas fully clear for glasstron / acrylic blur
            if (mode === "transparent" || mode === "glass" ) {
                return;
            }

            if (mode === "light") {
                ctx.fillStyle = "#ffffff";
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
            } else if (mode === "darkGradient") {
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
                // "dark" and any unknown value
                ctx.fillStyle = "#000000";
                ctx.fillRect(0, 0, W, H);
            }
        },
        // Initialize the ribbons effect
        init: function () {
            try {
                // bg below datetime (-1); ribbons above datetime
                this._bgCanvas = document.createElement("canvas");
                this._bgCanvas.className = "ribbons-bg-canvas";
                this._styleLayer(this._bgCanvas, -2);
                this._canvas = document.createElement("canvas");
                this._canvas.className = "ribbons-canvas";
                this._styleLayer(this._canvas, 0);
                this._onResize();
                this._bgContext = this._bgCanvas.getContext("2d");
                this._context = this._canvas.getContext("2d");
                this._context.globalAlpha = this._options.colorAlpha;
                this._drawBackground();
                window.addEventListener("resize", this._onResize);
                window.addEventListener("scroll", this._onScroll);
                document.body.appendChild(this._bgCanvas);
                document.body.appendChild(this._canvas);
            } catch (e) {
                console.warn("Canvas Context Error: " + e.toString());
                return;
            }
            this._onDraw();
        },
        // Create a new random ribbon and to the list
        addRibbon: function() {
            // tricolor
            if (this._options.singleColor === 667 ) {
                this._options.ribbonCount = 3;
            }
            // movement data
            var dir = (Math.round(random(1, 9)) > 5) ? "right" : "left",
                stop = 1000,
                hide = 400,
                min = 0 - hide,
                max = this._width + hide,
                movex = 0,
                movey = 0,
                startx = (dir === "right") ? min : max,
                starty = Math.round(random(0, this._height));
            // asjust starty based on options
            if (/^(top|min)$/i.test(this._options.verticalPosition)) {
                starty = 0 + hide;
            } else if (/^(middle|center)$/i.test(this._options.verticalPosition)) {
                starty = (this._height / 2);
            } else if (/^(bottom|max)$/i.test(this._options.verticalPosition)) {
                starty = this._height - hide;
            }
            // ribbon sections data
            // tricolor
            if (this._options.singleColor === 667 ) {
                var hues = [667, 240, 360];
                if (this._saved_color_index >= hues.length) {
                    this._saved_color_index = 0;
                }
                var color = hues[this._saved_color_index]
            } else if (this._options.singleColor) {
                var color = this._options.singleColor
            } else {
                var color = Math.round(random(0, 360));
            }
            var ribbon = [],
                point1 = new Point(startx, starty),
                point2 = new Point(startx, starty),
                point3 = null,
                // randomize delay between each ribbon appearance
                delay = Math.random() * 4;
            // buils ribbon sections
            while (true) {
                if (stop <= 0) break;
                stop--;
                movex = Math.round((Math.random() * 1 - 0.2) * this._options.horizontalSpeed);
                movey = Math.round((Math.random() * 1 - 0.5) * (this._height * 0.35));
                point3 = new Point();
                point3.copy(point2);
                if (dir === "right") {
                    point3.add(movex, movey);
                    if (point2.x >= max) break;
                } else if (dir === "left") {
                    point3.subtract(movex, movey);
                    if (point2.x <= min) break;
                }
                ribbon.push({ // single ribbon section
                    point1: new Point(point1.x, point1.y),
                    point2: new Point(point2.x, point2.y),
                    point3: point3,
                    color: color,
                    delay: delay,
                    dir: dir,
                    alpha: 0,
                    phase: 0,
                });
                point1.copy(point2);
                point2.copy(point3);
                delay += this._options.delay;
                color += this._options.colorCycleSpeed;
                
            }
            // tricolor
            if (this._options.singleColor === 667 ) {
                this._saved_color_index++;
            }
            this._ribbons.push(ribbon);
        },
        _drawRibbonSection: function (section) {
            if (section) {
                if (section.phase >= 1 && section.alpha <= 0) {
                    return true; // done
                }
                if (section.delay <= 0) {
                    section.phase += this._options.phase;
                    section.alpha = Math.sin(section.phase) * 1;
                    section.alpha = (section.alpha <= 0) ? 0 : section.alpha;
                    section.alpha = (section.alpha >= 1) ? 1 : section.alpha;
                    if (this._options.animateSections) {
                        var mod = (Math.sin(1 + section.phase * Math.PI / 2) * 0.1);
                        if (section.dir === "right") {
                            section.point1.add(mod, 0);
                            section.point2.add(mod, 0);
                            section.point3.add(mod, 0);
                        } else {
                            section.point1.subtract(mod, 0);
                            section.point2.subtract(mod, 0);
                            section.point3.subtract(mod, 0);
                        }
                        section.point1.add(0, mod);
                        section.point2.add(0, mod);
                        section.point3.add(0, mod);
                    }
                } else {
                    // affects ribbon dissapear speed
                    section.delay -= 0.5;
                }
                
                if (section.color === 667) {
                    var s = "0%";
                    var l = "100%"  
                } else {
                    var s = this._options.colorSaturation;
                    var l = this._options.colorBrightness;
                }
                var c = "hsla(" + section.color + ", " + s + ", " + l + ", " + section.alpha + " )";
                this._context.save();
                if (this._options.parallaxAmount !== 0) {
                    this._context.translate(0, this._scroll * this._options.parallaxAmount);
                }
                this._context.beginPath();
                this._context.moveTo(section.point1.x, section.point1.y);
                this._context.lineTo(section.point2.x, section.point2.y);
                this._context.lineTo(section.point3.x, section.point3.y);
                // set blur
                this._context.shadowBlur = this._options.glow;
                this._context.shadowColor = c;
                this._context.fillStyle = c;
                this._context.fill();
                if (this._options.strokeSize > 0) {
                    this._context.lineWidth = this._options.strokeSize;
                    this._context.strokeStyle = c;
                    this._context.lineCap = "round";
                    this._context.stroke();
                }
                this._context.restore();
            }
            return false; // not done yet
        },
        // Draw ribbons
        _onDraw: function () {
            if (this._destroyed) return;
            for (var i = 0; i < this._ribbons.length; ++i) {                
                if (!this._ribbons[i]) {
                    this._ribbons.splice(i, 1);
                    i--;
                }
            }
            if (!this._context || !this._canvas) return;
            
            this._drawBackground();
            this._context.clearRect(0, 0, this._width, this._height);
            
            for (var a = 0; a < this._ribbons.length; ++a) {
                var ribbon = this._ribbons[a];
                if (!ribbon || !Array.isArray(ribbon) || ribbon.length === 0) {
                    this._ribbons[a] = null;
                    continue;
                }
                var numSections = ribbon.length;
                var numDone = 0;
                for (var b = 0; b < numSections; ++b) {
                    if (this._drawRibbonSection(ribbon[b])) {
                        numDone++;
                    }
                }
                if (numDone >= numSections) {
                    this._ribbons[a] = null;
                }
            }
            while (this._ribbons.length < this._options.ribbonCount) {
                this.addRibbon();
            }
            // Reuse pre-bound _onDraw (constructor) — do NOT .bind() every frame
            var raf = requestAnimationFrame(this._onDraw);
            this._raf = raf;
            if (typeof window !== 'undefined') {
                window.AnimationId = raf;
            }
            if (typeof AnimationId !== 'undefined') {
                AnimationId = raf;
            }
        },
        // Update container size info
        _onResize: function(e) {
            if (this._destroyed) return;
            var screen = screenInfo(e);
            this._width = screen.width;
            this._height = screen.height;
            if (this._canvas) {
                this._canvas.width = this._width;
                this._canvas.height = this._height;
                if (this._context) {
                    this._context.globalAlpha = this._options.colorAlpha;
                }
            }
            if (this._bgCanvas) {
                this._bgCanvas.width = this._width;
                this._bgCanvas.height = this._height;
            }
            this._drawBackground();
        },
        // Update container size info
        _onScroll: function(e) {
            if (this._destroyed) return;
            var screen = screenInfo(e);
            this._scroll = screen.scrolly;
        },
        /** Full teardown — required when settings preview restarts classic often */
        destroy: function () {
            this._destroyed = true;
            if (this._raf != null) {
                cancelAnimationFrame(this._raf);
                this._raf = null;
            }
            try {
                cancelAnimationFrame(window.AnimationId);
            } catch (_) {}
            try {
                if (typeof AnimationId !== 'undefined') {
                    cancelAnimationFrame(AnimationId);
                }
            } catch (_) {}
            window.removeEventListener('resize', this._onResize);
            window.removeEventListener('scroll', this._onScroll);
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
        },
    };
    // export
    return Factory;
});
export default Ribbons;
