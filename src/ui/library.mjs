const categoryLabels = { manga: 'Mangas', comic: 'Cómics' };
const coverSizes = [
  ['auto', 'Automático'], ['9', 'Hasta 9 por fila'], ['6', 'Hasta 6 por fila'], ['4', 'Hasta 4 por fila']
];
const maxTitleLength = 255;

function searchText(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
}

function cardTitle(item) {
  return item.originalTitle === undefined
    ? item.title.replace(/\s+\(\d{4}\)(?:\s+\([^)]*\))*$/u, '') || item.title
    : item.title;
}

function validTitle(title) {
  return title.length > 0 && title.length <= maxTitleLength && !/\p{Cc}/u.test(title);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(text, className = 'button') {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

export function createLibrary({ byId, icon, openComic, notice }) {
  const api = window.pliego;
  const welcome = byId('welcome');
  const libraryTop = byId('library-top');
  const grid = byId('recent-list');
  const selectionRectangle = byId('selection-rectangle');
  const preview = byId('recent-preview');
  const previewImage = byId('preview-image');
  const menu = byId('library-menu');
  const dialog = byId('library-dialog');
  const form = byId('library-form');
  const body = byId('library-dialog-body');
  const error = byId('library-dialog-error');
  const submit = byId('library-submit');
  const cancel = byId('library-cancel');
  const toast = byId('library-toast');
  const toastActions = byId('library-toast-actions');
  const selectionCategory = byId('selection-category');
  const selectionRename = byId('selection-rename');
  const add = byId('library-add');
  const torrent = byId('torrent-open');
  const coverView = byId('library-cover-view');
  const options = byId('library-options');
  const suggest = byId('library-suggest');
  const search = byId('library-search');
  const groupList = byId('group-list');
  const groupBrowser = byId('group-browser');
  const newGroup = byId('group-new');
  const tabs = [...welcome.querySelectorAll('[data-category]')];
  let store = { books: [], groups: [], recentIds: [] };
  let category = 'comic';
  let recent = false;
  let selectedGroup;
  let hover;
  let observer;
  let dialogAction;
  let returnFocus;
  let menuAnchor;
  let toastTimer;
  let importing = false;
  let suggesting = false;
  let version;
  let availableUpdate;
  let updateTransfer = { phase: 'idle' };
  let updateDialog;
  let updateRequest = false;
  let submitting = false;
  let orderEditing = false;
  let selecting = false;
  let visibleIds = [];
  let selectionAnchor;
  let areaSelection;
  let areaFrame = 0;
  let drag;
  let savingDrag = false;
  const selectedBooks = new Set();
  const libraryArea = {
    scroller: welcome, rectangle: selectionRectangle, cards: grid, selected: selectedBooks,
    top: () => libraryTop.getBoundingClientRect().bottom,
    paint: paintSelection,
    onCommit: () => {
      selecting ||= selectedBooks.size > 0;
      selectionAnchor = undefined;
    }
  };

  function update(data, type = category) {
    if (!data) return;
    store = data;
    if (!recent && !search.value.trim() && type !== category) {
      category = type;
      selectedGroup = undefined;
      orderEditing = false;
      clearSelection();
    }
  }

  function progress(id, page, turned) {
    const item = store.books.find(book => book.id === id);
    if (!item) return;
    item.page = page;
    if (turned && item.status !== 'read') item.status = page > 0 ? 'reading' : 'unread';
  }

  function groups() {
    return store.groups.filter(group => group.category === category);
  }

  function selected() {
    return groups().find(group => group.id === selectedGroup);
  }

  function initialize(data, installedVersion, columns) {
    update(data);
    version = installedVersion;
    welcome.dataset.coverColumns = columns;
    const opened = new Set(store.recentIds);
    recent = store.books.some(item => opened.has(item.id));
    render();
  }

  function canSuggest() {
    const count = store.books.filter(item => item.category === category).length;
    return count >= (groups().length ? 1 : 2);
  }

  function paintAvailability() {
    add.disabled = torrent.disabled = importing || suggesting;
    suggest.disabled = importing || suggesting || !canSuggest();
    suggest.setAttribute('aria-busy', suggesting);
    const label = suggesting ? 'Buscando…' : 'Sugerir grupos';
    if (suggest.lastElementChild.textContent !== label) suggest.lastElementChild.textContent = label;
  }

  function render() {
    finishAreaSelection(false);
    hideOverlays();
    clearDrag();
    const categoryBooks = store.books.filter(item => item.category === category);
    const query = searchText(search.value.trim());
    const terms = query ? query.split(/\s+/u) : [];
    const index = new Map((recent ? store.books : categoryBooks).map(item => [item.id, item]));
    const group = recent ? undefined : selected();
    if (!group && !recent && selectedGroup) {
      selectedGroup = undefined;
      orderEditing = false;
    }
    const visible = query ? store.books.filter(item => {
      const title = searchText(item.title + ' ' + (item.originalTitle ?? ''));
      return terms.every(term => title.includes(term));
    }) : recent ? (store.recentIds || []).map(id => index.get(id)).filter(Boolean) :
      group ? group.books.map(id => index.get(id)).filter(Boolean) : categoryBooks;
    visibleIds = visible.map(item => item.id);
    const visibleSet = new Set(visibleIds);
    for (const id of selectedBooks) if (!visibleSet.has(id)) selectedBooks.delete(id);
    for (const tab of tabs) tab.setAttribute('aria-pressed', tab.dataset.category === (recent ? 'recent' : category));

    byId('library-controls').hidden = !store.books.length && !store.groups.length;
    byId('library-search-box').hidden = !store.books.length && !search.value;
    byId('library-search-clear').hidden = !search.value;
    groupList.hidden = Boolean(query) || recent || (!categoryBooks.length && !groups().length);
    newGroup.hidden = groupList.hidden;
    groupBrowser.hidden = recent || !store.groups.length;
    byId('library-groups').hidden = groupList.hidden && groupBrowser.hidden;
    suggest.hidden = groupList.hidden || !canSuggest();
    byId('library-order').hidden = Boolean(query) || recent || (!visible.length && !orderEditing);
    byId('library-order').disabled = visible.length < 2 && !orderEditing;
    byId('library-order').setAttribute('aria-pressed', orderEditing);
    byId('library-order').title = orderEditing ? 'Terminar de ordenar' : 'Ordenar portadas';
    byId('library-order').setAttribute('aria-label', byId('library-order').title);
    const all = groupButton('Todos', undefined, !group);
    groupList.replaceChildren(all, ...groups().map(item =>
      groupButton(item.name, item.id, item.id === group?.id)));
    byId('group-edit').hidden = !group || Boolean(query);
    byId('order-bar').hidden = !orderEditing;
    paintAvailability();

    const empty = byId('library-empty');
    empty.hidden = visible.length > 0;
    empty.querySelector('p').textContent = query ? 'No se encontraron títulos.' :
      recent ? 'Aquí aparecerán los títulos que abras.' : group ? 'Este grupo está vacío.' :
      category === 'manga' ? 'Aún no hay mangas.' : 'Aún no hay cómics.';
    byId('library-drop-hint').hidden = Boolean(query) || Boolean(group) || recent;
    observer?.disconnect();
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.src = entry.target.dataset.src;
        observer.unobserve(entry.target);
      }
    }, { root: welcome, rootMargin: '100px' });
    grid.replaceChildren(...visible.map((item, position) => card(item, group, position, visible.length, Boolean(query))));
    paintSelection();
  }

  function clearSelection() {
    selecting = false;
    selectionAnchor = undefined;
    selectedBooks.clear();
  }

  function paintSelection() {
    const count = selectedBooks.size;
    byId('library-select').hidden = orderEditing || !visibleIds.length;
    byId('library-actions').hidden = selecting;
    libraryTop.classList.toggle('is-selecting', selecting);
    byId('selection-bar').hidden = !selecting;
    byId('selection-count').textContent = count === 1 ? '1 título seleccionado' : count + ' títulos seleccionados';
    const selectedTypes = new Set(store.books.filter(item => selectedBooks.has(item.id)).map(item => item.category));
    selectionCategory.disabled = !count || savingDrag;
    selectionCategory.textContent = selectedTypes.size === 1
      ? 'Mover a ' + categoryLabels[selectedTypes.has('comic') ? 'manga' : 'comic']
      : 'Mover a…';
    if (selectedTypes.size > 1) selectionCategory.setAttribute('aria-haspopup', 'menu');
    else selectionCategory.removeAttribute('aria-haspopup');
    byId('selection-group').disabled = !count || savingDrag || selectedTypes.size > 1;
    byId('selection-group').title = selectedTypes.size > 1 ? 'Selecciona títulos de la misma pestaña para agruparlos' : '';
    selectionRename.disabled = !count || savingDrag;
    byId('selection-trash').disabled = !count || savingDrag;
    byId('selection-all').disabled = !visibleIds.length;
    byId('selection-all').textContent = count && count === visibleIds.length ? 'Deseleccionar todo' : 'Seleccionar todo';
    for (const tile of grid.children) {
      const selected = selectedBooks.has(tile.dataset.bookId);
      const control = tile.querySelector('.book-select');
      control.hidden = !selecting;
      control.firstElementChild.checked = selected;
      tile.classList.toggle('is-selected', selected);
      tile.querySelector('.recent').draggable = (selecting && selected) || orderEditing;
    }
  }

  function toggleBook(id, range = false) {
    selecting = true;
    const first = visibleIds.indexOf(selectionAnchor);
    const last = visibleIds.indexOf(id);
    if (range && first >= 0 && last >= 0) {
      visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1).forEach(id => selectedBooks.add(id));
    } else {
      if (selectedBooks.has(id)) selectedBooks.delete(id);
      else selectedBooks.add(id);
      selectionAnchor = id;
    }
    hidePreview();
    paintSelection();
  }

  function beginAreaSelection(event, surface) {
    if (areaSelection || event.pointerType !== 'mouse' || event.button !== 0) return;
    const { scroller, selected, top } = surface;
    const bounds = scroller.getBoundingClientRect();
    if (event.clientY < top() || event.clientX >= bounds.left + scroller.clientWidth ||
        event.clientY >= bounds.top + scroller.clientHeight) return;
    areaSelection = {
      ...surface, pointer: event.pointerId, startX: event.clientX, startY: event.clientY + scroller.scrollTop,
      x: event.clientX, y: event.clientY, original: new Set(selected),
      additive: surface.keepExisting || event.ctrlKey || event.metaKey, started: false
    };
  }

  function moveAreaSelection(event) {
    const area = areaSelection;
    if (area?.pointer !== event.pointerId) return;
    area.x = event.clientX;
    area.y = event.clientY;
    if (!area.started) {
      if (Math.hypot(area.x - area.startX, area.y + area.scroller.scrollTop - area.startY) < 5) return;
      area.started = true;
      area.scroller.setPointerCapture(event.pointerId);
      area.scroller.classList.add('is-selecting-area');
      hideOverlays();
      window.getSelection()?.removeAllRanges();
    }
    scheduleAreaSelection();
  }

  function scheduleAreaSelection() {
    if (areaSelection?.started && !areaFrame) areaFrame = requestAnimationFrame(() => {
      areaFrame = 0;
      paintAreaSelection(true);
    });
  }

  function paintAreaSelection(autoScroll) {
    const area = areaSelection;
    const { scroller, selected, cards, rectangle } = area;
    const viewport = scroller.getBoundingClientRect();
    const top = Math.max(viewport.top, area.top());
    const bottom = viewport.top + scroller.clientHeight;
    if (top >= bottom) return;
    if (autoScroll) {
      const edge = 28;
      const speed = area.y > bottom - edge ? Math.min(24, (area.y - bottom + edge) / 2) :
        area.y < top + edge ? -Math.min(24, (top + edge - area.y) / 2) : 0;
      const previous = scroller.scrollTop;
      if (speed) scroller.scrollTop += speed;
      if (scroller.scrollTop !== previous) scheduleAreaSelection();
    }
    const x = Math.max(viewport.left, Math.min(area.x, viewport.left + scroller.clientWidth));
    const y = Math.max(top, Math.min(area.y, bottom));
    const startY = area.startY - scroller.scrollTop;
    const rect = { left: Math.min(area.startX, x), right: Math.max(area.startX, x),
      top: Math.min(startY, y), bottom: Math.max(startY, y) };
    const shownTop = Math.max(top, rect.top);
    const next = area.additive ? new Set(area.original) : new Set();
    for (const tile of cards.children) {
      const bounds = tile.getBoundingClientRect();
      if (rect.left < bounds.right && rect.right > bounds.left &&
          rect.top < bounds.bottom && rect.bottom > bounds.top) next.add(tile.dataset.bookId);
    }
    Object.assign(rectangle.style, {
      left: rect.left + 'px', top: shownTop + 'px', width: Math.max(1, rect.right - rect.left) + 'px',
      height: Math.max(1, Math.min(bottom, rect.bottom) - shownTop) + 'px'
    });
    rectangle.hidden = false;
    if (next.size === selected.size && [...next].every(id => selected.has(id))) return;
    selected.clear();
    for (const id of next) selected.add(id);
    area.paint();
  }

  function finishAreaSelection(commit) {
    const area = areaSelection;
    if (!area) return;
    if (area.started && commit) paintAreaSelection(false);
    areaSelection = undefined;
    if (areaFrame) cancelAnimationFrame(areaFrame);
    areaFrame = 0;
    if (!area.started) return;
    const { scroller, rectangle, selected } = area;
    if (scroller.hasPointerCapture(area.pointer)) scroller.releasePointerCapture(area.pointer);
    scroller.classList.remove('is-selecting-area');
    rectangle.hidden = true;
    if (commit) area.onCommit?.();
    else {
      selected.clear();
      for (const id of area.original) selected.add(id);
    }
    area.paint();
  }

  function openGroup(id, type = category) {
    search.value = '';
    recent = false;
    update(store, type);
    selectedGroup = id;
    orderEditing = false;
    clearSelection();
    welcome.scrollTop = 0;
    render();
    const current = groupList.querySelector('[aria-pressed="true"]');
    current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return current;
  }

  function groupButton(name, id, active) {
    const control = button(name, 'button group-chip');
    control.setAttribute('aria-pressed', active);
    control.title = name;
    control.addEventListener('click', () => openGroup(id)?.focus({ preventScroll: true }));
    if (id) bindGroupDrop(control, id);
    return control;
  }

  function card(item, group, position, total, inSearch) {
    const tile = element('article', 'library-tile');
    tile.dataset.bookId = item.id;
    const open = button('', 'recent');
    open.title = item.title;
    const cover = element('span', 'recent-cover');
    const img = element('img');
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.dataset.src = '/cover/' + item.id + '/0';
    img.addEventListener('load', () => cover.classList.add('loaded'));
    cover.append(icon('book'), img);
    observer.observe(img);
    const details = element('span', 'recent-details');
    const title = cardTitle(item);
    const status = item.status === 'read' ? 'Leído' :
      item.status === 'unread' ? 'Sin leer' : 'Página ' + (item.page + 1) + ' de ' + item.count;
    details.append(element('span', 'recent-title', title), element('span', 'recent-page', status));
    if (inSearch) details.append(element('span', 'recent-category', categoryLabels[item.category]));
    if (item.status === 'reading') {
      const meter = element('span', 'recent-meter');
      meter.style.setProperty('--progress', ((item.page + 1) / item.count * 100) + '%');
      details.append(meter);
    }
    open.append(cover, details);
    open.addEventListener('click', event => {
      if (orderEditing || drag) return;
      if (selecting || event.ctrlKey || event.metaKey || event.shiftKey) {
        toggleBook(item.id, event.shiftKey);
      } else openComic(() => api.recent(item.id));
    });
    open.addEventListener('dragstart', event => startDrag(event, item));
    open.addEventListener('dragend', clearDrag);
    tile.append(open);
    const selector = checkRow('', false);
    selector.row.className = 'book-select';
    selector.check.setAttribute('aria-label', 'Seleccionar ' + title);
    selector.check.addEventListener('click', event => toggleBook(item.id, event.shiftKey));
    tile.append(selector.row);
    const more = button('', 'icon-button book-actions');
    more.setAttribute('aria-label', 'Opciones de ' + title);
    more.setAttribute('aria-haspopup', 'menu');
    more.append(icon('more'));
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect();
      showBookMenu(item, rect.left, rect.bottom + 4, more);
    });
    tile.append(more);
    tile.addEventListener('contextmenu', event => {
      event.preventDefault();
      const rect = cover.getBoundingClientRect();
      showBookMenu(item, event.clientX || rect.left, event.clientY || rect.top, more);
    });
    hoverCover(cover, item);
    if (orderEditing) {
      bindOrderDrop(tile, item, group);
      const controls = element('div', 'order-actions');
      for (const [offset, label, symbol, disabled] of [
        [-1, 'Mover antes', 'left', position === 0], [1, 'Mover después', 'right', position === total - 1]
      ]) {
        const control = button('', 'icon-button');
        control.title = label;
        control.setAttribute('aria-label', label + ': ' + title);
        control.append(icon(symbol));
        control.disabled = disabled;
        control.addEventListener('click', () => orderBook(group, item, offset));
        controls.append(control);
      }
      tile.append(controls);
    }
    return tile;
  }

  function hoverCover(cover, item) {
    function begin(event) {
      if (event.pointerType !== 'mouse' || !menu.hidden || dialog.open || selecting || orderEditing || drag) return;
      hidePreview();
      const target = { x: event.clientX, y: event.clientY, cover };
      hover = target;
      target.timer = setTimeout(() => showPreview(item, target), 360);
    }
    cover.addEventListener('pointerenter', begin);
    cover.addEventListener('pointermove', event => {
      if (hover?.cover !== cover) {
        if (!event.buttons) begin(event);
        return;
      }
      hover.x = event.clientX;
      hover.y = event.clientY;
      if (!preview.hidden) positionPreview();
    });
    cover.addEventListener('pointerleave', hidePreview);
    cover.addEventListener('pointerdown', hidePreview);
  }

  function hidePreview() {
    clearTimeout(hover?.timer);
    hover = undefined;
    preview.hidden = true;
  }

  function positionPreview() {
    const { x, y } = hover;
    const gap = 17;
    const width = preview.offsetWidth;
    const height = preview.offsetHeight;
    preview.style.left = Math.max(8, x + gap + width <= innerWidth - 8 ? x + gap : x - gap - width) + 'px';
    preview.style.top = Math.max(8, y + gap + height <= innerHeight - 8 ? y + gap : y - gap - height) + 'px';
  }

  async function showPreview(item, target) {
    if (hover !== target || welcome.hidden) return;
    byId('preview-page').textContent = 'Página ' + (item.page + 1) + ' de ' + item.count;
    const message = byId('preview-message');
    const source = new Image();
    source.src = '/preview/' + item.id + '/' + item.page;
    message.hidden = false;
    message.textContent = 'Cargando página…';
    previewImage.hidden = true;
    preview.hidden = false;
    positionPreview();
    try {
      await source.decode();
      if (hover !== target) return;
      previewImage.src = source.src;
      previewImage.width = source.naturalWidth;
      previewImage.height = source.naturalHeight;
      previewImage.hidden = false;
      message.hidden = true;
    } catch {
      if (hover !== target) return;
      message.textContent = 'Vista previa no disponible';
    }
    positionPreview();
  }

  function closeMenu(focus = false) {
    menu.hidden = true;
    if (menuAnchor?.hasAttribute('aria-expanded')) menuAnchor.setAttribute('aria-expanded', false);
    if (focus && menuAnchor?.isConnected) menuAnchor.focus({ preventScroll: true });
    menuAnchor = undefined;
  }

  function hideOverlays() {
    hidePreview();
    closeMenu();
  }

  function showMenu(actions, x, y, anchor) {
    hidePreview();
    closeMenu();
    menuAnchor = anchor;
    if (anchor.hasAttribute('aria-expanded')) anchor.setAttribute('aria-expanded', true);
    menu.replaceChildren(...actions.map(([label, run, separated, checked]) => {
      const item = button(label, separated ? 'separated' : '');
      item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemradio');
      if (checked !== undefined) item.setAttribute('aria-checked', checked);
      item.addEventListener('click', () => {
        closeMenu(true);
        run();
      });
      return item;
    }));
    menu.hidden = false;
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild).focus({ preventScroll: true });
  }

  function toggleMenu(anchor, actions) {
    if (menuAnchor === anchor) {
      closeMenu(true);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    showMenu(actions, rect.left, rect.bottom + 5, anchor);
  }

  function moveCategory(ids, category) {
    const label = categoryLabels[category];
    const feedback = ids.length === 1 ? 'Movido a ' + label + '.' : ids.length + ' títulos movidos a ' + label + '.';
    return action('category', { ids, category }, feedback);
  }

  function categoryActions(titles) {
    return Object.entries(categoryLabels).flatMap(([category, label]) => {
      const ids = titles.filter(book => book.category !== category).map(book => book.id);
      return ids.length ? [['Mover a ' + label, () => moveCategory(ids, category)]] : [];
    });
  }

  function selectedTitles() {
    const index = new Map(store.books.filter(book => selectedBooks.has(book.id)).map(book => [book.id, book]));
    return visibleIds.filter(id => index.has(id)).map(id => index.get(id));
  }

  function showBookMenu(item, x, y, anchor) {
    const titles = selectedBooks.has(item.id) ? selectedTitles() : [item];
    if (titles.length > 1) {
      const ids = titles.map(book => book.id);
      const sameType = titles.every(book => book.category === item.category);
      showMenu([
        ['Renombrar títulos…', () => renameTitles(titles, anchor)],
        ['Marcar como leídos', () => action('read', { ids, value: true })],
        ['Marcar como no leídos', () => action('read', { ids, value: false })],
        ...(sameType ? [['Añadir a grupo…', () => membership(titles, anchor)]] : []),
        ...categoryActions(titles),
        ['Quitar de Pliego', () => removeBooks(ids), true]
      ], x, y, anchor);
      return;
    }
    showMenu([
      ['Renombrar…', () => renameTitles([item], anchor)],
      ...(item.status !== 'read' ? [['Marcar como leído', () => action('read', { id: item.id, value: true })]] : []),
      ...(item.status !== 'unread' || item.page > 0
        ? [['Marcar como no leído', () => action('read', { id: item.id, value: false })]] : []),
      ['Añadir a grupo…', () => membership(titles, anchor)],
      ...categoryActions(titles),
      ['Mostrar en el Explorador', () => action('reveal', { id: item.id })],
      ['Quitar de Pliego', () => removeBooks([item.id]), true]
    ], x, y, anchor);
  }

  menu.addEventListener('keydown', event => {
    const items = [...menu.children];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    } else if (event.key === 'Tab') closeMenu(true);
  });

  function clearMessage() {
    clearTimeout(toastTimer);
    toast.hidden = true;
    toastActions.replaceChildren();
  }

  async function checkUpdates() {
    const [update, transfer] = await Promise.all([
      api.checkUpdates().catch(() => null), api.updateTransfer().catch(() => null)
    ]);
    if (transfer) updateTransfer = transfer;
    if (update) announceUpdate(update);
    else if (updateTransfer.phase !== 'idle') {
      byId('update-banner').hidden = false;
      paintUpdate();
    }
  }

  function updateText(update) {
    return 'Pliego ' + update.version + (update.prerelease ? ' beta' : '') + ' disponible';
  }

  function announceUpdate(update) {
    if (availableUpdate?.version !== update.version) byId('update-banner').hidden = false;
    availableUpdate = update;
    paintUpdate();
  }

  function paintUpdate() {
    const { phase, percentage, version, error } = updateTransfer;
    let text;
    let label;
    if (phase === 'downloading') {
      text = `Descargando Pliego ${version} · ${percentage} %`;
      label = 'Cancelar descarga';
    } else if (phase === 'ready') {
      text = error || `Pliego ${version} descargado y verificado`;
      label = 'Instalar y reiniciar';
    } else if (phase === 'installing') {
      text = `Abriendo el instalador de Pliego ${version}…`;
      label = 'Instalar y reiniciar';
    } else if (availableUpdate) {
      text = error || updateText(availableUpdate);
      label = availableUpdate.canDownload ? 'Descargar actualización' : 'Ver actualización en GitHub';
    } else return;
    for (const [status, control] of [[byId('update-message'), byId('update-download')],
      [updateDialog?.status, updateDialog?.control]]) {
      if (!status?.isConnected) continue;
      status.textContent = text;
      control.hidden = false;
      control.textContent = label;
      control.disabled = updateRequest || phase === 'installing';
    }
  }

  async function runUpdate() {
    if (updateRequest) return;
    updateRequest = true;
    paintUpdate();
    try {
      const { phase } = updateTransfer;
      if (phase === 'downloading') await api.cancelUpdate();
      else if (phase === 'ready') await api.installUpdate();
      else if (availableUpdate?.canDownload) {
        if (!await api.downloadUpdate()) throw Error();
      }
      else if (!await api.openUpdate()) throw Error();
    } catch {
      updateTransfer = { ...updateTransfer, error: 'No se pudo continuar con la actualización. Inténtalo de nuevo.' };
    } finally {
      updateRequest = false;
      paintUpdate();
    }
  }

  async function openRelease(open, control) {
    control.disabled = true;
    const opened = await open().catch(() => false);
    control.disabled = false;
    return opened;
  }

  function showUpdateCheck() {
    const content = element('div', 'info-content');
    const status = element('p');
    status.setAttribute('role', 'status');
    const control = button('', 'button secondary');
    content.append(status, control);
    showDialog('Buscar actualizaciones', content, '', undefined, options);

    async function check() {
      if (document.activeElement === control) cancel.focus();
      control.hidden = true;
      status.textContent = 'Buscando actualizaciones…';
      const result = await api.refreshUpdates().catch(() => null);
      if (!dialog.open || !status.isConnected) return;
      if (result?.status === 'available') {
        updateDialog = { status, control };
        control.onclick = runUpdate;
        announceUpdate(result.update);
      } else if (result?.status === 'current') {
        byId('update-banner').hidden = true;
        availableUpdate = undefined;
        status.textContent = 'Pliego ' + version + ' está al día.';
        return;
      } else {
        status.textContent = 'No se pudo comprobar si hay actualizaciones. Inténtalo de nuevo.';
        control.textContent = 'Reintentar';
        control.onclick = check;
      }
      control.hidden = false;
    }
    if (['downloading', 'ready', 'installing'].includes(updateTransfer.phase)) {
      updateDialog = { status, control };
      control.onclick = runUpdate;
      paintUpdate();
    } else check();
  }

  function showHelp() {
    const shortcuts = element('dl', 'shortcut-list');
    for (const [title, keys] of [
      ['Añadir archivos', 'Ctrl + O'], ['Buscar títulos', 'Ctrl + F'],
      ['Renombrar en la biblioteca', 'F2'], ['Seleccionar varios títulos', 'Ctrl + clic / Mayús + clic'],
      ['Pasar página', 'Flechas / Espacio'], ['Ver miniaturas', 'T'],
      ['Ir a una página', 'G'], ['Pantalla completa', 'F11']
    ]) {
      shortcuts.append(element('dt', '', title), element('dd', '', keys));
    }
    const content = element('div', 'info-content');
    content.append(
      element('p', '', 'Arrastra una página para girarla. En la biblioteca, arrastra desde un espacio vacío para seleccionar portadas.'),
      element('p', '', 'Con zoom, arrastra para moverte por la página. Para girarla, mantén pulsado un instante sobre el papel y luego arrastra.'),
      shortcuts
    );
    showDialog('Ayuda y atajos', content, '', undefined, options);
  }

  function showAbout() {
    const content = element('div', 'info-content');
    const notes = button('Ver novedades en GitHub', 'button secondary');
    const status = element('p');
    status.setAttribute('role', 'status');
    notes.addEventListener('click', async () => {
      status.textContent = await openRelease(api.openReleaseNotes, notes) ? '' : 'No se pudieron abrir las novedades en GitHub.';
    });
    content.append(element('p', '', 'Versión instalada ' + version), notes, status);
    showDialog('Acerca de Pliego', content, '', undefined, options);
  }

  function scheduleMessageHide(delay) {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (!toast.matches(':hover, :focus-within')) clearMessage();
    }, delay);
  }

  function message(text, actions = []) {
    clearMessage();
    toast.querySelector('span').textContent = text;
    toastActions.append(...actions.map(([label, run]) => {
      const control = button(label);
      control.addEventListener('click', () => { clearMessage(); run(); });
      return control;
    }));
    toast.hidden = false;
    scheduleMessageHide(actions.length ? 10000 : 6800);
  }
  toast.addEventListener('pointerleave', () => scheduleMessageHide(6800));
  toast.addEventListener('focusout', () => scheduleMessageHide(6800));

  async function edit(command, args) {
    const result = await api.editLibrary(command, args);
    if (!result || result.error) throw Error(result?.error || 'No se pudo actualizar la biblioteca.');
    if (result.library) {
      update(result.library);
      render();
    }
  }

  async function action(command, args, feedback) {
    try {
      await edit(command, args);
      if (feedback) message(feedback);
      return true;
    } catch (failure) {
      message(failure.message);
      return false;
    }
  }

  async function removeBooks(ids) {
    const removing = new Set(ids);
    const positions = Object.fromEntries(store.groups.map(group => [group.id,
      group.books.map((id, index) => [id, index]).filter(([id]) => removing.has(id))]));
    if (await action('remove', { ids })) {
      message(ids.length === 1 ? 'Título quitado de Pliego.' : ids.length + ' títulos quitados de Pliego.',
        [['Deshacer', () => action('restore', { ids, positions }, 'Títulos devueltos a la biblioteca.')]]);
    }
  }

  function showDialog(title, content, label, run, anchor) {
    finishAreaSelection(false);
    hideOverlays();
    returnFocus = anchor;
    suggest.setAttribute('aria-expanded', anchor === suggest);
    dialog.classList.remove('with-cover-picker', 'with-book-rename', 'with-group-browser');
    byId('library-dialog-title').textContent = title;
    body.replaceChildren(content);
    submit.textContent = label;
    submit.hidden = !run;
    cancel.textContent = run ? 'Cancelar' : 'Cerrar';
    error.hidden = true;
    submit.disabled = false;
    dialogAction = run;
    if (!dialog.open) dialog.showModal();
    const firstInput = body.querySelector('input:not([type="checkbox"]), input[type="checkbox"]');
    if (firstInput || !run) (firstInput || cancel).focus();
  }

  function closeDialog() {
    if (!submitting) dialog.close();
  }

  dialog.addEventListener('close', () => {
    if (areaSelection?.scroller === body) finishAreaSelection(false);
    suggest.setAttribute('aria-expanded', false);
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    dialogAction = undefined;
    updateDialog = undefined;
  });
  dialog.addEventListener('cancel', event => { if (submitting) event.preventDefault(); });
  byId('library-cancel').addEventListener('click', closeDialog);
  byId('library-dialog-close').addEventListener('click', closeDialog);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!dialogAction || submitting) return;
    submitting = true;
    submit.disabled = true;
    error.hidden = true;
    try {
      await dialogAction();
      dialog.close();
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      submit.disabled = false;
    } finally {
      submitting = false;
    }
  });

  function textInput(value, label, maxLength = 120) {
    const input = element('input');
    input.type = 'text';
    input.value = value;
    input.maxLength = maxLength;
    input.setAttribute('aria-label', label);
    input.spellcheck = false;
    return input;
  }

  function renameField(label, control) {
    const field = element('label', 'rename-field');
    control.setAttribute('aria-label', label);
    field.append(element('span', '', label), control);
    return field;
  }

  async function saveTitles(changes, titles, anchor) {
    const previous = new Map(titles.map(item => [item.id, item]));
    const undo = changes.map(({ id }) => {
      const item = previous.get(id);
      return { id, title: item.originalTitle === undefined ? null : item.title };
    });
    const anchorId = anchor?.closest('.library-tile')?.dataset.bookId;
    await edit('rename', { changes });
    if (anchorId) {
      returnFocus = [...grid.children].find(tile => tile.dataset.bookId === anchorId)?.querySelector('.recent');
    }
    message(changes.length === 1 ? 'Título renombrado.' : changes.length + ' títulos renombrados.',
      [['Deshacer', () => action('rename', { changes: undo }, 'Cambios deshechos.')]]);
  }

  function renameTitles(titles, anchor) {
    if (!titles.length || savingDrag) return;
    if (titles.length > 1) {
      renameBatch(titles, anchor);
      return;
    }

    const [item] = titles;
    const original = cardTitle(item);
    const input = textInput(original, 'Título en Pliego', maxTitleLength);
    const content = element('div', 'rename-books');
    content.append(renameField('Título en Pliego', input));
    if (item.originalTitle !== undefined) {
      const restore = button('Restaurar título del archivo');
      restore.addEventListener('click', () => {
        input.value = item.originalTitle;
        refresh();
        input.focus();
        input.select();
      });
      content.append(restore);
    }
    function refresh() {
      const title = input.value.trim();
      submit.disabled = !validTitle(title) || title === original;
    }
    input.addEventListener('input', refresh);
    showDialog('Renombrar título', content, 'Guardar', () => {
      const title = input.value.trim();
      return saveTitles([{ id: item.id, title: title === item.originalTitle ? null : title }], titles, anchor);
    }, anchor);
    refresh();
    input.select();
  }

  function renameBatch(titles, anchor) {
    const content = element('div', 'rename-books');
    const mode = element('select');
    for (const [value, label] of [
      ['manual', 'Editar uno por uno'], ['replace', 'Buscar y reemplazar'],
      ['add', 'Añadir texto'], ['number', 'Numerar en este orden']
    ]) {
      const option = element('option', '', label);
      option.value = value;
      mode.append(option);
    }
    const controls = element('div', 'rename-options');
    const search = textInput('', 'Buscar', maxTitleLength);
    const replacement = textInput('', 'Reemplazar por', maxTitleLength);
    replacement.placeholder = 'Deja vacío para quitar el texto';
    const prefix = textInput('', 'Al principio', maxTitleLength);
    const suffix = textInput('', 'Al final', maxTitleLength);
    const base = textInput('', 'Título común (opcional)', maxTitleLength);
    base.placeholder = 'Ej. Absolute Batman · Tomo';
    const start = element('input');
    start.type = 'number';
    start.value = 1;
    start.min = 0;
    start.max = 999999;
    const options = {
      replace: [renameField('Buscar', search), renameField('Reemplazar por', replacement)],
      add: [renameField('Al principio', prefix), renameField('Al final', suffix)],
      number: [renameField('Título común (opcional)', base), renameField('Empezar en', start)]
    };
    const list = element('div', 'rename-list');
    const heading = element('div', 'rename-row rename-heading');
    heading.append(element('span', '', 'Título actual'), element('span', '', 'Nuevo título'));
    list.append(heading);
    const summary = element('p', 'rename-summary');
    summary.setAttribute('role', 'status');
    let changes = [];
    const rows = titles.map(item => {
      const original = cardTitle(item);
      const input = textInput(original, 'Nuevo título de ' + original, maxTitleLength);
      const row = element('label', 'rename-row');
      const name = element('span', 'rename-original', original);
      name.title = original;
      row.append(name, input);
      list.append(row);
      const entry = { item, original, input, suggested: original, edited: false };
      input.addEventListener('input', () => {
        entry.edited = input.value !== entry.suggested;
        refresh();
      });
      return entry;
    });

    function refresh() {
      const first = start.valueAsNumber;
      const badStart = mode.value === 'number' && (!Number.isInteger(first) || !start.validity.valid);
      const digits = Math.max(2, String(first + rows.length - 1).length);
      const common = base.value.trim();
      const pattern = mode.value === 'replace' && search.value
        ? new RegExp(search.value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'giu')
        : null;
      changes = [];
      let invalid = false;
      for (const [index, row] of rows.entries()) {
        const { item, original, input } = row;
        let next = original;
        if (pattern) next = original.replace(pattern, () => replacement.value).trim();
        if (mode.value === 'add') next = [prefix.value.trim(), original, suffix.value.trim()].filter(Boolean).join(' ');
        if (mode.value === 'number' && !badStart) {
          const number = String(first + index).padStart(digits, '0');
          next = common ? common + ' ' + number : number + ' · ' + original;
        }
        row.suggested = next;
        if (!row.edited && input.value !== next) input.value = next;
        const title = input.value.trim();
        const valid = validTitle(title);
        input.setAttribute('aria-invalid', String(!valid));
        if (!valid) invalid = true;
        else if (title !== original) changes.push({ id: item.id, title: title === item.originalTitle ? null : title });
      }
      summary.textContent = badStart ? 'Elige un número entero entre 0 y 999999.' : invalid
        ? 'Usa entre 1 y ' + maxTitleLength + ' caracteres por título.'
        : changes.length === 1 ? '1 título cambiará' : changes.length + ' títulos cambiarán';
      submit.disabled = badStart || invalid || !changes.length;
    }

    mode.addEventListener('change', () => {
      controls.replaceChildren(...(options[mode.value] || []));
      refresh();
    });
    controls.addEventListener('input', refresh);
    content.append(renameField('Cómo renombrar', mode), controls, list, summary);
    showDialog('Renombrar ' + titles.length + ' títulos', content, 'Guardar cambios',
      () => saveTitles(changes, titles, anchor), anchor);
    dialog.classList.add('with-book-rename');
    mode.focus({ preventScroll: true });
    refresh();
  }

  function checkRow(text, checked) {
    const row = element('label', 'library-check');
    const check = element('input');
    check.type = 'checkbox';
    check.checked = checked;
    row.append(check, element('span', '', text));
    return { row, check };
  }

  function nameGroup(group, anchor) {
    const input = textInput(group.name, 'Nombre del grupo');
    input.placeholder = 'Nombre del grupo';
    showDialog('Renombrar grupo', input, 'Guardar', () =>
      edit('group-save', { groupId: group.id, category, name: input.value }), anchor);
    input.select();
  }

  function browseGroups() {
    const content = element('div', 'group-browser');
    const filter = textInput('', 'Buscar grupos');
    filter.placeholder = 'Buscar grupos…';
    const list = element('div', 'group-browser-list');
    const empty = element('p', 'picker-empty', 'No se encontraron grupos.');
    empty.setAttribute('role', 'status');
    content.append(filter, list, empty);
    const ordered = [...store.groups].sort((left, right) =>
      left.name.localeCompare(right.name, 'es', { sensitivity: 'base', numeric: true }));

    function paint() {
      const query = searchText(filter.value.trim());
      const sections = [];
      for (const type of ['comic', 'manga']) {
        const matches = ordered.filter(group => group.category === type && searchText(group.name).includes(query));
        if (!matches.length) continue;
        const section = element('section');
        section.setAttribute('aria-label', categoryLabels[type]);
        section.append(element('h3', '', categoryLabels[type]));
        for (const group of matches) {
          const control = button(group.name, 'button group-browser-item');
          if (!recent && group.id === selectedGroup) control.setAttribute('aria-current', 'true');
          control.addEventListener('click', () => {
            returnFocus = openGroup(group.id, group.category) || groupBrowser;
            dialog.close();
          });
          section.append(control);
        }
        sections.push(section);
      }
      list.replaceChildren(...sections);
      list.scrollTop = 0;
      list.hidden = sections.length === 0;
      empty.hidden = !list.hidden;
    }

    filter.addEventListener('input', paint);
    paint();
    showDialog('Grupos', content, '', undefined, groupBrowser);
    dialog.classList.add('with-group-browser');
  }

  function pickGroupBooks(group, anchor) {
    const type = group?.category ?? category;
    const titles = store.books.filter(item => item.category === type);
    const checked = new Set(group?.books);
    const content = element('div', 'group-picker');
    const name = textInput(group?.name || '', 'Nombre del grupo');
    name.placeholder = 'Nombre del grupo';
    const search = textInput('', 'Buscar portadas');
    search.placeholder = 'Buscar por título…';
    const summary = element('p', 'picker-count');
    summary.setAttribute('role', 'status');
    const tools = element('div', 'picker-tools');
    const hint = element('p', 'picker-hint', 'Arrastra desde un espacio vacío para seleccionar varias portadas.');
    tools.append(summary, hint);
    const covers = element('div', 'picker-grid');
    const empty = element('p', 'picker-empty');
    if (!group) content.append(name);
    if (titles.length > 5) content.append(search);
    content.append(tools, covers, empty);
    const known = new Set(titles.map(item => item.id));
    function paintCount() {
      const count = [...checked].filter(id => known.has(id)).length;
      summary.textContent = count === 1 ? '1 título seleccionado' : count + ' títulos seleccionados';
    }
    const pickerArea = {
      scroller: body, rectangle: byId('picker-selection-rectangle'), cards: covers, selected: checked,
      top: () => Math.max(covers.getBoundingClientRect().top, tools.getBoundingClientRect().bottom),
      keepExisting: true,
      paint: () => {
        for (const tile of covers.children) tile.querySelector('input').checked = checked.has(tile.dataset.bookId);
        paintCount();
      }
    };
    covers.addEventListener('pointerdown', event => {
      if (!submitting && covers.children.length && !event.target.closest('.picker-card')) beginAreaSelection(event, pickerArea);
    });
    function paint() {
      if (areaSelection?.cards === covers) finishAreaSelection(false);
      const query = searchText(search.value.trim()).split(/\s+/u).filter(Boolean);
      const matching = titles.filter(item => query.every(word => searchText(item.title).includes(word)));
      covers.replaceChildren(...matching.map(item => {
        const label = element('label', 'picker-card');
        label.dataset.bookId = item.id;
        const cover = element('span', 'recent-cover');
        const pic = element('img');
        pic.src = '/cover/' + item.id + '/0';
        pic.alt = '';
        pic.loading = 'lazy';
        pic.decoding = 'async';
        pic.draggable = false;
        pic.addEventListener('load', () => cover.classList.add('loaded'));
        cover.append(icon('book'), pic);
        const input = element('input');
        input.type = 'checkbox';
        input.checked = checked.has(item.id);
        const title = element('span', 'picker-title', item.title);
        title.title = item.title;
        label.append(cover, input, title);
        input.addEventListener('change', () => {
          if (input.checked) checked.add(item.id);
          else checked.delete(item.id);
          paintCount();
        });
        return label;
      }));
      empty.hidden = matching.length > 0;
      hint.hidden = matching.length < 2;
      empty.textContent = titles.length ? 'No hay títulos que coincidan.' : 'Añade archivos a esta pestaña para incluirlos en un grupo.';
      paintCount();
    }
    search.addEventListener('input', paint);
    paint();
    showDialog(group ? 'Editar tomos' : 'Nuevo grupo', content, group ? 'Guardar' : 'Crear grupo', async () => {
      const previous = new Set(store.groups.map(item => item.id));
      await edit('group-save', { groupId: group?.id, category: type, name: group ? undefined : name.value, books: [...checked] });
      if (!group) {
        const created = store.groups.find(item => item.category === type && !previous.has(item.id));
        if (created) returnFocus = openGroup(created.id, type) || anchor;
      }
    }, anchor);
    dialog.classList.add('with-cover-picker');
    if (group && search.isConnected) search.focus();
  }

  function membership(items, anchor) {
    const content = element('div', 'membership-list');
    const choices = store.groups.filter(group => group.category === items[0]?.category).map(group => {
      const count = items.filter(item => group.books.includes(item.id)).length;
      const entry = checkRow(group.name, count === items.length);
      const original = entry.check.checked;
      const mixed = count > 0 && count < items.length;
      entry.check.indeterminate = mixed;
      content.append(entry.row);
      return { ...entry, id: group.id, original, mixed };
    });
    const input = textInput('', 'Nombre de un grupo nuevo');
    input.placeholder = 'Crear un grupo nuevo';
    content.append(input);
    showDialog('Añadir a grupo', content, 'Guardar', async () => {
      await edit('memberships', {
        ids: items.map(item => item.id),
        add: choices.filter(entry => entry.check.checked && !entry.original).map(entry => entry.id),
        remove: choices.filter(entry => !entry.check.checked && (entry.original || (entry.mixed && !entry.check.indeterminate)))
          .map(entry => entry.id),
        name: input.value
      });
    }, anchor);
  }

  function startDrag(event, item) {
    const ordering = orderEditing;
    if (savingDrag || (!ordering && !selectedBooks.has(item.id))) {
      event.preventDefault();
      return;
    }
    hideOverlays();
    const ids = ordering ? [item.id] : visibleIds.filter(id => selectedBooks.has(id));
    drag = { ids, ordering };
    if (!ordering) {
      drag.categories = new Set(store.books.filter(book => selectedBooks.has(book.id)).map(book => book.category));
    }
    event.dataTransfer.effectAllowed = ordering ? 'move' : 'copyMove';
    event.dataTransfer.setData('application/x-pliego-books', '1');
    if (ids.length > 1) {
      const badge = element('div', 'drag-count', ids.length + ' títulos');
      document.body.append(badge);
      event.dataTransfer.setDragImage(badge, 14, 14);
      setTimeout(() => badge.remove(), 0);
    }
    requestAnimationFrame(() => {
      if (drag?.ids !== ids) return;
      for (const tile of grid.children) tile.classList.toggle('is-dragged', ids.includes(tile.dataset.bookId));
    });
  }

  function clearDropMark() {
    drag?.target?.classList.remove('drop-active');
    drag?.target?.removeAttribute('data-insert');
    if (drag) drag.target = undefined;
  }

  function clearDrag() {
    clearDropMark();
    drag = undefined;
    for (const tile of grid.querySelectorAll('.is-dragged')) tile.classList.remove('is-dragged');
  }

  function bindDrop(target, accepts, effect, highlight, run) {
    target.addEventListener('dragover', event => {
      if (!drag || !accepts(drag)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = effect;
      if (drag.target !== target) {
        clearDropMark();
        drag.target = target;
      }
      highlight(event);
    });
    target.addEventListener('dragleave', event => {
      if (drag?.target === target && !target.contains(event.relatedTarget)) clearDropMark();
    });
    target.addEventListener('drop', async event => {
      if (!drag || !accepts(drag)) return;
      event.preventDefault();
      const payload = drag;
      const after = target.dataset.insert === 'after';
      clearDrag();
      savingDrag = true;
      paintSelection();
      try {
        await run(payload, after);
      } finally {
        savingDrag = false;
        paintSelection();
      }
    });
  }

  function bindGroupDrop(control, groupId) {
    bindDrop(control, payload => !payload.ordering, 'copy', () => control.classList.add('drop-active'),
      ({ ids }) => action('memberships', { ids, add: [groupId] },
        ids.length === 1 ? 'Título añadido al grupo.' : ids.length + ' títulos añadidos al grupo.'));
  }

  function bindCategoryDrop(tab, type) {
    bindDrop(tab, ({ ordering, categories }) => !ordering && (categories.size > 1 || !categories.has(type)),
      'move', () => tab.classList.add('drop-active'), ({ ids }) => {
        const selected = new Set(ids);
        const moving = store.books.filter(book => selected.has(book.id) && book.category !== type).map(book => book.id);
        if (moving.length) return moveCategory(moving, type);
      });
  }

  function bindOrderDrop(tile, item, group) {
    bindDrop(tile, payload => payload.ordering && payload.ids[0] !== item.id, 'move', event => {
      const rect = tile.getBoundingClientRect();
      tile.dataset.insert = event.clientX >= rect.left + rect.width / 2 ? 'after' : 'before';
    }, ({ ids }, after) => action('order', { id: ids[0], groupId: group?.id, category, target: item.id, after }));
  }

  async function orderBook(group, item, offset) {
    const target = visibleIds[visibleIds.indexOf(item.id) + offset];
    if (target && await action('order', { id: item.id, groupId: group?.id, category, target, after: offset > 0 })) {
      grid.querySelector('[data-book-id="' + item.id + '"] .order-actions button:not(:disabled)')?.focus();
    }
  }

  byId('group-edit').addEventListener('click', event => {
    const group = selected();
    if (!group) return;
    const anchor = event.currentTarget;
    const rect = anchor.getBoundingClientRect();
    showMenu([
      ['Renombrar grupo…', () => nameGroup(group, anchor)],
      ['Editar tomos…', () => pickGroupBooks(group, anchor)],
      [orderEditing ? 'Terminar de ordenar' : 'Ordenar tomos', () => { clearSelection(); orderEditing = !orderEditing; render(); }],
      ['Borrar grupo…', () => showDialog('Borrar grupo', element('p', '',
        'Se borrará «' + group.name + '». Sus títulos seguirán en la biblioteca.'),
      'Borrar grupo', () => edit('group-delete', { groupId: group.id }), anchor), true]
    ], rect.left, rect.bottom + 4, anchor);
  });

  async function suggestGroups() {
    if (suggesting || importing) return;
    const type = category;
    hideOverlays();
    suggesting = true;
    paintAvailability();
    try {
      const result = await api.suggestGroups(type);
      if (!result) throw Error();
      update(result.library);
      if (recent || category !== type || search.value.trim() || welcome.hidden || dialog.open) return;
      render();
      const { suggestions } = result;
      if (suggestions?.length) reviewSuggestions(type, suggestions, suggest);
      else message('No hay nuevas coincidencias entre los títulos.');
    } catch {
      message('No se pudieron buscar grupos.');
    } finally {
      suggesting = false;
      paintAvailability();
      if (!suggest.disabled && document.activeElement === document.body) suggest.focus({ preventScroll: true });
    }
  }

  function reviewSuggestions(type, suggestions, anchor) {
    const list = element('div', 'suggestion-list');
    const labels = { metadata: 'Serie en ComicInfo', numbered: 'Numeración del archivo',
      subtitle: 'Inicio del título · Revisar', title: 'Nombre coincidente' };
    const choices = suggestions.map(suggestion => {
      const card = element('section', 'suggestion');
      const header = element('div', 'suggestion-heading');
      const name = textInput(suggestion.name, 'Nombre del grupo ' + suggestion.name);
      const include = element('input');
      include.type = 'checkbox';
      include.checked = suggestion.reason !== 'subtitle';
      include.setAttribute('aria-label', 'Crear o actualizar ' + suggestion.name);
      header.append(include, name);
      card.append(header, element('p', 'suggestion-source',
        (suggestion.groupId ? 'Grupo existente · ' : '') + labels[suggestion.reason]));
      const books = suggestion.books.map(item => {
        const entry = checkRow(item.title, !item.tentative);
        if (item.tentative) entry.row.title = 'Coincidencia por el inicio del título';
        card.append(entry.row);
        return { id: item.id, check: entry.check };
      });
      list.append(card);
      return { source: suggestion.name, name, include, books };
    });
    showDialog('Grupos sugeridos', list, 'Aplicar selección', async () => {
      const proposals = choices.filter(item => item.include.checked).map(item => ({
        source: item.source, name: item.name.value, books: item.books.filter(entry => entry.check.checked).map(entry => entry.id)
      }));
      if (!proposals.length) throw Error('Selecciona al menos un grupo.');
      await edit('apply', { category: type, proposals });
      message('Grupos actualizados.');
    }, anchor);
  }

  async function importFiles(files) {
    if (importing || suggesting || document.querySelector('dialog[open]')) return;
    importing = true;
    paintAvailability();
    const type = currentCategory();
    try {
      if (files) notice('Añadiendo archivos…', true);
      const result = await (files ? api.importLibrary(files, type) : api.chooseLibrary(type));
      if (!result) return;
      update(result.library);
      render();
      const { added, addedCategories, failures, importedCategories } = result;
      const destinations = (added ? addedCategories : importedCategories)
        .filter(type => recent || selectedGroup || type !== category);
      const actions = destinations.map(type => ['Ver en ' + categoryLabels[type], () => showCategory(type)]);
      const summary = added === 1 ? '1 título añadido.' : added + ' títulos añadidos.';
      const failure = failures.length === 1 ? '1 archivo sin abrir.' : failures.length + ' archivos sin abrir.';
      if (failures.length) message([added ? summary : '', failure, failures[0].message].filter(Boolean).join(' '), actions);
      else message(added ? summary : 'Los títulos ya estaban en la biblioteca.', actions);
    } catch {
      message('No se pudieron añadir los archivos.');
    } finally {
      importing = false;
      paintAvailability();
      notice('');
    }
  }

  function currentCategory() {
    return recent ? 'comic' : category;
  }

  function showCategory(type, fromShortcut = true) {
    search.value = '';
    recent = type === 'recent';
    if (!recent) update(store, type);
    if (fromShortcut) selectedGroup = undefined;
    clearSelection();
    orderEditing = false;
    welcome.scrollTop = 0;
    render();
    if (fromShortcut) tabs.find(tab => tab.dataset.category === type)?.focus({ preventScroll: true });
  }

  function focusTitle(id) {
    const tile = [...grid.children].find(item => item.dataset.bookId === id);
    const control = tile?.querySelector('.recent') || tabs.find(tab => tab.getAttribute('aria-pressed') === 'true');
    control?.focus();
  }

  function updateSearch() {
    orderEditing = false;
    welcome.scrollTop = 0;
    render();
  }

  function clearSearch() {
    search.value = '';
    updateSearch();
    search.focus({ preventScroll: true });
  }

  search.addEventListener('input', updateSearch);
  byId('library-search-clear').addEventListener('click', clearSearch);
  for (const tab of tabs) {
    const type = tab.dataset.category;
    if (type !== 'recent') bindCategoryDrop(tab, type);
    tab.addEventListener('click', () => showCategory(type, false));
  }
  add.addEventListener('click', () => importFiles());
  groupBrowser.addEventListener('click', browseGroups);
  newGroup.addEventListener('click', () => pickGroupBooks(undefined, newGroup));
  coverView.addEventListener('click', () => {
    const selected = welcome.dataset.coverColumns;
    toggleMenu(coverView, coverSizes.map(([columns, title]) => [title, async () => {
      if (columns === selected) return;
      welcome.dataset.coverColumns = columns;
      const saved = await api.setLibraryColumns(columns).catch(() => false);
      if (!saved) message('No se pudo guardar el tamaño de las portadas.');
    }, false, columns === selected]));
  });
  options.addEventListener('click', () => toggleMenu(options, [
    ['Buscar actualizaciones', showUpdateCheck],
    ['Ayuda y atajos', showHelp],
    ['Acerca de Pliego', showAbout]
  ]));
  suggest.addEventListener('click', suggestGroups);
  byId('update-download').addEventListener('click', runUpdate);
  api.onUpdateTransfer(status => {
    updateTransfer = status;
    if (status.phase === 'ready') byId('update-banner').hidden = false;
    paintUpdate();
  });
  byId('update-dismiss').addEventListener('click', () => {
    byId('update-banner').hidden = true;
    options.focus({ preventScroll: true });
  });
  byId('library-select').addEventListener('click', () => {
    selecting = true;
    hideOverlays();
    paintSelection();
    byId('selection-all').focus({ preventScroll: true });
  });
  function finishSelection() {
    clearSelection();
    paintSelection();
    const select = byId('library-select');
    const control = select.hidden ? search : select;
    control.focus({ preventScroll: true });
  }
  byId('selection-done').addEventListener('click', finishSelection);
  byId('selection-all').addEventListener('click', () => {
    if (selectedBooks.size === visibleIds.length) selectedBooks.clear();
    else visibleIds.forEach(id => selectedBooks.add(id));
    paintSelection();
  });
  selectionCategory.addEventListener('click', () => {
    const titles = store.books.filter(item => selectedBooks.has(item.id));
    const actions = categoryActions(titles);
    if (actions.length === 1) actions[0][1]();
    else if (actions.length) {
      const rect = selectionCategory.getBoundingClientRect();
      showMenu(actions, rect.left, rect.bottom + 4, selectionCategory);
    }
  });
  byId('selection-group').addEventListener('click', event => {
    membership(store.books.filter(item => selectedBooks.has(item.id)), event.currentTarget);
  });
  selectionRename.addEventListener('click', () => renameTitles(selectedTitles(), selectionRename));
  welcome.addEventListener('keydown', event => {
    if (event.key !== 'F2' || dialog.open || !menu.hidden || orderEditing || savingDrag) return;
    const tile = event.target.closest('.library-tile');
    const id = tile?.dataset.bookId;
    const titles = selectedBooks.size && (!id || selectedBooks.has(id))
      ? selectedTitles()
      : store.books.filter(item => item.id === id);
    if (titles.length) {
      event.preventDefault();
      renameTitles(titles, event.target);
    }
  });
  const trash = byId('selection-trash');
  trash.addEventListener('click', () => removeBooks(visibleIds.filter(id => selectedBooks.has(id))));
  bindDrop(trash, payload => !payload.ordering, 'move', () => trash.classList.add('drop-active'),
    ({ ids }) => removeBooks(ids));
  byId('order-done').addEventListener('click', () => {
    orderEditing = false;
    render();
    byId('library-order').focus();
  });
  byId('library-order').addEventListener('click', () => {
    clearSelection();
    orderEditing = !orderEditing;
    render();
  });

  welcome.addEventListener('pointerdown', event => {
    if (visibleIds.length && !orderEditing && !savingDrag && !event.target.closest('#library-top, .library-tile')) {
      beginAreaSelection(event, libraryArea);
    }
  });
  window.addEventListener('pointermove', moveAreaSelection);
  window.addEventListener('pointerup', event => {
    if (areaSelection?.pointer !== event.pointerId) return;
    areaSelection.x = event.clientX;
    areaSelection.y = event.clientY;
    finishAreaSelection(true);
  });
  window.addEventListener('pointercancel', event => {
    if (areaSelection?.pointer === event.pointerId) finishAreaSelection(false);
  });
  window.addEventListener('lostpointercapture', event => {
    if (areaSelection?.pointer === event.pointerId) finishAreaSelection(false);
  });
  window.addEventListener('resize', () => { hideOverlays(); finishAreaSelection(false); });
  window.addEventListener('blur', () => { hideOverlays(); clearDrag(); finishAreaSelection(false); });
  welcome.addEventListener('scroll', () => { hideOverlays(); scheduleAreaSelection(); });
  body.addEventListener('scroll', scheduleAreaSelection);
  welcome.addEventListener('dragover', event => {
    if (!drag?.ordering) return;
    const bounds = welcome.getBoundingClientRect();
    const edge = 40;
    if (event.clientY < bounds.top + edge) welcome.scrollTop -= 16;
    else if (event.clientY > bounds.bottom - edge) welcome.scrollTop += 16;
  });
  window.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target) && !menuAnchor?.contains(event.target)) closeMenu();
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && areaSelection) {
      finishAreaSelection(false);
      event.preventDefault();
      return;
    }
    if (welcome.hidden || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !byId('library-search-box').hidden &&
        !byId('library-controls').hidden) {
      event.preventDefault();
      closeMenu();
      search.focus();
      search.select();
      return;
    }
    if (event.key !== 'Escape') return;
    if (event.target === search && search.value) {
      event.preventDefault();
      clearSearch();
      return;
    }
    if (menu.hidden && preview.hidden) {
      if (selecting) {
        finishSelection();
      } else if (orderEditing) {
        orderEditing = false;
        render();
      } else return;
    }
    event.preventDefault();
    closeMenu(true);
    hidePreview();
  });

  return { initialize, update, progress, render, focusTitle, hideOverlays, importFiles, showCategory, clearMessage, checkUpdates,
    category: currentCategory };
}
