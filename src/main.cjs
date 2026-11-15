const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell } = require('electron');
const { readFile, writeFile, rename, stat } = require('node:fs/promises');
const path = require('node:path');
const { openArchive } = require('./archive.cjs');
const { createTransfers } = require('./torrent.cjs');
const { createUpdateCheck } = require('./updates.cjs');
const { addBook, applySuggestions, bookTitle, categories, findGroup, libraryView, loadLibrary, renameBooks,
  reorder, suggestGroups, updateGroup } = require('./library.cjs');

const appOrigin = 'pliego://lector';
const paperLab = !app.isPackaged && process.argv.includes('--pliego-paper-lab');
const readerUrl = appOrigin + (paperLab ? '/?papel' : '/');
if (paperLab && !process.argv.some(arg => /^--user-data-dir(?:=|$)/.test(arg))) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Pliego Laboratorio'));
}
const resources = path.join(__dirname, '..');
const extractor = path.join(app.isPackaged ? process.resourcesPath : resources, 'vendor', '7zip', '7z.exe');
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/reader.mjs': ['reader.mjs', 'text/javascript; charset=utf-8'],
  '/library.mjs': ['library.mjs', 'text/javascript; charset=utf-8'],
  '/library.css': ['library.css', 'text/css; charset=utf-8'],
  '/downloads.mjs': ['downloads.mjs', 'text/javascript; charset=utf-8'],
  '/curl.mjs': ['curl.mjs', 'text/javascript; charset=utf-8'],
  '/layout.mjs': ['layout.mjs', 'text/javascript; charset=utf-8'],
  '/roboto.woff2': ['roboto.woff2', 'font/woff2'],
  '/pliego.svg': ['../../assets/pliego.svg', 'image/svg+xml']
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'pliego', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

let window;
let archive;
let transfers;
let state = loadLibrary({});
let saves = Promise.resolve();
let openRequest = 0;
let awaitingQuit = false;
let quitReady = false;
const previews = new Map();
const previewJobs = new Map();
const previewQueue = [];
let runningPreviews = 0;

async function limitPreview(run) {
  if (runningPreviews >= 3) await new Promise(resolve => previewQueue.push(resolve));
  else runningPreviews++;
  try {
    return await run();
  } finally {
    const next = previewQueue.shift();
    if (next) next();
    else runningPreviews--;
  }
}

function thumbnail(page, height) {
  const source = nativeImage.createFromBuffer(page.data);
  if (source.isEmpty()) return page;
  const size = source.getSize();
  const scale = Math.min(1, height / size.height, height * 1.55 / size.width);
  const image = scale < 1 ? source.resize({ height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }) : source;
  return { type: 'image/jpeg', data: image.toJPEG(height > 500 ? 86 : 79) };
}

function pageResponse(page) {
  if (!page) return new Response(null, { status: 404 });
  return new Response(page.data, {
    headers: { 'Content-Type': page.type, 'Cache-Control': 'no-store' }
  });
}

async function loadPreview(kind, id, index) {
  const item = state.books.find(record => record.id === id && !record.removed);
  if (!item || index < 0 || index >= item.count || (kind === 'cover' ? index !== 0 : index !== item.page)) return null;
  const key = `${kind}/${id}/${index}`;
  if (previews.has(key)) return previews.get(key);
  if (previewJobs.has(key)) return previewJobs.get(key);

  const job = limitPreview(async () => {
    if (awaitingQuit || !state.books.some(record => record.id === id && !record.removed &&
        (kind === 'cover' || record.page === index))) return null;
    const current = archive?.id === id ? archive : null;
    const temporary = current ? null : await openArchive(item.filename, extractor);
    try {
      const page = await (temporary || current).read(index);
      if (!page) return null;
      const result = thumbnail(page, kind === 'cover' ? 390 : 620);
      if (result.data.length < 2 * 1024 * 1024) {
        previews.set(key, result);
        if (previews.size > 24) previews.delete(previews.keys().next().value);
      }
      return result;
    } finally {
      temporary?.close();
    }
  }).finally(() => previewJobs.delete(key));
  previewJobs.set(key, job);
  return job;
}

function argumentFile(args) {
  return args.find(arg => path.isAbsolute(arg) && /\.(cbr|cbz|rar|zip)$/i.test(arg));
}

let startupFile = argumentFile(process.argv);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, args) => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
    const file = argumentFile(args);
    if (!file) return;
    if (!window || window.webContents.isLoadingMainFrame()) startupFile = file;
    else window.webContents.send('reader:external-open', file);
  });
  app.whenReady().then(start);
}

async function start() {
  const statePath = path.join(app.getPath('userData'), 'reading.json');
  try {
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    state = loadLibrary(saved);
  } catch {}

  function save() {
    const content = JSON.stringify(state);
    saves = saves.catch(() => {}).then(async () => {
      await writeFile(statePath + '.tmp', content);
      await rename(statePath + '.tmp', statePath);
    });
    return saves;
  }

  protocol.handle('pliego', async request => {
    const url = new URL(request.url);
    if (url.host !== 'lector' || request.method !== 'GET') return new Response(null, { status: 404 });
    const asset = Object.hasOwn(files, url.pathname) ? files[url.pathname] : null;
    if (asset) {
      return new Response(await readFile(path.join(__dirname, 'ui', asset[0])), {
        headers: { 'Content-Type': asset[1] }
      });
    }
    const match = /^\/(comic|thumb|cover|preview)\/([a-f0-9]{32})\/(\d+)$/.exec(url.pathname);
    if (!match) return new Response(null, { status: 404 });
    const [, kind, id, number] = match;
    const index = Number(number);
    try {
      if (kind === 'cover' || kind === 'preview') return pageResponse(await loadPreview(kind, id, index));
      if (archive?.id !== id) return pageResponse(null);
      const page = await archive.read(index);
      return pageResponse(page && kind === 'thumb' ? thumbnail(page, 230) : page);
    } catch {
      return new Response(null, { status: 422 });
    }
  });

  function handle(channel, action) {
    ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== readerUrl) return null;
      return action(...args);
    });
  }

  const updates = createUpdateCheck(app.getVersion(), (...args) => net.fetch(...args));
  handle('updates:check', () => updates.check());
  handle('updates:open', async () => {
    const url = updates.releasePage();
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  async function open(file, category) {
    const request = ++openRequest;
    try {
      if (typeof file !== 'string' || !path.isAbsolute(file)) return { error: 'No se encontró el archivo.' };
      const next = await openArchive(file, extractor, { metadata: true });
      if (request !== openRequest) {
        next.close();
        return null;
      }
      const previous = archive;
      archive = next;
      previous?.close();
      for (const key of previews.keys()) {
        if (key.split('/')[1] === next.id) previews.delete(key);
      }
      const existing = state.books.find(item => item.id === next.id);
      const record = addBook(state, next, existing, category ?? 'comic');
      state.recentIds = [next.id, ...state.recentIds.filter(id => id !== next.id)];
      save().catch(console.error);
      return { id: next.id, title: bookTitle(record), count: next.count, page: record.page,
        category: record.category, rtl: record.rtl, library: libraryView(state) };
    } catch (error) {
      return request === openRequest ? { error: error.code === 'ENOENT' ? 'El archivo ya no está en esa ubicación.' : error.message } : null;
    }
  }

  async function importBooks(paths, category, groupName) {
    let added = 0;
    const addedCategories = new Set();
    const imports = [];
    const failures = [];
    for (const filename of new Set(paths)) {
      if (typeof filename !== 'string' || !path.isAbsolute(filename)) continue;
      let comic;
      try {
        comic = await openArchive(filename, extractor, { metadata: true });
        const prior = state.books.find(item => item.id === comic.id);
        const isNew = !prior || prior.removed;
        const record = addBook(state, comic, prior, category);
        imports.push(record);
        if (isNew) {
          added++;
          addedCategories.add(record.category);
        }
      } catch (error) {
        failures.push({ name: path.basename(filename), message: error.message });
      } finally {
        comic?.close();
      }
    }
    if (groupName && imports.length > 1) {
      const compare = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
      imports.sort((a, b) => compare.compare(a.title, b.title));
      for (const type of categories) {
        const ids = imports.filter(book => book.category === type).map(book => book.id);
        if (!ids.length) continue;
        const group = findGroup(state, type, groupName);
        if (group) group.books = [...new Set([...group.books, ...ids])];
        else updateGroup(state, { category: type, title: groupName, books: ids });
      }
    }
    await save();
    return { added, addedCategories: [...addedCategories], failures, imported: imports.length,
      importedCategories: [...new Set(imports.map(book => book.category))], library: libraryView(state) };
  }

  async function editLibrary(command, args = {}) {
    try {
      const ids = new Set(Array.isArray(args.ids) ? args.ids : [args.id]);
      const items = state.books.filter(book => ids.has(book.id) && !book.removed);
      const [item] = items;
      const group = state.groups.find(entry => entry.id === args.groupId);
      switch (command) {
        case 'rename': {
          const rollback = renameBooks(state, args.changes);
          try {
            await save();
          } catch (error) {
            rollback();
            save().catch(console.error);
            throw error;
          }
          return { library: libraryView(state) };
        }
        case 'read':
          for (const book of items) {
            book.read = args.value === true;
            book.unread = !book.read;
            if (book.unread) book.page = 0;
          }
          break;
        case 'category':
          if (!categories.has(args.category)) break;
          for (const book of items) {
            book.category = args.category;
            book.rtl = args.category === 'manga';
          }
          break;
        case 'reveal':
          if (!item) break;
          if (!(await stat(item.filename).catch(() => null))?.isFile()) throw Error('El archivo ya no está en esa ubicación.');
          shell.showItemInFolder(item.filename);
          return {};
        case 'remove':
          for (const book of items) book.removed = true;
          for (const collection of state.groups) collection.books = collection.books.filter(id => !ids.has(id));
          break;
        case 'restore': {
          const restored = new Set(state.books.filter(book => ids.has(book.id) && book.removed)
            .map(book => { book.removed = false; return book.id; }));
          for (const collection of state.groups) {
            const positions = args.positions?.[collection.id];
            if (!Array.isArray(positions)) continue;
            for (const [id, index] of positions) {
              if (restored.has(id) && Number.isInteger(index) && index >= 0 && !collection.books.includes(id)) {
                collection.books.splice(index, 0, id);
              }
            }
          }
          break;
        }
        case 'group-save': {
          if (args.groupId && !group) throw Error('El grupo ya no existe.');
          const category = group?.category ?? args.category;
          let books;
          if (Array.isArray(args.books)) {
            const requested = new Set(args.books);
            const visible = state.books.filter(book => !book.removed && book.category === category);
            const available = new Set(visible.map(book => book.id));
            // Retain the group's existing order and any titles moved to another category.
            const kept = group?.books.filter(id => !available.has(id) || requested.has(id)) ?? [];
            books = [...new Set([...kept, ...visible.filter(book => requested.has(book.id)).map(book => book.id)])];
          }
          updateGroup(state, { id: group?.id, category, title: args.name, books });
          break;
        }
        case 'group-delete':
          state.groups = state.groups.filter(entry => entry.id !== args.groupId);
          break;
        case 'memberships': {
          if (!item) break;
          const matching = new Set(items.filter(book => book.category === item.category).map(book => book.id));
          const sameCategory = [...ids].filter(id => matching.has(id));
          const additions = new Set(Array.isArray(args.add) ? args.add : []);
          const removals = new Set(Array.isArray(args.remove) ? args.remove : []);
          if (typeof args.name === 'string' && args.name.trim()) {
            additions.add(updateGroup(state, { category: item.category, title: args.name }).id);
          }
          for (const collection of state.groups) {
            if (collection.category !== item.category) continue;
            if (additions.has(collection.id)) collection.books = [...new Set([...collection.books, ...sameCategory])];
            else if (removals.has(collection.id)) collection.books = collection.books.filter(id => !ids.has(id));
          }
          break;
        }
        case 'order': {
          if (group) {
            reorder(group.books, args.id, args.target, args.after);
          } else if (!args.groupId && item?.category === args.category && categories.has(args.category)) {
            const ids = state.books.filter(book => !book.removed && book.category === args.category).map(book => book.id);
            if (!ids.includes(args.target)) break;
            reorder(ids, args.id, args.target, args.after);
            const items = new Map(state.books.map(book => [book.id, book]));
            let index = 0;
            state.books = state.books.map(book => !book.removed && book.category === args.category
              ? items.get(ids[index++]) : book);
          }
          break;
        }
        case 'apply':
          applySuggestions(state, args.category, args.proposals);
          break;
        default: throw Error('Acción de biblioteca desconocida.');
      }
      await save();
      return { library: libraryView(state) };
    } catch (error) {
      return { error: error.message };
    }
  }

  const comicFilter = [{ name: 'Cómics y mangas', extensions: ['cbr', 'cbz', 'rar', 'zip'] }];
  handle('reader:initial', () => {
    const file = startupFile;
    startupFile = undefined;
    return { settings: state.settings, pageTurnTipSeen: state.pageTurnTipSeen,
      library: libraryView(state), file, fullscreen: window.isFullScreen() };
  });
  handle('reader:choose', async category => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Abrir cómic', properties: ['openFile'],
      filters: comicFilter
    });
    return result.canceled ? null : open(result.filePaths[0], category);
  });
  handle('reader:open', open);
  handle('reader:recent', id => {
    const item = state.books.find(record => record.id === id && !record.removed);
    return item ? open(item.filename) : null;
  });
  handle('reader:progress', (id, page, rtl, turned) => {
    const item = state.books.find(record => record.id === id);
    if (!item || !Number.isInteger(page) || page < 0 || page >= item.count) return;
    if (turned && item.page !== page) item.unread = false;
    item.page = page;
    item.rtl = Boolean(rtl);
    save().catch(console.error);
  });
  handle('reader:settings', settings => {
    if (!settings || !['auto', 'single', 'double'].includes(settings.layout)) return;
    state.settings = {
      layout: settings.layout, motion: settings.motion !== false, sound: settings.sound === true
    };
    save().catch(console.error);
  });
  handle('reader:fullscreen', () => window.setFullScreen(!window.isFullScreen()));
  handle('reader:dismiss-page-turn-tip', async () => {
    if (state.pageTurnTipSeen) return;
    state.pageTurnTipSeen = true;
    await save();
  });
  handle('library:choose', async category => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Añadir a la biblioteca', properties: ['openFile', 'multiSelections'], filters: comicFilter
    });
    return result.canceled ? null : importBooks(result.filePaths, category);
  });
  handle('library:import', (paths, category) => Array.isArray(paths) ? importBooks(paths, category) : null);
  handle('library:edit', editLibrary);
  handle('library:suggest', async category => {
    for (const item of state.books) {
      if (item.removed || item.category !== category || item.meta !== undefined) continue;
      let comic;
      try {
        comic = await openArchive(item.filename, extractor, { metadata: true });
        item.meta = comic.metadata;
      } catch {} finally { comic?.close(); }
    }
    await save();
    return { suggestions: suggestGroups(state, category), library: libraryView(state) };
  });
  const defaultFolder = path.join(app.getPath('downloads'), 'Pliego');
  transfers = await createTransfers({
    runtime: path.join(app.isPackaged ? process.resourcesPath : resources, 'vendor', 'torrent'),
    dataDir: path.join(app.getPath('userData'), 'transfers'),
    defaultFolder,
    importBooks: async (...args) => {
      const result = await importBooks(...args);
      if (!window?.isDestroyed()) window?.webContents.send('library:changed', result.library);
      return result;
    },
    notify: job => {
      if (!window?.isDestroyed()) window?.webContents.send('torrent:changed', job);
    }
  });
  handle('torrent:initial', () => ({ job: transfers.view(), defaultFolder }));
  handle('torrent:command', (command, args) => transfers.command(command, args));
  handle('torrent:folder', async chosen => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Elegir carpeta de descarga', properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof chosen === 'string' ? chosen : defaultFolder
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('torrent:reveal', () => {
    const folder = transfers.view()?.folder;
    return folder ? shell.openPath(folder) : '';
  });

  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    title: paperLab ? 'Pliego · Laboratorio de papel' : 'Pliego', width: 1260, height: 880, minWidth: 580, minHeight: 460,
    backgroundColor: '#101010', show: false,
    icon: path.join(resources, 'assets', 'pliego.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#151515', symbolColor: '#dedede', height: 53 },
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('enter-full-screen', () => window.webContents.send('reader:fullscreen-changed', true));
  window.on('leave-full-screen', () => window.webContents.send('reader:fullscreen-changed', false));
  window.once('ready-to-show', () => window.show());
  await window.loadURL(readerUrl);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (quitReady) return;
  event.preventDefault();
  if (awaitingQuit) return;
  awaitingQuit = true;
  archive?.close();
  Promise.resolve(transfers?.close()).catch(console.error).then(() => saves).finally(() => {
    quitReady = true;
    app.quit();
  }).catch(console.error);
});
