/**
 * Date/time overlay helpers.
 * Random placement accounts for max CSS scale (1.8) so the container
 * never clips the display edge at peak zoom.
 */

/** Must match the largest scale() in appearDisappear1 / appearDisappear2 */
const MAX_SCALE = 1.8;

export function updateDateTime(locale) {
    const now = new Date();
    const dateOptions = { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short' };
    const formattedDate = now.toLocaleDateString(locale, dateOptions);
    const timeOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    const formattedTime = now.toLocaleTimeString(locale, timeOptions);
    document.getElementById('currentDate').textContent =
        formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
    document.getElementById('currentTime').textContent = formattedTime;
}

export function showDateTime() {
    document.getElementsByClassName('datetime-container')[0].classList.remove('hidden');
}

export function pauseDateTimeAnimation() {
    document.getElementsByClassName('datetime-container')[0].classList.add('paused');
}

export function resumeDateTimeAnimation() {
    document.getElementsByClassName('datetime-container')[0].classList.remove('paused');
}

export function setFront() {
    document.getElementsByClassName('datetime-container')[0].classList.add('front');
}

export function showDRL() {
    const drl_element = document.getElementsByClassName('drl-container')[0];
    drl_element.classList.remove('hidden');
    const duration = Math.floor(Math.random() * 21000) + 10000;
    setTimeout(() => {
        drl_element.classList.add('hidden');
    }, duration);
}

function toggleAnimation(element, dur_base) {
    element.classList.remove('appear-disappear-1', 'appear-disappear-2');
    void element.offsetWidth; // force reflow so the next animation restarts
    const nextClass = Math.random() < 0.5 ? 'appear-disappear-1' : 'appear-disappear-2';
    element.classList.add(nextClass);
    element.style.setProperty('--dur', `${dur_base}s`);

    if (nextClass === 'appear-disappear-1') {
        // zoom in: start behind ribbons, go front at mid-point
        element.classList.remove('front');
        setTimeout(() => {
            element.classList.add('front');
        }, dur_base * 0.5 * 1000);
    } else {
        // zoom out: start in front, drop behind at mid-point
        element.classList.add('front');
        setTimeout(() => {
            element.classList.remove('front');
        }, dur_base * 0.5 * 1000);
    }
}

function getActiveAnimations(element) {
    if (typeof element.getAnimations !== 'function') return false;
    return element.getAnimations().some((anim) => anim.playState === 'running');
}

/**
 * Measure unscaled layout size of the datetime container.
 * Temporarily clears animation transforms so getBoundingClientRect is accurate.
 */
export function checkContainerMaxSize() {
    const element = document.getElementsByClassName('datetime-container')[0];
    if (!element) return;

    const prevAnim = element.style.animation;
    const prevTransform = element.style.transform;
    const had1 = element.classList.contains('appear-disappear-1');
    const had2 = element.classList.contains('appear-disappear-2');
    const hadHidden = element.classList.contains('hidden');

    element.style.animation = 'none';
    element.style.transform = 'none';
    element.classList.remove('appear-disappear-1', 'appear-disappear-2', 'hidden');
    void element.offsetWidth;

    const rect = element.getBoundingClientRect();
    cont_width = Math.max(1, rect.width);
    cont_height = Math.max(1, rect.height);

    // restore
    element.style.animation = prevAnim;
    element.style.transform = prevTransform;
    if (had1) element.classList.add('appear-disappear-1');
    if (had2) element.classList.add('appear-disappear-2');
    if (hadHidden) element.classList.add('hidden');
}

export function randomizePosition(bounds, src_bounds, dur_base) {
    const element = document.getElementsByClassName('datetime-container')[0];
    if (!element) return;

    if (getActiveAnimations(element)) {
        return;
    }

    // Refresh size in case locale/font changed
    checkContainerMaxSize();

    const { left, top } = getRandomPosition(bounds, src_bounds);
    // Position as top-left of the unscaled box (animation transform replaces
    // translate(-50%,-50%), so we do not rely on centering via CSS transform).
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    // Neutralize the stylesheet's translate(-50%, -50%) while animating/randomizing
    element.style.transform = 'none';
    element.style.margin = '0';

    toggleAnimation(element, dur_base);
}

let lastPosition = { left: 0, top: 0 };
let cont_width = 200;
let cont_height = 120;

/**
 * Pick a random top-left (left, top) for the unscaled box such that
 * at scale MAX_SCALE with transform-origin: center the visual rect
 * stays fully inside the chosen display.
 *
 * Visual extents at scale S (origin = center of border box):
 *   visualLeft   = left - width  * (S - 1) / 2
 *   visualRight  = left + width  * (S + 1) / 2
 *   visualTop    = top  - height * (S - 1) / 2
 *   visualBottom = top  + height * (S + 1) / 2
 */
function getRandomPosition(bounds, src_bounds) {
    let w, h, x, y;

    if (Array.isArray(src_bounds) && src_bounds.length > 0) {
        const display = src_bounds[Math.floor(Math.random() * src_bounds.length)];
        w = display.width;
        h = display.height;
        x = display.x;
        y = display.y;
    } else {
        x = 0;
        y = 0;
        w = bounds.width;
        h = bounds.height;
    }

    const cw = cont_width || 200;
    const ch = cont_height || 120;
    const S = MAX_SCALE;

    // Minimum inset so scaled box fits
    const insetX = (cw * (S - 1)) / 2; // = cw * 0.4 at S=1.8
    const insetY = (ch * (S - 1)) / 2;
    // Max left/top so right/bottom edges stay inside
    // left + cw * (S+1)/2 <= x + w  =>  left <= x + w - cw*(S+1)/2
    const maxLeft = x + w - (cw * (S + 1)) / 2;
    const maxTop = y + h - (ch * (S + 1)) / 2;
    const minLeft = x + insetX;
    const minTop = y + insetY;

    // If display is smaller than scaled container, clamp to centered fit
    const safeMinLeft = Math.min(minLeft, maxLeft);
    const safeMaxLeft = Math.max(minLeft, maxLeft);
    const safeMinTop = Math.min(minTop, maxTop);
    const safeMaxTop = Math.max(minTop, maxTop);

    const rangeLeft = Math.max(0, safeMaxLeft - safeMinLeft);
    const rangeTop = Math.max(0, safeMaxTop - safeMinTop);

    // Prefer jumping far from the previous position
    const minDistance = 0.35 * Math.min(w, h);
    let left = safeMinLeft;
    let top = safeMinTop;
    let best = null;
    let bestDist = -1;

    const attempts = 40;
    for (let i = 0; i < attempts; i++) {
        const candidateLeft = Math.round(safeMinLeft + Math.random() * rangeLeft);
        const candidateTop = Math.round(safeMinTop + Math.random() * rangeTop);
        const dx = candidateLeft - lastPosition.left;
        const dy = candidateTop - lastPosition.top;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= minDistance) {
            left = candidateLeft;
            top = candidateTop;
            best = { left, top };
            break;
        }
        if (distance > bestDist) {
            bestDist = distance;
            best = { left: candidateLeft, top: candidateTop };
        }
    }

    if (best) {
        left = best.left;
        top = best.top;
    }

    // Final clamp (numeric safety)
    left = Math.round(Math.min(safeMaxLeft, Math.max(safeMinLeft, left)));
    top = Math.round(Math.min(safeMaxTop, Math.max(safeMinTop, top)));

    lastPosition = { left, top };
    return { left, top };
}
