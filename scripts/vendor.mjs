import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'vendor');
const cache = path.join(root, '.cache', 'vendor');
export const components = {
  zip: {
    name: '7z2606-x64.exe',
    url: 'https://github.com/ip7z/7zip/releases/download/26.06/7z2606-x64.exe',
    sha256: '9b697f65ecc2d9b0152f5ee96d72dde522a7827690349d9307935dacf40f42ec'
  },
  zipSource: {
    name: '7z2606-src.7z',
    url: 'https://github.com/ip7z/7zip/releases/download/26.06/7z2606-src.7z',
    sha256: 'e0364d39e8208557d939472c9a12d02ed1c12f45ca402e3b408bcaa63b36dd93'
  },
  python: {
    name: 'cpython-3.13.18-win-x64.tar.gz',
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.13.18%2B20261110-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: '7e93813bd362c6413f30788b248590e2f169df2d17dcac81aafbcc7a6eeb542c'
  },
  torrent: {
    name: 'libtorrent-2.0.15-cp313-cp313-win_amd64.whl',
    url: 'https://files.pythonhosted.org/packages/31/f4/977cdcf832cfdc7880dcdeefdc5be5748ad1155f7e1a969657b37f6cf72a/libtorrent-2.0.15-cp313-cp313-win_amd64.whl',
    sha256: 'c6ab6445adc0b69003a56dd254c50c0ee9da681bcd08cdb719be6f34c677df72'
  }
};

export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function download({ name, url, sha256: expected }) {
  await mkdir(cache, { recursive: true });
  const file = path.join(cache, name);
  try {
    if (await sha256(file) === expected) return file;
    await rm(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const partial = file + '.' + randomUUID() + '.tmp';
  try {
    if (new URL(url).hostname === 'downloads.sourceforge.net') {
      execFileSync('curl.exe', ['--fail', '--silent', '--show-error', '--location', '--retry', '2',
        '--max-time', '120', '--proto', '=https', '--proto-redir', '=https', '--output', partial, url],
      { stdio: 'inherit', windowsHide: true });
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body) throw Error(name + ' (HTTP ' + response.status + ')');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    }
    if (await sha256(partial) !== expected) throw Error('SHA-256 inesperado para ' + name);
    await rename(partial, file);
    return file;
  } finally {
    await rm(partial, { force: true });
  }
}

function extract(file, directory, entries = []) {
  execFileSync('tar.exe', ['-xf', file, '-C', directory, ...entries], { stdio: 'inherit' });
}

export async function prepareVendor() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw Error('La preparación requiere Node.js x64 en Windows.');
  }
  const windowsZip = path.join(vendor, '7zip');
  const runtime = path.join(vendor, 'torrent', 'runtime');
  const stamp = path.join(cache, 'installed.json');
  const inputs = [await sha256(fileURLToPath(import.meta.url)), await sha256(path.join(root, 'licenses', 'LGPL-2.1.txt'))];
  async function digestTree(directory) {
    const entries = (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter(entry => !entry.isDirectory())
      .map(entry => path.join(entry.parentPath, entry.name)).sort();
    return Promise.all(entries.map(async file => [path.relative(vendor, file), await sha256(file)]));
  }
  const digests = () => Promise.all([digestTree(windowsZip), digestTree(runtime)]);
  const manifest = JSON.stringify({ components, inputs });
  try {
    const saved = JSON.parse(await readFile(stamp, 'utf8'));
    if (saved.manifest === manifest && JSON.stringify(saved.digests) === JSON.stringify(await digests())) return;
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }

  const [zip, python, torrent] = await Promise.all([
    download(components.zip), download(components.python), download(components.torrent)
  ]);
  await mkdir(path.join(vendor, 'torrent'), { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-vendor-'));
  try {
    const archive = path.join(work, '7zip');
    const preparedPython = path.join(work, 'python');
    await mkdir(archive);
    extract(zip, archive, ['7z.exe', '7z.dll', 'License.txt']);
    extract(python, work, [
      '--exclude=*.pdb', '--exclude=python/Lib/site-packages', '--exclude=python/Lib/test',
      '--exclude=python/Lib/idlelib', '--exclude=python/DLLs/tcl86t.dll', '--exclude=python/DLLs/tk86t.dll',
      '--exclude=python/DLLs/_tkinter.pyd', 'python/python.exe', 'python/python3.dll', 'python/python313.dll',
      'python/vcruntime140.dll', 'python/vcruntime140_1.dll', 'python/LICENSE.txt', 'python/DLLs', 'python/Lib'
    ]);
    extract(torrent, preparedPython);
    await writeFile(path.join(preparedPython, 'python313._pth'), 'Lib\nDLLs\n.\n');
    execFileSync(path.join(preparedPython, 'python.exe'), [
      '-I', '-B', '-c', 'import libtorrent, sys; assert sys.version_info[:3] == (3, 13, 18) and libtorrent.version == "2.0.15.0"'
    ], { windowsHide: true, stdio: 'inherit' });
    await copyFile(path.join(root, 'licenses', 'LGPL-2.1.txt'), path.join(archive, 'LGPL-2.1.txt'));
    await rm(windowsZip, { recursive: true, force: true });
    await rm(runtime, { recursive: true, force: true });
    await cp(archive, windowsZip, { recursive: true });
    await cp(preparedPython, runtime, { recursive: true });
    await writeFile(stamp, JSON.stringify({ manifest, digests: await digests() }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareVendor();
}
