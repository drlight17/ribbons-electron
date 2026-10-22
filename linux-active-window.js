/**
 * Linux active-window + fullscreen detection.
 * Avoids bare xprop on Wayland (which often yields window id 0x0).
 *
 * Strategy (first success wins):
 *  1. @deepfocus/get-windows when it returns data
 *  2. KDE Plasma: KWin evaluateScript (Plasma 5/6, no click, no xprop)
 *  3. X11: xprop, but never with id 0x0
 *  4. Wayland compositors: Hyprland / Sway / kdotool / GNOME / wlrctl
 *  5. Soft-fail → { fullscreen: false } so the screensaver is not blocked
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function isWaylandSession() {
  return (
    process.env.XDG_SESSION_TYPE === 'wayland' ||
    !!process.env.WAYLAND_DISPLAY
  );
}

function desktopEnv() {
  return String(process.env.XDG_CURRENT_DESKTOP || process.env.DESKTOP_SESSION || '').toLowerCase();
}

function emptyResult(extra = {}) {
  return {
    owner: { name: 'Unknown' },
    title: '',
    fullscreen: false,
    window_id: null,
    ...extra
  };
}

function isValidXId(id) {
  if (!id || typeof id !== 'string') return false;
  const n = parseInt(id, 16);
  return Number.isFinite(n) && n > 0;
}

/**
 * @param {Function} writeLog optional logger
 * @param {Function} activeWindowFn optional import from @deepfocus/get-windows
 */
export async function getLinuxActiveWindow(writeLog = console.log, activeWindowFn = null) {
  // ---- 2) wctx daemon (X11 / KDE 5+6 / GNOME) if installed ----
  const wctx = await getViaWctx(writeLog);
  if (wctx) return wctx;

  const de = desktopEnv();

  // ---- 3) X11 via xprop (guard against 0x0) ----
  if (!isWaylandSession()) {
    const x11 = await getViaXprop(writeLog);
    if (x11) return x11;
  } else {
    // On Wayland, xprop only sees XWayland clients. Still try if we get a real id.
    const x11 = await getViaXprop(writeLog, { quietInvalid: true });
    if (x11 && x11.window_id) return x11;
  }

  // ---- 4) Other Wayland compositors ----
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE || de.includes('hyprland')) {
    const h = await getViaHyprctl(writeLog);
    if (h) return h;
  }

  if (process.env.SWAYSOCK || de.includes('sway')) {
    const s = await getViaSway(writeLog);
    if (s) return s;
  }

  if (de.includes('gnome') || de.includes('ubuntu')) {
    const g = await getViaGnome(writeLog);
    if (g) return g;
  }

  // wlroots generic: wlrctl (if installed) — user mentioned “wctx”; closest common tool is wlrctl
  const w = await getViaWlrctl(writeLog);
  if (w) return w;

  writeLog(
    `Linux active-window: no reliable backend (session=${process.env.XDG_SESSION_TYPE || '?'}, DE=${de || '?'}). Assuming not fullscreen.`
  );
  return emptyResult({ source: 'fallback' });
}

async function getViaXprop(writeLog, { quietInvalid = false } = {}) {
  try {
    const { stdout: activeWinOut } = await execAsync('xprop -root _NET_ACTIVE_WINDOW', {
      timeout: 1500
    });
    const match = activeWinOut.match(/window id #\s*(0x[a-fA-F0-9]+)/i);
    if (!match) {
      if (!quietInvalid) writeLog('xprop: could not parse _NET_ACTIVE_WINDOW');
      return null;
    }
    const activeWindowId = match[1];
    if (!isValidXId(activeWindowId)) {
      // Typical pure-Wayland case: id is 0x0 — do NOT call xprop -id 0x0
      if (!quietInvalid) {
        writeLog(`xprop: active window id is invalid (${activeWindowId}); skip X11 query`);
      }
      return null;
    }

    const { stdout: winPropsOut } = await execAsync(`xprop -id ${activeWindowId}`, {
      timeout: 1500
    });
    const isFullscreen = winPropsOut.includes('_NET_WM_STATE_FULLSCREEN');

    let appName = 'Unknown';
    let windowTitle = '';

    try {
      const { stdout: nameOut } = await execAsync(
        `xprop -id ${activeWindowId} _NET_WM_NAME`,
        { timeout: 1000 }
      );
      const nameMatch = nameOut.match(/_NET_WM_NAME\(\w+\) = "(.*)"/s);
      if (nameMatch) windowTitle = nameMatch[1];
    } catch (_) {}

    try {
      const { stdout: classOut } = await execAsync(
        `xprop -id ${activeWindowId} WM_CLASS`,
        { timeout: 1000 }
      );
      const classMatch = classOut.match(/WM_CLASS\(\w+\) = ".*",\s*"([^"]+)"/);
      if (classMatch) appName = classMatch[1];
    } catch (_) {}

    return {
      owner: { name: appName },
      title: windowTitle,
      fullscreen: isFullscreen,
      window_id: activeWindowId,
      source: 'xprop'
    };
  } catch (error) {
    //writeLog(`xprop query failed: ${error.message}`);
    return null;
  }
}

async function getViaHyprctl(writeLog) {
  try {
    const { stdout } = await execAsync('hyprctl activewindow -j', { timeout: 1500 });
    const data = JSON.parse(stdout);
    if (!data || data.address === '0x0') return null;
    return {
      owner: { name: data.class || data.initialClass || 'Unknown' },
      title: data.title || '',
      fullscreen: data.fullscreen === true || data.fullscreen === 1 || data.fullscreenMode > 0,
      window_id: data.address || null,
      bounds: data.size && data.at
        ? { x: data.at[0], y: data.at[1], width: data.size[0], height: data.size[1] }
        : null,
      source: 'hyprctl'
    };
  } catch (e) {
    //writeLog(`hyprctl failed: ${e.message}`);
    return null;
  }
}

async function getViaSway(writeLog) {
  try {
    const { stdout } = await execAsync('swaymsg -t get_tree', { timeout: 2000 });
    const tree = JSON.parse(stdout);
    let focused = null;
    function walk(node) {
      if (!node) return;
      if (node.focused && node.type === 'con') focused = node;
      (node.nodes || []).forEach(walk);
      (node.floating_nodes || []).forEach(walk);
    }
    walk(tree);
    if (!focused) return null;
    return {
      owner: { name: focused.app_id || focused.window_properties?.class || 'Unknown' },
      title: focused.name || focused.window_properties?.title || '',
      fullscreen: focused.fullscreen_mode === 1 || focused.fullscreen_mode === 2,
      window_id: focused.id != null ? String(focused.id) : null,
      bounds: focused.rect
        ? {
            x: focused.rect.x,
            y: focused.rect.y,
            width: focused.rect.width,
            height: focused.rect.height
          }
        : null,
      source: 'swaymsg'
    };
  } catch (e) {
    writeLog(`swaymsg failed: ${e.message}`);
    return null;
  }
}

/**
 * KWin Scripting.evaluateScript — non-interactive, Plasma 5 + 6.
 * Does NOT use queryWindowInfo (that one requires a mouse click).
 *
 * Optional companion script ships in kwin/ribbons-active-window/
 * (signals only; evaluateScript does not require it to be enabled).
 */
/**
 * wctx CLI (https://github.com/slightlyfaulty/wctx)
 * Requires userspace daemon: systemctl --user enable --now wctx
 * Supports X11, KDE Plasma 6 (upstream), Plasma 5 with dual kwin.js patch.
 */
async function getViaWctx(writeLog) {
  try {
    const { stdout } = await execAsync('wctx active -f json', {
      timeout: 1200,
      maxBuffer: 256 * 1024
    });
    const raw = String(stdout || '').trim();
    if (!raw) return null;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const data = JSON.parse(raw.slice(start, end + 1));
    const state = String(data.state || '').toUpperCase();
    const fullscreen = state === 'FULLSCREEN';
    return {
      owner: { name: data.class || data.name || 'Unknown' },
      title: data.title || '',
      fullscreen,
      bounds: null,
      window_id: data.id != null ? String(data.id) : null,
      state,
      source: 'wctx'
    };
  } catch (e) {
    // not installed / daemon down — silent
    if (!/ENOENT|not found|NIX_FILE|No such file/i.test(e.message)) {
      writeLog(`wctx failed: ${e.message}`);
    }
    return null;
  }
}

async function getViaGnome(writeLog) {
  // GNOME has no stable public API for “focused window is fullscreen” without
  // extensions. Try gdbus Eval only as last resort (often disabled).
  try {
    const js =
      'global.display.focus_window && global.display.focus_window.is_fullscreen()';
    const { stdout } = await execAsync(
      `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '${js}'`,
      { timeout: 1500 }
    );
    // stdout like: (true, 'true') or (false, '')
    const m = stdout.match(/\(true,\s*'([^']*)'\)/);
    if (m) {
      const val = m[1] === 'true';
      return {
        owner: { name: 'GNOME' },
        title: '',
        fullscreen: val,
        window_id: null,
        source: 'gnome-shell-eval'
      };
    }
  } catch (e) {
    writeLog(`GNOME Shell Eval failed (expected on locked-down sessions): ${e.message}`);
  }
  return null;
}

async function getViaWlrctl(writeLog) {
  // Optional: https://git.sr.ht/~brocellous/wlrctl — toplevel focus helpers
  try {
    const { stdout } = await execAsync('wlrctl toplevel find state:active', { timeout: 1500 });
    if (!stdout || !stdout.trim()) return null;
    // If a focused toplevel exists, try state:fullscreen
    let fullscreen = false;
    try {
      const { stdout: fsOut } = await execAsync(
        'wlrctl toplevel find state:active state:fullscreen',
        { timeout: 1000 }
      );
      fullscreen = !!(fsOut && fsOut.trim());
    } catch (_) {
      fullscreen = false;
    }
    return {
      owner: { name: 'wlr' },
      title: stdout.trim().split('\n')[0] || '',
      fullscreen,
      window_id: null,
      source: 'wlrctl'
    };
  } catch (e) {
    // tool not installed — silent
    return null;
  }
}

/** Whether xprop is required for this session (X11 only). */
export function linuxNeedsXprop() {
  return !isWaylandSession();
}

export { isWaylandSession };
