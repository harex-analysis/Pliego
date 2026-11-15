const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdir, readFile, rename, realpath, stat, statfs, unlink, writeFile } = require('node:fs/promises');
const { isIP } = require('node:net');
const path = require('node:path');
const { createInterface } = require('node:readline');

const active = new Set(['searching', 'ready', 'downloading', 'checking', 'importing']);
const topic = /^(?:urn:btih:(?:[\da-f]{40}|[a-z2-7]{32})|urn:btmh:1220[\da-f]{64})$/i;
const comicExtension = /\.(cbr|cbz|rar|zip)$/i;

function magnetLink(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (input.length > 8192) throw Error('El enlace es demasiado largo.');
  if (/^(?:[\da-f]{40}|[a-z2-7]{32})$/i.test(input)) return 'magnet:?xt=urn:btih:' + input;
  if (/^[\da-f]{64}$/i.test(input)) return 'magnet:?xt=urn:btmh:1220' + input;
  if (/^1220[\da-f]{64}$/i.test(input)) return 'magnet:?xt=urn:btmh:' + input;
  if (/^magnet:\?/i.test(input) && !/[\s\x00-\x1f#]/u.test(input)) {
    const parameters = new URLSearchParams(input.slice(8));
    const topics = parameters.getAll('xt');
    if (topics.length && topics.every(value => topic.test(value))) {
      const allowed = topics.map(value => 'xt=' + value.toLowerCase());
      for (const [key, value] of parameters) {
        if (key === 'tr' && !validSource(value, ['http:', 'https:', 'udp:'])) throw Error('El magnet contiene un rastreador no compatible.');
        if (key === 'ws' && !validSource(value, ['http:', 'https:'])) throw Error('El magnet contiene una fuente web no compatible.');
        if (['dn', 'tr', 'ws'].includes(key)) allowed.push(key + '=' + encodeURIComponent(value));
        if (key === 'x.pe') {
          const peer = /^(?:\[([\da-f:.]+)\]|([\d.]+)):(\d{1,5})$/i.exec(value);
          if (peer && isIP(peer[1] || peer[2]) === (peer[1] ? 6 : 4) && Number(peer[3]) > 0 && Number(peer[3]) <= 65535) {
            // libtorrent reads peer endpoints directly, including the colon and brackets.
            allowed.push('x.pe=' + value);
          }
        }
      }
      return 'magnet:?' + allowed.join('&');
    }
  }
  throw Error('Pega un enlace magnet o un info hash válido.');
}

function validSource(value, schemes) {
  try {
    const url = new URL(value);
    return schemes.includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function safeName(value, fallback, length) {
  const clean = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, length).replace(/[. ]+$/g, '');
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(clean)) return '_' + clean;
  return clean && clean !== '.' && clean !== '..' ? clean : fallback;
}

function planFiles(entries) {
  const used = new Set();
  return entries.map(entry => {
    const extension = path.extname(entry.name).toLowerCase();
    const base = safeName(path.basename(entry.name, path.extname(entry.name)), 'Tomo ' + (entry.index + 1), 100);
    let name = base + extension;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = base + ' (' + i + ')' + extension;
    used.add(name.toLowerCase());
    return { ...entry, name };
  });
}

async function reserveFolder(parent, name, size) {
  await mkdir(parent, { recursive: true });
  const base = await realpath(parent);
  // libuv cannot report Windows UNC free space consistently. The torrent engine
  // reports write failures for those locations.
  if (!base.startsWith('\\\\')) {
    const { bavail, bsize } = await statfs(base, { bigint: true });
    if (bavail * bsize < size) throw Error('No hay espacio suficiente para los tomos seleccionados.');
  }
  for (let index = 1; index <= 1000; index++) {
    const target = path.join(base, index === 1 ? name : name + ' (' + index + ')');
    try {
      await mkdir(target);
      return target;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw Error('Elige otra carpeta de destino.');
}

async function createTransfers({ runtime, dataDir, defaultFolder, importBooks, notify,
  workerScript = path.join(runtime, 'worker.py') }) {
  const ledger = path.join(dataDir, 'active.json');
  let job;
  let worker;
  let closing = false;
  let runningCommand;
  let importing;
  let workerExit = Promise.resolve();
  let writes = Promise.resolve();
  await mkdir(dataDir, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(ledger, 'utf8'));
    if (saved?.plan) job = { ...saved, phase: 'paused' };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Pliego: no se pudo restaurar la descarga.', error.message);
  }

  function view() {
    if (!job) return null;
    const { magnet, cache, plan, files, ...visible } = job;
    return { ...visible, canResume: Boolean(plan), folder: plan?.folder,
      files: job.phase === 'ready' ? files : undefined };
  }

  function persist() {
    const snapshot = JSON.stringify(job?.plan && job.phase !== 'complete' ? job : null);
    writes = writes.catch(() => {}).then(async () => {
      await writeFile(ledger + '.tmp', snapshot);
      await rename(ledger + '.tmp', ledger);
    });
    return writes;
  }

  function patch(data) {
    Object.assign(job, data);
    if (!closing) notify(view());
  }

  function fail(message) {
    patch({ phase: 'error', error: message, speed: 0 });
    if (job.plan) persist().catch(console.error);
  }

  function stopWorker() {
    if (!worker) return workerExit;
    const process = worker;
    worker = undefined;
    process.stdin.end('{"command":"stop"}\n');
    workerExit = new Promise(resolve => {
      const timer = setTimeout(() => process.kill(), 3500);
      process.once('close', () => { clearTimeout(timer); resolve(); });
    });
    return workerExit;
  }

  function send(command, data = {}) {
    if (!worker?.stdin.writable) throw Error('El motor de descarga se cerró.');
    worker.stdin.write(JSON.stringify({ command, ...data }) + '\n');
  }

  async function finish(current, partFile) {
    patch({ phase: 'importing', progress: 1, speed: 0 });
    try {
      await stopWorker();
      const { files, folder, group } = current.plan;
      const paths = [];
      await assertFolder(folder, files);
      for (const file of files) {
        const filename = path.join(folder, file.name);
        if ((await stat(filename)).size !== file.size) throw Error('Hay archivos que aún no están completos.');
        paths.push(filename);
      }
      const result = await importBooks(paths, current.category, group);
      if (job !== current) return;
      if (/^\.[\da-f]{40}\.parts$/.test(partFile)) {
        await unlink(path.join(folder, partFile)).catch(() => {});
      }
      patch({ phase: 'complete', imported: result.imported, importedCategories: result.importedCategories,
        failures: result.failures.map(item => item.name) });
      await persist();
      await unlink(current.cache).catch(() => {});
    } catch (error) {
      if (job === current) fail(error.message);
    }
  }

  async function assertFolder(folder, files) {
    if (path.normalize(await realpath(folder)).toLowerCase() !== path.normalize(folder).toLowerCase()) {
      throw Error('La carpeta de la descarga cambió de ubicación.');
    }
    for (const file of files) {
      const filename = path.join(folder, file.name);
      try {
        if (path.normalize(await realpath(filename)).toLowerCase() !== filename.toLowerCase() ||
          !(await stat(filename)).isFile()) throw Error('Un archivo del destino cambió de ubicación.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }

  function launch(magnet) {
    const current = job;
    const proc = spawn(path.join(runtime, 'runtime', 'python.exe'), [
      '-I', '-B', '-u', workerScript
    ], { windowsHide: true, cwd: path.join(runtime, 'runtime'), stdio: ['pipe', 'pipe', 'pipe'] });
    worker = proc;
    proc.stdin.on('error', () => {});
    proc.stderr.resume();
    const lines = createInterface({ input: proc.stdout });
    let completion;
    lines.on('line', async line => {
      if (worker !== proc || job !== current || closing) return;
      try {
        const status = JSON.parse(line);
        if (status.event === 'metadata') {
          const files = status.files.filter(item => comicExtension.test(item.name));
          if (current.plan) {
            const metadata = new Map(files.map(file => [file.index, file.size]));
            if (current.plan.files.some(file => metadata.get(file.index) !== file.size)) {
              throw Error('La lista de archivos del torrent cambió. Vuelve a añadir el magnet.');
            }
            await assertFolder(current.plan.folder, current.plan.files);
            if (worker !== proc || closing || job !== current) return;
            send('download', current.plan);
          } else if (files.length) {
            const name = safeName(status.name, 'Descarga Pliego', 100);
            patch({ phase: 'ready', name: /[\p{L}\p{N}]/u.test(name) ? name : 'Descarga Pliego', files });
          } else {
            fail('Este torrent no contiene archivos CBR, CBZ, RAR o ZIP compatibles.');
            stopWorker();
          }
        } else if (status.event === 'progress') {
          patch({ phase: status.checking ? 'checking' : 'downloading',
            progress: status.progress, speed: status.speed, peers: status.peers });
        } else if (status.event === 'complete') {
          completion = importing = finish(current, status.partFile);
        } else if (status.event === 'error') {
          fail(status.message.slice(0, 350));
          stopWorker();
        }
      } catch (error) {
        if (worker !== proc || job !== current) return;
        fail(error.message);
        stopWorker();
      }
    });
    proc.once('error', () => {
      if (worker === proc) {
        worker = undefined;
        fail('No se pudo iniciar el motor BitTorrent de Pliego.');
      }
    });
    proc.once('close', () => {
      if (worker === proc) {
        worker = undefined;
        if (active.has(current.phase) && !closing) fail('El motor BitTorrent se cerró. Puedes reintentar.');
      }
      completion?.catch(console.error);
    });
    send('probe', { magnet, cache: current.cache });
  }

  async function command(action, value = {}) {
    if (runningCommand || closing) return { error: 'Espera a que termine la operación actual.', job: view() };
    let unlock;
    runningCommand = new Promise(resolve => { unlock = resolve; });
    try {
      switch (action) {
        case 'probe': {
          if (active.has(job?.phase)) throw Error('Ya hay una descarga o búsqueda abierta.');
          if (job?.plan && job.phase !== 'complete') throw Error('Quita o reanuda la descarga pendiente.');
          const magnet = magnetLink(value.text);
          if (job?.cache) await unlink(job.cache).catch(() => {});
          await workerExit;
          const id = randomUUID();
          job = { id, magnet, cache: path.join(dataDir, id + '.resume'),
            category: value.category === 'manga' ? 'manga' : 'comic', phase: 'searching' };
          await persist();
          launch(magnet);
          break;
        }
        case 'download': {
          if (job?.phase !== 'ready') throw Error('Espera a que aparezca la lista de archivos.');
          const ids = new Set(Array.isArray(value.files) ? value.files : []);
          const selected = planFiles(job.files.filter(file => ids.has(file.index)));
          if (!selected.length) throw Error('Selecciona al menos un archivo.');
          const parent = value.destination || defaultFolder;
          if (typeof parent !== 'string' || !path.isAbsolute(parent)) throw Error('Elige una carpeta de destino.');
          const name = job.name;
          patch({ phase: 'checking', error: undefined });
          try {
            const size = selected.reduce((sum, file) => sum + BigInt(file.size), 0n);
            const folder = await reserveFolder(parent, name, size);
            job.plan = { files: selected, folder, group: value.group && selected.length > 1 ? name : undefined };
            delete job.files;
            await persist();
            send('download', job.plan);
          } catch (problem) {
            if (job.plan) {
              fail(problem.message);
              stopWorker();
            } else patch({ phase: 'ready' });
            throw problem;
          }
          break;
        }
        case 'stop': {
          if (job?.phase === 'importing') break;
          const cache = job?.plan ? null : job?.cache;
          if (job?.plan) {
            patch({ phase: 'paused', speed: 0 });
            await persist();
          } else job = undefined;
          await stopWorker();
          if (cache) await unlink(cache).catch(() => {});
          break;
        }
        case 'resume': {
          if (!job?.plan || !['paused', 'error'].includes(job.phase)) break;
          const magnet = magnetLink(job.magnet);
          patch({ phase: 'checking', error: undefined });
          await workerExit;
          launch(magnet);
          break;
        }
        case 'dismiss':
          if (active.has(job?.phase)) break;
          if (job?.cache) await unlink(job.cache).catch(() => {});
          job = undefined;
          await persist();
          break;
        default: throw Error('Acción desconocida.');
      }
      notify(view());
      return { job: view() };
    } catch (error) {
      return { error: error.message, job: view() };
    } finally {
      runningCommand = undefined;
      unlock();
    }
  }

  return {
    view, defaultFolder, command,
    async close() {
      closing = true;
      await runningCommand;
      await stopWorker();
      await importing;
      await persist();
    }
  };
}

module.exports = { createTransfers, magnetLink };
