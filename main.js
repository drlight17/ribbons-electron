import { app, powerMonitor, clipboard, BrowserWindow, Menu, MenuItem, Tray, nativeImage, ipcMain, screen, nativeTheme, dialog } from 'electron';
import * as path from 'path';
import { fileURLToPath } from "url";
import { exec } from 'child_process';
import { execFile } from 'child_process';
import * as DBus from 'dbus-next';
import console from 'console';

app.console = new console.Console(process.stdout, process.stderr);

const packageJsonPath = path.join(app.getAppPath(), 'package.json');
// __dirname new electron fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
import Store from 'electron-store';
const system_theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
import fs from "fs";
//import { join } from 'path';
import SystemIdleTime from 'desktop-idle';

//import {activeWindow} from 'get-windows';
import { activeWindow } from "@deepfocus/get-windows";
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

const appNameLC = packageJson.name;

let optionsArray = [];

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
// **************** functions block *********************************

// stop screensaver func
function stopScreensaver(displays, win, checkid) {
  displays.forEach((display) => {
    if (mainWindow[display.id].isVisible()) {
      win.setFullScreen(false);
      //win.setFullScreenable(true);
      win.webContents.send('send-stop',true);
      win.hide();
      running_screensaver = {};
    }
  });
  clearInterval(checkid);
}

function restartApp() {
  let options = [];
  
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

// linux lock events listener
async function listenForScreenLockEvents() {
  const bus = DBus.sessionBus();
  const obj = await bus.getProxyObject('org.freedesktop.ScreenSaver', '/org/freedesktop/ScreenSaver');
  const screenSaver = obj.getInterface('org.freedesktop.ScreenSaver');

  screenSaver.on('ActiveChanged', (isActive) => {
    if (isActive) {
      isLocked_suspend = true;
      console.log(new Date().toLocaleString()+' The screen is locked');
    } else {
      isLocked_suspend = false;
      console.log(new Date().toLocaleString()+' The screen is unlocked');
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
      console.log(new Date().toLocaleString()+' The system is suspended');
    } else {
      isLocked_suspend = false;
      console.log(new Date().toLocaleString()+' The system is released');
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

// check Xwininfo installed (linux)
function checkXwininfoInstalled() {
  return new Promise((resolve, reject) => {
    exec('which xwininfo', (error, stdout, stderr) => {
      if (error) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function appendLanguages(contextMenu,lang_files) {
  //console.log(typeof(lang_files));
  let langSubmenu = [];
  lang_files.forEach((lang) => {
    langSubmenu.push(new MenuItem({
          id: lang,
          label: i18n.__(lang),
          type: 'checkbox',
          checked: ((store.get('locale') === lang) || (!store.get('locale'))) ? true : false,
          click: () => {
            store.set('locale',lang);
            restartApp();
          },
      }))
  })

  //console.log(contextMenu.getMenuItemById("to_add_lang"));
  contextMenu.insert(contextMenu.items.findIndex(item => item.id === "to_add_lang")+1,new MenuItem({
        id: "lang",
        label: i18n.__('lang'),
        submenu: langSubmenu,
    }));
  //console.log(contextMenu)

}

function setRunAtStartup (flag, store) {
    //store.set('run_at_startup',flag);
    if (flag) {
      if (isWindows) {
        app.setLoginItemSettings({
            openAtLogin: true,
            //path: app.getPath('exe'),
            //name: app.getName() + " v."+app.getVersion() // to fix version in registry autorun
            name: app.getName()
        })
      }
      if (isLinux) {
        let executable = appNameLC;
        let Path = '';
        if (process.env.APPIMAGE) {
          Path = process.env.APPIMAGE.replace(/\/[^\/]*$/, '/');
          executable = `"`+process.env.APPIMAGE+`"`;
        } else {
          Path = app.getPath('exe').replace(/\/[^\/]*$/, '/');
          executable = `"`+app.getPath('exe')+`"`;
        }
        const isKDE = process.env.KDE_SESSION_VERSION !== undefined;
        if (isKDE) {
          executable = `'sleep 10 && ` + executable + `'`;
        }
        let shortcut_contents = `[Desktop Entry]
Categories=Multimedia
Comment=Windows like ribbons screensaver app
Exec=bash -c `+executable+`
Path=`+Path+`
Name=Ribbons screensaver
StartupWMClass=Ribbons screensaver
Terminal=false
Type=Application
Icon=`+appNameLC+`
X-GNOME-Autostart-Delay=10`;
        if (!fs.existsSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")) {
          fs.writeFileSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop",shortcut_contents, 'utf-8');
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
      }
      if (isLinux) {
        if (fs.existsSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")) {
          fs.unlinkSync(app.getPath('home')+"/.config/autostart/"+appNameLC+".desktop")
        }
      }
      if (isMac) {
        if (fs.existsSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist")) {
          fs.unlinkSync(app.getPath('home')+"/Library/LaunchAgents/com.electron."+appNameLC+".plist");
          //exec('launchctl bootstrap disable com.electron.'+appNameLC);
          exec('launchctl bootstrap disable gui/"$(id -u)"/com.electron.'+appNameLC);

        }
      }
    }
}
function getResourceDirectory () {
  //return process.env.NODE_ENV === "development"
  if (!app.isPackaged) {
    console.log(new Date().toLocaleString()+' App is in dev mode');
    let current_app_dir = app.getPath('userData')
    // don't delete if already not empty userData folder from prod app
    if (fs.readdirSync(current_app_dir).length === 0) {
      fs.rmSync(current_app_dir, { recursive: true, force: true });
    }
    app.setPath ('userData', current_app_dir+"-dev");
    return path.join(process.cwd())
  } else {
    console.log(new Date().toLocaleString()+' App is in production mode');
    return path.join(process.resourcesPath, "app.asar.unpacked");
  }
};

// **************** functions block end *********************************



if (!isMac) {
  var iconPath = path.resolve(getResourceDirectory(), "icon.png");
  store = new Store();
} else {
  getResourceDirectory();
  store = new Store();
  var iconPath = path.join(__dirname,store.get('app_icon_name')||'iconTemplate.png');
  

}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    console.log(new Date().toLocaleString()+" Found already running screensaver. Exiting!");
    app.exit(0);
} else {
    app.on('second-instance', (event) => {
      
      if (isMac) {
        app.exit(0);
      } else {

        dialog.showErrorBox(i18n.__('error'), i18n.__('error1'));
      }
      //exec('launchctl stop com.electron.'+appNameLC+'&& sleep 5 && launchctl start com.electron.'+appNameLC);
      //if (mainWindow) {
      //  if (win.isMinimized()) win.restore();
        //mainWindow.show();
        //mainWindow.focus();
      //}
    })
    try {
      
        // temporary turn off console.log errors in case of app.exit(0) in AppImage
        process.stdout.on('error', (err) => {
          if (err.code === 'EPIPE') {
          } else {
            throw err;
          }
        });

        var i18n = new(require('./translations/i18n.cjs'));

        var lang_files = i18n.___("get_locales");

        // check if theme is configured and set default auto value if not
        if (!store.get('theme')) {
          store.set('theme', 'auto');
        }

        // check if hw_acc is configured and set default true value if not
        if (store.get('hw_acc') === undefined) {
          store.set('hw_acc', true);
        }

        // check if colorCycleSpeed is configured and set default 3 value if not
        if (!store.get('color_cycle_speed')) {
          store.set('color_cycle_speed', 3);
        }

        // check if horizontalSpeed is configured and set default 400 value if not
        if (!store.get('horizontal_speed')) {
          store.set('horizontal_speed', "normal");
        }

        // check if max_visible_ribbons is configured and set default 3 value if not
        if (!store.get('max_visible_ribbons')) {
          store.set('max_visible_ribbons', 3);
        }

        // check if idle_time is configured and set default 60 value if not
        if (!store.get('idle_time')) {
          store.set('idle_time', 60);
        }

        // check if run_at_startup is configured and set default false value if not
        if (!store.get('run_at_startup')) {
          setRunAtStartup (false, store);
        } else {
          setRunAtStartup (true, store);
        }
        
        let icon = nativeImage.createFromPath(iconPath); // template with center transparency
        var trayIcon = icon
        if (isMac) {
          //var icon_bw = await bw_icon_process(icon);
          // as this icon is for macos tray only resize it here
          trayIcon = trayIcon.resize({width:16});
        }

        
        //setRunAtStartup(store.get('run_at_startup'));

        var appIcon = null;

        let appIconMenuTemplate = [

            {
              label: i18n.__('show_now'),
              click: () => {
                displays.forEach((display) => {
                  if (!mainWindow[display.id].isVisible()) {
                    app.console.log(new Date().toLocaleString()+" Start screensaver at display "+display.label);
                    //run_screensaver();
                    mainWindow[display.id].setFullScreen(true);
                    //mainWindow[display.id].setFullScreenable(false);
                    mainWindow[display.id].webContents.send('send-options',optionsArray);
                    mainWindow[display.id].show();
                    // delay activity tracking, otherwise we'll close immediately
                    setTimeout( function() {
                      setInterval(function () {
                        if (Math.round(SystemIdleTime.getIdleTime())<1) {
                          console.log(new Date().toLocaleString()+" User activity, stop screensaver at display "+display.label);
                          stopScreensaver(displays, mainWindow[display.id], this)
                        }
                      }, 500);
                    }, 1000);
                  }
                })
              },
            },
            { type: 'separator' },
            {
              label: i18n.__('visuals'),
              submenu: [
                {
                  label: i18n.__('theme'),
                  submenu: [
                    {
                      label: i18n.__('auto'),
                      type: 'checkbox',
                      checked: ((store.get('theme') === 'auto') || (!store.get('theme'))) ? true : false,
                      click: () => {
                        store.set('theme','auto');
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('light'),
                      type: 'checkbox',
                      checked: store.get('theme') === 'light' ? true : false,
                      click: () => {
                        store.set('theme','light');
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('dark'),
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
                  label: i18n.__('rib_color'),
                  submenu: [
                    {
                      label: i18n.__('rndm_col'),
                      type: 'checkbox',
                      checked: ((store.get('single_color') === false) || (!store.get('single_color')))  ? true : false,
                      click: () => {
                        store.set('single_color',false);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('tricolor'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 667  ? true : false,
                      click: () => {
                        store.set('single_color',667);
                        restartApp();
                      }
                    },
                    { type: 'separator' },
                    {
                      label: i18n.__('grey'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 666 ? true : false,
                      click: () => {
                        store.set('single_color',666);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('red'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 360 ? true : false,
                      click: () => {
                        store.set('single_color',360);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('yellow'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 60 ? true : false,
                      click: () => {
                        store.set('single_color',60);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('green'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 120 ? true : false,
                      click: () => {
                        store.set('single_color',120);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('cyan'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 180 ? true : false,
                      click: () => {
                        store.set('single_color',180);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('blue'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 240 ? true : false,
                      click: () => {
                        store.set('single_color',240);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('magenta'),
                      type: 'checkbox',
                      checked: store.get('single_color') === 300 ? true : false,
                      click: () => {
                        store.set('single_color',300);
                        restartApp();
                      }
                    },
                    { type: 'separator' },
                    {
                      label: i18n.__('custom'),
                      type: 'checkbox',
                      enabled: false,
                      checked: ((store.get('single_color') !== false) && (store.get('single_color') !== 0)  && (store.get('single_color') !== 60) && (store.get('single_color') !== 120)  && (store.get('single_color') !== 180)  && (store.get('single_color') !== 240)  && (store.get('single_color') !== 300) && (store.get('single_color') !== 666)  && (store.get('single_color')) && (store.get('single_color') !== 667))  ? true : false,
                      click: (event) => {
                        event.preventDefault();
                      }
                    },
                  ]
                },
                {
                  label: i18n.__('max_vis_rib'),
                  enabled: (store.get('single_color') !== 667)  ? true : false,
                  submenu: [
                    {
                      label: '1',
                      type: 'checkbox',
                      checked: store.get('max_visible_ribbons') === 1 ? true : false,
                      click: () => {
                        store.set('max_visible_ribbons',1);
                        restartApp();
                      }
                    },
                    {
                      label: '2',
                      type: 'checkbox',
                      checked: store.get('max_visible_ribbons') === 2 ? true : false,
                      click: () => {
                        store.set('max_visible_ribbons',2);
                       restartApp();
                      }
                    },
                    {
                      label: '3'+ i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('max_visible_ribbons') === 3 ? true : false,
                      click: () => {
                        store.set('max_visible_ribbons',3);
                        restartApp();
                      }
                    },
                    {
                      label: '4',
                      type: 'checkbox',
                      checked: store.get('max_visible_ribbons') === 4 ? true : false,
                      click: () => {
                        store.set('max_visible_ribbons',4);
                        restartApp();
                      }
                    },
                    {
                      label: '5',
                      type: 'checkbox',
                      checked: store.get('max_visible_ribbons') === 5 ? true : false,
                      click: () => {
                        store.set('max_visible_ribbons',5);
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: i18n.__('rib_col_cyc_speed'),
                  enabled: ((store.get('single_color') === false) || (!store.get('single_color')))  ? true : false,
                  submenu: [
                    {
                      label: i18n.__('slow'),
                      type: 'checkbox',
                      checked: store.get('color_cycle_speed') === 1 ? true : false,
                      click: () => {
                        store.set('color_cycle_speed',1);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('normal')+i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('color_cycle_speed') === 3 ? true : false,
                      click: () => {
                        store.set('color_cycle_speed',3);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('fast'),
                      type: 'checkbox',
                      checked: store.get('color_cycle_speed') === 10 ? true : false,
                      click: () => {
                        store.set('color_cycle_speed',10);
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('v_fast'),
                      type: 'checkbox',
                      checked: store.get('color_cycle_speed') === 20 ? true : false,
                      click: () => {
                        store.set('color_cycle_speed',20);
                        restartApp();
                      }
                    },
                  ]
                },
                {
                  label: i18n.__('horizontal_speed'),
                  submenu: [
                    {
                      label: i18n.__('slow'),
                      type: 'checkbox',
                      checked: store.get('horizontal_speed') == "slow" ? true : false,
                      click: () => {
                        store.set('horizontal_speed',"slow");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('normal')+i18n.__('default'),
                      type: 'checkbox',
                      checked: store.get('horizontal_speed') == "normal" ? true : false,
                      click: () => {
                        store.set('horizontal_speed',"normal");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('fast'),
                      type: 'checkbox',
                      checked: store.get('horizontal_speed') == "fast" ? true : false,
                      click: () => {
                        store.set('horizontal_speed',"fast");
                        restartApp();
                      }
                    },
                    {
                      label: i18n.__('v_fast'),
                      type: 'checkbox',
                      checked: store.get('horizontal_speed') == "v_fast" ? true : false,
                      click: () => {
                        store.set('horizontal_speed',"v_fast");
                        restartApp();
                      }
                    },
                  ]
                }
              ]
            },
            {
              label: i18n.__('max_idle'),
              submenu: [
                /*{
                  label: '5 sec dev',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 5 ? true : false,
                  click: () => {
                    store.set('idle_time',5);
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
            { type: 'separator', id: 'to_add_lang' },
            {
              // set hw acceleration
              label: i18n.__('hw_acc'),
              type: 'checkbox',
              checked: store.get('hw_acc'),
              //enabled: (app.isPackaged)  ? true : false,
              click: (option) => {
                  store.set('hw_acc', option.checked);
                  restartApp();
              },
            },
            {
              // set run at startup
              label: i18n.__('run_at_startup'),
              type: 'checkbox',
              checked: store.get('run_at_startup'),
              enabled: (app.isPackaged)  ? true : false,
              click: (option) => {
                  store.set('run_at_startup', option.checked);
                  setRunAtStartup (option.checked, store);
                  // to fix cinnamon nemo desktop checked bug 
                  //if (!isMac) {
                    restartApp();
                  //} 

              },
            },
            {
              label : i18n.__('about'),
              // for linux compatibility
              click: () => {
                app.showAboutPanel();
              }
            },
            { type: 'separator' },
            {
              label: i18n.__('exit'),
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
        
        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        app.on('ready', function() {
          // to detect lock screen and suspend (win, mac)
          if (!isLinux) {
            powerMonitor.on('lock-screen', () => {
              isLocked_suspend = true;
              console.log(new Date().toLocaleString()+' The screen is locked');
              // Add your custom logic here
            });
            powerMonitor.on('unlock-screen', () => {
              isLocked_suspend = false;
              console.log(new Date().toLocaleString()+' The screen is unlocked');
              // Add your custom logic here
            });
            powerMonitor.on('suspend', () => {
              isLocked_suspend = true;
              console.log(new Date().toLocaleString()+' The system is suspended');
              // Add your custom logic here
            });
            powerMonitor.on('resume', () => {
              isLocked_suspend = false;
              console.log(new Date().toLocaleString()+' The system is released');
              // Add your custom logic here
            });
          } else {
            // to detect lock screen and suspend (linux)
            listenForScreenLockEvents().catch(console.error);
            listenForSuspendEvents().catch(console.error);
            checkXwininfoInstalled().then((installed) => {
              // check xwininfo
              if (!installed) {
                dialog.showErrorBox(i18n.__('error'), i18n.__('error2'));
                app.exit(0);
              }
            });
          }
          //force hide dockicon on mac
            if (isMac) app.dock.hide();
            // dont start tray icon in windows
            //if (!isWindows || config) {
              //trayIcon = icon;
              appIcon = new Tray(trayIcon)
              var contextMenu = Menu.buildFromTemplate(appIconMenuTemplate)
              appendLanguages(contextMenu,lang_files);
              appIcon.setToolTip(app.getName() + " v."+app.getVersion());
              appIcon.setContextMenu(contextMenu)

              appIcon.on('click', (event) => {
                /*if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                  mainWindow.hide()
                  //win_loading.hide();
                } else {
                  mainWindow.show()
                }*/
                displays.forEach((display) => {
                  if (!mainWindow[display.id].isVisible()) { 
                    console.log(new Date().toLocaleString()+" Start screensaver at display "+display.label);
                    //run_screensaver();
                    mainWindow[display.id].setFullScreen(true);
                    //mainWindow[display.id].setFullScreenable(false);
                    mainWindow[display.id].webContents.send('send-options',optionsArray);
                    mainWindow[display.id].show();
                    // delay activity tracking, otherwise we'll close immediately
                    setTimeout( function() {
                      setInterval(function () {
                        if (Math.round(SystemIdleTime.getIdleTime())<1) {
                          console.log(new Date().toLocaleString()+" User activity, stop screensaver at display "+display.label);
                          stopScreensaver(displays, mainWindow[display.id], this)
                        }
                      }, 500);
                    }, 1000);
                  }
                })

              })

              appIcon.on('context', (event) => {
                  appIcon.popUpContextMenu(); // TODO KDE linux doesnt support this =((
              })
            //}
            // init graphics =)
            displays = screen.getAllDisplays();
            screen.on('display-removed', (event, display) => {
              console.log(new Date().toLocaleString()+" Display "+display.name+" with id "+display.id+" was removed. Restart app...")
              restartApp();
            });
            screen.on('display-added', (event, display) => {
              console.log(new Date().toLocaleString()+" Display "+display.name+" with id "+display.id+" was added. Restart app...")
              restartApp();
            });
            // independent fullscreen window on each available monitor
            displays.forEach((display) => {
                const { x, y, width, height } = display.bounds;

                // Create the browser window.
                mainWindow[display.id] = new BrowserWindow({
                    //x: (isLinux) ? x-1 : x, // -1 to compensate focusable in linux
                    x: x,
                    //y: (isLinux) ? y-1 : y, // -1 to compensate focusable in linux
                    y: y,
                    width: (isLinux) ? width + 2 : width, // +2 to compensate focusable in linux
                    //width: width,
                    height: (isLinux) ? height + 2 : height, // +2 to compensate focusable in linux
                    //height: height,
                    fullscreen: false,
                    focusable: false,
                    roundedCorners: false, // for macos
                    frame: false,
                    icon: icon,
                    show: false,
                    skipTaskbar: true,
                    enableLargerThanScreen: true,
                    disableAutoHideCursor: false,
                    webPreferences: {
                        nodeIntegration: true,
                        contextIsolation: false,
                        //enableRemoteModule: false, // turn off remote
                    }
                });

                // to override everything
                mainWindow[display.id].setAlwaysOnTop(true, 'screen-saver', 1);
                //mainWindow[display.id].setResizable(false);

                // and load the index.html of the app.
                mainWindow[display.id].loadFile('index.html');

                optionsArray["ribbonCount"] = store.get('max_visible_ribbons');
                optionsArray["colorCycleSpeed"] = store.get('color_cycle_speed');
                optionsArray["horizontalSpeed"] = store.get('horizontal_speed');
                optionsArray["singleColor"] = store.get('single_color');
                optionsArray["theme"] = store.get('theme') == 'auto' ? system_theme : store.get('theme');

                // Hide the menu
                mainWindow[display.id].setMenu(null);

                //mainWindow[display.id].webContents.toggleDevTools();

                // Prevent window from closing and quitting app
                // Instead make close simply hide main window
                // Clicking on tray icon will bring back main window
                 /*mainWindow[display.id].on('close', event => {
                    event.preventDefault();
                    mainWindow[display.id].hide();
                    mainWindow[display.id].setFullScreen(false);
                })*/
             })

            //customize about
            //console.log(iconPath)
            app.setAboutPanelOptions({
                //applicationName: app.getName(),
                applicationName: i18n.__('app_name'),
                applicationVersion: "v."+app.getVersion(),
                authors: ["<a href='https://github.com/drlight17'>drlight17</a>"],
                version: app.getVersion(),
                copyright: "Lisense AGPLv3 ©2024",
                iconPath: iconPath,
                //iconPath: path.resolve(getResourceDirectory(), "icon.png"),
                website: "https://drlight17.github.io/"+appNameLC+"-page"
            });

            // dont use desktop-idle in windows
            //if (!isWindows) {
              displays.forEach((display) => {
                const { x, y, width, height } = display.bounds;
                let activity_check_interval = 1;
                let curWindow = [];
                var isFullscreen = [];


                setInterval(function () {
                    // dont run screensaver if system is suspended or screen is locked
                    if (isLocked_suspend) {
                      // force stop screensaver if system locked or suspunded during running screensaver
                      if (running_screensaver[display.id]) {
                        console.log(new Date().toLocaleString()+" Running screensaver detected. Stopping it.")
                        stopScreensaver(displays, mainWindow[display.id], this);
                      }
                      return;
                    }
                    /*let time_left = store.get('idle_time')-Math.round(SystemIdleTime.getIdleTime());
                    if (time_left >0) {
                      console.log('Time before screensaver run: ' + time_left + 's')
                    }*/
                  
                    if (Math.round(SystemIdleTime.getIdleTime()) >= store.get('idle_time')) {
                      (async () => {
                        try {
                          curWindow[display.id] = await activeWindow({
                            accessibilityPermission: false,
                            screenRecordingPermission: false
                          });
                        }
                        catch(error) {
                          console.log(new Date().toLocaleString()+error)
                        }
                        var macNoActiveWin = false;

                        if (!curWindow[display.id]) {
                          if (isMac) {
                            macNoActiveWin = true;
                          } else {
                          console.log(new Date().toLocaleString()+' Cannot get active window. Screensaver will not run.');
                          return;
                          }
                        }

                        if (!macNoActiveWin) {
                          const { bounds } = curWindow[display.id];
                          
                          // on mac some fullscreen apps height is not fetched so skip it 
                          if (!isMac) {
                            isFullscreen[display.id] =
                              bounds.x === x &&
                              bounds.y === y &&
                              bounds.width === width &&
                              bounds.height === height;
                          } else {
                            isFullscreen[display.id] =
                              bounds.x === x &&
                              bounds.y === y &&
                              bounds.width === width;
                          }
                          /*console.log("Display: "+display.id+" Active app is fullscreen: "+isFullscreen[display.id] + 
                            " Running screensaver: "+running_screensaver[display.id])*/

                          if ((!running_screensaver[display.id])&&(!isFullscreen[display.id] || (isDesktopWindow(curWindow[display.id])))) {
                            //console.log('Current active window is not fullscreen or desktop. Running screensaver.');
                              if (!mainWindow[display.id].isVisible()) {
                                  console.log(new Date().toLocaleString()+" Start screensaver at display "+display.label);
                                  mainWindow[display.id].setFullScreen(true);
                                  //mainWindow[display.id].setFullScreenable(false);
                                  mainWindow[display.id].webContents.send('send-options',optionsArray);
                                  mainWindow[display.id].showInactive();
                                  running_screensaver[display.id] = true;
                                  setInterval(function () {
                                    if (Math.round(SystemIdleTime.getIdleTime())<1) {
                                      console.log(new Date().toLocaleString()+" User activity, stop screensaver at display "+display.label);
                                      stopScreensaver(displays, mainWindow[display.id], this)
                                    }
                                  }, 500)
                              }
                          }
                        } else {
                          //console.log('There is no active windows but it is Mac. Running screensaver.');
                            if (!mainWindow[display.id].isVisible()) {
                                console.log(new Date().toLocaleString()+" Start screensaver at display "+display.label);
                                mainWindow[display.id].setFullScreen(true);
                                //mainWindow[display.id].setFullScreenable(false);
                                mainWindow[display.id].webContents.send('send-options',optionsArray);
                                mainWindow[display.id].showInactive();
                                running_screensaver[display.id] = true;
                                setInterval(function () {
                                  if (Math.round(SystemIdleTime.getIdleTime())<1) {
                                    console.log(new Date().toLocaleString()+" User activity, stop screensaver at display "+display.label);
                                    stopScreensaver(displays, mainWindow[display.id], this)
                                  }
                                }, 500)
                            }
                        }
                      })();
                    }
                }, activity_check_interval*1000);

              });
            //}
            // run fullscreen graphics immediately in windows
            /*if (isWindows) {
              displays.forEach((display) => {
                if (!mainWindow[display.id].isVisible()) {
                  //if (!config) {
                    mainWindow[display.id].setFullScreen(true);
                    mainWindow[display.id].show();
                  //}
                }
              })
            }*/
        });

    }
    catch (err) {
        console.log(new Date().toLocaleString()+err)
        fs.unlinkSync(app.getPath('userData')+"/config.json")
        restartApp();
    }
}
