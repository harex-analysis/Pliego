const { randomUUID } = require('node:crypto');

const order = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
const categories = new Set(['comic', 'manga']);

function key(text) {
  return text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
}

function name(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 120) : '';
}

function loadLibrary(saved) {
  const entries = Array.isArray(saved.books) ? saved.books : saved.recent;
  const books = Array.isArray(entries) ? entries.map(item => ({
    ...item, category: categories.has(item.category) ? item.category : item.rtl ? 'manga' : 'comic',
    read: item.read === true, page: item.unread && !item.read ? 0 : item.page
  })) : [];
  return {
    books,
    recentIds: Array.isArray(saved.recentIds) ? saved.recentIds :
      books.filter(item => !Array.isArray(saved.books) || item.page > 0 || item.read).map(item => item.id),
    groups: Array.isArray(saved.groups) ? saved.groups : [],
    settings: saved.settings || {},
    pageTurnTipSeen: saved.pageTurnTipSeen === true
  };
}

function libraryView(state) {
  return {
    books: state.books.filter(item => !item.removed).map(({ id, title, page, count, category, read, unread }) =>
      ({ id, title, page, count, category, status: read ? 'read' : page > 0 && !unread ? 'reading' : 'unread' })),
    recentIds: state.recentIds,
    groups: state.groups
  };
}

function addBook(state, archive, existing, defaultCategory) {
  const meta = archive.metadata ?? existing?.meta;
  const category = existing?.category ?? (meta?.manga ? 'manga' : meta?.manga === false ? 'comic' : defaultCategory);
  const record = {
    ...existing, id: archive.id, filename: archive.filename, title: archive.title, count: archive.count,
    page: Math.max(0, Math.min(archive.count - 1, existing?.page || 0)),
    category: categories.has(category) ? category : 'comic',
    rtl: existing?.rtl ?? (meta?.rtl === true || (meta?.manga == null && category === 'manga')),
    read: existing?.read === true, removed: false, meta
  };
  if (existing) Object.assign(existing, record);
  else state.books.unshift(record);
  return record;
}

function findGroup(state, category, title) {
  const label = key(title);
  return state.groups.find(group => group.category === category && key(group.name) === label);
}

function updateGroup(state, { id, category, title, books }) {
  const existing = state.groups.find(group => group.id === id);
  const label = name(title ?? existing?.name);
  if (!label || !key(label)) throw Error('Escribe un nombre para el grupo.');
  const type = existing?.category ?? category;
  if (!categories.has(type)) throw Error('Elige Cómics o Mangas.');
  if (state.groups.some(group => group.id !== id && group.category === type && key(group.name) === key(label))) {
    throw Error('Ya hay un grupo con ese nombre.');
  }
  if (existing) {
    existing.name = label;
    if (books) existing.books = books;
    return existing;
  }
  const group = { id: randomUUID(), name: label, category: type, books: books || [] };
  state.groups.push(group);
  return group;
}

function reorder(items, id, anchor, after) {
  const index = items.indexOf(id);
  if (id === anchor || index === -1 || !items.includes(anchor)) return;
  items.splice(index, 1);
  items.splice(items.indexOf(anchor) + (after ? 1 : 0), 0, id);
}

function parseFilename(title) {
  const clean = title.normalize('NFKC').replace(/^(?:\s*\[[^\]]*\]\s*)+/u, '')
    .replace(/_/g, ' ').replace(/\s*\[[^\]]*\]/g, '')
    .replace(/(?:\s*\([^()]*\))+\s*$/u, '').trim();
  const volumePattern = /(?:^|[\s.\-–—])(?:v(?:ol(?:umen|ume)?|lm)?|t(?:omo|ome)?|book)\.?\s*([0-9]{1,4})(?![\d\p{L}])/iu;
  const issuePattern = /(?:(?:^|[\s.\-–—])(?:ch(?:apter|ap|p)?|c(?:ap[ií]tulo|ap)?|issue|episode|episodio|n[uú]m(?:ero)?)\.?\s*|#\s*)([0-9]{1,4}(?:\.\d+)?)(?![\d\p{L}])/iu;
  const volume = volumePattern.exec(clean);
  const issue = issuePattern.exec(clean);
  const marker = [volume, issue].filter(Boolean).sort((a, b) => a.index - b.index)[0];
  if (marker && marker.index > 0) {
    const series = clean.slice(0, marker.index).replace(/[\s.:–—-]+$/u, '');
    if (key(series)) return { series, volume: volume?.[1], issue: issue?.[1], reason: 'numbered' };
  }
  const numbered = /^(.*?)\s*[. –—-]\s*(\d{1,3}(?:\.\d+)?)\s*$/u.exec(clean);
  if (numbered && key(numbered[1])) {
    return { series: numbered[1].trim(), issue: numbered[2], reason: 'numbered' };
  }
  const divider = clean.search(/\s+[–—-]\s+|:\s+/u);
  if (divider > 0) {
    const series = clean.slice(0, divider).trim();
    if (key(series).split(' ').length >= 2) return { series, reason: 'subtitle' };
  }
  return { series: clean, reason: 'title' };
}

function compareVolumes(a, b) {
  function compareNumber(first, second) {
    if (first && second && Number.isFinite(Number(first)) && Number.isFinite(Number(second))) {
      return Number(first) - Number(second);
    }
    return order.compare(first || '', second || '');
  }
  return compareNumber(a.volume, b.volume) || compareNumber(a.issue, b.issue) || order.compare(a.item.title, b.item.title);
}

function suggestGroups(state, category) {
  if (!categories.has(category)) return [];
  const buckets = new Map();
  const existing = new Map(state.groups.filter(group => group.category === category)
    .map(group => [key(group.name), group]));
  for (const item of state.books) {
    if (item.removed || item.category !== category) continue;
    const parsed = parseFilename(item.title);
    if (item.meta?.series) Object.assign(parsed, {
      series: item.meta.series, volume: item.meta.volume || parsed.volume,
      issue: item.meta.issue || parsed.issue, reason: 'metadata'
    });
    const normalized = key(parsed.series);
    if (!normalized) continue;
    if (!buckets.has(normalized)) buckets.set(normalized, []);
    buckets.get(normalized).push({ ...parsed, item });
  }

  const candidates = [];
  const prefixRows = [];
  for (const [normalized, rows] of buckets) {
    const group = existing.get(normalized);
    if (rows.length < 2 && !group) {
      if (rows[0].reason === 'title') prefixRows.push(rows[0]);
      continue;
    }
    const additions = rows.filter(row => !group?.books.includes(row.item.id));
    if (!additions.length) continue;
    const strongest = rows.find(row => row.reason === 'metadata') || rows.find(row => row.reason === 'numbered') || rows[0];
    const tentative = strongest.reason === 'subtitle' || rows.some(row => row.reason === 'subtitle');
    candidates.push({
      name: group?.name ?? strongest.series, reason: tentative ? 'subtitle' : strongest.reason,
      groupId: group?.id, books: additions.sort(compareVolumes).map(row => ({ id: row.item.id, title: row.item.title }))
    });
  }

  // Look for shared beginnings only among files without a clear series name.
  // Longest matches claim their titles first and always require user review.
  const prefixes = new Map();
  for (const row of prefixRows) {
    const tokens = [...row.series.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu)];
    for (let length = 2; length < tokens.length && length <= 12; length++) {
      const end = tokens[length - 1];
      const label = row.series.slice(0, end.index + end[0].length);
      const normalized = key(label);
      if (!prefixes.has(normalized)) prefixes.set(normalized, { normalized, label, length, rows: [] });
      prefixes.get(normalized).rows.push(row);
    }
  }
  const claimed = new Set();
  const named = new Map(candidates.map(candidate => [key(candidate.name), candidate]));
  for (const prefix of [...prefixes.values()].sort((a, b) => b.length - a.length || order.compare(a.label, b.label))) {
    const group = existing.get(prefix.normalized);
    const candidate = named.get(prefix.normalized);
    const additions = prefix.rows.filter(row => !claimed.has(row.item.id) && !group?.books.includes(row.item.id));
    if (additions.length < (group || candidate ? 1 : 2)) continue;
    additions.forEach(row => claimed.add(row.item.id));
    const books = additions.sort(compareVolumes).map(row => ({ id: row.item.id, title: row.item.title, tentative: Boolean(candidate) }));
    if (candidate) candidate.books.push(...books);
    else candidates.push({ name: group?.name ?? prefix.label, reason: 'subtitle', groupId: group?.id, books });
  }
  return candidates.sort((a, b) => order.compare(a.name, b.name));
}

function applySuggestions(state, category, proposals) {
  if (!categories.has(category) || !Array.isArray(proposals)) throw Error('No se recibieron los grupos.');
  // Validate against today's proposals before making any edits.
  const candidates = new Map(suggestGroups(state, category).map(item => [item.name, item]));
  const groups = state.groups.map(group => ({ ...group, books: [...group.books] }));
  const draft = { ...state, groups };
  for (const proposal of proposals) {
    const candidate = candidates.get(proposal.source);
    if (!candidate || !Array.isArray(proposal.books)) throw Error('Vuelve a buscar sugerencias para actualizar la lista.');
    const allowed = new Set(proposal.books);
    const additions = candidate.books.map(item => item.id).filter(id => allowed.has(id));
    const target = groups.find(group => group.category === category && key(group.name) === key(name(proposal.name)));
    if (additions.length < (target ? 1 : 2)) throw Error('Elige al menos dos títulos para crear un grupo.');
    const group = target ?? updateGroup(draft, { category, title: proposal.name });
    group.books = [...new Set([...group.books, ...additions])];
  }
  state.groups = groups;
}

module.exports = { addBook, applySuggestions, categories, findGroup, libraryView, loadLibrary, reorder, suggestGroups, updateGroup };
