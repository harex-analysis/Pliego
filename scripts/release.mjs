import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { components, download, sha256 } from './vendor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const app = path.join(dist, 'Pliego-win32-x64');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(dist, 'release', 'v' + version);
const filename = 'Pliego-' + version + '-windows-x64.zip';
const zip = path.join(output, filename);
const setupName = 'Pliego-Setup-x64.exe';
const installer = path.join(output, setupName);
const nsis = {
  name: 'nsis-3.13.zip',
  url: 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip',
  sha256: 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8'
};

function nsisPath(file) {
  return file.split(path.sep).join('\\').replaceAll('$', '$$');
}

async function createInstaller(work, compiler) {
  execFileSync('tar.exe', ['-xf', compiler, '-C', work], { stdio: 'inherit' });
  const tool = path.join(work, 'nsis-3.13');
  await copyFile(path.join(tool, 'COPYING'), path.join(app, 'LICENSE-NSIS.txt'));
  const entries = await readdir(app, { recursive: true, withFileTypes: true });
  const filePaths = entries.filter(entry => entry.isFile())
    .map(entry => path.relative(app, path.join(entry.parentPath, entry.name)));
  const folders = entries.filter(entry => entry.isDirectory())
    .map(entry => path.relative(app, path.join(entry.parentPath, entry.name)))
    .sort((a, b) => b.length - a.length);
  const manifest = path.join(work, 'remove-files.nsh');
  const remove = filePaths.filter(file => file !== 'Pliego.exe')
    .map(file => '  Delete "$INSTDIR\\' + nsisPath(file) + '"');
  remove.push('  IfErrors uninstallFailed');
  for (const folder of folders) {
    // Directories may contain files added by the user. Remove them only when empty.
    remove.push('  RMDir "$INSTDIR\\' + nsisPath(folder) + '"');
  }
  await writeFile(manifest, remove.join('\n') + '\n');
  const compiled = path.join(work, setupName);
  execFileSync(path.join(tool, 'makensis.exe'), [
    '/INPUTCHARSET', 'UTF8', '/V3', '/WX', path.join(root, 'scripts', 'installer.nsi')
  ], {
    env: {
      ...process.env, PLIEGO_VERSION: version, PLIEGO_APP_DIR: app,
      PLIEGO_ICON: path.join(root, 'assets', 'pliego.ico'), PLIEGO_INSTALLER_FILE: compiled,
      PLIEGO_REMOVE_FILES: manifest
    },
    stdio: 'inherit', windowsHide: true
  });
  return compiled;
}

await mkdir(output, { recursive: true });
for (const [source, name] of [
  ['LICENSE', 'LICENSE-Pliego.txt'], ['THIRD-PARTY.md', 'LICENCIAS-DE-TERCEROS.md'], ['RELEASE-NOTES.md', 'LEEME.md']
]) {
  await copyFile(path.join(root, source), path.join(app, name));
}
const [source, compiler] = await Promise.all([download(components.zipSource), download(nsis)]);
await copyFile(source, path.join(output, components.zipSource.name));
const work = await mkdtemp(path.join(tmpdir(), 'pliego-release-'));
const partial = zip + '.new';
const setupPartial = installer + '.new';
try {
  const localZip = path.join(work, filename);
  const compiled = await createInstaller(work, compiler);
  const sevenZip = path.join(root, 'vendor', '7zip', '7z.exe');
  execFileSync(sevenZip, ['a', '-tzip', '-mx=3', '-mmt=2', '-bso0', localZip, path.basename(app)], {
    cwd: dist, stdio: 'inherit', windowsHide: true
  });
  await copyFile(localZip, partial);
  await copyFile(compiled, setupPartial);
  await rename(partial, zip);
  await rename(setupPartial, installer);
} finally {
  await rm(partial, { force: true });
  await rm(setupPartial, { force: true });
  await rm(work, { recursive: true, force: true });
}
const checksums = [installer, zip, path.join(output, components.zipSource.name)];
await writeFile(path.join(output, 'SHA256SUMS.txt'), (await Promise.all(checksums.map(async file =>
  (await sha256(file)) + '  ' + path.basename(file)))).join('\n') + '\n');
console.log(installer + '\n' + zip);
