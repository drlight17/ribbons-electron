const { app, clipboard, BrowserWindow, Menu, Tray, nativeImage, ipcMain, screen, nativeTheme, dialog } = require('electron/main')
const path = require("path");

const getResourceDirectory = () => {
  //return process.env.NODE_ENV === "development"
  if (!app.isPackaged) {
    console.log('App is in dev mode');
    let current_app_dir = app.getPath('userData')
    //fs.rm(current_app_dir, { recursive: true, force: true });
    app.setPath ('userData', current_app_dir+"-dev");
    return path.join(process.cwd())
  } else {
    console.log('App is in production mode');
    return path.join(process.resourcesPath, "app.asar.unpacked");
  }
};
const iconPath = path.resolve(getResourceDirectory(), "icon.png");

const isMac = process.platform === 'darwin'
const isWindows = process.platform === 'win32'
const isLinux = process.platform === 'linux'
const Store = require('electron-store');
const system_theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
const fs = require("fs");
const { join } = require('path');
const SystemIdleTime = require('desktop-idle');
const gotTheLock = app.requestSingleInstanceLock();
const activeWin = require('active-win');


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
    'Desktop', // common
];

let mainWindow = [];
let displays = null;


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

if (!gotTheLock) {
    console.log("Found already running screensaver. Exiting!");
    app.exit(0);
} else {
    app.on('second-instance', (event) => {
      dialog.showErrorBox('Error ', 'Screensaver is already run! Check tray icon!');
      /*if (mainWindow) {
        if (win.isMinimized()) win.restore();
        mainWindow.show();
        mainWindow.focus();
        if (isMac) app.dock.show();
      }*/
    })
    try {

        const store = new Store();

        // check if theme is configured and set default auto value if not
        if (!store.get('theme')) {
          store.set('theme', 'auto');
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
        
        //let iconPath = path.join(__dirname,store.get('app_icon_name')||'iconTemplate.png');
        let icon = nativeImage.createFromPath(iconPath); // template with center transparency
        let trayIcon = icon

        
        //setRunAtStartup(store.get('run_at_startup'));

        var appIcon = null;

        let appIconMenuTemplate = [

            {
              label: 'Show now',
              click: () => {
                displays.forEach((display) => {
                  if (!mainWindow[display.id].isVisible()) { 
                    //run_screensaver();
                    mainWindow[display.id].setFullScreen(true);
                    mainWindow[display.id].show();
                  }
                })
              },
            },
            { type: 'separator' },
            {
              label: 'Theme',
              submenu: [
                {
                  label: 'Auto',
                  type: 'checkbox',
                  checked: ((store.get('theme') === 'auto') || (!store.get('theme'))) ? true : false,
                  click: () => {
                    store.set('theme','auto');
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Light',
                  type: 'checkbox',
                  checked: store.get('theme') === 'light' ? true : false,
                  click: () => {
                    store.set('theme','light');
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Dark',
                  type: 'checkbox',
                  checked: store.get('theme') === 'dark' ? true : false,
                  click: () => {
                    store.set('theme','dark');
                    app.relaunch();
                    app.exit(0);
                  }
                },
              ]
            },
            {
              label: 'Ribbons color',
              submenu: [
                {
                  label: 'Random',
                  type: 'checkbox',
                  checked: ((store.get('single_color') === false) || (!store.get('single_color')))  ? true : false,
                  click: () => {
                    store.set('single_color',false);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                { type: 'separator' },
                {
                  label: 'Grey',
                  type: 'checkbox',
                  checked: store.get('single_color') === 666 ? true : false,
                  click: () => {
                    store.set('single_color',666);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Red',
                  type: 'checkbox',
                  checked: store.get('single_color') === 360 ? true : false,
                  click: () => {
                    store.set('single_color',0);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Yellow',
                  type: 'checkbox',
                  checked: store.get('single_color') === 60 ? true : false,
                  click: () => {
                    store.set('single_color',60);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Green',
                  type: 'checkbox',
                  checked: store.get('single_color') === 120 ? true : false,
                  click: () => {
                    store.set('single_color',120);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Cyan',
                  type: 'checkbox',
                  checked: store.get('single_color') === 180 ? true : false,
                  click: () => {
                    store.set('single_color',180);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Blue',
                  type: 'checkbox',
                  checked: store.get('single_color') === 240 ? true : false,
                  click: () => {
                    store.set('single_color',240);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: 'Magenta',
                  type: 'checkbox',
                  checked: store.get('single_color') === 300 ? true : false,
                  click: () => {
                    store.set('single_color',300);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                { type: 'separator' },
                {
                  label: 'Custom',
                  type: 'checkbox',
                  enabled: false,
                  checked: ((store.get('single_color') !== false) && (store.get('single_color') !== 0)  && (store.get('single_color') !== 60) && (store.get('single_color') !== 120)  && (store.get('single_color') !== 180)  && (store.get('single_color') !== 240)  && (store.get('single_color') !== 300) && (store.get('single_color') !== 666)  && (store.get('single_color')))  ? true : false,
                  click: (event) => {
                    event.preventDefault();
                  }
                },
              ]
            },
            {
              label: 'Max visible ribbons',
              submenu: [
                {
                  label: '1',
                  type: 'checkbox',
                  checked: store.get('max_visible_ribbons') === 1 ? true : false,
                  click: () => {
                    store.set('max_visible_ribbons',1);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '2',
                  type: 'checkbox',
                  checked: store.get('max_visible_ribbons') === 2 ? true : false,
                  click: () => {
                    store.set('max_visible_ribbons',2);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '3',
                  type: 'checkbox',
                  checked: store.get('max_visible_ribbons') === 3 ? true : false,
                  click: () => {
                    store.set('max_visible_ribbons',3);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '4',
                  type: 'checkbox',
                  checked: store.get('max_visible_ribbons') === 4 ? true : false,
                  click: () => {
                    store.set('max_visible_ribbons',4);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '5',
                  type: 'checkbox',
                  checked: store.get('max_visible_ribbons') === 5 ? true : false,
                  click: () => {
                    store.set('max_visible_ribbons',5);
                    app.relaunch();
                    app.exit(0);
                  }
                },
              ]
            },
            {
              label: 'Max idle time',
              submenu: [
                /*{
                  label: '5 sec dev',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 5 ? true : false,
                  click: () => {
                    store.set('idle_time',5);
                    app.relaunch();
                    app.exit(0);
                  }
                },*/
                {
                  label: '30 sec',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 30 ? true : false,
                  click: () => {
                    store.set('idle_time',30);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '1 min',
                  type: 'checkbox',
                  checked: ((store.get('idle_time') === 60) || (!store.get('idle_time'))) ? true : false,
                  click: () => {
                    store.set('idle_time',60);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '5 min',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 5*60 ? true : false,
                  click: () => {
                    store.set('idle_time',5*60);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '15 min',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 15*60 ? true : false,
                  click: () => {
                    store.set('idle_time',15*60);
                    app.relaunch();
                    app.exit(0);
                  }
                },
                {
                  label: '30 min',
                  type: 'checkbox',
                  checked: store.get('idle_time') === 30*60 ? true : false,
                  click: () => {
                    store.set('idle_time',30*60);
                    app.relaunch();
                    app.exit(0);
                  }
                },
              ]
            },
            { type: 'separator' },
            {
              // set run at startup
              label: 'Run app at startup',
              type: 'checkbox',
              checked: store.get('run_at_startup'),
              click: (option) => {
                  store.set('run_at_startup', option.checked);
                  setRunAtStartup (option.checked, store);

              },
            },
            {
              label : 'About',
              // for linux compatibility
              click: () => {
                app.showAboutPanel();
              }
            },
            { type: 'separator' },
            {
              label: 'Exit',
              click: () => {
                app.exit(0);
              },
            }
        ];


        // This method will be called when Electron has finished
        // initialization and is ready to create browser windows.
        app.on('ready', function() {
            // dont start tray icon in windows
            //if (!isWindows || config) {
              trayIcon = icon;
              appIcon = new Tray(trayIcon)
              const contextMenu = Menu.buildFromTemplate(appIconMenuTemplate)
              appIcon.setToolTip(app.getName() + " v."+app.getVersion());
              appIcon.setContextMenu(contextMenu)

              

              /*appIcon.on('click', (event) => {
                if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
                  mainWindow.hide()
                  //win_loading.hide();
                } else {
                  mainWindow.show()
                }

              })*/
              appIcon.on('context', (event) => {
                  appIcon.popUpContextMenu(); // TODO KDE linux doesnt support this =((
              })
            //}
            // init graphics =)
            displays = screen.getAllDisplays();
            // independent fullscreen window on each available monitor
            displays.forEach((display) => {
                const { x, y, width, height } = display.bounds;

                // Create the browser window.
                mainWindow[display.id] = new BrowserWindow({
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                    fullscreen: false,
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

                // and load the index.html of the app.
                mainWindow[display.id].loadFile('index.html');

                // send options to all windows
                mainWindow[display.id].webContents.once('did-finish-load', () => {
                  let optionsArray = [];
                  optionsArray["ribbonCount"] = store.get('max_visible_ribbons');
                  optionsArray["singleColor"] = store.get('single_color');
                  optionsArray["theme"] = store.get('theme') == 'auto' ? system_theme : store.get('theme');
                  mainWindow[display.id].webContents.send('send-options',optionsArray);
                });

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
                applicationName: app.getName(),
                applicationVersion: "v."+app.getVersion(),
                authors: ["drlight17"],
                version: app.getVersion(),
                copyright: "Lisense AGPLv3 ©2024",
                iconPath: iconPath,
                //iconPath: path.resolve(getResourceDirectory(), "icon.png"),
                website: "https://github.com/drlight17/ribbons-electron"
            });

            // dont use desktop-idle in windows
            //if (!isWindows) {
              let activity_check_interval = 1;

              setInterval(function () {
                //let time_left = store.get('idle_time')-Math.round(SystemIdleTime.getIdleTime());
                //console.log('Time before screensaver run: ' + time_left + 's')
                if (SystemIdleTime.getIdleTime() > store.get('idle_time')) {
                  (async () => {
                    const activeWindow = await activeWin();

                    if (!activeWindow) {
                      console.log('Cannot get active window. Screensaver will not run.');
                      return;
                    }

                    const { bounds } = activeWindow;
                    const primaryDisplay = screen.getPrimaryDisplay();
                    const { bounds: screenBounds } = primaryDisplay;

                    const isFullscreen =
                      bounds.x === screenBounds.x &&
                      bounds.y === screenBounds.y &&
                      bounds.width === screenBounds.width &&
                      bounds.height === screenBounds.height;

                    if (!isFullscreen || (isDesktopWindow(activeWindow))) {
                      //console.log('Current active window is not fullscreen or desktop. Running screensaver.');
                      displays.forEach((display) => {
                          if (!mainWindow[display.id].isVisible()) {
                              mainWindow[display.id].setFullScreen(true);
                              mainWindow[display.id].show();
                          }
                      });
                    }
                  })();
                }
              }, activity_check_interval*1000);
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

        // Quit the screensaver when the renderer process says so

        ipcMain.on('sendQuit', function(event){
            // stop app in windows after sendQuit
            /*if (isWindows) {
              app.exit(0);
            } else { */
              displays.forEach((display) => {
                  //console.log(display.id)
                if (mainWindow[display.id].isVisible()) {
                  mainWindow[display.id].setFullScreen(false);
                  mainWindow[display.id].hide();
                }
              });
            //}
        });
    }
    catch (err) {
        console.log(err)
        fs.unlinkSync(app.getPath('userData')+"/config.json")
        app.relaunch();
        app.exit()
    }

    // check desktop window
    function isDesktopWindow(window) {
        if (!window) return false;

        const { owner, title } = window;

        const isKnownDesktopProcess = desktopProcesses.some((process) =>
            owner.name.toLowerCase().includes(process.toLowerCase())
        );

        const isEmptyTitle = !title || title.trim() === '';

        return isKnownDesktopProcess || isEmptyTitle;
    }


    function setRunAtStartup (flag, store) {
        //store.set('run_at_startup',flag);
        if (flag) {
          app.setLoginItemSettings({
              openAtLogin: true,
              //name: app.getName() + " v."+app.getVersion() // to fix version in registry autorun
              name: app.getName()
          })
          if (isLinux) {
            let executable = "ribbons-electron";
            if (process.env.APPIMAGE) {
              executable = process.env.APPIMAGE;
            } else {
              executable = app.getPath('exe');
            }
            let shortcut_contents = `[Desktop Entry]
        Categories=Utility;
        Comment=Windows like ribbons screensaver app
        Exec=sleep 15 && "`+executable+`"
        Name=Ribbons screensaver
        StartupWMClass=Ribbons screensaver
        Terminal=false
        Type=Application
        Icon=ribbons-electron`;
            if (!fs.existsSync(app.getPath('home')+"/.config/autostart/ribbons-electron.desktop")) {
              fs.writeFileSync(app.getPath('home')+"/.config/autostart/ribbons-electron.desktop",shortcut_contents, 'utf-8');
            }
          }
        } else {
          app.setLoginItemSettings({
              openAtLogin: false,
              //name: app.getName() + " v."+app.getVersion()  // to fix version in registry autorun
              name: app.getName()
          })
          if (isLinux) {
            if (fs.existsSync(app.getPath('home')+"/.config/autostart/ribbons-electron.desktop")) {
              fs.unlinkSync(app.getPath('home')+"/.config/autostart/ribbons-electron.desktop")
            }
          }
        }
    }
}
