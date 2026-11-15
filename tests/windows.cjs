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
const launchSource = options => electron.launch({
  executablePath: path.join(root, '.cache', 'vendor', 'electron', 'electron.exe'), ...options
});
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

async function comic(parent, name, { manga = false, oversized = false, pageCount = 2 } = {}) {
  const pages = await mkdtemp(path.join(parent, 'pages-'));
  const image = Buffer.from(png);
  if (oversized) {
    image.writeUInt32BE(10_000, 16);
    image.writeUInt32BE(10_000, 20);
  }
  for (let page = 1; page <= pageCount; page++) {
    await writeFile(path.join(pages, String(page).padStart(2, '0') + '.png'), image);
  }
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
  assert.match(magnetLink(base + '&tr=udp%3A%2F%2Ftracker.example.org%3A80%2Fannounce'), /tr=udp/);
  assert.equal(magnetLink(base + '&dht=example.org:80&xs=https://example.org'), base);
  assert.equal(magnetLink(base + '&x.pe=1.1.1.1%3A6881'), base + '&x.pe=1.1.1.1:6881');
  assert.equal(magnetLink(base + '&x.pe=example.org:6881'), base);
  assert.throws(() => magnetLink(base + '&tr=file%3A%2F%2Ftest'), /rastreador/);
  assert.throws(() => magnetLink(base + '&ws=https%3A%2F%2Fuser%3Apass%40example.org'), /fuente web/);
});

test('el motor de descarga descarta direcciones locales', () => {
  execFileSync(python, ['-I', '-B', path.join(__dirname, 'torrent-worker.py'),
    path.join(vendor, 'torrent', 'worker.py')], { windowsHide: true });
});

test('reconoce ZIP por su contenido y descarta otros formatos', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-format-'));
  try {
    const zip = await comic(work, 'Correcto.cbz');
    const renamed = path.join(work, 'Correcto.cbr');
    await copyFile(zip, renamed);
    const archive = await openArchive(renamed, extractor);
    try { assert.deepEqual(await archive.read(0), { type: 'image/png', data: png }); } finally { archive.close(); }
    const other = path.join(work, 'Otro formato.cbz');
    const page = path.join(work, 'page.png');
    await writeFile(page, png);
    execFileSync(extractor, ['a', '-t7z', other, page], { windowsHide: true });
    await assert.rejects(openArchive(other, extractor), /formato ZIP o RAR/);
  } finally {
    await cleanTestDirectory(work);
  }
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
  for (const [status, fetchRelease] of [
    ['current', async () => Response.json([release('1.10.0'), release('1.9.2')])],
    ['unavailable', async () => new Response(null, { status: 429 })],
    ['unavailable', async () => new Response('respuesta incompleta')],
    ['unavailable', async () => { throw Error('sin conexión'); }]
  ]) {
    const check = createUpdateCheck('1.10.0', fetchRelease);
    assert.equal(await check.check(), null);
    assert.deepEqual(await check.refresh(), { status });
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
      globalThis.updateResponse = () => Response.json(${JSON.stringify([release('1.11.0', true)])});
      net.fetch = async () => globalThis.updateResponse();
      shell.openExternal = async url => { globalThis.openedUpdates.push(url); };
      require(${JSON.stringify(path.join(root, 'src', 'main.cjs'))});
    `);
    app = await launchSource({ args: [work, '--user-data-dir=' + path.join(work, 'profile')], cwd: root });
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
    const options = page.getByRole('button', { name: 'Opciones', exact: true });
    await app.evaluate(() => { globalThis.updateResponse = () => new Response(null, { status: 503 }); });
    await options.press('Enter');
    await page.getByRole('menuitem', { name: 'Buscar actualizaciones' }).press('Enter');
    const updates = page.getByRole('dialog', { name: 'Buscar actualizaciones' });
    await updates.getByText(/No se pudo comprobar/).waitFor();
    await app.evaluate(() => { globalThis.updateResponse = () => Response.json([]); });
    await delay(750);
    await updates.getByRole('button', { name: 'Reintentar' }).click();
    await updates.getByText('Pliego 1.10.0 está al día.').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement.id === 'library-options');
    await options.click();
    await page.getByRole('menuitem', { name: 'Ayuda y atajos' }).click();
    await page.getByRole('dialog', { name: 'Ayuda y atajos' }).getByText('Ctrl + O').waitFor();
    await page.keyboard.press('Escape');
    await options.click();
    await page.getByRole('menuitem', { name: 'Acerca de Pliego' }).click();
    await page.getByText('Versión instalada 1.10.0').waitFor();
    await page.getByRole('button', { name: 'Ver novedades en GitHub' }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Ver novedades en GitHub').disabled);
    assert.deepEqual(await app.evaluate(() => globalThis.openedUpdates),
      [updateRepository + '/tag/v1.11.0', updateRepository]);
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
    await page.getByRole('button', { name: 'Volver a la biblioteca', exact: true }).click();
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
  const launch = () => launchSource({ args: [root, '--user-data-dir=' + profile], cwd: root });
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
    await button('Volver a la biblioteca').click();
    assert.equal(await card('Saga 01 [Digital]').evaluate(control => control === document.activeElement), true);

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
    await reopened.getByRole('button', { name: 'Recientes', exact: true, pressed: true }).waitFor();
    await reopened.locator('.recent').filter({ hasText: 'Saga · Tomo 1' }).click();
    await reopened.locator('#page-label').getByText('2 / 2', { exact: true }).waitFor();
    assert.equal(await reopened.locator('#title').textContent(), 'Saga · Tomo 1');
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanTestDirectory(work);
  }
});

test('busca grupos y permite seleccionar portadas por área al crear un grupo', { skip: Boolean(installed), timeout: 45_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-groups-'));
  let app;
  try {
    const profile = path.join(work, 'profile');
    const groups = Array.from({ length: 24 }, (_, index) => ({
      id: 'comic-' + index, name: 'Colección antigua ' + (index + 1), category: 'comic', books: []
    }));
    groups.push({ id: 'manga', name: 'Edición de Tokio', category: 'manga', books: [] });
    await mkdir(profile);
    await writeFile(path.join(profile, 'reading.json'), JSON.stringify({ groups }));
    const first = await comic(work, 'Historias 1.cbz');
    const files = [first];
    for (let index = 2; index <= 8; index++) {
      const filename = path.join(work, 'Historias ' + index + '.cbz');
      await copyFile(first, filename);
      files.push(filename);
    }
    app = await launchSource({ args: [root, '--user-data-dir=' + profile], cwd: root });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    const button = name => page.getByRole('button', { name, exact: true });
    await app.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
    }, files);
    await button('Añadir archivos').click();
    await page.getByText('8 títulos añadidos.', { exact: true }).waitFor();
    assert.ok(await page.locator('#group-list').evaluate(list => list.scrollWidth > list.clientWidth));
    await button('Nuevo grupo').click();
    const picker = page.getByRole('dialog', { name: 'Nuevo grupo' });
    await picker.getByLabel('Nombre del grupo').fill('Lectura rápida');
    const boxes = picker.getByRole('checkbox');
    await boxes.last().check();
    const grid = await picker.locator('.picker-grid').boundingBox();
    const target = await picker.locator('.picker-card').nth(1).boundingBox();
    const start = { x: grid.x + 2, y: grid.y + 2 };
    const end = { x: target.x + target.width / 2, y: target.y + 70 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 7 });
    await picker.locator('#picker-selection-rectangle').waitFor();
    await picker.getByText('3 títulos seleccionados', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await picker.locator('#picker-selection-rectangle').waitFor({ state: 'hidden' });
    await page.mouse.up();
    await picker.getByText('1 título seleccionado', { exact: true }).waitFor();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 7 });
    await page.mouse.up();
    await picker.getByText('3 títulos seleccionados', { exact: true }).waitFor();
    await picker.getByRole('button', { name: 'Crear grupo', exact: true }).click();
    await page.getByRole('button', { name: 'Lectura rápida', exact: true, pressed: true }).waitFor();
    assert.equal(await page.locator('#recent-list .recent').count(), 3);
    assert.equal(await button('Opciones del grupo').evaluate(control => getComputedStyle(control).borderTopStyle), 'solid');

    const shelf = await page.locator('#recent-list').boundingBox();
    const card = await page.locator('.library-tile').nth(1).boundingBox();
    await page.mouse.move(shelf.x - 5, card.y + 8);
    await page.mouse.down();
    await page.mouse.move(card.x + card.width / 2, card.y + 64, { steps: 7 });
    await page.locator('#selection-rectangle').waitFor();
    await page.mouse.up();
    await page.getByText('2 títulos seleccionados', { exact: true }).waitFor();
    await button('Terminar selección').click();

    await button('Recientes').click();
    assert.equal(await button('Ver grupos').isVisible(), false);
    await button('Cómics').click();
    await button('Ver grupos').click();
    const browser = page.getByRole('dialog', { name: 'Grupos', exact: true });
    assert.ok(await browser.locator('.group-browser-list').evaluate(list => list.scrollHeight > list.clientHeight));
    await browser.getByLabel('Buscar grupos').fill('edicion de tokio');
    await browser.getByRole('button', { name: 'Edición de Tokio', exact: true }).click();
    await browser.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Mangas', exact: true, pressed: true }).waitFor();
    await page.getByRole('button', { name: 'Edición de Tokio', exact: true, pressed: true }).waitFor();
    assert.equal(await button('Ver grupos').isVisible(), true);
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanTestDirectory(work);
  }
});

test('guarda el tamaño de portadas y conserva el pliego al redimensionar el lector', { skip: Boolean(installed), timeout: 40_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-view-'));
  const profile = path.join(work, 'profile');
  const launch = () => launchSource({ args: [root, '--user-data-dir=' + profile], cwd: root });
  let app;
  try {
    const file = await comic(work, 'Lectura.cbz', { pageCount: 5 });
    app = await launch();
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    const button = name => page.getByRole('button', { name, exact: true });
    const columns = () => page.locator('#recent-list').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, file);
    await button('Añadir archivos').click();
    await button('Tamaño de portadas').click();
    await page.getByRole('menuitemradio', { name: 'Hasta 4 por fila' }).click();
    assert.equal(await columns(), 4);
    await page.locator('.recent').click();
    await page.waitForFunction(() => document.activeElement.id === 'stage');
    await button('Página siguiente').click();
    await page.getByText('2–3 / 5', { exact: true }).waitFor();
    const before = await page.locator('.sheet').first().boundingBox();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(580, 470));
    await page.waitForFunction(width => document.querySelector('.sheet').offsetWidth < width - 30, before.width);
    assert.equal(await page.locator('.sheet').count(), 2);
    assert.equal(await page.locator('#page-label').textContent(), '2–3 / 5');
    await button('Ajustes de lectura').click();
    await page.getByLabel('Vista de página').selectOption('single');
    await page.getByText('2 / 5', { exact: true }).waitFor();
    await button('Volver a la biblioteca').click();
    assert.equal(await columns(), 3);

    await app.close();
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', { name: 'Tamaño de portadas' }).click();
    const selected = reopened.getByRole('menuitemradio', { name: 'Hasta 4 por fila', checked: true });
    await selected.waitFor();
  } finally {
    if (app) await app.close().catch(() => {});
    await cleanTestDirectory(work);
  }
});

test('con zoom, el arrastre desplaza y el agarre gira la hoja sin perder la ampliación', { skip: Boolean(installed), timeout: 45_000 }, async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'pliego-zoom-'));
  let app;
  try {
    const file = await comic(work, 'Zoom.cbz');
    app = await launchSource({ args: [root, '--user-data-dir=' + path.join(work, 'profile'), file], cwd: root });
    const page = await app.firstWindow();
    page.setDefaultTimeout(8_000);
    await page.waitForFunction(() => document.activeElement.id === 'stage');
    const tip = page.locator('#page-turn-tip-close');
    if (await tip.isVisible()) await tip.click();
    const stage = await page.locator('#stage').boundingBox();
    const fold = page.locator('#curl:visible, #paper-fold:visible');
    const currentPage = page.locator('#page-label');
    const x = stage.x + stage.width * .66;
    const y = stage.y + stage.height * .55;
    const paper = () => page.locator('.sheet').first().boundingBox();

    await page.mouse.move(x, y);
    for (let i = 0; i < 7; i++) await page.keyboard.press('Equal');
    await page.locator('#zoom-reset').getByText('400 %', { exact: true }).waitFor();
    const before = await paper();
    await page.mouse.down();
    await page.mouse.move(x + 75, y - 112, { steps: 4 });
    await page.mouse.up();
    const after = await paper();
    assert.ok(Math.abs(after.x - before.x - 75) < 2);
    assert.ok(Math.abs(after.y - before.y + 112) < 2);
    assert.equal(await fold.count(), 0);
    assert.equal(await currentPage.textContent(), '1 / 2');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await fold.waitFor();
    await page.mouse.move(x - stage.width * .44, y, { steps: 10 });
    await page.mouse.up();
    await currentPage.getByText('2 / 2', { exact: true }).waitFor();
    assert.equal(await page.locator('#zoom-reset').textContent(), '400 %');
    const next = await paper();
    assert.ok(Math.abs(next.x - stage.x) < 2 && Math.abs(next.y - stage.y) < 2);

    const edge = stage.x + 12;
    await page.mouse.move(edge, y);
    await page.mouse.down();
    await page.mouse.move(edge, y - 100, { steps: 5 });
    await page.mouse.up();
    const scrolled = await paper();
    assert.ok(Math.abs(scrolled.y - next.y + 100) < 2);
    assert.equal(await fold.count(), 0);

    await page.mouse.move(edge, y);
    await page.mouse.down();
    await page.mouse.move(edge + stage.width * .43, y, { steps: 10 });
    await fold.waitFor();
    await page.mouse.up();
    await currentPage.getByText('1 / 2', { exact: true }).waitFor();
    await page.mouse.dblclick(x, y);
    await page.locator('#zoom-reset').getByText('100 %', { exact: true }).waitFor();
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
    await assert.rejects(openArchive(corrupt, extractor), /formato ZIP o RAR/);
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
    await writeFile(path.join(work, 'package.json'), JSON.stringify({ main: 'main.cjs' }));
    await writeFile(path.join(work, 'main.cjs'), `
      const transfers = require(${JSON.stringify(path.join(root, 'src', 'torrent.cjs'))});
      const createTransfers = transfers.createTransfers;
      transfers.createTransfers = options => createTransfers({ ...options,
        workerScript: ${JSON.stringify(path.join(__dirname, 'torrent-worker.py'))} });
      require(${JSON.stringify(path.join(root, 'src', 'main.cjs'))});
    `);
    app = await launchSource({ args: [work, '--user-data-dir=' + path.join(work, 'profile')], cwd: root });
    const page = await app.firstWindow();
    const errors = [];
    page.setDefaultTimeout(12_000);
    page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    await page.getByText('Aún no hay cómics.', { exact: true }).waitFor();
    await page.getByText('Arrastra un CBR o CBZ aquí', { exact: true }).waitFor();
    assert.equal(await button('Seleccionar').isVisible(), false);
    await app.evaluate(({ dialog }, { first, manga, destination }) => {
      dialog.showOpenDialog = async (_window, options) => ({
        canceled: false, filePaths: options.properties.includes('openDirectory') ? [destination] : [first, manga]
      });
    }, { first, manga, destination });
    await button('Añadir archivos').click();
    await button('Ver en Mangas').click();
    await page.locator('.recent-title').getByText('Manga', { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(590, 530));
    await page.waitForFunction(() => innerWidth <= 610);
    assert.equal(await page.locator('.library-tabs button').evaluateAll(tabs =>
      new Set(tabs.map(tab => tab.getBoundingClientRect().top)).size), 1);
    assert.equal(await page.locator('#welcome').evaluate(list => list.scrollWidth > list.clientWidth), false);
    await page.keyboard.press('Control+f');
    const search = page.getByRole('searchbox', { name: 'Buscar títulos en toda la biblioteca' });
    assert.equal(await search.evaluate(field => field === document.activeElement), true);
    await search.fill('LÉCTOR');
    await page.locator('.recent-title').getByText('Lector', { exact: true }).waitFor();
    assert.equal(await page.locator('.recent-category').textContent(), 'Cómics');
    await search.fill('sin coincidencias');
    await page.getByText('No se encontraron títulos.', { exact: true }).waitFor();
    await search.press('Escape');
    await page.locator('.recent-title').getByText('Manga', { exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1260, 880));
    await page.waitForFunction(() => innerWidth > 900);
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
    await button('Volver a la biblioteca').click();
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
