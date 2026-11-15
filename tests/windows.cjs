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
const { createUpdateCheck } = require('../src/updates.cjs');

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

const updateRepository = 'https://github.com/harex-analysis/Pliego/releases';

function release(version, prerelease = false) {
  return {
    tag_name: 'v' + version, draft: false, prerelease,
    assets: [{ name: 'Pliego-Setup-x64.exe', state: 'uploaded',
      browser_download_url: updateRepository + '/download/v' + version + '/Pliego-Setup-x64.exe' }]
  };
}

test('consulta una vez y elige la versión superior con un instalador oficial', async () => {
  const beta = release('1.12.0', true);
  const foreign = release('8.0.0');
  foreign.assets[0].browser_download_url = 'https://github.com/otro/Pliego/releases/download/v8.0.0/Pliego-Setup-x64.exe';
  const pending = release('7.0.0');
  pending.assets[0].state = 'new';
  const candidates = [null, { ...release('9.0.0'), draft: true }, foreign, pending, release('1.2.0'),
    release('1.11.3'), { ...release('6.0.0'), assets: [] }, release('1.10.0'), beta, release('10.0.0\n')];
  let requests = 0;
  const check = createUpdateCheck('1.10.0', async (url, options) => {
    requests++;
    assert.equal(url, 'https://api.github.com/repos/harex-analysis/Pliego/releases?per_page=20');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(candidates);
  });
  assert.equal(check.releasePage(), null);
  const results = await Promise.all([check.check(), check.check()]);
  assert.deepEqual(results, [{ version: '1.12.0', prerelease: true }, { version: '1.12.0', prerelease: true }]);
  assert.equal(requests, 1);
  assert.equal(check.releasePage(), updateRepository + '/tag/v1.12.0');
});

test('la búsqueda de actualizaciones tolera una respuesta vacía, límites y fallas de red', async () => {
  for (const fetchRelease of [
    async () => Response.json([release('1.10.0'), release('1.9.2')]),
    async () => new Response(null, { status: 429 }),
    async () => new Response('respuesta incompleta'),
    async () => { throw Error('sin conexión'); }
  ]) {
    const check = createUpdateCheck('1.10.0', fetchRelease);
    assert.equal(await check.check(), null);
    assert.equal(check.releasePage(), null);
  }
});

test('el aviso de actualización abre la versión oficial al pulsar Descargar', { skip: Boolean(installed), timeout: 40_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-updates-'));
  let app;
  try {
    await writeFile(path.join(work, 'package.json'), JSON.stringify({
      name: 'pliego', version: '1.10.0', main: 'main.cjs'
    }));
    await writeFile(path.join(work, 'main.cjs'), `
      const { net, shell } = require('electron');
      globalThis.openedUpdates = [];
      net.fetch = async () => Response.json(${JSON.stringify([release('1.11.0', true)])});
      shell.openExternal = async url => { globalThis.openedUpdates.push(url); };
      require(${JSON.stringify(path.join(root, 'src', 'main.cjs'))});
    `);
    app = await electron.launch({ args: [work, '--user-data-dir=' + path.join(work, 'profile')], cwd: root });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    await page.getByText('Pliego 1.11.0 beta disponible', { exact: true }).waitFor();
    assert.deepEqual(await app.evaluate(() => globalThis.openedUpdates), []);
    await page.getByRole('button', { name: 'Descargar actualización', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#update-download').disabled);
    assert.deepEqual(await app.evaluate(() => globalThis.openedUpdates), [updateRepository + '/tag/v1.11.0']);
    await page.getByRole('button', { name: 'Ocultar aviso de actualización' }).click();
    await page.locator('#update-banner').waitFor({ state: 'hidden' });
    await page.getByText('Aún no hay cómics.', { exact: true }).waitFor();
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanTestDirectory(work);
  }
});

test('el ejecutable distribuido abre y lee un CBZ', { skip: !installed, timeout: 60_000 }, async () => {
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
    execFileSync(python, ['-I', '-B', '-c', 'import libtorrent; assert libtorrent.version'], { windowsHide: true });
  } finally {
    await browser?.close().catch(() => {});
    if (process?.exitCode === null && process?.signalCode === null) {
      process.kill();
      await once(process, 'close');
    }
    await cleanTestDirectory(work);
  }
});

test('renombra títulos individuales y en lote y conserva la lectura', { skip: Boolean(installed), timeout: 70_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-rename-'));
  const profile = path.join(work, 'profile');
  const launch = () => electron.launch({ args: [root, '--user-data-dir=' + profile], cwd: root });
  let app;
  try {
    const first = await comic(work, 'Saga 01 [Digital].cbz');
    const second = await comic(work, 'Saga 02 [Digital].cbz');
    app = await launch();
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    const button = name => page.getByRole('button', { name, exact: true });
    const card = name => page.locator('.recent').filter({ has: page.getByText(name, { exact: true }) });
    const visibleTitles = () => page.locator('.recent-title').allTextContents();
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
    }, [first, second]);
    await button('Añadir archivos').click();
    await card('Saga 01 [Digital]').click();
    await page.locator('#page-turn-tip-close').click();
    await button('Página siguiente').click();
    await page.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    await button('Pliego, inicio').click();

    await card('Saga 01 [Digital]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Renombrar…', exact: true }).click();
    const title = page.getByLabel('Título en Pliego', { exact: true });
    await title.fill('   ');
    assert.equal(await button('Guardar').isDisabled(), true);
    await title.fill('Saga 01 [Digital] (2025)');
    await title.press('Enter');
    await card('Saga 01 [Digital] (2025)').waitFor();
    await card('Saga 01 [Digital] (2025)').press('F2');
    await button('Restaurar título del archivo').click();
    await button('Guardar').click();
    await card('Saga 01 [Digital]').waitFor();

    await button('Seleccionar').click();
    await button('Seleccionar todo').click();
    const originals = await visibleTitles();
    await card(originals[0]).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Renombrar títulos…', exact: true }).click();
    const mode = page.getByLabel('Cómo renombrar', { exact: true });
    const previews = page.locator('.rename-row input');
    const values = () => previews.evaluateAll(inputs => inputs.map(input => input.value));
    assert.equal(await button('Guardar cambios').isDisabled(), true);
    await mode.selectOption('replace');
    await page.getByLabel('Buscar', { exact: true }).fill('[digital]');
    assert.deepEqual(await values(), originals.map(name => name.replace(' [Digital]', '')));
    await page.getByLabel('Reemplazar por', { exact: true }).fill('$&');
    assert.deepEqual(await values(), originals.map(name => name.replace(' [Digital]', () => ' $&')));
    await mode.selectOption('add');
    await page.getByLabel('Al principio', { exact: true }).fill('Edición');
    await page.getByLabel('Al final', { exact: true }).fill('Especial');
    assert.deepEqual(await values(), originals.map(name => 'Edición ' + name + ' Especial'));
    await mode.selectOption('number');
    await page.getByLabel('Título común (opcional)', { exact: true }).fill('Tomo');
    await page.getByLabel('Empezar en', { exact: true }).fill('-1');
    assert.equal(await button('Guardar cambios').isDisabled(), true);
    await page.getByLabel('Empezar en', { exact: true }).fill('7');
    assert.deepEqual(await values(), ['Tomo 07', 'Tomo 08']);
    await previews.first().fill('Especial');
    await page.getByLabel('Empezar en', { exact: true }).fill('8');
    assert.deepEqual(await values(), ['Especial', 'Tomo 09']);
    await button('Guardar cambios').click();
    await card('Tomo 09').waitFor();
    assert.deepEqual(await visibleTitles(), ['Especial', 'Tomo 09']);
    await button('Deshacer').click();
    await card(originals[0]).waitFor();
    assert.deepEqual(await visibleTitles(), originals);

    await page.locator('#selection-rename').click();
    await page.getByLabel('Nuevo título de Saga 01 [Digital]', { exact: true }).fill('Saga · Tomo 1');
    await button('Guardar cambios').click();
    await card('Saga · Tomo 1').waitFor();
    const reading = JSON.parse(await readFile(path.join(profile, 'reading.json'), 'utf8'));
    const book = reading.books.find(item => item.filename === first);
    assert.equal(book.title, 'Saga 01 [Digital]');
    assert.equal(book.customTitle, 'Saga · Tomo 1');
    assert.equal(book.page, 1);
    await access(first);
    await access(second);

    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.locator('.recent').filter({ hasText: 'Saga · Tomo 1' }).click();
    await reopened.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    assert.equal(await reopened.locator('#title').textContent(), 'Saga · Tomo 1');
  } finally {
    if (app) await app.close().catch(() => {});
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
    const paper = await page.locator('.sheet').first().boundingBox();
    const gripX = paper.x + paper.width * .64;
    const gripY = paper.y + paper.height * .44;
    const fold = page.locator('#curl:visible, #paper-fold:visible');
    await page.mouse.move(gripX, gripY);
    await page.mouse.down();
    await page.mouse.move(gripX, gripY + paper.height * .23);
    await fold.waitFor();
    await page.mouse.up();
    await fold.waitFor({ state: 'hidden' });
    await page.locator('#page-label').getByText('1 / 2', { exact: true }).waitFor();
    for (const [y, inward] of [[paper.y - 6, 1], [paper.y + paper.height + 6, -1]]) {
      await page.mouse.move(gripX, y);
      assert.equal(await page.locator('#stage').getAttribute('data-cursor'), 'fold');
      await page.mouse.down();
      await page.mouse.move(gripX - 18, y + inward * 25);
      await fold.waitFor();
      await page.mouse.up();
      await fold.waitFor({ state: 'hidden' });
    }
    await page.locator('#page-label').getByText('1 / 2', { exact: true }).waitFor();
    await page.mouse.move(gripX, gripY);
    await page.mouse.down();
    await fold.waitFor();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#curl');
      if (canvas.hidden) return !document.querySelector('#paper-fold').hidden;
      const gl = canvas.getContext('webgl');
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      return gl.getUniform(program, gl.getUniformLocation(program, 'uWave'))[0] > 4;
    });
    await page.mouse.move(gripX - paper.width * .48, gripY, { steps: 8 });
    await page.mouse.up();
    await page.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    await page.keyboard.press('ArrowLeft');
    await page.locator('#page-label').getByText('1 / 2', { exact: true }).waitFor();

    const cornerX = paper.x + .97 * paper.width;
    const cornerY = paper.y + .06 * paper.height;
    await page.mouse.move(cornerX, cornerY);
    await page.mouse.down();
    await fold.waitFor();
    await page.mouse.move(cornerX - .47 * paper.width, cornerY + .13 * paper.height, { steps: 9 });
    const webgl = await page.locator('#curl').isVisible();
    if (webgl) {
      await page.locator('#curl').evaluate(canvas => {
        window.cornerLanding = { maxFlex: 0 };
        function sample() {
          if (canvas.hidden) return;
          const gl = canvas.getContext('webgl');
          const program = gl.getParameter(gl.CURRENT_PROGRAM);
          const uniform = name => gl.getUniform(program, gl.getUniformLocation(program, 'u' + name));
          const flex = uniform('Flex');
          window.cornerLanding = { flex, axis: uniform('Axis'), tilt: uniform('Normal')[1],
            maxFlex: Math.max(flex, window.cornerLanding.maxFlex) };
          requestAnimationFrame(sample);
        }
        sample();
      });
    }
    await page.mouse.up();
    await page.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    if (webgl) {
      const landing = await page.evaluate(() => window.cornerLanding);
      assert.ok(landing.maxFlex > 3 && landing.flex < 1, 'La esquina se curva y se aplana al caer');
      assert.ok(Math.abs(landing.axis) < 8 && Math.abs(landing.tilt) < .025,
        'El pliegue de la esquina alcanza el lomo antes de cambiar la página');
    }
    await page.keyboard.press('ArrowLeft');
    await page.locator('#page-label').getByText('1 / 2', { exact: true }).waitFor();
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
