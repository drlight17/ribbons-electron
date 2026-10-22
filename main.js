import { app, powerMonitor, clipboard, BrowserWindow, desktopCapturer, session, Menu, MenuItem, Tray, nativeImage, ipcMain, screen, nativeTheme, dialog, shell, globalShortcut } from 'electron';
import * as path from 'path';
import { fileURLToPath } from "url";
import { exec } from 'child_process';
import { execFile } from 'child_process';
import { execSync } from 'child_process';
//import { spawn } from 'child_process';
import * as DBus from 'dbus-next';
//import console from 'console';

app.console = new console.Console(process.stdout, process.stderr);

const packageJsonPath = path.join(app.getAppPath(), 'package.json');
// __dirname new electron fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
//const robot = require('robotjs');

const HID = require('node-hid');

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
import Store from 'electron-store';
const system_theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'

import fs from "fs";
//import { join } from 'path';
//import {SystemIdleTime from 'desktop-idle';
import { desktopIdle } from 'node-desktop-idle-v2';

//import {activeWindow} from 'get-windows';
import { activeWindow } from "@deepfocus/get-windows";

import { getLinuxActiveWindow, linuxNeedsXprop } from './linux-active-window.js';

//const { initMain: initSystemAudioLoopback } = require('electron-audio-loopback');
const {
  startCapture,
  stopCapture,
  getPidFromWindowHandle,
  isAvailable,
  getLoadError
} = require('electron-native-screenshare');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const appNameLC = packageJson.name;

let optionsArray = [];

let debounce = false;

// list of known desktop manager processes, may be extended
const desktopProcesses = [
    'explorer.exe', // Windows
    'Finder', // macOS
    'gnome-shell', // GNOME Linux
    'plasmashell', // KDE Linux
    'marco', // Linux Mint Mate
    'mate', // Linux Mint Mate
    'muffin', // Linux Mint Cinnamon
    'cinnamon', // Linux Mint Cinnamon
    'xfwm4', // Xfce Linux
    'openbox', // Openbox
    'i3', // i3wm
    'desktop', // common
];

let mainWindow = [];
let running_screensaver = {};
let displays = null;
let store = null;
let isLocked_suspend = false;
let idle_time = 0;
let sound_detected = false;
let paused = {};
let curWindow = {};
var isFullscreen = {};
let contextMenu;

let audioCheckInterval;
let sumSquares = 0;
let sampleCount = 0;
let lastSoundTime = Date.now();

// Tune this threshold if necessary.
const RMS_THRESHOLD = 0.01;

// Stay open only if the screensaver should be shown (/s param)
// We don't implement /c (configure) and /p (preview) for now... 
/*if (isWindows) {
  var shouldStart = false;
  var config = false;
  for (var i = 0; i < process.argv.length; i++) {
      if (process.argv[i].trim() == "/s") {
        shouldStart = true;
        break;
      }
      if (process.argv[i].trim() == "/c") {
        config = true;
        break;
      }
  }

  if (!shouldStart && !config) {
      app.exit(0);
  }
}*/


if (isLinux) {
  var iconPath = path.resolve(getResourceDirectory(), "icon.png");
  var iconPausedPath = path.resolve(getResourceDirectory(), "iconPaused.png");
  store = new Store();
} else if (isMac){
  getResourceDirectory();
  store = new Store();
  var iconPath = path.join(__dirname, store.get('app_icon_name') || 'iconTemplate.png');
  var iconPausedPath = path.join(__dirname, store.get('app_icon_name') || 'iconPaused.png');
} else if (isWindows) {
  var iconPath = path.resolve(getResourceDirectory(), "icon.ico");
  var iconPausedPath = path.resolve(getResourceDirectory(), "iconPaused.ico");
  store = new Store();
}

// **************** functions block *********************************


function startSystemAudioDetection(timeout) {
  if (!isAvailable()) {
    writeLog(`Native audio capture unavailable: ${getLoadError()}`);
    return;
  }

  try {
    const started = startCapture(
      process.pid,
      false, // Capture system audio excluding this app
      (audioData, meta) => {
        if (!meta.isFloat || meta.bitsPerSample !== 32) {
          return;
        }

        // The package provides Float32 PCM samples.
        for (let offset = 0; offset + 4 <= audioData.length; offset += 4) {
          const sample = audioData.readFloatLE(offset);

          if (Number.isFinite(sample)) {
            sumSquares += sample * sample;
            sampleCount++;
          }
        }
      }
    );

    if (!started) {
      writeLog('Failed to start system audio capture');
      return;
    }

    writeLog('System audio detection is started');

    audioCheckInterval = setInterval(() => {
      const rms =
        sampleCount > 0
          ? Math.sqrt(sumSquares / sampleCount)
          : 0;

      if (rms > RMS_THRESHOLD) {
        lastSoundTime = Date.now();
        //writeLog('System audio detected');
      }

      let playing = (Date.now() - lastSoundTime) < timeout*1000;
      sound_detected = playing;

      // Start a fresh measurement window.
      sumSquares = 0;
      sampleCount = 0;
    }, 1000);
  } catch (error) {
    writeLog(`System audio capture failed: ${error}`);
  }
}

/*function openRibbonsSettings(icon) {
  const win_settings = new BrowserWindow({
    width: 1100,
    height: 720,
    //frame: false,
    roundedCorners: false, // for macos
    icon: icon,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  })
  win_settings.loadFile('settings.html');
  win_settings.setMenu(null);
  win_settings.webContents.toggleDevTools();
}*/

// stop screensaver func
function stopScreensaver(display, win, checkid) {
    
  if (win.isVisible()) {
    if (display.id != "stretched") {
      win.setFullScreen(false);
    }
    //win.webContents.send('hide-button-cursor');
    win.webContents.send('send-stop',true);
    win.hide();
    running_screensaver = {};
  }
  //win.setFocusable(false);
  clearInterval(checkid);

}

// toggle play/pause screensaver
function toggleScreensaver(display, win) {
  //if (running_screensaver[display.id]) {
    if (!paused[display.id]) {
      win.webContents.send('send-pause');
      paused[display.id] = true;
      writeLog("Screensaver is paused")
      contextMenu.getMenuItemById(`pause_menu`).enabled = false;
      appIcon.setContextMenu(contextMenu);
      appIcon.setImage(trayIconPaused);
    } else {
      win.webContents.send('send-stop',true);
      startScreensaver(mainWindow, display, true);
      paused[display.id] = false;
      writeLog("Screensaver is resumed")
      contextMenu.getMenuItemById(`pause_menu`).enabled = true;
      appIcon.setContextMenu(contextMenu);
      appIcon.setImage(trayIcon);
    }
  //}
}

// start screensaver func
function startScreensaver(mainWindow, display, start) {
  if (!mainWindow[display.id].isVisible() || (start)) {
    writeLog(`Start screensaver at display ${display.label||'NONAME'} (id ${display.id})`);
    paused[display.id] = false;
    if (display.id != "stretched") {
      mainWindow[display.id].setFullScreen(true);

    }
    mainWindow[display.id].setFocusable(true);
    mainWindow[display.id].webContents.send('send-options',optionsArray[display.id], paused[display.id]);

    mainWindow[display.id].show();

    mainWindow[display.id].webContents.focus();

    running_screensaver[display.id] = true;

    // delay activity tracking, otherwise we'll close immediately
    if (store.get('user_activity')) {
      setTimeout( function() {
        setInterval(function () {
          if (idle_time<1) {
            writeLog(`User activity, stop screensaver at display ${display.label||'NONAME'} (id ${display.id})`);
            stopScreensaver(display, mainWindow[display.id], this)
          }
        }, 500);
      }, 1500); // 1,5 seconds delay to prevent accidential mouse move screensaver close
    }
  }
}

function processDisplays(appIconMenuTemplate) {

  const displays = screen.getAllDisplays();

  if (store.get('stretched_mode')) {
    store.set('selected_displays', 'all');
  }

  if (displays.length <= 1) {

    store.delete('selected_displays');

    return displays;
  }

  const saved_display_submenu = [];

  let selectedDisplays = store.get('selected_displays');

  const existingDisplayIds = displays.map(display =>
    String(display.id)
  );

  let selectedDisplayIds = [];

  if (
    selectedDisplays &&
    selectedDisplays !== 'all' &&
    typeof selectedDisplays === 'object' &&
    Array.isArray(selectedDisplays.displays)
  ) {
    selectedDisplayIds = selectedDisplays.displays
      .map(id => String(id))
      .filter(id => existingDisplayIds.includes(id));

    if (
      selectedDisplayIds.length !== selectedDisplays.displays.length
    ) {
      if (selectedDisplayIds.length === 0) {
        store.delete('selected_displays');
        selectedDisplays = undefined;
      } else {
        store.set('selected_displays', {
          displays: selectedDisplayIds
        });

        selectedDisplays = {
          displays: selectedDisplayIds
        };
      }
    }
  }

  const isCustomMode =
    selectedDisplays &&
    selectedDisplays !== 'all' &&
    typeof selectedDisplays === 'object' &&
    Array.isArray(selectedDisplays.displays);

  saved_display_submenu.push({
    label: i18n.__('use_all_displays'),
    type: 'radio',
    id: 'all',
    checked: !isCustomMode,
    click: () => {

      if (store.get('stretched_mode')) {
        store.set('selected_displays', 'all');
      } else {
        store.delete('selected_displays');
      }

      restartApp();
    }
  });

  saved_display_submenu.push({
    label: i18n.__('use_selected_displays'),
    type: 'radio',
    id: 'custom',
    //enabled: ,
    checked: isCustomMode,
    click: () => {

      if (!isCustomMode) {

        const firstDisplay = displays[0];

        if (firstDisplay) {
          store.set('selected_displays', {
            displays: [String(firstDisplay.id)]
          });
        }
      }

      restartApp();
    }
  });

  saved_display_submenu.push({
    type: 'separator'
  });

  displays.forEach((display) => {

    const displayId = String(display.id);

    saved_display_submenu.push({
      label: display.label || `Display ${displayId}`,
      id: displayId,
      type: 'checkbox',

      enabled: isCustomMode,

      checked:
        isCustomMode &&
        selectedDisplayIds.includes(displayId),

      click: (menuItem) => {

        let current = store.get('selected_displays');

        let ids = [];

        if (
          current &&
          typeof current === 'object' &&
          Array.isArray(current.displays)
        ) {
          ids = current.displays.map(id => String(id));
        }

        if (menuItem.checked) {

          if (!ids.includes(displayId)) {
            ids.push(displayId);
          }

        } else {

          ids = ids.filter(id => id !== displayId);

        }

        if (ids.length === 0) {

          if (store.get('stretched_mode')) {
            store.set('selected_displays', 'all');
          } else {
            store.delete('selected_displays');
          }

        } else {

          store.set('selected_displays', {
            displays: ids
          });

        }

        restartApp();
      }
    });

  });

  // we need to add displays menu before preferences 

  try {
      contextMenu.insert(contextMenu.items.findIndex(item => item.id === "to_add_displays")+1,new MenuItem({
        label: '📺 ' + i18n.__('selected_displays'),
        visible: (!store.get('stretched_mode')),
        enabled: true,
        submenu: saved_display_submenu
      }));
  }
  catch(err) {
    writeLog(err)
  }

  /*appIconMenuTemplate.splice(2, 0, {

  });

  contextMenu = Menu.buildFromTemplate(appIconMenuTemplate);
  appIcon.setContextMenu(contextMenu);*/

  const currentSelection = store.get('selected_displays');

  if (
    currentSelection === 'all' ||
    !currentSelection ||
    !Array.isArray(currentSelection.displays)
  ) {
    return displays;
  }

  const selectedIds = currentSelection.displays.map(id =>
    String(id)
  );

  return displays.filter(display =>
    selectedIds.includes(String(display.id))
  );
}

async function restartApp(removed, media_detect) {
  let options = [];

  if (media_detect) {
    // to prevent spawning electron_app_capture
    if (isLinux) {
      writeLog(`Linux detected. Doing forced restart pipewire to prevent spawning electron_app_capture`)
      exec(`systemctl --user restart pipewire wireplumber`);
    }
  }

  // check if app is in autostart and run as linux systemd service
  if (process.argv.includes('--systemd')) {
    let executable = `"`+app.getPath('exe')+`"`;
    if (!removed) {
      writeLog('Application was run as service. Trying to restart systemd service...');
      exec(`systemctl --user restart `+appNameLC+`.service`);
      return;
    }
  }

  if (app.isPackaged && process.env.APPIMAGE) {
    options.args = process.argv;
    //options.args.unshift({ windowsHide: false });
    execFile(process.execPath, options.args);
    app.exit(0);
    return;
  }

  app.relaunch();
  app.exit(0);
}

function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// linux lock events listener
async function listenForScreenLockEvents() {
  const bus = DBus.sessionBus();
  const obj = await bus.getProxyObject('org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver');
  const screenSaver = obj.getInterface('org.freedesktop.ScreenSaver');

  screenSaver.on('ActiveChanged', (isActive) => {
    if (isActive) {
      isLocked_suspend = true;
      writeLog('The screen is locked');
    } else {
      isLocked_suspend = false;
      writeLog('The screen is unlocked');
      writeLog('Restart app to prevents issues.')
      restartApp();
    }
  });
}

// linux suspend events listener
async function listenForSuspendEvents() {
  const bus = DBus.systemBus();
  const obj = await bus.getProxyObject('org.freedesktop.login1', '/org/freedesktop/login1');
  const logindManager = obj.getInterface('org.freedesktop.login1.Manager');

  logindManager.on('PrepareForSleep', (isStarting) => {
    if (isStarting) {
      isLocked_suspend = true;
      writeLog('The system is suspended');
    } else {
      isLocked_suspend = false;
     writeLog('The system is released');
     writeLog('Restart app to prevents issues.')
     restartApp();
    }
  });
}

// check desktop window
function isDesktopWindow(window) {
    if (!window) return false;

    const { owner, title } = window;

    const isKnownDesktopProcess = desktopProcesses.some((process) =>
        owner.name.toLowerCase().includes(process.toLowerCase())
    );

    // exclude empty title check for mac
    if (!isMac) {
      const isEmptyTitle = !title || title.trim() === '';
      return isKnownDesktopProcess || isEmptyTitle;
    } else {
      return isKnownDesktopProcess;
    }
}

// check non-X11 linux environment
/*function detectWayland() {
  if (process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY) {
    return true;
  }
}*/

// check xprop installed (linux)
async function checkXpropInstalled() {
  return new Promise((resolve, reject) => {
    exec('which xprop', (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// check wctx installed (linux)
async function checkWctxInstalled() {
  return new Promise((resolve, reject) => {
    exec('which wctx', (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// check Xwininfo installed (linux)
/*function checkXwininfoInstalled() {
  return new Promise((resolve, reject) => {
    exec('which xwininfo', (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}*/

async function checkInputGroupMembership() {
  try {
    // Run 'groups' command to get current user's groups
    const { stdout } = await execAsync('groups');
    const groupsList = stdout.trim().split(' '); // Groups are usually space-separated

    //console.log('Current user is in groups:', groupsList);

    const isInInputGroup = groupsList.includes('input');
    //console.log(`Is user in 'input' group? ${isInInputGroup}`);

    return isInInputGroup;

  } catch (error) {
    writeLog(`Error checking groups: ${error.message}` );
    // Handle error appropriately, maybe assume not in group
    return false;
  }
}

/*async function getLinuxActiveWindow() {

  try {
    // 1. Get the active window ID
    const { stdout: activeWinOut } = await execAsync('xprop -root _NET_ACTIVE_WINDOW');
    //writeLog(activeWinOut, true)

    const match = activeWinOut.match(/_NET_ACTIVE_WINDOW\(WINDOW\):\s+window id #\s+(0x[a-fA-F0-9]+)/);
    if (!match) {
      writeLog("Could not determine the active window ID.");
      return false;
    }

    const activeWindowId = match[1];
    //console.log(`[DEBUG] Active Window ID: ${activeWindowId}`);

    // 2. Check if the active window has the FULLSCREEN state
    const { stdout: winPropsOut } = await execAsync(`xprop -id ${activeWindowId}`);
    const isFullscreen = winPropsOut.includes('_NET_WM_STATE_FULLSCREEN');
    //console.log(`[DEBUG] Fullscreen State Found: ${isFullscreen}`);

    // 3. Get the window name (application name/title) using xprop
    let appName = 'Unknown';
    let windowTitle = 'Unknown';

    try {
      // Try xprop for _NET_WM_NAME first (UTF-8)
      const { stdout: nameOut } = await execAsync(`xprop -id ${activeWindowId} _NET_WM_NAME`);
      const nameMatch = nameOut.match(/_NET_WM_NAME\(\w+\) = "(.*)"/);
      if (nameMatch) {
        windowTitle = nameMatch[1];
      }

      // Try xprop for WM_CLASS (application ID)
      const { stdout: classOut } = await execAsync(`xprop -id ${activeWindowId} WM_CLASS`);
      const classMatch = classOut.match(/WM_CLASS\(\w+\) = ".*",\s+"([^"]+)"/);
      if (classMatch) {
        appName = classMatch[1]; // Usually the second part is the class name used by applications
      }

      // Fallback: try xwininfo for title if _NET_WM_NAME wasn't found
      //if (windowTitle === 'Unknown') {
      //   const { stdout: infoOut } = await execAsync(`xwininfo -id ${activeWindowId} -stats`);
      //   const titleMatch = infoOut.match(/xwininfo: Window id: .* "(.+)"/);
      //   if (titleMatch) {
      //      windowTitle = titleMatch[1];
      //   }
      //}

    } catch (detailsErr) {
      writeLog("Could not retrieve window details (name/class):"+detailsErr.message);
      // Proceed even if details retrieval fails
    }


    //return activeWindowId;
    return {
      owner: {
        name: appName
      },
      title: windowTitle,
      fullscreen: isFullscreen,
      window_id: activeWindowId
    };


  }
  catch (error) {
    writeLog(`Failed to query XWayland/X11 properties for fullscreen info: ${error.message}`);
    return []; // Return empty array on failure
  }
}*/


function appendLanguages(contextMenu,lang_files) {
  //console.log(typeof(lang_files));
  let langSubmenu = [];
  lang_files.forEach((lang) => {
    langSubmenu.push(new MenuItem({
          id: lang,
          label: i18n.__(lang),
          type: 'checkbox',
          checked: (store.get('locale') === lang) ? true : false,
          click: () => {
            writeLog(lang)
            store.set('locale',lang);
            restartApp();
          },
      }))
  })

  //console.log(contextMenu.getMenuItemById("to_add_lang"));

  contextMenu.insert(contextMenu.items.findIndex(item => item.id === "to_add_lang")+1,new MenuItem({
        id: "lang",
        label: '🌐 ' + i18n.__('lang'),
        submenu: langSubmenu,
    }));
  //console.log(contextMenu)

}

function setRunAtStartup (flag, store) {
    //store.set('run_at_startup',flag);
    // check if store.get('exec_path') is the same as linux systemd service ExecStart
    let executable = appNameLC;
    let Path = '';
    let exec_changed = false;

    if (isLinux) {
      if (process.env.APPIMAGE) {
        executable = process.env.APPIMAGE;
      } else {
        executable = app.getPath('exe');
      }

      if (executable != store.get('exec_path')) {
        writeLog("Exec path were changed! Force change of systemd service ExecStart.")
        store.set('exec_path', executable)
        flag = true;
        exec_changed = true;
      }
    }
    if (flag) {
      if (isWindows) {
        app.setLoginItemSettings({
            openAtLogin: true,
            //path: app.getPath('exe'),
            //name: app.getName() + " v."+app.getVersion() // to fix version in registry autorun
            name: app.getName()
        })
        writeLog("Application was set to autostart")
      }
      if (isLinux) {
        if (process.env.APPIMAGE) {
          Path = process.env.APPIMAGE.replace(/\/[^\/]*$/, '/');
          executable = `"`+process.env.APPIMAGE+`"`;
        } else {
          Path = app.getPath('exe').replace(/\/[^\/]*$/, '/');
          executable = `"`+app.getPath('exe')+`"`;
        }
        //const isKDE = process.env.KDE_SESSION_VERSION !== undefined;
        //if (isKDE) {
          //executable = `'sleep 10 && ` + executable + `'`;
        //}
        let shortcut_contents = `[Desktop Entry]
Categories=Multimedia
Comment=Windows like ribbons screensaver app
Exec=bash -c 'systemctl --user start `+appNameLC+`.service'
Name=Ribbons screensaver
StartupWMClass=Ribbons screensaver
Terminal=false
Type=Application
Icon=`+appNameLC+`
X-GNOME-Autostart-Delay=10`;

        let systemd_contents = `[Unit]
Description=Windows like ribbons screensaver app
After=graphical-session.target
Requires=graphical-session.target

[Service]
Type=simple
WorkingDirectory=`+Path+`
ExecStart=`+executable+` --systemd
Environment="NODE_ENV=production"
KillMode=mixed
TimeoutStopSec=10

[Install]
WantedBy=graphical-session.target`;
        if (!fs.existsSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")) {
          //fs.unlinkSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")
          fs.writeFileSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop",shortcut_contents, 'utf-8');
        }
        if ((!fs.existsSync(app.getPath('home')+"/.config/systemd/user/"+appNameLC+".service")) || exec_changed) {
          // to force create subfolder if it is not exist to prevent errors
          fs.mkdirSync(path.dirname(`${app.getPath('home')}/.config/systemd/user/${appNameLC}.service`), { recursive: true });
          fs.writeFileSync(app.getPath('home')+"/.config/systemd/user/"+appNameLC+".service",systemd_contents, 'utf-8');
          exec(`systemctl --user daemon-reload`);
          exec(`systemctl --user enable `+appNameLC+`.service`);
          writeLog("Application was set to autostart as user systemd service")
        }
      }
      if (isMac) {
        let plist_contents =`
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>Label</key>
<string>com.electron.`+appNameLC+`</string>
<key>ProgramArguments</key>
<array>
    <string>/Applications/Ribbons screensaver.app/Contents/MacOS/Ribbons screensaver</string>
</array>
<key>RunAtLoad</key>
<true/>
<key>KeepAlive</key>
<true/>
</dict>
</plist>
`;
        if (!fs.existsSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist")) {
          fs.writeFileSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist",plist_contents, 'utf-8');
          exec('launchctl bootstrap enable '+app.getPath('home')+'/Library/LaunchAgents/com.electron.'+appNameLC+'.plist');
          writeLog("Application was set to autostart as service")
        }
      }
    } else {
      if (isWindows) {
        app.setLoginItemSettings({
            openAtLogin: false,
            //path: app.getPath('exe'),
            //name: app.getName() + " v."+app.getVersion()  // to fix version in registry autorun
            name: app.getName()
        })
        writeLog("Application was removed from autostart")
      }
      if (isLinux) {

        if (fs.existsSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")) {
          fs.unlinkSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")
        }
        if (fs.existsSync(app.getPath('home')+"/.config/systemd/user/"+appNameLC+".service")) {
          exec(`systemctl --user disable `+appNameLC+`.service`);
          fs.unlinkSync(app.getPath('home')+"/.config/systemd/user/"+appNameLC+".service")
          exec(`systemctl --user daemon-reload`);
          writeLog("Application was removed from autostart")
        }
      }
      if (isMac) {
        if (fs.existsSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist")) {
          fs.unlinkSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist");
          //exec('launchctl bootstrap disable com.electron.'+appNameLC);
          exec('launchctl bootstrap disable gui/"$(id -u)"/com.electron.'+appNameLC);
          writeLog("Application was removed from autostart")
        }
      }
    }
}

function getResourceDirectory () {
  //return process.env.NODE_ENV === "development"
  if (!app.isPackaged) {
    return path.join(process.cwd())
  } else {
    return path.join(process.resourcesPath, "app.asar.unpacked");
  }
};

function writeLog(message,obj) {

  const logFilePath = path.join(app.getPath('userData'), 'app.log');
  const timestamp = new Date().toLocaleString();
  const logMessage = `[${timestamp}] ${message}\n`;
  if (obj) {
    console.log( `[${timestamp}]`);
    console.dir( message, { depth: null, colors: true });
  } else {
    console.log( `[${timestamp}] ${message}`);
  }
  try {
    if (store.get('logging')) {
      fs.appendFile(logFilePath, logMessage, (err) => {
        if (err) {
          console.error(`[${timestamp}] 'Error when tring to write log:'`, err);
        }
      });
    }
  }
  catch(err) {
    //console.log( `[${timestamp}] `+err);
  }
}

function isKDEPlasma5() {
  return (
    isLinux &&
    process.env.XDG_CURRENT_DESKTOP
      ?.split(':')
      .includes('KDE') &&
    process.env.KDE_SESSION_VERSION === '5'
  );
}

async function openFile(filePath) {

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'File not found',
        detail: `The file ${filePath} does not exist.`
      });
      return;
    }

    // Try to open the file
    const error = await shell.openPath(filePath);
    if (error) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Failed to open file',
        detail: `No application is associated with this file type. Error: ${error}`
      });
    }
  } catch (err) {
    writeLog('Unexpected error:', err);
    await dialog.showMessageBox({
      type: 'error',
      message: 'Unexpected error',
      detail: err.message
    });
  }
}

// **************** functions block end *********************************

import i18n from './translations/i18n.js';
/*dialog.showErrorBox(
    i18n.__('error'),
    i18n.__('error1')
);*/
//const i18n = new I18n();

const gotTheLock = app.requestSingleInstanceLock();

writeLog(`Electron v.${process.versions.electron}`)

if (!app.isPackaged) {
  writeLog(app.getName() + " v."+app.getVersion() + ' is started in dev mode');
} else {
  writeLog(app.getName() + " v."+app.getVersion() + ' is started in production mode');
}

if (!gotTheLock) {
    writeLog("Found already running screensaver. Exiting!");
    app.exit(0);
} else {
    app.on('second-instance', (event) => {
      
      if (isMac) {
        app.exit(0);
      } else {

        dialog.showErrorBox(i18n.__('error'), i18n.__('error1'));
      }
    })

    try {

        // temporary turn off console.log errors in case of app.exit(0) in AppImage
        process.stdout.on('error', (err) => {
          if (err.code === 'EPIPE') {
          } else {
            throw err;
          }
        });

        var lang_files = i18n.___("get_locales");

        // init options 
        // check if engine is configured and set default modern value if not
        if (!store.get('engine')) {
          store.set('engine', 'modern');
        }

        // check if backgroundMode is configured and set default auto value if not
        if (!store.get('backgroundMode')) {
          store.set('backgroundMode', 'auto');
        }

        // check if opacity is configured and set default 70 value if not
        if (!store.get('opacity')) {
          store.set('opacity', 70);
        }

        // check if glow is configured and set default 66 value if not
        if (store.get('glow') === undefined) {
          store.set('glow', 66);
        }

        // check if minLength is configured and set default 1 value if not
        if (store.get('minLength') === undefined) {
          store.set('minLength', 1);
        }

        // check if maxLength is configured and set default 6 value if not
        if (store.get('maxLength') === undefined) {
          store.set('maxLength', 6);
        }

        // check if minWidth is configured and set default 10 value if not
        if (store.get('minWidth') === undefined) {
          store.set('minWidth', 10);
        }

        // check if maxWidth is configured and set default 60 value if not
        if (store.get('maxWidth') === undefined) {
          store.set('maxWidth', 60);
        }

        // check if minCurl is configured and set default 1 value if not
        if (store.get('minCurl') === undefined) {
          store.set('minCurl', 1);
        }

        // check if maxCurl is configured and set default 3 value if not
        if (store.get('maxCurl') === undefined) {
          store.set('maxCurl', 3);
        }

        // check if minTwist is configured and set default 0 value if not
        if (store.get('minTwist') === undefined) {
          store.set('minTwist', 0);
        }

        // check if maxTwist is configured and set default 0 value if not
        if (store.get('maxTwist') === undefined) {
          store.set('maxTwist', 0);
        }

        // check if curlAmplitude is configured and set default 0.22 value if not
        if (store.get('curlAmplitude') === undefined) {
          store.set('curlAmplitude', 0.22);
        }

        // check if endless is configured and set default true value if not
        if (store.get('endless') === undefined) {
          store.set('endless', true);
        }

        // check if theme is configured and set default auto value if not
        if (!store.get('theme')) {
          store.set('theme', 'auto');
        }

        // check if selected_displays is configured and set default all value if not
        if (!store.get('selected_displays')) {
          store.set('selected_displays', 'all');
        }

        // check if hw_acc is configured and set default true value if not
        if (store.get('hw_acc') === undefined) {
          store.set('hw_acc', true);
        }

        // check if user_activity is configured and set default true value if not
        if (store.get('user_activity') === undefined) {
          store.set('user_activity', true);
        }

        // check if colorCycleSpeed is configured and set default 3 value if not
        if (!store.get('colorCycleSpeed')) {
          store.set('colorCycleSpeed', 3);
        }

        // check if horizontalSpeed is configured and set default 400 value if not
        if (!store.get('horizontalSpeed')) {
          store.set('horizontalSpeed', "normal");
        }

        // check if ribbonCount is configured and set default 3 value if not
        if (!store.get('ribbonCount')) {
          store.set('ribbonCount', 3);
        }

        // check if idle_time is configured and set default 60 value if not
        if (!store.get('idle_time')) {
          store.set('idle_time', 60);
        }

        // check if logging is configured and set default false if not
        if (store.get('logging') === undefined) {
          store.set('logging', false);
        }

        // save current app exec path in config file
        if (!store.get('exec_path')) {
          store.set('exec_path',app.getPath('exe'));
        }

        // check if stretched_mode is configured and set default false value if not
        if (store.get('stretched_mode') === undefined) {
          store.set('stretched_mode', false);
        }


        // check if run_at_startup is configured and set default false value if not
        if (!store.get('run_at_startup')) {
          setRunAtStartup (false, store);
        } else {
          setRunAtStartup (true, store);
        }

        // check if media_detect is configured and set default true value if not
        if (store.get('media_detect') === undefined) {
          if (!isMac) {
            store.set('media_detect', true)
          }
        }

        // check if fullscreen_detect is configured and set default true value if not
        if (store.get('fullscreen_detect') === undefined) {
            store.set('fullscreen_detect', true)
        }

        // if stretched_mode is enabled - force turn on randomize_datetime_pos
        if (store.get('show_datetime') && !store.get('randomize_datetime_pos')) {
          if (store.get('stretched_mode')) {
            store.set('randomize_datetime_pos', true)
          }
        }
        let icon = nativeImage.createFromPath(iconPath); // template with center transparency
        let iconPaused = nativeImage.createFromPath(iconPausedPath);
        var trayIcon = icon
        var trayIconPaused = iconPaused
        if (isMac) {
          //var icon_bw = await bw_icon_process(icon);
          // as this icon is for macos tray only resize it here
          trayIcon = trayIcon.resize({width:16});
          trayIconPaused = trayIconPaused.resize({width:16});
        }

        
        //setRunAtStartup(store.get('run_at_startup'));

        var appIcon = null;

        let appIconMenuTemplate = [

            {
              label: '⏵  ' + i18n.__('show_now'),
              click: () => {
                displays.forEach((display) => {
                  if (paused[display.id]) {
                    if (!contextMenu.getMenuItemById(`pause_menu`).enabled) {
                      contextMenu.getMenuItemById(`pause_menu`).enabled = true;
                      appIcon.setContextMenu(contextMenu);
                      appIcon.setImage(trayIcon);
                      writeLog("Screensaver is resumed");
                    }
                  }
                  startScreensaver(mainWindow, display);
                });
              },
            },
            {
              label: '⏸  ' + i18n.__('pause'),
              id: 'pause_menu',
              accelerator: (!isKDEPlasma5()) ? 'Control+P' : null,
              registerAccelerator: false,
              click: () => {
                displays.forEach((display) => {
                  toggleScreensaver(display, mainWindow[display.id]);
                });
                //Menu.getApplicationMenu().getMenuItemById('pause_menu').enabled = false;
              },
            },
            { type: 'separator', id: 'to_add_displays' },
            {
              label: '⚙️ ' + i18n.__('visuals'),
              submenu: [
                {
                  label: '✨ ' + i18n.__('engine'),
                  submenu: [
                    {
                      label: '🎩 ' + i18n.__('classic'),
                      type: 'checkbox',
                      checked: store.get('engine') === 'classic' ? true : false,
                      click: () => {
                        store.set('engine','classic');
                        restartApp();
                      }
                    },
                    {
                      label: '🛸 ' + i18n.__('modern'),
                      type: 'checkbox',
                      checked: store.get('engine') === 'modern' ? true : false,
                      click: () => {
                        store.set('engine','modern');
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: '∞ ' + i18n.__('endless'),
                  visible: store.get('engine') == 'modern',
                  submenu: [
                    {
                      label: i18n.__('logging_sw'),
                      type: 'checkbox',
                      checked: store.get('endless'),
                      click: (option) => {
                          store.set('endless', option.checked);
                          restartApp();
                      }
                    }
                  ]
                },
                {
                  label: '🖼️ ' + i18n.__('backgroundMode'),
                  visible: store.get('engine') == 'modern',
                  submenu: [
                    {
                      label: '🌓 ' + i18n.__('auto'),
                      type: 'checkbox',
                      checked: ((store.get('backgroundMode') === 'auto') || (!store.get('backgroundMode'))) ? true : false,
                      click: () => {
                        store.set('backgroundMode','auto');
                        store.set('theme','auto');
                        restartApp();
                      }
                    },
                    {
                      label: '🌅 ' + i18n.__('lightGradient'),
                      type: 'checkbox',
                      checked: store.get('backgroundMode') === 'lightGradient' ? true : false,
                      click: () => {
                        store.set('backgroundMode','lightGradient');
                        store.set('theme','light');
                        restartApp();
                      }
                    },
                    {
                      label: '☀️ ' + i18n.__('light'),
                      type: 'checkbox',
                      checked: store.get('backgroundMode') === 'light' ? true : false,
                      click: () => {
                        store.set('backgroundMode','light');
                        store.set('theme','light');
                        restartApp();
                      }
                    },
                    {
                      label: '🌙 ' + i18n.__('dark'),
                      type: 'checkbox',
                      checked: store.get('backgroundMode') === 'dark' ? true : false,
                      click: () => {
                        store.set('backgroundMode','dark');
                        store.set('theme','dark');
                        restartApp();
                      }
                    },
                    {
                      label: '🌌 ' + i18n.__('darkGradient'),
                      type: 'checkbox',
                      checked: store.get('backgroundMode') === 'darkGradient' ? true : false,
                      click: () => {
                        store.set('backgroundMode','darkGradient');
                        store.set('theme','dark');
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: '🌫️ ' + i18n.__('opacity'),
                  visible: store.get('engine') == 'modern',
                  submenu: [
                    {
                      label: '● ' + i18n.__('non_transparent'),
                      type: 'checkbox',
                      checked: store.get('opacity') === 100 ? true : false,
                      click: () => {
                        store.set('opacity', 100);
                        restartApp();
                      }
                    },
                    {
                      label: '◐ ' + i18n.__('half_transparent'),
                      type: 'checkbox',
                      checked: store.get('opacity') === 70 ? true : false,
                      click: () => {
                        store.set('opacity', 70);
                        restartApp();
                      }
                    },
                    {
                      label: '◯ ' + i18n.__('almost_transparent'),
                      type: 'checkbox',
                      checked: store.get('opacity') === 30 ? true : false,
                      click: () => {
                        store.set('opacity', 30);
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: '∞ ' + i18n.__('endless'),
                  visible: store.get('engine') == 'modern',
                  submenu: [
                    {
                      label: i18n.__('logging_sw'),
                      type: 'checkbox',
                      checked: store.get('endless'),
                      click: (option) => {
                          store.set('endless', option.checked);
                          restartApp();
                      }
                    }
                  ]
                },
                { type: 'separator' },
                {
                  label: '↔️ ' + i18n.__('stretched_mode'),
                  id: 'stretched_mode',
                  submenu: [
                    {
                      label: i18n.__('logging_sw'),
                      type: 'checkbox',
                      checked: store.get('stretched_mode'),
                      //enabled: store.get('randomize_datetime_pos') ? true : false,
                      click: (option) => {
                          store.set('stretched_mode', option.checked);
                          restartApp();
                      }
                    }
                  ],
                },
                {
                  label: '🌓 ' + i18n.__('theme'),
                  visible: store.get('engine') != 'modern',
                  submenu: [
                    {
                      label: '🌓 ' + i18n.__('auto'),
                      type: 'checkbox',
                      checked: ((store.get('theme') === 'auto') || (!store.get('theme'))) ? true : false,
                      click: () => {
                        store.set('theme','auto');
                        restartApp();
                      }
                    },
                    {
                      label: '☀️ ' + i18n.__('light'),
                      type: 'checkbox',
                      checked: store.get('theme') === 'light' ? true : false,
                      click: () => {
                        store.set('theme','light');
                        restartApp();
                      }
                    },
                    {
                      label: '🌙 ' + i18n.__('dark'),
                      type: 'checkbox',
                      checked: store.get('theme') === 'dark' ? true : false,
                      click: () => {
                        store.set('theme','dark');
                        restartApp();
                      }
                    },

                  ]
                },
                {
                  label: '🌈 ' + i18n.__('rib_color'),
                  submenu: [
                    {
                      label: '🌈 ' + i18n.__('rndm_col'),
                      type: 'checkbox',
                      checked: ((store.get('singleColor') === false) || (!store.get('singleColor')))  ? true : false,
                      click: () => {
                        store.set('singleColor',false);
                        restartApp();
                      }
                    },
                    {
                      label: '🇷🇺 ' + i18n.__('tricolor'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 667  ? true : false,
                      click: () => {
                        store.set('singleColor',667);
                        restartApp();
                      }
                    },
                    { type: 'separator' },
                    {
                      label: i18n.__('grey'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 666 ? true : false,
                      click: () => {
                        store.set('singleColor',666);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('red'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 360 ? true : false,
                      click: () => {
                        store.set('singleColor',360);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('yellow'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 60 ? true : false,
                      click: () => {
                        store.set('singleColor',60);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('green'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 120 ? true : false,
                      click: () => {
                        store.set('singleColor',120);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('cyan'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 180 ? true : false,
                      click: () => {
                        store.set('singleColor',180);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('blue'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 240 ? true : false,
                      click: () => {
                        store.set('singleColor',240);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('magenta'),
                      type: 'checkbox',
                      checked: store.get('singleColor') === 300 ? true : false,
                      click: () => {
                        store.set('singleColor',300);
                        restartApp();
                      }
                    },
                    { type: 'separator' },
                    {
                      label: i18n.__('custom'),
                      type: 'checkbox',
                      enabled: false,
                      checked: ((store.get('singleColor') !== false) && (store.get('singleColor') !== 0)  && (store.get('singleColor') !== 60) && (store.get('singleColor') !== 120)  && (store.get('singleColor') !== 180)  && (store.get('singleColor') !== 240)  && (store.get('singleColor') !== 300) && (store.get('singleColor') !== 666)  && (store.get('singleColor')) && (store.get('singleColor') !== 667))  ? true : false,
                      click: (event) => {
                        event.preventDefault();
                      }
                    },
                  ]
                },
                {
                  label: '💫 ' + i18n.__('glow'),
                  //visible: store.get('engine') == 'modern',
                  submenu: [
                    {
                      label: i18n.__('logging_sw'),
                      type: 'checkbox',
                      checked: store.get('glow') != 0 ? true : false,
                      click: (option) => {
                          if (option.checked) {
                            store.set('glow', 66);
                          } else {
                            store.set('glow', 0);
                          }
                          restartApp();
                      }
                    }
                  ]
                },
                {
                  label: '⚡ ' + i18n.__('ribbonCount'),
                  enabled: (store.get('singleColor') !== 667)  ? true : false,
                  submenu: [
                    {
                      label: '3',
                      type: 'checkbox',
                      checked: store.get('ribbonCount') === 3 ? true : false,
                      click: () => {
                        store.set('ribbonCount',3);
                        restartApp();
                      }
                    },
                    {
                      label: '5'+ i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('ribbonCount') === 5 ? true : false,
                      click: () => {
                        store.set('ribbonCount',5);
                       restartApp();
                      }
                    },
                    {
                      label: '7',
                      type: 'checkbox',
                      checked: store.get('ribbonCount') === 7 ? true : false,
                      click: () => {
                        store.set('ribbonCount',7);
                        restartApp();
                      }
                    },
                    {
                      label: '9',
                      type: 'checkbox',
                      checked: store.get('ribbonCount') === 9 ? true : false,
                      click: () => {
                        store.set('ribbonCount',9);
                        restartApp();
                      }
                    }
                  ]
                },
                {
                  label: '🔃 ' + i18n.__('colorCycleSpeed'),
                  enabled: ((store.get('singleColor') === false) || (!store.get('singleColor')))  ? true : false,
                  visible: store.get('engine') != 'modern',
                  submenu: [
                    {
                      label: i18n.__('slow'),
                      type: 'checkbox',
                      checked: store.get('colorCycleSpeed') === 1 ? true : false,
                      click: () => {
                        store.set('colorCycleSpeed',1);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('normal')+i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('colorCycleSpeed') === 3 ? true : false,
                      click: () => {
                        store.set('colorCycleSpeed',3);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('fast'),
                      type: 'checkbox',
                      checked: store.get('colorCycleSpeed') === 10 ? true : false,
                      click: () => {
                        store.set('colorCycleSpeed',10);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('v_fast'),
                      type: 'checkbox',
                      checked: store.get('colorCycleSpeed') === 20 ? true : false,
                      click: () => {
                        store.set('colorCycleSpeed',20);
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: '⏩ ' + i18n.__('horizontalSpeed'),
                  submenu: [
                    {
                      label: i18n.__('slow'),
                      type: 'checkbox',
                      checked: store.get('horizontalSpeed') == "slow" ? true : false,
                      click: () => {
                        store.set('horizontalSpeed',"slow");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('normal')+i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('horizontalSpeed') == "normal" ? true : false,
                      click: () => {
                        store.set('horizontalSpeed',"normal");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('fast'),
                      type: 'checkbox',
                      checked: store.get('horizontalSpeed') == "fast" ? true : false,
                      click: () => {
                        store.set('horizontalSpeed',"fast");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('v_fast'),
                      type: 'checkbox',
                      checked: store.get('horizontalSpeed') == "v_fast" ? true : false,
                      click: () => {
                        store.set('horizontalSpeed',"v_fast");
                        restartApp();
                      }
                    },
                  ]
                },
                // set show datetime
                {
                  label: '📅 ' + i18n.__('show_datetime'),
                  submenu: [
                    {
                      label: i18n.__('logging_sw'),
                      type: 'checkbox',
                      checked: store.get('show_datetime'),
                      click: (option) => {
                          store.set('show_datetime', option.checked);
                          restartApp();
                      }
                    },
                    { type: 'separator' },
                    {
                      label: i18n.__('datetime_front'),
                      type: 'checkbox',
                      enabled: store.get('show_datetime') && !store.get('randomize_datetime_pos') ? true : false,
                      checked: store.get('datetime_front'),
                      click: (option) => {
                        store.set('datetime_front', option.checked);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('randomize_datetime_pos'),
                      type: 'checkbox',
                      id: 'randomize_datetime_pos',
                      enabled: store.get('show_datetime') ? true : false,
                      checked: store.get('randomize_datetime_pos'),
                      click: (option) => {
                        store.set('randomize_datetime_pos', option.checked);
                        restartApp();
                      }
                    }
                  ]
                },
              ]
            },
            {
              label: '⏱️ ' + i18n.__('max_idle'),
              submenu: [
                /*{
                  label: '3' +i18n.__('sec'),
                  type: 'checkbox',
                  checked: store.get('idle_time') === 3 ? true : false,
                  click: () => {
                    store.set('idle_time',3);
                    restartApp();
                  }
                },*/
                {
                  label: '30 '+i18n.__('sec'),
                  type: 'checkbox',
                  checked: store.get('idle_time') === 30 ? true : false,
                  click: () => {
                    store.set('idle_time',30);
                    restartApp();
                  }
                },
                {
                  label: '1 '+i18n.__('min')+ i18n.__('default'),
                  type: 'checkbox',
                  checked: ((store.get('idle_time') === 60) || (!store.get('idle_time'))) ? true : false,
                  click: () => {
                    store.set('idle_time',60);
                    restartApp();
                  }
                },
                {
                  label: '5 '+i18n.__('min'),
                  type: 'checkbox',
                  checked: store.get('idle_time') === 5*60 ? true : false,
                  click: () => {
                    store.set('idle_time',5*60);
                    restartApp();
                  }
                },
                {
                  label: '15 '+i18n.__('min'),
                  type: 'checkbox',
                  checked: store.get('idle_time') === 15*60 ? true : false,
                  click: () => {
                    store.set('idle_time',15*60);
                    restartApp();
                  }
                },
                {
                  label: '30 '+i18n.__('min'),
                  type: 'checkbox',
                  checked: store.get('idle_time') === 30*60 ? true : false,
                  click: () => {
                    store.set('idle_time',30*60);
                    restartApp();
                  }
                },
              ]
            },
            {
              // set media detection
              label: '🎧 ' + i18n.__('media_detect'),
              submenu: [
                {
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('media_detect'),
                  //enabled: (app.isPackaged)  ? true : false,
                  click: (option) => {
                      store.set('media_detect', option.checked);
                      if (!option.checked) {
                        restartApp(false, true);
                      } else {
                        restartApp();
                      }
                  }
                }
              ],
            },
            {
              // set fullscreen detection (linux only)
              label: '⛶ ' + i18n.__('fullscreen_detect'),
              //visible: isLinux,
              submenu: [
                {
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('fullscreen_detect'),
                  //enabled: (app.isPackaged)  ? true : false,
                  click: (option) => {
                      store.set('fullscreen_detect', option.checked);
                      restartApp();
                  }
                }
              ],
            },
            {
              // set user activity detection
              label: '👆 ' + i18n.__('user_activity'),
              submenu: [
                {
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('user_activity'),
                  //enabled: (app.isPackaged)  ? true : false,
                  click: (option) => {
                      store.set('user_activity', option.checked);
                      restartApp();
                  }
                }
              ],
            },
            { type: 'separator', id: 'to_add_lang' },
            {
              // set hw acceleration
              label: '📊 ' + i18n.__('hw_acc'),
              submenu: [
                {
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('hw_acc'),
                  //enabled: (app.isPackaged)  ? true : false,
                  click: (option) => {
                      store.set('hw_acc', option.checked);
                      restartApp();
                  }
                }
              ],
            },
            {
              label: '🚀 ' + i18n.__('run_at_startup'),
              submenu: [
                {
                  // set run at startup
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('run_at_startup'),
                  enabled: (app.isPackaged)  ? true : false,
                  click: (option) => {
                      store.set('run_at_startup', option.checked);
                      setRunAtStartup (option.checked, store);
                      restartApp(option.checked);
                  }
                }
              ],
            },
             // set logging to file
            {
              label: '📄  ' + i18n.__('logging'),
              submenu: [
                {
                  label: i18n.__('logging_sw'),
                  type: 'checkbox',
                  checked: store.get('logging'),
                  click: (option) => {
                      store.set('logging', option.checked);
                      restartApp();
                  }
                },
                { type: 'separator' },
                {
                  label: i18n.__('logging_open'),
                  //type: 'checkbox',
                  enabled: store.get('logging'),
                  click: () => {
                    writeLog(`Opening app.log file in ${app.getPath('userData')}`);
                    openFile(path.join(app.getPath('userData'), 'app.log'));
                  }
                },
              ]
            },
            /*{
              label : '🛠️  ' + i18n.__('settings'),
              click: () => {
                openRibbonsSettings(icon);
              }
            },*/
            {
              label : '📜  ' + i18n.__('settings_json'),
              click: () => {
                writeLog(`Opening config.json file in ${app.getPath('userData')}`);
                openFile(path.join(app.getPath('userData'), 'config.json'));
              }
            },
            {
              label : 'ℹ️  ' + i18n.__('about'),
              click: () => {
                app.showAboutPanel();
              }
            },
            { type: 'separator' },
            {
              label: '↩️  ' + i18n.__('restart_app'),
              click: () => {
                restartApp();
              }
            },
            {
              label: '🚪  ' + i18n.__('exit'),
              click: () => {
                if (isMac) {
                  exec('launchctl bootout gui/"$(id -u)"/com.electron.'+appNameLC);
                }
                app.exit(0);
              },
            }
        ];

        // to fix low performance
        if (!store.get('hw_acc')) {
          app.disableHardwareAcceleration();
        }
        
        app.on('quit', function() {
          clearInterval(audioCheckInterval);
          stopCapture();
          // to prevent spawning electron_app_capture
          if (isLinux && store.get('media_detect')) {
            writeLog(`Linux detected. Doing forced restart pipewire to prevent spawning electron_app_capture`)
            exec(`systemctl --user restart pipewire wireplumber`);
          }
          writeLog(app.getName() + " v."+app.getVersion() + ' is exited')
        })

        process.on('SIGTERM', () => {
          app.exit(0);
        })
        process.on('SIGINT', () => {
          app.exit(0);
        })

        // initialize electron-audio-loopback plugin
        //let initialized = await initSystemAudioLoopback({
          /*forceCoreAudioTap: false,
          removeVideo: false,
          loopbackWithMute: true,
          onAfterGetSources: (sources) => {
            console.log('sources', sources);
            return sources;
          }*/
        //});

        // fix win focus issues in wayland
        /*if (isLinux) {
          app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
          app.commandLine.appendSwitch('ozone-platform', 'x11');
          //app.commandLine.appendSwitch('enable-features', 'Opengl');
        }*/

        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        app.on('ready', async function() {

          // check if locale is configured and set default current system lang value if not
          if (store.get('locale') === undefined || store.get('locale') === "") {
            store.set('locale', app.getLocale());
          }

          if (isMac) {
            if (store.get('media_detect') === undefined) {
              await dialog.showMessageBox({
                type: 'info',
                message: i18n.__('warning_media_detect'),
                detail: i18n.__('warning_media_detect_details'),
                buttons: [i18n.__('yes'), i18n.__('no')],
                defaultId: 1,
                cancelId: 2
              })
              .then((result) => {
                // if yes
                if (result.response == 0) {
                  store.set('media_detect', false)
                } else if (result.response == 1) {
                  store.set('media_detect', true)
                  restartApp();
                } else {
                  // if close dialog - exit app
                  app.exit(0)
                }
              })
            }
          }

          // to detect lock screen and suspend (win, mac)
          if (!isLinux) {
            powerMonitor.on('lock-screen', () => {
              isLocked_suspend = true;
              writeLog('The screen is locked');
              // Add your custom logic here
            });
            powerMonitor.on('unlock-screen', () => {
              isLocked_suspend = false;
              writeLog('The screen is unlocked');
              writeLog('Restart app to prevents issues.')
              restartApp();
              // Add your custom logic here
            });
            powerMonitor.on('suspend', () => {
              isLocked_suspend = true;
              writeLog('The system is suspended');
              // Add your custom logic here
            });
            powerMonitor.on('resume', () => {
              isLocked_suspend = false;
              writeLog('The system is released');
              writeLog('Restart app to prevents issues.')
              restartApp();
              // Add your custom logic here
            });
          } else {
            // to detect lock screen and suspend (linux)
            listenForScreenLockEvents().catch(console.error);
            listenForSuspendEvents().catch(console.error);
            //check X11
            /*if (detectWayland()) {
              //writeLog("Application is not compatible with wayland protocol. Exiting.");
              dialog.showErrorBox(i18n.__('error'), i18n.__('error3'));
              app.exit(0);
            }*/
          }


          let fullscreen_detector = false;
          if (isLinux) {
            await checkXpropInstalled().then((installed) => {
              if (!installed && linuxNeedsXprop()) {
                dialog.showErrorBox(i18n.__('error'), i18n.__('error2'));
                app.exit(0);
              } else {
                fullscreen_detector = true;
              }
            });

            await checkWctxInstalled().then((installed) => {
              if (!installed && !linuxNeedsXprop()) {
                dialog.showErrorBox(i18n.__('error'), i18n.__('error5'));
                app.exit(0);
              } else {
                fullscreen_detector = true;
              }
            });
          } else {
            fullscreen_detector = true;
          }

          if (fullscreen_detector && store.get('fullscreen_detect')) {
            writeLog('Fullscreen applications detection is started');
          } else {
            writeLog('Fullscreen applications detection is off');
          }


          

          /*checkXwininfoInstalled().then((installed) => {
            // check xwininfo
            if (!installed) {
              dialog.showErrorBox(i18n.__('error'), i18n.__('error2'));
              app.exit(0);
            }
          });*/

          // start idle system monitoring
          //check user permission to input group

          let activity_detector = false;

          if (isLinux) {
            await checkInputGroupMembership()
            .then(isMember => {
              if (isMember) {
                //writeLog(`User has permission (member of 'input' group).`);
                // Proceed with actions requiring input group permissions
                desktopIdle.startMonitoring();
                activity_detector = true;
              } else {
                writeLog(`User does not have 'input' group permissions`);
                // Show error message or disable features
                dialog.showErrorBox(i18n.__('error'), i18n.__('error4'));
                app.exit(0);
              }
            })
            .catch(error => {
              writeLog(error)
              app.exit(0);
            });
          } else {
            desktopIdle.startMonitoring();
            activity_detector = true;
          }

          if (activity_detector && store.get('user_activity')) {
            writeLog(`User activity detection is started`)
          } else {
            writeLog(`User activity detection is off`)
          }

          //force hide dockicon on mac
          if (isMac) app.dock.hide();
          // dont start tray icon in windows
          appIcon = new Tray(trayIcon)
          contextMenu = Menu.buildFromTemplate(appIconMenuTemplate)
          appendLanguages(contextMenu,lang_files);
          appIcon.setToolTip(app.getName() + " v."+app.getVersion());
          appIcon.setContextMenu(contextMenu)

          appIcon.on('click', (event) => {
            displays.forEach((display) => {
              if (paused[display.id]) {
                if (!contextMenu.getMenuItemById(`pause_menu`).enabled) {
                  contextMenu.getMenuItemById(`pause_menu`).enabled = true;
                  appIcon.setContextMenu(contextMenu);
                  appIcon.setImage(trayIcon);
                  writeLog("Screensaver is resumed");
                }
              }
              startScreensaver(mainWindow, display);
            })
          })

          appIcon.on('context', (event) => {
              appIcon.popUpContextMenu(); // TODO KDE linux doesnt support this =((
          })


          // pull displays to selector menu and wait user chosen displays arrays
          displays = processDisplays(appIconMenuTemplate);

          clearTimeout(debounce);
        
          screen.on('display-removed', (event, display) => {
            let delay = 2000 + Math.random() * 5000;
            debounce = setTimeout(function() {
              writeLog("Display "+display.label+" with id "+display.id+" was removed. Restart app...")
              restartApp();
            }, delay);
          });
          screen.on('display-added', (event, display) => {
            let delay = 2000 + Math.random() * 5000;
            debounce = setTimeout(function() {
              writeLog("Display "+display.label+" with id "+display.id+" was added. Restart app...")
              restartApp();
            }, delay);
          });

          // could conflict with media detection on some platforms!
          screen.on('display-metrics-changed', (event, display) => {
            let delay = 2000 + Math.random() * 5000;
            debounce = setTimeout(function() {
              writeLog("Display "+display.label+" with id "+display.id+" was changed (resolution or other properties). Restart app...")
              restartApp();
            }, delay);
          });


          const deviceCache = new Map();
          let number_of_hid_devices = 0;

          const checkDevices = () => {
            try {
              const currentDevices = HID.devices();
              let delay = 2000 + Math.random() * 5000;

              if (number_of_hid_devices != currentDevices.length) {
                debounce = setTimeout(function() {
                  writeLog("Some hid devices changed. Restart app..")
                  restartApp();
                }, delay);
              }
              number_of_hid_devices = currentDevices.length;

              //writeLog(`🔍 Scanning: ${currentDevices.length} devices found`);



            } catch (err) {
              // 🚨 CRITICAL: Always catch HID errors (macOS permissions!)
              writeLog(`❌ DEVICE MONITOR ERROR: ${err.message}`);
            }
          };

          // Initialize immediately + poll
          //checkDevices(); // Initial scan (catches devices already connected)
          number_of_hid_devices = HID.devices().length;
          setInterval(checkDevices, 1000);


          // register ctrl+p shortcut to play/pause animation
          // causes system keys bind settings menu in KDE plasma 5 with wayland session with Electron newer then 31
          // workaround skip this register in plasma 5
          if (!isKDEPlasma5()) {
            globalShortcut.register('Control+P', () => {
              displays.forEach((display) => {
                toggleScreensaver(display, mainWindow[display.id]);
              });
            })
          } else {
            writeLog('Skip globalShortcut registation in the old KDE Plasma 5 to prevent gui issues')
          }

          // register esc button to stopScreensaver close button event - NO need in system-wide
          /*if (!isKDEPlasma5()) {
            globalShortcut.register('Escape', (event) => {
              writeLog("Esc button is pushed. Stopping screensaver at all displays.");
              displays.forEach((display) => {
                stopScreensaver(display, mainWindow[display.id], this);
              });
            })
          } else {
            writeLog('Skip globalShortcut registation in the old KDE Plasma 5 to prevent gui issues')
          }*/
          

          if (displays.length > 1) {
            // streched window over each available monitor
            if (store.get('stretched_mode')) {
              // force randomize_datetime_pos true and disable
              contextMenu.getMenuItemById(`randomize_datetime_pos`).enabled = false;
              store.set('randomize_datetime_pos', true);
              contextMenu.getMenuItemById(`randomize_datetime_pos`).checked = true;
              appIcon.setContextMenu(contextMenu)


              //writeLog('Streched screensaver mode');
              let minX = 0, minY = 0, maxX = 0, maxY = 0
              let src_bounds = [];

              displays.forEach((display) => {

                const { x, y, width, height } = display.bounds
                src_bounds.push(display.bounds)
                if (x < minX) minX = x
                if (y < minY) minY = y
                if ((x + width) > maxX) maxX = x + width
                if ((y + height) > maxY) maxY = y + height
              })

              const fullVirtualBounds = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              }
              displays = [
                {
                  id: 'stretched',
                  bounds: fullVirtualBounds,
                  src_bounds: src_bounds
                }
              ]
            }
          } else {
            // disable stretched_mode in menu
            contextMenu.getMenuItemById(`stretched_mode`).enabled = false;
            store.set('stretched_mode', false);
            contextMenu.getMenuItemById(`stretched_mode`).visible = false;
            appIcon.setContextMenu(contextMenu)
          }

          let media_detector = false;

          // independent fullscreen window on each available monitor
          displays.forEach((display) => {
              writeLog(`Display to use: ${display.label||'NONAME'} (id ${display.id})`);
              let { x, y, width, height } = display.bounds;

              // Create the browser window.
              mainWindow[display.id] = new BrowserWindow({
                  fullscreen: false,
                  focusable: false, // false prevents cursor from hiding - need to changed it after window creation
                  roundedCorners: false, // for macos
                  frame: false,
                  icon: icon,
                  show: false,
                  skipTaskbar: true,
                  enableLargerThanScreen: false,
                  disableAutoHideCursor: false,
                  webPreferences: {
                      nodeIntegration: true,
                      contextIsolation: false,
                  }
              });

              // to override everything
              mainWindow[display.id].setAlwaysOnTop(true, 'screen-saver', 1);

              // Windows DWM sometimes resets bounds on first render. Re-apply after ready-to-show.
              mainWindow[display.id].setBounds({
                x: x,
                y: y,
                width: (isLinux) ? width + 2 : width, // +2 to compensate focusable in linux
                height: (isLinux) ? height + 2 : height, // +2 to compensate focusable in linux
              });

              // and load the index.html of the app.
              mainWindow[display.id].loadFile('index.html');

              optionsArray[display.id] = {
                engine: store.get('engine'),
                endless: store.get('endless'),
                opacity: store.get('opacity'),
                glow: store.get('glow'),
                minLength: store.get('minLength'),
                maxLength: store.get('maxLength'),
                minWidth: store.get('minWidth'),
                maxWidth: store.get('maxWidth'),
                minCurl: store.get('minCurl'),
                maxCurl: store.get('maxCurl'),
                minTwist: store.get('minTwist'),
                maxTwist: store.get('maxTwist'),
                curlAmplitude: store.get('curlAmplitude'),
                backgroundMode: store.get('backgroundMode') == 'auto' ? system_theme : store.get('backgroundMode'),
                ribbonCount: store.get('ribbonCount'),
                colorCycleSpeed: store.get('colorCycleSpeed'),
                horizontalSpeed: store.get('horizontalSpeed'),
                singleColor: store.get('singleColor'),
                theme: store.get('theme') == 'auto' ? system_theme : store.get('theme'),
                locale: store.get('locale'),
                datetime_front: store.get('datetime_front'),
                show_datetime: store.get('show_datetime'),
                randomize_datetime_pos: store.get('randomize_datetime_pos'),
                display_bounds: display.bounds,
                src_bounds: display.src_bounds
              }

              // Hide the menu
              mainWindow[display.id].setMenu(null);

              //mainWindow[display.id].webContents.toggleDevTools();

              // media_detector MUST be here to support ALL platforms media caption!
              if (!media_detector) {
                if (store.get('media_detect') === true) {
                  // run media detect in each window
                  writeLog(`Trying to start media-detection`);
                  
                  // Check if native module loaded successfully
                  if (!isAvailable()) {
                    writeLog('Native audio capture is not available on this platform');
                  }
                  
                  //mainWindow[display.id].webContents.send('start-detection', store.get('idle_time'));
                  startSystemAudioDetection(store.get('idle_time'));
                } else {
                  writeLog('System audio detection is off');
                }
              }

              media_detector = true;

              // Handle settings

              /*ipcMain.on('ribbons-settings-ready', (e) => {
                e.sender.send('ribbons-settings-load', optionsArray[display.id])
              })

              ipcMain.on('ribbons-settings-save', (_e, data) => {
                writeLog(data, true)
                //store.set(data)
                //ribbonsSettings = data
                // persist + при необходимости перезапустить screensaver с send-options
              })

              ipcMain.on('debug', (event, ...args) => {
                writeLog(...args, true);
              });*/


              setInterval(function () {
                // dont run screensaver if system is suspended or screen is locked
                if (isLocked_suspend) {
                  // force stop screensaver if system locked or suspunded during running screensaver
                  if (running_screensaver[display.id]) {
                    writeLog("Running screensaver detected. Stopping it at all displays.");
                    displays.forEach((display) => {
                      stopScreensaver(display, mainWindow[display.id], this);
                    });
                  }
                  return;
                }

                // to allow some time before idle_time update - prevents wrong start screensaver right after fullscreen app
                setTimeout (()=>{
                  idle_time = Math.round(desktopIdle.getIdleTime());
                
                  if (idle_time > store.get('idle_time') && !sound_detected) {
                    (async () => {
                      try {
                        if (!isLinux) {
                          curWindow[display.id] = await activeWindow({
                            accessibilityPermission: false,
                            screenRecordingPermission: false
                          });
                        } else {
                          //writeLog("Get active window state using xprop.");
                          curWindow[display.id] = await getLinuxActiveWindow(writeLog, activeWindow);
                        }
                      }
                      catch(error) {
                        writeLog(error)
                      }

                      var macNoActiveWin = false;

                      if (!curWindow[display.id]) {
                        if (isMac) {
                          macNoActiveWin = true;
                        } else {
                          if (isLinux) {
                              // to fix fresh booted linux cinnamon DE without opened windows to run screensaver
                              if (!process.env.XDG_CURRENT_DESKTOP?.toLowerCase().includes('cinnamon')) {
                                writeLog('Cannot get active window. Screensaver will not run.');
                                return;
                              } else {
                                macNoActiveWin = true;
                              };
                          }
                        }

                      }
                        
                      

                      if (store.get('fullscreen_detect')) {
                        macNoActiveWin = false;
                      } else {
                        macNoActiveWin = true;
                      }


                      if (!macNoActiveWin) {

                        const bounds = !isLinux ? curWindow[display.id]?.bounds : null;

                        // on mac some fullscreen apps height is not fetched so skip it 
                        if (isWindows) {
                          isFullscreen[display.id] =
                            bounds.x === x &&
                            bounds.y === y &&
                            bounds.width === width &&
                            bounds.height === height;
                        } else if (isMac) {
                          isFullscreen[display.id] =
                            bounds.x === x &&
                            bounds.y === y &&
                            bounds.width === width;
                        } else {
                          // if linux run screensavers at all display without exclude active fullscreen app (we have no info about bounds from xprop)
                          isFullscreen[display.id] = curWindow[display.id].fullscreen;
                        }

                        //writeLog("Display: "+display.label+" Active app is fullscreen: "+isFullscreen[display.id] + " Running screensaver: "+running_screensaver[display.id])
                        if (paused[display.id]) {
                          return;
                        }
                        //writeLog(paused[display.id]);
                        if (!isFullscreen[display.id] || (isDesktopWindow(curWindow[display.id]))) {
                          //writeLog('Current active window is not fullscreen or desktop. Running screensaver.');
                          startScreensaver(mainWindow, display);
                        }
                      } else {
                        //writeLog('There is no active windows but it is Mac. Running screensaver.');
                        startScreensaver(mainWindow, display);
                      }
                    })();
                  }
                }, 100);
            }, 1000);

          })

          //customize about
          app.setAboutPanelOptions({
              applicationName: i18n.__('app_name'),
              applicationVersion: "v."+app.getVersion(),
              authors: ["<a href='https://github.com/drlight17'>drlight17</a>"],
              version: app.getVersion(),
              copyright: "Lisense AGPLv3 ©2026",
              iconPath: iconPath,
              website: "https://ribbons.drlight.fun/"
          });

          const clickResponse = (event) => {
            writeLog("Close button is clicked. Stopping screensaver at all displays.");
            displays.forEach((display) => {
              stopScreensaver(display, mainWindow[display.id], this);
            });
            // restart app to detect new hid include the virtual
            //restartApp();
          };

          ipcMain.on('close-button-clicked', clickResponse);
      });
    }
    catch (err) {
        writeLog(err);
        fs.unlinkSync(app.getPath('userData')+"/config.json")
        restartApp();
    }
}