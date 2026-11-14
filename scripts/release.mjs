import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { components, download, sha256 } from './vendor.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'dist');
const app = path.join(dist, 'Pliego-win32-x64');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const output = path.join(dist, 'release');
const filename = 'Pliego-' + version + '-windows-x64.zip';
const zip = path.join(output, filename);

await mkdir(output, { recursive: true });
for (const [source, name] of [
  ['LICENSE', 'LICENSE-Pliego.txt'], ['THIRD-PARTY.md', 'LICENCIAS-DE-TERCEROS.md'], ['RELEASE-NOTES.md', 'LEEME.md']
]) {
  await copyFile(path.join(root, source), path.join(app, name));
}
const source = await download(components.zipSource);
await copyFile(source, path.join(output, components.zipSource.name));
const work = await mkdtemp(path.join(tmpdir(), 'pliego-release-'));
const partial = zip + '.new';
try {
  const localZip = path.join(work, filename);
  const sevenZip = path.join(root, 'vendor', '7zip', '7z.exe');
  execFileSync(sevenZip, ['a', '-tzip', '-mx=3', '-mmt=2', '-bso0', localZip, path.basename(app)], {
    cwd: dist, stdio: 'inherit', windowsHide: true
  });
  await copyFile(localZip, partial);
  await rename(partial, zip);
} finally {
  await rm(partial, { force: true });
  await rm(work, { recursive: true, force: true });
}
const checksums = [zip, path.join(output, components.zipSource.name)];
await writeFile(path.join(output, 'SHA256SUMS.txt'), (await Promise.all(checksums.map(async file =>
  (await sha256(file)) + '  ' + path.basename(file)))).join('\n') + '\n');
console.log(zip);
