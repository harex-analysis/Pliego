const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { _electron: electron, chromium } = require('playwright-core');
const { openArchive } = require('../src/archive.cjs');
const { magnetLink } = require('../src/torrent.cjs');

const root = path.resolve(__dirname, '..');
const installed = process.env.PLIEGO_TEST_EXE;
const vendor = installed ? path.join(path.dirname(installed), 'resources', 'vendor') : path.join(root, 'vendor');
const extractor = path.join(vendor, '7zip', '7z.exe');
const python = path.join(vendor, 'torrent', 'runtime', 'python.exe');
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex');

async function cleanTestDirectory(work) {
  try {
    await rm(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  } catch (error) {
    if (!['EBUSY', 'EPERM'].includes(error.code)) throw error;
    console.warn('Windows aún está liberando la carpeta temporal de pruebas.');
  }
}

async function comic(parent, name, { manga = false, oversized = false } = {}) {
  const pages = await mkdtemp(path.join(parent, 'pages-'));
  const image = Buffer.from(png);
  if (oversized) {
    image.writeUInt32BE(10_000, 16);
    image.writeUInt32BE(10_000, 20);
  }
  for (const name of ['01.png', '02.png']) await writeFile(path.join(pages, name), image);
  if (manga) await writeFile(path.join(pages, 'ComicInfo.xml'), '<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>');
  const file = path.join(parent, name);
  execFileSync(extractor, ['a', '-tzip', file, ...await readdir(pages)], { cwd: pages, windowsHide: true });
  return file;
}

async function waitJob(page, phase) {
  for (let i = 0; i < 160; i++) {
    const { job } = await page.evaluate(() => window.pliego.torrentInitial());
    if (job?.phase === 'error') throw Error(job.error);
    if (job?.phase === phase) return job;
    await delay(150);
  }
  throw Error('No llegó el estado ' + phase);
}

test('orígenes permitidos del magnet', () => {
  const base = 'magnet:?xt=urn:btih:' + 'a'.repeat(40);
  assert.match(magnetLink(base + '&tr=udp%3A%2F%2Flocalhost%3A80%2Fannounce'), /tr=udp/);
  assert.throws(() => magnetLink(base + '&tr=file%3A%2F%2Ftest'), /rastreador/);
  assert.throws(() => magnetLink(base + '&ws=https%3A%2F%2Fuser%3Apass%40example.org'), /fuente web/);
});

test('el ejecutable extraído abre y lee un CBZ', { skip: !installed, timeout: 60_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-portable-'));
  const profile = path.join(work, 'profile');
  let process;
  let browser;
  try {
    const file = await comic(work, 'Prueba portable.cbz');
    process = spawn(installed, ['--user-data-dir=' + profile, '--remote-debugging-port=0', file], {
      cwd: path.dirname(installed), stdio: 'ignore', windowsHide: true
    });
    const failed = once(process, 'exit').then(([code]) => { throw Error('Pliego terminó con código ' + code); });
    const port = await Promise.race([failed, (async () => {
      for (let attempt = 0; attempt < 120 && process.exitCode === null; attempt++) {
        try {
          return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0];
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await delay(200);
        }
      }
      throw Error('Pliego no abrió el puerto de pruebas.');
    })()]);
    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page');
    await page.locator('#page-label').getByText('1 / 2', { exact: true }).waitFor();
    await page.locator('.sheet img').first().evaluate(image => image.decode());
    await page.getByRole('button', { name: 'Página siguiente', exact: true }).click();
    await page.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pliego, inicio', exact: true }).click();
    await page.locator('.recent-title').getByText('Prueba portable', { exact: true }).waitFor();
    const saved = JSON.parse(await readFile(path.join(profile, 'reading.json'), 'utf8'));
    assert.equal(saved.books[0].page, 1);
  } finally {
    await browser?.close().catch(() => {});
    if (process?.exitCode === null && process?.signalCode === null) {
      process.kill();
      await once(process, 'close');
    }
    await cleanTestDirectory(work);
  }
});

test('primera apertura, biblioteca, lector y descargas de Windows', { skip: Boolean(installed), timeout: 150_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-test-'));
  let app;
  let seed;
  try {
    const first = await comic(work, 'Lector.cbz');
    const manga = await comic(work, 'Manga.cbz', { manga: true });
    const tooBig = await comic(work, 'Imagen extrema.cbz', { oversized: true });
    const corrupt = path.join(work, 'Incompleto.cbz');
    await writeFile(corrupt, 'archivo incompleto');
    await assert.rejects(openArchive(corrupt, extractor), /No se pudo abrir el cómic/);
    const checked = await openArchive(tooBig, extractor);
    try {
      await assert.rejects(checked.read(0), /tamaño de imagen/);
    } finally { checked.close(); }

    const demo = path.join(work, 'Demo');
    const destination = path.join(work, 'Descargas');
    await mkdir(demo);
    await mkdir(destination);
    await copyFile(first, path.join(demo, 'Tomo 01.cbz'));
    await copyFile(first, path.join(demo, 'Tomo 02.cbz'));
    await writeFile(path.join(demo, 'Otro.txt'), 'archivo ajeno a la biblioteca');
    app = await electron.launch({ args: [root, '--user-data-dir=' + path.join(work, 'profile')], cwd: root });
    const page = await app.firstWindow();
    const errors = [];
    page.setDefaultTimeout(12_000);
    page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    await page.getByText('Aún no hay cómics.', { exact: true }).waitFor();
    await app.evaluate(({ dialog }, { first, manga, destination }) => {
      dialog.showOpenDialog = async (_window, options) => ({
        canceled: false, filePaths: options.properties.includes('openDirectory') ? [destination] : [first, manga]
      });
    }, { first, manga, destination });
    await button('Añadir archivos').click();
    await button('Ver en Mangas').click();
    await page.locator('.recent-title').getByText('Manga', { exact: true }).waitFor();
    await button('Cómics').click();
    await page.locator('.recent').filter({ hasText: 'Lector' }).click();
    await page.locator('#page-turn-tip').waitFor();
    await button('Cerrar consejo').click();
    await page.keyboard.press('ArrowRight');
    await page.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    await button('Pliego, inicio').click();
    await button('Recientes').click();
    await page.locator('.recent-title').getByText('Lector', { exact: true }).waitFor();
    await button('Cómics').click();

    seed = spawn(python, ['-I', '-B', path.join(__dirname, 'seed.py'), work], { windowsHide: true });
    const line = createInterface({ input: seed.stdout });
    const [magnet1, magnet2] = JSON.parse(await Promise.race([
      once(line, 'line').then(([value]) => value), once(seed, 'exit').then(([code]) => { throw Error('Fuente cerrada ' + code); }),
      delay(12_000, null, { ref: false }).then(() => { throw Error('No arrancó la fuente local'); })
    ]));
    for (const [index, magnet] of [magnet1, magnet2].entries()) {
      await button('Añadir por magnet o hash').click();
      await page.locator('#torrent-network-note').waitFor();
      await page.locator('#torrent-input').fill(magnet);
      await button('Buscar archivos').click();
      const ready = await waitJob(page, 'ready');
      assert.equal(ready.files.length, 2);
      if (index) await page.getByLabel(/Tomo 02\.cbz/).uncheck();
      await button('Cambiar').click();
      await page.locator('#torrent-folder').getByText(destination, { exact: true }).waitFor();
      await button('Descargar').click();
      const done = await waitJob(page, 'complete');
      assert.equal(done.imported, index ? 1 : 2);
      assert.deepEqual(await readFile(path.join(done.folder, 'Tomo 01.cbz')), await readFile(first));
      await assert.rejects(access(path.join(done.folder, 'Otro.txt')));
      if (index) await assert.rejects(access(path.join(done.folder, 'Tomo 02.cbz')));
      await button('Ver en Cómics').click();
      await page.locator('#torrent-dialog').waitFor({ state: 'hidden' });
    }
    await button('Demo').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    if (app) await app.close().catch(() => {});
    if (seed?.exitCode === null && seed?.signalCode === null) {
      seed.stdin.end();
      await once(seed, 'close');
    }
    await cleanTestDirectory(work);
  }
});
