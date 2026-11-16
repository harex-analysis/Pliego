const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const repository = 'harex-analysis/Pliego';
const releasesApi = 'https://api.github.com/repos/' + repository + '/releases?per_page=20';
const releasesPage = 'https://github.com/' + repository + '/releases';
const installer = 'Pliego-Setup-x64.exe';
const maxDownload = 650 * 1024 * 1024;
const integrityError = 'El instalador no coincide con la versión publicada. Vuelve a descargarlo.';

function versionParts(value) {
  if (typeof value !== 'string' || value.trim() !== value ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

function compareVersions(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function newestUpdate(releases, installed) {
  let newest = null;
  let highest = versionParts(installed);
  if (!highest || !Array.isArray(releases)) return null;
  for (const release of releases) {
    if (release?.draft !== false || !Array.isArray(release.assets) ||
        typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) continue;
    const version = release.tag_name.slice(1);
    const parts = versionParts(version);
    if (!parts || compareVersions(parts, highest) <= 0) continue;
    const expected = releasesPage + '/download/v' + version + '/' + installer;
    const asset = release.assets.find(asset => asset?.name === installer && asset.state === 'uploaded' &&
      asset.browser_download_url === expected);
    if (!asset) continue;
    highest = parts;
    newest = { version, prerelease: release.prerelease === true };
    if (release.immutable === true && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= maxDownload &&
        typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      newest.installer = { version, url: expected, size: asset.size, sha256: asset.digest.slice(7) };
    }
  }
  return newest;
}

function createUpdateCheck(installed, fetchRelease, canInstall = false) {
  let lastResult;
  let inFlight;
  let lastManualCheck = -Infinity;
  let available;

  async function request() {
    try {
      const response = await fetchRelease(releasesApi, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(6000)
      });
      if (response.ok) {
        const releases = await response.json();
        if (Array.isArray(releases)) {
          available = newestUpdate(releases, installed);
          if (!available) return { status: 'current' };
          const { version, prerelease, installer } = available;
          return { status: 'available', update: { version, prerelease, ...(canInstall && installer && { canDownload: true }) } };
        }
      }
    } catch {} // Update checks are optional when GitHub or the network is unavailable.
    return { status: 'unavailable' };
  }

  function check(manual = false) {
    if (inFlight) return inFlight;
    const now = Date.now();
    if (lastResult && (!manual || now - lastManualCheck < 750)) return Promise.resolve(lastResult);
    if (manual) lastManualCheck = now;
    inFlight = request().then(result => {
      lastResult = result;
      inFlight = undefined;
      return result;
    });
    return inFlight;
  }

  return {
    check: async () => (await check()).update ?? null,
    refresh: () => check(true),
    installer: () => canInstall ? available?.installer : undefined,
    releasePage: () => available ? releasesPage + '/tag/v' + available.version : null,
    notesPage: () => releasesPage
  };
}

async function isInstalledForUpdates(executable, packaged) {
  if (!packaged || process.platform !== 'win32' || path.basename(executable).toLowerCase() !== 'pliego.exe') return false;
  try {
    const marker = await readFile(path.join(path.dirname(executable), '.pliego-installed'), 'utf16le');
    return path.normalize(marker.replace(/^\uFEFF/, '')).toLowerCase() === path.normalize(executable).toLowerCase();
  } catch { return false; }
}

async function downloadResponse(fetchFile, initialUrl, signal) {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchFile(url.href, { credentials: 'omit', redirect: 'manual', signal });
    if (response.status === 200 && response.body) return response;
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    url = new URL(location, url);
    if (url.protocol !== 'https:' || url.host !== 'release-assets.githubusercontent.com' || url.username || url.password) break;
  }
  throw Error('No se pudo descargar el instalador desde GitHub. Inténtalo de nuevo.');
}

async function clearStage(folder) {
  if (!folder) return;
  const info = await lstat(folder).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) return;
  await Promise.all([installer, installer + '.part'].map(name => unlink(path.join(folder, name)).catch(() => {})));
  await rmdir(folder).catch(() => {});
}

function createUpdateDownload(root, fetchFile, notify) {
  let state = { phase: 'idle' };
  let controller;
  let running;
  let staged;
  let closing = false;
  let launching = false;

  function report(next) {
    state = next;
    if (!closing) notify(next);
  }

  async function prepare(asset, control) {
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(20 * 60_000)]);
    await mkdir(root, { recursive: true });
    const folder = await mkdtemp(path.join(root, 'pliego-'));
    const file = path.join(folder, installer);
    const partial = file + '.part';
    try {
      const response = await downloadResponse(fetchFile, asset.url, signal);
      const hash = createHash('sha256');
      let received = 0;
      let percentage = 0;
      await pipeline(Readable.fromWeb(response.body), async function* (input) {
        for await (const chunk of input) {
          received += chunk.length;
          if (received > asset.size) throw Error(integrityError);
          hash.update(chunk);
          const next = Math.min(99, Math.floor(100 * received / asset.size));
          if (next !== percentage) {
            percentage = next;
            report({ phase: 'downloading', version: asset.version, percentage });
          }
          yield chunk;
        }
      }, createWriteStream(partial, { flags: 'wx' }), { signal });
      if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw Error(integrityError);
      await rename(partial, file);
      if (process.platform === 'win32') {
        await writeFile(file + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=' + asset.url + '\r\n');
      }
      signal.throwIfAborted();
      staged = { asset, folder, file };
      report({ phase: 'ready', version: asset.version });
    } catch (error) {
      await clearStage(folder);
      throw error;
    }
  }

  async function install(open) {
    if (closing || !staged || state.phase !== 'ready') return false;
    const { asset, folder, file } = staged;
    report({ phase: 'installing', version: asset.version });
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.size !== asset.size) throw Error(integrityError);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') !== asset.sha256) throw Error(integrityError);
      // Reset the Internet zone before handing the file to the Windows shell.
      if (process.platform === 'win32') {
        await writeFile(file + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=' + asset.url + '\r\n');
      }
    } catch {
      staged = undefined;
      await clearStage(folder);
      report({ phase: 'error', version: asset.version, error: integrityError });
      return false;
    }
    if (closing) return false;
    launching = true;
    const opened = await open(file).catch(() => false);
    launching = false;
    if (!opened) {
      report({ phase: 'ready', version: asset.version, error: 'No se pudo abrir el instalador. Puedes intentarlo de nuevo.' });
      return false;
    }
    // Windows may still be using the installer when the updated app first opens.
    staged = undefined;
    return true;
  }

  return {
    state: () => state,
    start(asset) {
      if (!asset || closing || running || staged || state.phase === 'installing') return false;
      const control = new AbortController();
      controller = control;
      report({ phase: 'downloading', version: asset.version, percentage: 0 });
      running = prepare(asset, control).catch(error => {
        if (control.signal.aborted) report({ phase: 'idle' });
        else report({ phase: 'error', version: asset.version, error: error.message === integrityError ? integrityError :
          'No se pudo completar la descarga. Comprueba la conexión y vuelve a intentarlo.' });
      }).finally(() => { running = undefined; controller = undefined; });
      return true;
    },
    async cancel() { controller?.abort(); await running; },
    install,
    async cleanPrevious() {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      await Promise.all(entries.filter(entry => entry.isDirectory() && /^pliego-[a-zA-Z0-9]{6}$/.test(entry.name))
        .map(entry => clearStage(path.join(root, entry.name))));
    },
    async close() {
      closing = true;
      controller?.abort();
      await running;
      if (!launching) await clearStage(staged?.folder);
    }
  };
}

module.exports = { createUpdateCheck, createUpdateDownload, isInstalledForUpdates };
