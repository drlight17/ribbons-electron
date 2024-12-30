# <h1><img align="center" width="100" height="100" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/master/icon.png"> Ribbons Screensaver </h1>
Famous windows-like Ribbons screensaver made with js and Electron wrapped for multi platform support

<img align="center" width="100%" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/master/robbons-example.gif">

## Minimum OS requirements
Windows 7/2008, Linux with modern kernel version (5.x)

## 📦 Download

| Platform   | Type | Download link                               | File size   |
|-------------|--------------|---------------------------------------------------|----------------|
| 🖥 Windows x64   | `.exe`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/Ribbons.screensaver.Setup.0.2.0-alpha.exe)   | 80.4 MB          |
| 🐧 Debian/Ubuntu Linux x64    | `.deb`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/ribbons-electron_0.2.0-alpha_amd64.deb)     | 77.2 MB          |
| 🐧 RHEL/Fedora Linux x64    | `.rpm`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/ribbons-electron-0.2.0-alpha.x86_64.rpm)    | 77.7 MB          |
| 🐧 Linux AppImage x64   | `.AppImage`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/Ribbons.screensaver-0.2.0-alpha.AppImage)     | 107 MB          |
| 🌐 Linux Archive x64      | `.tar.gz`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/ribbons-electron-0.2.0-alpha.tar.gz)      | 102 MB          |
| 🌐 Windows Archive x64      | `.zip`       | [Download](https://github.com/drlight17/ribbons-electron/releases/download/0.2.0-alpha/Ribbons.screensaver-0.2.0-alpha-win.zip)       | 106 MB          |


---
### 📂 How to install?
1. Choose you platform distrib.
2. Click download.
3. Follow installation.


## Supported settings
All app settings are saved in the local user folder in file config.json:
- Windows 7 and newer: `%AppData%\Ribbons screensaver`
- Linux `~/.config/Ribbons screensaver`

## Usage
This app is created to be used as screensaver with idle system detect to run fullscreen animation. For current alpha version it isn't supposed to be:
- "native" windows scr app as there are no native winapi preview and settings implementation
- "native" linux xscreensaver app as there are no plans to develop something for xscreensaver api

### <ins>So for both platforms make sure to disable "native" screensaver to prevent conflicts!</ins>

After app startup check it's settings in tray menu:
<img align="center" width="200" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/refs/heads/main/2.png">

## For developers
Build depends on the platform as it uses the system idle detect function.

For Windows:
```
choco install python312 visualstudio2019community visualstudio2019-workload-nativedesktop visualstudio2019buildtools windows-sdk-10.0
pip install setuptools
git clone https://github.com/drlight17/ribbons-electron
cd ./ribbons-electron
cp ./package.json.windows ./package.json
```
For Linux:
```
apt install libxss-dev pkg-config
git clone https://github.com/drlight17/ribbons-electron
cd ./ribbons-electron
cp ./package.json.linux ./package.json
```
Platform independent steps:
```
npm install -g node-gyp
npm install --save-dev electron-rebuild
npx electron-rebuild
```
To run dev app use:
```
npm start 
```
In dev mode config path includes '-dev'

To build distributive use:
```
npm run dist
```
If there are any module errors try to `npx electron-rebuild` before every `npm start` or `npm run dist`.

Also check [package.json.linux](package.json.linux) and [package.json.windows](package.json.windows)


## Special thanks to:
- [madve2](https://github.com/madve2) for his [electron-screensaver-seed repo](https://github.com/madve2/electron-screensaver-seed) that was partly used to create initial Electron app
- [fadyehabamer](https://github.com/fadyehabamer) for his [Ribbons-Screensaver repo](https://github.com/fadyehabamer/Ribbons-Screensaver) that is the basis for graphics (he "failed with PWA", I made it with Electron =))) )

All rights belongs to their authors!
