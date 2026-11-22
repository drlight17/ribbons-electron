#!/usr/bin/env node
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tauriConfig = JSON.parse(
    readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const version = tauriConfig.version || packageJson.version;

if (packageJson.version !== version) {
    console.warn(
        `Warning: package.json version (${packageJson.version}) differs from tauri.conf.json version (${version}); using ${version}.`,
    );
}

const repoUrl =
    process.env.GITHUB_REPO_URL || 'https://github.com/drlight17/ribbons-tauri';
const tag = process.env.RELEASE_TAG;
const assetBase = (
    process.env.RELEASE_BASE_URL ||
    (tag
        ? `${repoUrl}/releases/download/${encodeURIComponent(tag)}`
        : `${repoUrl}/releases/latest/download`)
).replace(/\/+$/, '');

const bundleDir = process.env.TAURI_BUNDLE_DIR
    ? resolve(root, process.env.TAURI_BUNDLE_DIR)
    : resolve(
          process.env.CARGO_TARGET_DIR
              ? join(process.env.CARGO_TARGET_DIR, 'release', 'bundle')
              : join(root, 'src-tauri', 'target', 'release', 'bundle'),
      );
const outputPath = resolve(root, process.env.LATEST_JSON_PATH || 'latest.json');

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

function normalizeArch(value) {
    const text = String(value || '').toLowerCase();
    if (text.includes('aarch64') || text.includes('arm64')) return 'aarch64';
    if (text.includes('armv7') || text.includes('armhf')) return 'armv7';
    if (text.includes('i686') || text.includes('i386') || text.includes('ia32')) {
        return 'i686';
    }
    if (text.includes('x86_64') || text.includes('x64') || text.includes('amd64')) {
        return 'x86_64';
    }
    if (text.includes('x86')) return 'i686';
    return null;
}

function hostArch() {
    const triple =
        process.env.TAURI_ENV_TARGET_TRIPLE ||
        process.env.CARGO_BUILD_TARGET ||
        '';
    const fromTriple = normalizeArch(triple);
    if (fromTriple) {
        return fromTriple;
    }
    switch (process.arch) {
        case 'arm64':
            return 'aarch64';
        case 'ia32':
            return 'i686';
        case 'arm':
            return 'armv7';
        default:
            return 'x86_64';
    }
}

function readNotes(existing) {
    if (process.env.RELEASE_NOTES) {
        return process.env.RELEASE_NOTES;
    }
    const notesFile =
        process.env.RELEASE_NOTES_FILE || process.env.RELEASE_NOTES_PATH;
    if (notesFile) {
        const path = resolve(root, notesFile);
        if (existsSync(path)) {
            return readFileSync(path, 'utf8').trim();
        }
        console.warn(`Warning: release notes file not found: ${path}`);
    }
    if (existing && typeof existing.notes === 'string') {
        return existing.notes;
    }
    return `See the full release notes: ${repoUrl}/releases`;
}

function artifactVersionFromName(name) {
    const match = name.match(
        /[_-](\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)[_.-]/,
    );
    return match ? match[1] : null;
}

function readSignature(sigPath) {
    const content = readFileSync(sigPath, 'utf8').trim();
    let artifactVersion = null;
    try {
        const decoded = Buffer.from(content, 'base64').toString('utf8');
        const match = decoded.match(/version:([^\s]+)/);
        if (match) {
            artifactVersion = match[1];
        }
    } catch {
        // Fall back to the version embedded in the file name.
    }
    return { content, artifactVersion };
}

function githubAssetName(path) {
    // GitHub replaces spaces with periods in release asset names.
    return basename(path).replaceAll(' ', '.');
}

function artifactInfo(path) {
    const name = basename(path);
    if (name.endsWith('.AppImage')) {
        return { os: 'linux', priority: 10 };
    }
    if (name.endsWith('.app.tar.gz')) {
        return { os: 'darwin', priority: 10 };
    }
    if (name.endsWith('.exe')) {
        return { os: 'windows', priority: 20 };
    }
    if (name.endsWith('.msi')) {
        return { os: 'windows', priority: 10 };
    }
    return null;
}

let existing = null;
if (existsSync(outputPath)) {
    try {
        existing = JSON.parse(readFileSync(outputPath, 'utf8'));
    } catch (err) {
        console.warn(`Warning: could not read ${outputPath}: ${err.message}`);
    }
}

const sameVersion = existing && existing.version === version;
const platforms =
    sameVersion && existing.platforms ? { ...existing.platforms } : {};

const candidates = new Map();
for (const sigPath of walk(bundleDir)) {
    if (!sigPath.endsWith('.sig')) {
        continue;
    }
    const artifactPath = sigPath.slice(0, -'.sig'.length);
    if (!existsSync(artifactPath)) {
        continue;
    }
    const info = artifactInfo(artifactPath);
    if (!info) {
        continue;
    }

    const signature = readSignature(sigPath);
    if (!signature.content) {
        console.warn(`Warning: empty signature for ${artifactPath}`);
        continue;
    }

    const name = basename(artifactPath);
    const artifactVersion =
        signature.artifactVersion || artifactVersionFromName(name);
    if (artifactVersion && artifactVersion !== version) {
        console.warn(
            `Skipping ${name}: artifact version ${artifactVersion} does not match ${version}.`,
        );
        continue;
    }

    const detectedArch = normalizeArch(name);
    const archs = /universal/i.test(name)
        ? ['x86_64', 'aarch64']
        : [detectedArch || hostArch()];

    for (const arch of archs) {
        const platform = `${info.os}-${arch}`;
        const previous = candidates.get(platform);
        if (!previous || info.priority > previous.priority) {
            candidates.set(platform, {
                priority: info.priority,
                artifactPath,
                sigPath,
                signature: signature.content,
            });
        }
    }
}

if (candidates.size === 0) {
    if (sameVersion && Object.keys(platforms).length > 0) {
        console.warn(
            `No updater artifacts found in ${bundleDir}; keeping existing ${outputPath}.`,
        );
        process.exit(0);
    }
    console.error(
        `No signed updater artifacts found in ${bundleDir}. Ensure createUpdaterArtifacts is enabled and TAURI_SIGNING_PRIVATE_KEY is set.`,
    );
    process.exit(1);
}

for (const [platform, candidate] of [...candidates.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
)) {
    const url = `${assetBase}/${encodeURIComponent(
        githubAssetName(candidate.artifactPath),
    )}`;
    platforms[platform] = {
        signature: candidate.signature,
        url,
    };
    console.log(`${platform}: ${basename(candidate.artifactPath)} -> ${url}`);
}

if (Object.keys(platforms).length === 0) {
    console.error('No platform entries could be generated.');
    process.exit(1);
}

const manifest = {
    version,
    notes: readNotes(existing),
    pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(
        Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
};

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${outputPath} (version ${version})`);
