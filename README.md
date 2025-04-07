# <h1><img align="center" width="100" height="100" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/master/icon.png"> Ribbons Screensaver </h1>
Famous windows-like Ribbons screensaver made with js and Electron wrapped for multi platform support

<img align="center" width="100%" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/master/ribbons-example.gif">

## Minimum OS requirements
MacOS 10.15 Catalina (since [0.2.2-alpha](https://github.com/drlight17/ribbons-electron/releases/0.2.2-alpha)), Windows 8/2012, Linux with modern kernel version (5.x) and Xserver (wayland is not supported, at least for now)

## 📦 Download and install

Go to landing page https://drlight17.github.io/, download your platform latest version and follow installation

---

## Supported settings
All app settings are saved in the local user folder in file config.json:
- Windows 8 and newer: `%AppData%\Ribbons screensaver`
- Linux `~/.config/Ribbons screensaver`
- MacOS: `~/Library/Application Support/Ribbons screensaver`

## Usage
This app is created to be used as screensaver with idle system detect to run fullscreen animation. For current alpha version it isn't supposed to be:
- "native" windows scr app as there are no native winapi preview and settings implementation
- "native" linux xscreensaver app as there are no plans to develop something for xscreensaver api
- "native" macos screensaver app as there are no plans to develop something for Objective-C and Cocoa framework

### <ins>So for all the platforms make sure to disable "native" screensaver to prevent conflicts!</ins>

After app startup check it's settings in tray menu:
<img align="center" width="200" src="https://raw.githubusercontent.com/drlight17/ribbons-electron/refs/heads/main/2.png">

## For developers
Build depends on the platform as it uses the system idle detect function.

For Windows:
```
choco install python312 visualstudio2019community visualstudio2019-workload-nativedesktop visualstudio2019buildtools windows-sdk-10.0
pip install setuptools
```
For Linux:
```
apt install libxss-dev pkg-config
```
Platform independent steps:
```
git clone https://github.com/drlight17/ribbons-electron
cd ./ribbons-electron
npm install -g node-gyp
npm install --save-dev electron-rebuild
npx electron-rebuild
```
To run dev app use:
```
npm start
```
In dev mode config path includes '-dev'

To build all platform distributives at once use:
```
npm run dist
```
Or you can build specific dist. For example linux rpm package:
```
npm run build-rpm
```
If there are any module errors try to `npx electron-rebuild` before every `npm start` or `npm run dist`.

Also check [package.json](package.json)


## Special thanks to:
- [madve2](https://github.com/madve2) for his [electron-screensaver-seed repo](https://github.com/madve2/electron-screensaver-seed) that was partly used to create initial Electron app
- [fadyehabamer](https://github.com/fadyehabamer) for his [Ribbons-Screensaver repo](https://github.com/fadyehabamer/Ribbons-Screensaver) that is the basis for graphics (he "failed with PWA", I made it with Electron =))) )

All rights belongs to their authors!
