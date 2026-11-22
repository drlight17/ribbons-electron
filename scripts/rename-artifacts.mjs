#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriConfig = JSON.parse(
    readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = tauriConfig.version || packageJson.version;

const bundleDir = process.env.TAURI_BUNDLE_DIR
    ? resolve(root, process.env.TAURI_BUNDLE_DIR)
    : resolve(
          process.env.CARGO_TARGET_DIR
              ? join(process.env.CARGO_TARGET_DIR, 'release', 'bundle')
              : join(root, 'src-tauri', 'target', 'release', 'bundle'),
      );

function walk(dir, result = []) {
    if (!existsSync(dir)) {
        return result;
    }
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stats = statSync(path);
        if (stats.isDirectory()) {
            walk(path, result);
        } else {
            result.push(path);
        }
    }
    return result;
}

function artifactVersionFromName(name) {
    const match = name.match(
        /[_-](\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)[_.-]/,
    );
    return match ? match[1] : null;
}

function signatureVersion(path) {
    const sigPath = `${path}.sig`;
    if (!existsSync(sigPath)) {
        return null;
    }
    try {
        const decoded = Buffer.from(readFileSync(sigPath, 'utf8'), 'base64').toString(
            'utf8',
        );
        const match = decoded.match(/version:([^\s]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function electronArch(name) {
    const text = String(name || '').toLowerCase();
    if (text.includes('universal')) return 'universal';
    if (text.includes('aarch64') || text.includes('arm64')) return 'arm64';
    if (text.includes('x86_64') || text.includes('x64') || text.includes('amd64')) {
        return 'x64';
    }

    const triple =
        process.env.TAURI_ENV_TARGET_TRIPLE ||
        process.env.CARGO_BUILD_TARGET ||
        '';
    if (/aarch64|arm64/.test(triple)) return 'arm64';
    if (/x86_64|x64|amd64/.test(triple)) return 'x64';

    return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function targetName(path) {
    const name = basename(path);
    const lower = name.toLowerCase();
    const macArch = electronArch(name);

    if (lower.endsWith('.appimage')) {
        return `Ribbons.screensaver-${version}.AppImage`;
    }
    if (lower.endsWith('.deb')) {
        return `Ribbons.screensaver-${version}.deb`;
    }
    if (lower.endsWith('.rpm')) {
        return `Ribbons.screensaver-${version}.rpm`;
    }
    if (lower.endsWith('.msi')) {
        return `Ribbons.screensaver-${version}.msi`;
    }
    if (lower.endsWith('-setup.exe')) {
        return `Ribbons.screensaver-${version}.exe`;
    }
    if (lower.endsWith('.app.tar.gz')) {
        return `Ribbons.screensaver-${version}-mac-${macArch}.app.tar.gz`;
    }
    if (lower.endsWith('.dmg')) {
        return `Ribbons.screensaver-${version}-mac-${macArch}.dmg`;
    }
    return null;
}

function moveWithSignature(source, target) {
    if (resolve(source) === resolve(target)) {
        return false;
    }

    rmSync(target, { force: true });
    renameSync(source, target);

    const sourceSig = `${source}.sig`;
    const targetSig = `${target}.sig`;
    if (existsSync(sourceSig)) {
        rmSync(targetSig, { force: true });
        renameSync(sourceSig, targetSig);
    }

    console.log(`${basename(source)} -> ${basename(target)}`);
    return true;
}

let renamed = 0;
for (const path of walk(bundleDir)) {
    if (path.endsWith('.sig')) {
        continue;
    }
    const target = targetName(path);
    if (!target) {
        continue;
    }

    const artifactVersion =
        signatureVersion(path) || artifactVersionFromName(basename(path));
    if (artifactVersion && artifactVersion !== version) {
        console.warn(
            `Skipping ${basename(path)}: artifact version ${artifactVersion} does not match ${version}.`,
        );
        continue;
    }
    if (!artifactVersion) {
        console.warn(
            `Skipping ${basename(path)}: cannot determine artifact version.`,
        );
        continue;
    }

    if (moveWithSignature(path, join(dirname(path), target))) {
        renamed += 1;
    }
}

console.log(
    renamed > 0
        ? `Renamed ${renamed} bundle artifact(s) in ${bundleDir}`
        : `No bundle artifacts needed renaming in ${bundleDir}`,
);
