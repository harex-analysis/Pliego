const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { open, stat } = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { imageSize } = require('image-size');

const run = promisify(execFile);
const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const imageTypes = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp'
};
const maxPageBytes = 80 * 1024 * 1024;
const maxCacheBytes = 48 * 1024 * 1024;
const maxPagePixels = 48_000_000;
const zipHeaders = new Set(['504b0304', '504b0506', '504b0606', '504b0708', '504b0000']);

async function archiveType(filename) {
  const file = await open(filename, 'r');
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const signature = header.toString('hex', 0, bytesRead);
    if (zipHeaders.has(signature.slice(0, 8))) return '-tzip';
    if (signature.startsWith('526172211a0700')) return '-trar';
    if (signature === '526172211a070100') return '-trar5';
    throw new Error('El archivo debe estar en formato ZIP o RAR.');
  } finally {
    await file.close();
  }
}

function checkImage(data) {
  let size;
  try { size = imageSize(data); } catch {
    throw new Error('La página tiene un formato de imagen no válido.');
  }
  if (!size.width || !size.height || size.width * size.height > maxPagePixels) {
    throw new Error('La página supera el tamaño de imagen admitido.');
  }
}

async function openArchive(filename, extractor, { metadata = false } = {}) {
  if (!/\.(cbr|cbz|rar|zip)$/i.test(filename)) {
    throw new Error('Elige un archivo CBR, CBZ, RAR o ZIP.');
  }
  if (!(await stat(filename)).isFile()) {
    throw new Error('Elige un archivo de cómic.');
  }
  const typeSwitch = await archiveType(filename);
  const options = { windowsHide: true, timeout: 45_000 };
  let listing;
  try {
    ({ stdout: listing } = await run(extractor, [
      'l', typeSwitch, '-slt', '-sccUTF-8', '-pPliego', '--', filename
    ], { ...options, maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    if (/password|encrypted/i.test(String(error.stderr))) {
      throw new Error('Este cómic está protegido con contraseña.');
    }
    throw new Error('No se pudo abrir el cómic. Revisa que el archivo esté completo.');
  }
  const section = listing.split(/^----------\r?$/m)[1] || '';
  let infoEntry;
  const entries = section.trim().split(/\r?\n\r?\n/).flatMap(block => {
    const fields = Object.fromEntries(block.split(/\r?\n/).flatMap(line => {
      const separator = line.indexOf(' = ');
      return separator < 0 ? [] : [[line.slice(0, separator), line.slice(separator + 3)]];
    }));
    const name = fields.Path;
    if (!name || fields.Folder === '+' || fields['Symbolic Link'] ||
        fields['Hard Link'] || /(^|[/\\])(__MACOSX|\.[^/\\]+)([/\\]|$)/.test(name)) return [];
    if (/^comicinfo\.xml$/i.test(name) && fields.Encrypted !== '+' && Number(fields.Size) <= 256 * 1024) {
      infoEntry = name;
    }
    const type = imageTypes[path.extname(name).toLowerCase()];
    return type ? [{ name, type, size: Number(fields.Size), encrypted: fields.Encrypted === '+' }] : [];
  });
  entries.sort((a, b) => collator.compare(a.name, b.name) || a.name.localeCompare(b.name));
  if (!entries.length) throw new Error('El archivo no contiene páginas de imagen compatibles.');
  if (entries.some(entry => entry.encrypted)) {
    throw new Error('Este cómic está protegido con contraseña.');
  }

  const id = createHash('sha256').update(path.resolve(filename).toLowerCase()).digest('hex').slice(0, 32);
  const cache = new Map();
  const pending = new Map();
  const controller = new AbortController();
  let cacheBytes = 0;

  async function read(index) {
    const entry = entries[index];
    if (!entry || entry.size > maxPageBytes || controller.signal.aborted) return null;
    if (cache.has(index)) {
      const page = cache.get(index);
      cache.delete(index);
      cache.set(index, page);
      return page;
    }
    if (pending.has(index)) return pending.get(index);
    const task = extract(index, entry).finally(() => pending.delete(index));
    pending.set(index, task);
    return task;
  }

  async function extract(index, entry) {
    const { stdout: data } = await run(extractor, [
      'x', typeSwitch, '-so', '-spd', '-y', '-pPliego', '--', filename, entry.name
    ], {
      ...options, signal: controller.signal, encoding: 'buffer', maxBuffer: maxPageBytes
    });
    if (data.length === 0 || (Number.isFinite(entry.size) && data.length !== entry.size)) {
      throw new Error('La imagen de la página está incompleta.');
    }
    checkImage(data);
    const page = { type: entry.type, data };
    if (data.length <= maxCacheBytes) {
      cache.set(index, page);
      cacheBytes += data.length;
      while (cacheBytes > maxCacheBytes) {
        const first = cache.keys().next().value;
        cacheBytes -= cache.get(first).data.length;
        cache.delete(first);
      }
    }
    return page;
  }

  let info;
  if (metadata) {
    info = {};
    if (infoEntry) {
      try {
        const { stdout: xml } = await run(extractor, [
          'x', typeSwitch, '-so', '-spd', '-y', '-pPliego', '--', filename, infoEntry
        ], { ...options, maxBuffer: 256 * 1024, encoding: 'buffer' });
        info = parseComicInfo(xml);
      } catch {}
    }
  }
  return {
    id, filename, title: path.parse(filename).name, count: entries.length, read, metadata: info,
    close() { controller.abort(); cache.clear(); }
  };
}

function parseComicInfo(data) {
  const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le' :
    data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8';
  const xml = new TextDecoder(encoding).decode(data).replace(/<!--[\s\S]*?-->/g, '');
  if (!/<ComicInfo(?:\s|>)/i.test(xml)) return {};
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  function field(tag) {
    const raw = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '\\s*>', 'i').exec(xml)?.[1] || '';
    return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, text, entity) => {
      if (text !== undefined) return text;
      if (entity[0] !== '#') return entities[entity.toLowerCase()];
      const hex = entity[1].toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).trim().replace(/\s+/g, ' ').slice(0, 120);
  }
  const manga = field('Manga').toLowerCase();
  return {
    series: field('Series'), volume: field('Volume'), issue: field('Number'),
    manga: manga === 'no' ? false : ['yes', 'yesandrighttoleft'].includes(manga) ? true : undefined,
    rtl: manga === 'yesandrighttoleft'
  };
}

module.exports = { openArchive, parseComicInfo };
