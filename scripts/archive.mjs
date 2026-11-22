import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mode = process.argv[2];
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const releaseDir = path.join(root, 'src-tauri', 'target', 'release');
const isWindows = process.platform === 'win32';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function binaryName() {
  return isWindows ? 'ribbons-tauri.exe' : 'ribbons-tauri';
}

const portableResources = [
  'icon.png',
  'iconPaused.png',
  'iconTemplate.png',
  'iconTemplatePaused.png',
  'icon.ico',
  'iconPaused.ico',
];

function stagePortable() {
  const stageName = `Ribbons.Screensaver-${version}`;
  const stage = path.join(releaseDir, stageName);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.copyFileSync(path.join(releaseDir, binaryName()), path.join(stage, binaryName()));
  fs.chmodSync(path.join(stage, binaryName()), 0o755);

  const uiDir = path.join(root, 'ui');
  for (const resource of portableResources) {
    const source = path.join(uiDir, resource);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stage, resource));
  }
  fs.cpSync(path.join(uiDir, 'translations'), path.join(stage, 'translations'), {
    recursive: true,
  });
  return { stage, stageName };
}

if (mode === 'targz') {
  const { stage, stageName } = stagePortable();
  const output = path.join(releaseDir, `Ribbons.screensaver-${version}.tar.gz`);
  run('tar', ['-czf', output, '-C', path.dirname(stage), stageName]);
  console.log(output);
} else if (mode === 'zip') {
  const { stage, stageName } = stagePortable();
  const output = path.join(releaseDir, `Ribbons.screensaver-${version}.zip`);
  if (isWindows) {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Force -Path '${stage}' -DestinationPath '${output}'`,
    ]);
  } else if (spawnSync('zip', ['-v']).status === 0) {
    run('zip', ['-r', output, stageName], { cwd: path.dirname(stage) });
  } else {
    run('tar', ['-czf', output.replace(/\.zip$/, '.tar.gz'), '-C', path.dirname(stage), stageName]);
  }
  console.log(output);
} else if (mode === 'zip-mac') {
  const appDir = path.join(releaseDir, 'bundle', 'macos', 'Ribbons Screensaver.app');
  if (!fs.existsSync(appDir)) {
    throw new Error(`macOS bundle not found at ${appDir}`);
  }
  const output = path.join(releaseDir, `Ribbons.screensaver-${version}-mac-${arch}.zip`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appDir, output]);
  console.log(output);
} else {
  console.error('Usage: node scripts/archive.mjs <targz|zip|zip-mac>');
  process.exitCode = 1;
}
