const states = {
  searching: 'Buscando archivos en la red BitTorrent…',
  checking: 'Preparando y comprobando archivos…',
  importing: 'Añadiendo los tomos a la biblioteca…',
  paused: 'Descarga pausada',
  error: 'La descarga requiere atención'
};

function bytes(value) {
  if (value >= 1024 ** 3) return (value / 1024 ** 3).toFixed(1) + ' GB';
  if (value >= 1024 ** 2) return (value / 1024 ** 2).toFixed(1) + ' MB';
  return Math.max(1, Math.round(value / 1024)) + ' KB';
}

export async function createDownloads(byId, library) {
  const api = window.pliego;
  const dialog = byId('torrent-dialog');
  const field = byId('torrent-input');
  const folderText = byId('torrent-folder');
  const list = byId('torrent-files');
  const group = byId('torrent-group');
  const submit = byId('torrent-submit');
  const secondary = byId('torrent-secondary');
  const libraryActions = byId('torrent-library-actions');
  const summary = byId('torrent-summary');
  const status = byId('torrent-status');
  const progress = status.querySelector('progress');
  const error = byId('torrent-error');
  const marked = new Set();
  let job;
  let defaultFolder;
  let destination;
  let selectionKey;
  let editedGroup = false;
  let busy = false;
  let lastEvent = 0;
  let localError = '';
  let anchor;
  let viewAfterClose;

  function statusText() {
    if (job?.phase === 'downloading') {
      if (!job.peers && !job.speed) return 'Esperando fuentes…';
      return 'Descargando · ' + Math.floor((job.progress || 0) * 100) + '%' +
        (job.speed ? ' · ' + bytes(job.speed) + '/s' : '');
    }
    if (job?.phase === 'complete') {
      const count = job.imported || 0;
      return count === 1 ? '1 título en la biblioteca' : count + ' títulos en la biblioteca';
    }
    return states[job?.phase] || '';
  }

  function setJob(next) {
    const oldId = job?.id;
    job = next;
    if (oldId && oldId !== job?.id) localError = '';
    if (job?.phase === 'ready' && selectionKey !== job.id) {
      selectionKey = job.id;
      marked.clear();
      for (const file of job.files) marked.add(file.index);
      editedGroup = false;
      group.checked = job.files.length > 1;
      buildFiles();
    }
    libraryActions.hidden = job?.phase !== 'complete' || !job.importedCategories?.length;
    libraryActions.replaceChildren(...(libraryActions.hidden ? [] : job.importedCategories.map(type => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.textContent = type === 'manga' ? 'Ver en Mangas' : 'Ver en Cómics';
      button.addEventListener('click', async () => {
        if (busy || !(await command('dismiss'))) return;
        viewAfterClose = type;
        dialog.close();
      });
      return button;
    })));
    render();
  }

  function buildFiles() {
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    const rows = [...job.files].sort((a, b) => collator.compare(a.name, b.name));
    list.replaceChildren(...rows.map(file => {
      const label = document.createElement('label');
      label.className = 'torrent-file';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = marked.has(file.index);
      box.dataset.index = file.index;
      box.addEventListener('change', () => {
        if (box.checked) marked.add(file.index);
        else marked.delete(file.index);
        render();
      });
      const title = document.createElement('span');
      title.textContent = file.name;
      const size = document.createElement('small');
      size.textContent = bytes(file.size);
      label.append(box, title, size);
      return label;
    }));
  }

  function render() {
    const phase = job?.phase;
    const input = !phase || (phase === 'error' && !job.canResume);
    const picking = phase === 'ready';
    const resumable = phase === 'paused' || (phase === 'error' && job.canResume);
    const complete = phase === 'complete';
    const pausable = ['downloading', 'checking'].includes(phase);
    byId('torrent-input-row').hidden = !input;
    byId('torrent-selection').hidden = !picking;
    byId('torrent-change').hidden = !(picking || input);
    byId('torrent-destination-label').textContent = complete ? 'Guardado en' : 'Guardar en';
    folderText.textContent = job?.folder || destination || defaultFolder || '';
    folderText.title = folderText.textContent;
    const subfolder = byId('torrent-subfolder');
    subfolder.hidden = !picking;
    subfolder.textContent = picking ? 'Subcarpeta «' + job.name + '»' : '';
    byId('torrent-name').textContent = job?.name || '';
    byId('torrent-count').textContent = marked.size + ' de ' + (job?.files?.length || 0) + ' seleccionados';
    byId('torrent-all').textContent = marked.size === job?.files?.length ? 'Deseleccionar todo' : 'Seleccionar todo';
    byId('torrent-group-row').hidden = marked.size < 2;
    if (!editedGroup) group.checked = marked.size > 1;
    byId('torrent-group-row').title = job?.name ? 'Grupo: ' + job.name : '';

    status.hidden = !phase || picking || phase === 'error';
    status.querySelector('span').textContent = statusText();
    progress.hidden = !(pausable || phase === 'importing');
    progress.value = job?.progress || 0;
    const failures = job?.failures;
    error.textContent = localError || job?.error || (failures?.length
      ? 'Guardados en la carpeta, pero Pliego no pudo abrir: ' + failures.join(', ') : '');
    error.hidden = !error.textContent;
    submit.hidden = !(input || picking || resumable || pausable || complete);
    submit.disabled = busy || (picking && !marked.size);
    submit.textContent = picking ? 'Descargar' : resumable ? 'Reanudar' :
      pausable ? 'Pausar' : complete ? 'Abrir carpeta' : 'Buscar archivos';
    secondary.textContent = ['searching', 'ready'].includes(phase) ? 'Cancelar' :
      resumable ? 'Quitar de la cola' : complete ? 'Listo' : 'Cerrar';
    secondary.disabled = busy;
    summary.hidden = !job;
    summary.textContent = job ? (statusText() || 'Elegir archivos de la descarga') : '';
    summary.title = job?.name || '';
  }

  async function command(action, args) {
    busy = true;
    localError = '';
    render();
    try {
      const result = await api.torrentCommand(action, args);
      setJob(result?.job);
      localError = result?.error || (!result ? 'No se pudo conectar con la descarga.' : '');
      return !localError;
    } catch {
      localError = 'No se pudo actualizar la descarga.';
      return false;
    } finally {
      busy = false;
      render();
    }
  }

  function open(event) {
    if (dialog.open) return;
    library.hideOverlays();
    library.clearMessage();
    anchor = event.currentTarget;
    render();
    dialog.showModal();
    if (!byId('torrent-input-row').hidden) field.focus();
  }
  byId('torrent-open').addEventListener('click', open);
  summary.addEventListener('click', open);
  byId('torrent-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!viewAfterClose) {
      (anchor?.hidden ? byId('torrent-open') : anchor)?.focus();
      return;
    }
    library.showCategory(viewAfterClose);
    viewAfterClose = undefined;
  });
  byId('torrent-change').addEventListener('click', async () => {
    try {
      const chosen = await api.torrentFolder(destination || defaultFolder);
      if (chosen) destination = chosen;
    } catch {
      localError = 'No se pudo elegir la carpeta.';
    }
    render();
  });
  group.addEventListener('change', () => { editedGroup = true; });
  byId('torrent-all').addEventListener('click', () => {
    const boxes = [...list.querySelectorAll('input')];
    const select = marked.size !== boxes.length;
    marked.clear();
    for (const box of boxes) {
      box.checked = select;
      if (select) marked.add(Number(box.dataset.index));
    }
    render();
  });
  secondary.addEventListener('click', async () => {
    const phase = job?.phase;
    if (['ready', 'searching'].includes(phase)) await command('stop');
    else if (['paused', 'complete', 'error'].includes(phase)) await command('dismiss');
    dialog.close();
  });
  byId('torrent-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    switch (job?.phase) {
      case 'ready':
        await command('download', { files: [...marked], destination, group: group.checked });
        break;
      case 'paused':
        await command('resume');
        break;
      case 'checking':
      case 'downloading':
        await command('stop');
        break;
      case 'complete':
        localError = await api.torrentReveal() || '';
        render();
        break;
      case 'error':
        if (job.canResume) {
          await command('resume');
          break;
        }
      case undefined:
        await command('probe', { text: field.value, category: library.category() });
        break;
    }
  });
  api.onTorrent(next => {
    lastEvent++;
    setJob(next);
  });
  const initial = await api.torrentInitial();
  defaultFolder = initial?.defaultFolder;
  if (!lastEvent) setJob(initial?.job);
  else render();
}
