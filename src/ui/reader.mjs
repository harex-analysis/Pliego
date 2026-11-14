import { createLibrary } from './library.mjs';
import { createDownloads } from './downloads.mjs';
import { createCurl, createPaperFold } from './curl.mjs';
import { createLayout, positionSheets, turningLeaves } from './layout.mjs';

const byId = id => document.getElementById(id);
const stage = byId('stage');
const scene = byId('scene');
const canvas = byId('curl');
const paperCanvas = byId('paper-fold');
const shadow = byId('shadow');
const drawer = byId('drawer');
const thumbList = byId('thumb-list');
const scrubber = byId('scrubber');
const pageTurnTip = byId('page-turn-tip');
const chromeControls = '.toolbar, #navigation';
const settings = { layout: 'auto', motion: true, sound: false };
const pan = { x: 0, y: 0 };
const neighbors = new Map();
const pointers = new Map();
let book;
let current;
let pageIndex = 0;
let zoom = 1;
let signature;
let curl;
let opening = false;
let changing = false;
let activeTurn;
let gesture;
let resizeFrame;
let statusTimer;
let chromeTimer;
let chromeEdgeArmed = false;
let chromeOverControls = false;
let thumbObserver;
let audioContext;
let previousDouble;
let pageTurnTipSeen = false;
const paperFold = createPaperFold(paperCanvas);

try { curl = createCurl(canvas); } catch (error) { console.warn(error); }
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  cancelTurn();
  curl = null;
});
canvas.addEventListener('webglcontextrestored', () => {
  try { curl = createCurl(canvas); } catch (error) { console.warn(error); }
});

function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  return svg;
}

function notice(message, hold = false) {
  clearTimeout(statusTimer);
  const status = byId('status');
  status.textContent = message;
  status.hidden = !message;
  if (message && !hold) statusTimer = setTimeout(() => { status.hidden = true; }, 4900);
}

function dismissPageTurnTip() {
  if (pageTurnTipSeen) return;
  pageTurnTipSeen = true;
  pageTurnTip.hidden = true;
  window.pliego.dismissPageTurnTip().catch(console.error);
}

function createComic(result) {
  const cache = new Map();
  const url = index => `/comic/${result.id}/${index}`;
  function load(index) {
    if (index < 0 || index >= result.count) return Promise.resolve(null);
    const previous = cache.get(index);
    if (previous) {
      cache.delete(index);
      cache.set(index, previous);
      return previous;
    }
    const image = new Image();
    image.decoding = 'async';
    image.src = url(index);
    const pending = image.decode().then(() => image, () => null);
    cache.set(index, pending);
    while (cache.size > 9) cache.delete(cache.keys().next().value);
    return pending;
  }
  return { ...result, url, load, layout: createLayout(load) };
}

async function openComic(action) {
  if (opening) return;
  opening = true;
  library.hideOverlays();
  library.clearMessage();
  cancelTurn();
  closePopovers();
  notice('Abriendo cómic…', true);
  try {
    const result = await action();
    if (!result) {
      notice('');
      return;
    }
    if (result.error) {
      notice(result.error);
      return;
    }
    book = createComic(result);
    current = null;
    byId('page-label').textContent = '';
    library.update(result.library, result.category);
    setDrawer(false);
    setZoom(1, undefined, false);
    byId('welcome').hidden = true;
    byId('reading').hidden = false;
    byId('navigation').hidden = false;
    byId('tools').hidden = false;
    byId('title').textContent = book.title;
    byId('title').title = book.title;
    byId('rtl-option').checked = book.rtl;
    scrubber.max = book.count;
    byId('page-number').max = book.count;
    await showPage(result.page);
    pageTurnTip.hidden = pageTurnTipSeen || !settings.motion || book.count < 2;
    stage.focus({ preventScroll: true });
    notice('');
  } catch (error) {
    console.error(error);
    notice('Ocurrió un error al abrir el cómic.');
  } finally {
    opening = false;
  }
}

function doubleView() {
  return settings.layout === 'double' ||
    (settings.layout === 'auto' && stage.clientWidth >= 740 && stage.clientWidth / stage.clientHeight >= 1.13);
}

async function loadSpread(comic, index, double) {
  const indices = await comic.layout.groupFor(index, comic.count, double);
  const images = await Promise.all(indices.map(comic.load));
  return { indices, images: new Map(indices.map((page, slot) => [page, images[slot]])) };
}

async function showPage(index) {
  if (!book) return;
  cancelTurn();
  const comic = book;
  const double = doubleView();
  previousDouble = double;
  const request = Symbol();
  signature = request;
  changing = true;
  const spread = await loadSpread(comic, index, double);
  if (signature !== request || book !== comic) return false;
  if (double !== doubleView()) return showPage(index);
  const previousSheets = settings.motion && index === pageIndex && current &&
    current.indices.length !== spread.indices.length ? positioned(current) : null;
  changing = false;
  commit(spread, index);
  if (previousSheets) animateLayout(previousSheets);
  return true;
}

function commit(spread, index = spread.indices[0]) {
  const turned = Boolean(current && pageIndex !== index);
  current = spread;
  pageIndex = index;
  pan.x = 0;
  pan.y = 0;
  pan.y = topPan(spread);
  render();
  controls();
  library.progress(book.id, pageIndex, turned);
  window.pliego.progress(book.id, pageIndex, book.rtl, turned).catch(console.error);
  prepareNeighbors();
}

function prepareNeighbors() {
  neighbors.clear();
  for (const direction of [-1, 1]) {
    const index = direction > 0 ? current.indices.at(-1) + 1 : current.indices[0] - 1;
    if (index < 0 || index >= book.count) continue;
    const record = { index, spread: null };
    record.promise = loadSpread(book, index, doubleView()).then(spread => { record.spread = spread; return spread; });
    neighbors.set(direction, record);
  }
}

function positioned(spread, offset = pan) {
  return positionSheets(spread.indices, spread.images, {
    width: stage.clientWidth, height: stage.clientHeight, zoom, pan: offset, rtl: book.rtl
  });
}

function topPan(spread) {
  if (zoom === 1) return 0;
  const [sheet] = positioned(spread, { x: 0, y: 0 });
  return Math.max(0, (sheet.h - stage.clientHeight) / 2);
}

function rectangle(element, sheet) {
  Object.assign(element.style, {
    left: sheet.x + 'px', top: sheet.y + 'px', width: sheet.w + 'px', height: sheet.h + 'px'
  });
}

function sheetNode(sheet) {
  const element = document.createElement('figure');
  element.className = 'sheet ' + sheet.side;
  if (sheet.half !== undefined) element.classList.add('panorama-leaf');
  element.dataset.page = sheet.index + 1;
  rectangle(element, sheet);
  if (sheet.image) {
    const image = sheet.image.cloneNode();
    image.alt = `Página ${sheet.index + 1}`;
    image.draggable = false;
    element.append(image);
  } else {
    element.classList.add('empty');
    element.textContent = `No se pudo cargar la página ${sheet.index + 1}.`;
  }
  return element;
}

function render() {
  if (!current || byId('reading').hidden) return;
  scene.replaceChildren(...positioned(current).map(sheetNode));
}

function animateLayout(previous) {
  const sheets = positioned(current);
  const timing = { duration: 200, easing: 'cubic-bezier(.2,.65,.3,1)' };
  sheets.forEach((sheet, index) => {
    const element = scene.children[index];
    const before = previous.find(item => item.index === sheet.index);
    if (!before) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], timing);
      return;
    }
    const dx = before.x - sheet.x;
    const dy = before.y - sheet.y;
    element.animate([
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${before.w / sheet.w}, ${before.h / sheet.h})` },
      { transformOrigin: 'top left', transform: 'none' }
    ], timing);
  });
}

function reposition() {
  if (!current) return;
  positioned(current).forEach((sheet, index) => {
    if (scene.children[index]) rectangle(scene.children[index], sheet);
  });
}

function controls() {
  const [first, last] = [current.indices[0], current.indices.at(-1)];
  byId('page-label').textContent = (first === last ? first + 1 : `${first + 1}–${last + 1}`) + ' / ' + book.count;
  byId('previous').disabled = first === 0;
  byId('next').disabled = last === book.count - 1;
  byId('previous').replaceChildren(icon(book.rtl ? 'right' : 'left'));
  byId('next').replaceChildren(icon(book.rtl ? 'left' : 'right'));
  scrubber.value = pageIndex + 1;
  updateScrubber();
  markThumbnail();
}

function updateScrubber() {
  const progress = (scrubber.valueAsNumber - 1) / Math.max(1, book.count - 1);
  scrubber.style.setProperty('--progress', progress * 100 + '%');
}

function setZoom(value, anchor, redraw = true) {
  cancelTurn();
  const next = Math.max(1, Math.min(4, value));
  if (anchor && next !== 1) {
    const scale = next / zoom;
    pan.x = anchor.x - stage.clientWidth / 2 - (anchor.x - stage.clientWidth / 2 - pan.x) * scale;
    pan.y = anchor.y - stage.clientHeight / 2 - (anchor.y - stage.clientHeight / 2 - pan.y) * scale;
  } else if (next === 1) {
    pan.x = 0;
    pan.y = 0;
  }
  zoom = next;
  byId('zoom-reset').textContent = Math.round(100 * zoom) + ' %';
  if (redraw) reposition();
}

function point(event) {
  const bounds = stage.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function physicalSide(direction) {
  return book.rtl ? -direction : direction;
}

function hitEdge(position) {
  if (!current) return 0;
  const sheets = positioned(current);
  for (const direction of [1, -1]) {
    if (!neighbors.has(direction)) continue;
    const side = physicalSide(direction);
    const sheet = side > 0 ? sheets.at(-1) : sheets[0];
    const edge = side > 0 ? sheet.x + sheet.w : sheet.x;
    const edgeWidth = Math.min(96, sheet.w * .24);
    if (Math.abs(position.x - edge) <= edgeWidth && position.y >= sheet.y - 24 && position.y <= sheet.y + sheet.h + 24) return direction;
  }
  return 0;
}

function interpolatePaper(from, to, amount) {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    w: from.w + (to.w - from.w) * amount,
    h: from.h + (to.h - from.h) * amount
  };
}

function smooth(amount) {
  const value = Math.max(0, Math.min(1, amount));
  return value * value * (3 - 2 * value);
}

function startTurn(direction, target) {
  if (!current || activeTurn || !settings.motion) return null;
  const side = physicalSide(direction);
  const original = turningLeaves(positioned(current));
  const next = turningLeaves(positioned(target, { x: 0, y: topPan(target) }));
  const sheet = side > 0 ? original.at(-1) : original[0];
  const draw = original.length !== next.length
    ? bookTurn(original, next, side)
    : original.length === 2 ? spreadTurn(original, next, side) : singleTurn(sheet, next[0], side);
  if (!draw) return null;
  activeTurn = { sheet, side, target, draw, progress: 0, tilt: 0, frame: 0 };
  draw(0, 0);
  return activeTurn;
}

function startCurl(paper, side, back, bound) {
  if (!paper.image) return null;
  const options = {
    width: stage.clientWidth, height: stage.clientHeight, paper, back, side, bound
  };
  let draw;
  try { draw = curl?.begin(options); } catch (error) { console.warn(error); }
  if (draw) return draw;
  canvas.hidden = true;
  return paperFold?.begin(options);
}

function bookTurn(original, next, direction) {
  const openingBook = original.length === 1;
  const single = (openingBook ? original : next)[0];
  const spread = openingBook ? next : original;
  const side = openingBook ? direction : -direction;
  const [back, beneath] = side > 0 ? spread : [...spread].reverse();
  const fold = startCurl(single, side, back, true);
  if (!fold) return null;
  const under = sheetNode(beneath);
  scene.replaceChildren(under);

  // While the leaf turns, its inner edge moves from center to the spine.
  // The facing page moves beneath it and stays covered until the fold reveals it.
  return (progress, tilt) => {
    const open = openingBook ? progress : 1 - progress;
    const travel = smooth(open / .84);
    const base = interpolatePaper(single, beneath, travel);
    const width = single.w + (back.w - single.w) * smooth((open - .42) / .58);
    const geometry = { ...base, w: width, x: side > 0 ? base.x : base.x + base.w - width };
    rectangle(under, base);
    under.style.opacity = Math.min(1, open * 7);
    fold(open, tilt, geometry);
  };
}

function spreadTurn(original, next, side) {
  const [stationary, front] = side > 0 ? original : [...original].reverse();
  const [back, beneath] = side > 0 ? next : [...next].reverse();
  const draw = startCurl(front, side, back, true);
  if (!draw) return null;
  const under = sheetNode(beneath);
  const still = sheetNode(stationary);
  scene.replaceChildren(under, still);
  shadow.style.background = `linear-gradient(to ${side > 0 ? 'left' : 'right'}, #0007, transparent 24%)`;
  shadow.hidden = false;
  shadow.style.opacity = '0';

  return (progress, tilt) => {
    const travel = smooth(progress);
    const facing = interpolatePaper(front, beneath, travel);
    const fixed = interpolatePaper(stationary, back, travel);
    const width = front.w + (back.w - front.w) * smooth((progress - .42) / .58);
    rectangle(under, facing);
    rectangle(still, fixed);
    rectangle(shadow, fixed);
    draw(progress, tilt, {
      ...facing, w: width, x: side > 0 ? facing.x : facing.x + facing.w - width,
      spine: (front.half === undefined ? 1 : 0) * (1 - travel) + (back.half === undefined ? 1 : 0) * travel
    });
  };
}

function singleTurn(front, next, side) {
  const draw = startCurl(front, side, null, false);
  if (!draw) return null;
  const under = sheetNode(next);
  scene.replaceChildren(under);
  return (progress, tilt) => {
    const reveal = smooth((progress - .34) / .66);
    const base = interpolatePaper(front, next, reveal);
    rectangle(under, base);
    under.style.clipPath = `inset(${Math.max(0, front.y - base.y) * (1 - reveal)}px ${Math.max(0, base.x + base.w - front.x - front.w) * (1 - reveal)}px ${Math.max(0, base.y + base.h - front.y - front.h) * (1 - reveal)}px ${Math.max(0, front.x - base.x) * (1 - reveal)}px)`;
    draw(progress, tilt, interpolatePaper(front, next, smooth((progress - .45) / .55)));
  };
}

function updateTurn(turn, progress, tilt) {
  if (activeTurn !== turn) return;
  turn.progress = progress;
  turn.tilt = tilt;
  shadow.style.opacity = Math.sin(progress * Math.PI) * .8;
  if (turn.frame) return;
  turn.frame = requestAnimationFrame(() => {
    turn.frame = 0;
    if (activeTurn === turn) turn.draw(turn.progress, turn.tilt);
  });
}

function endTurn(turn, complete) {
  if (activeTurn !== turn) return;
  cancelAnimationFrame(turn.frame);
  cancelAnimationFrame(turn.easeFrame);
  activeTurn = null;
  canvas.hidden = true;
  paperCanvas.hidden = true;
  shadow.hidden = true;
  if (complete) commit(turn.target);
  else render();
}

function cancelTurn() {
  if (activeTurn) endTurn(activeTurn, false);
  clearTimeout(gesture?.hold);
  gesture = null;
  stage.dataset.cursor = '';
}

function paperSound() {
  if (!settings.sound) return;
  try {
    audioContext ||= new AudioContext();
    audioContext.resume().catch(() => {});
    const length = Math.floor(audioContext.sampleRate * .22);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < length; index++) {
      const fade = Math.sin(Math.PI * index / length) ** 2;
      samples[index] = (Math.random() * 2 - 1) * fade;
    }
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1450;
    filter.Q.value = .7;
    const gain = audioContext.createGain();
    gain.gain.value = .11;
    source.connect(filter).connect(gain).connect(audioContext.destination);
    source.start();
  } catch (error) { console.warn(error); }
}

function settle(turn, complete, duration) {
  if (complete) paperSound();
  const from = turn.progress;
  const tilt = turn.tilt;
  const to = complete ? 1 : 0;
  let start;
  function step(time) {
    if (activeTurn !== turn) return;
    start ??= time;
    const elapsed = Math.min(1, (time - start) / duration);
    if (elapsed >= 1) {
      endTurn(turn, complete);
      return;
    }
    const eased = complete ? elapsed * elapsed * (3 - 2 * elapsed) : 1 - (1 - elapsed) ** 3;
    turn.progress = from + (to - from) * eased;
    turn.draw(turn.progress, tilt);
    shadow.style.opacity = Math.sin(turn.progress * Math.PI) * .8;
    turn.easeFrame = requestAnimationFrame(step);
  }
  turn.easeFrame = requestAnimationFrame(step);
}

async function navigate(direction) {
  if (!book || opening || changing) return;
  if (activeTurn) return;
  const neighbor = neighbors.get(direction);
  if (!neighbor) return;
  const request = signature;
  changing = true;
  const target = await neighbor.promise;
  if (signature !== request) return;
  changing = false;
  const turn = startTurn(direction, target);
  if (!turn) {
    paperSound();
    commit(target);
    return;
  }
  turn.tilt = .24;
  settle(turn, true, 450);
}

function updatePinch() {
  const [a, b] = pointers.values();
  const distance = Math.hypot(a.x - b.x, a.y - b.y);
  const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { distance, center };
}

function turnTilt(interaction, turn, position) {
  const bottom = interaction.start.y > turn.sheet.y + turn.sheet.h / 2;
  const bias = (position.y - interaction.start.y) / turn.sheet.h;
  return Math.max(-.65, Math.min(.65, (bottom ? .39 : -.39) + bias * .8));
}

function updateGrab(interaction) {
  const turn = interaction.turn;
  if (!turn) return;
  const { start, last } = interaction;
  const delta = (start.x - last.x) * turn.side;
  const grip = interaction.held ? .16 : .025;
  const progress = Math.max(0, Math.min(.98, grip + delta / (turn.sheet.w * 1.12)));
  updateTurn(turn, progress, turnTilt(interaction, turn, last));
}

function grab(interaction, direction) {
  if (!direction || interaction.turn || interaction.waiting || !settings.motion) return;
  const neighbor = neighbors.get(direction);
  if (!neighbor) return;
  function begin(target) {
    if (gesture !== interaction) return;
    if (interaction.direction !== direction) {
      grab(interaction, interaction.direction);
      return;
    }
    interaction.turn = startTurn(direction, target);
    if (interaction.turn) updateGrab(interaction);
  }
  if (neighbor.spread) begin(neighbor.spread);
  else {
    interaction.waiting = true;
    neighbor.promise.then(target => {
      interaction.waiting = false;
      begin(target);
    });
  }
}

stage.addEventListener('pointerdown', event => {
  if (!current || changing || opening || event.button !== 0 || activeTurn?.easeFrame ||
      pageTurnTip.contains(event.target)) return;
  const position = point(event);
  pointers.set(event.pointerId, position);
  stage.setPointerCapture(event.pointerId);
  if (pointers.size > 1 && event.pointerType === 'touch') {
    cancelTurn();
    gesture = { type: 'pinch', ...updatePinch() };
    return;
  }
  const edge = hitEdge(position);
  const sheets = positioned(current);
  const onPage = sheets.some(sheet => position.x >= sheet.x && position.x <= sheet.x + sheet.w &&
    position.y >= sheet.y && position.y <= sheet.y + sheet.h);
  const middle = (sheets[0].x + sheets.at(-1).x + sheets.at(-1).w) / 2;
  const type = zoom > 1 && !edge ? 'pan' : 'page';
  const interaction = { type, edge, onPage, start: position, last: position,
    direction: edge, moved: false, startTime: performance.now(), touch: event.pointerType === 'touch' };
  gesture = interaction;
  if (type === 'pan') stage.dataset.cursor = 'drag';
  if (type === 'page' && (onPage || edge)) {
    interaction.hold = setTimeout(() => {
      if (gesture !== interaction || interaction.moved || !settings.motion) return;
      const preferred = physicalSide(position.x >= middle ? 1 : -1);
      interaction.direction = edge || (neighbors.has(preferred) ? preferred : -preferred);
      interaction.held = true;
      stage.dataset.cursor = 'drag';
      grab(interaction, interaction.direction);
    }, 165);
    if (edge) {
      stage.dataset.cursor = 'drag';
      grab(interaction, edge);
    }
  }
});

stage.addEventListener('pointermove', event => {
  if (!pointers.has(event.pointerId)) {
    stage.dataset.cursor = settings.motion && hitEdge(point(event)) ? 'fold' : zoom > 1 ? 'pan' : '';
    return;
  }
  const position = point(event);
  pointers.set(event.pointerId, position);
  if (!gesture) return;
  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const next = updatePinch();
    if (gesture.distance > 0) setZoom(zoom * next.distance / gesture.distance, next.center);
    gesture = { type: 'pinch', ...next };
    return;
  }
  const { start, last } = gesture;
  const dx = position.x - start.x;
  const dy = position.y - start.y;
  gesture.moved ||= Math.hypot(dx, dy) > 6;
  gesture.last = position;
  if (gesture.type === 'pan') {
    pan.x += position.x - last.x;
    pan.y += position.y - last.y;
    reposition();
  } else {
    if (Math.abs(dx) > 10 && (gesture.edge ||
        ((gesture.onPage || gesture.touch) && Math.abs(dx) > Math.abs(dy) * .8))) {
      const direction = gesture.edge || physicalSide(dx < 0 ? 1 : -1);
      if (direction !== gesture.direction && neighbors.has(direction)) {
        if (gesture.turn) endTurn(gesture.turn, false);
        gesture.turn = null;
        gesture.direction = direction;
      }
      grab(gesture, gesture.direction);
    }
    updateGrab(gesture);
  }
});

function release(event, canceled = false) {
  if (!pointers.delete(event.pointerId) || !gesture) return;
  const previous = gesture;
  if (previous.type === 'pinch' && pointers.size >= 2) return;
  clearTimeout(previous.hold);
  gesture = null;
  stage.dataset.cursor = '';
  const position = point(event);
  if (previous.turn) {
    const { turn, moved, held, edge, startTime } = previous;
    previous.last = position;
    updateGrab(previous);
    const distance = (previous.start.x - position.x) * turn.side;
    const quick = performance.now() - startTime < 295 && distance > Math.min(105, turn.sheet.w * .23);
    const complete = !canceled && ((!held && !moved && edge) ||
      (moved && (distance >= turn.sheet.w * .34 || quick)));
    if (complete && moved) dismissPageTurnTip();
    settle(turn, complete, complete ? 300 : 235);
  } else if (!canceled && previous.type === 'page') {
    const dx = position.x - previous.start.x;
    const dy = position.y - previous.start.y;
    if ((previous.onPage || previous.edge || previous.touch) &&
        Math.abs(dx) > 58 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      navigate(physicalSide(dx < 0 ? 1 : -1));
      return;
    }
    const spread = positioned(current);
    if (!previous.moved && !previous.held) {
      const left = spread[0].x;
      const right = spread.at(-1).x + spread.at(-1).w;
      if (previous.edge) navigate(previous.edge);
      else if (position.x >= right - 27) navigate(physicalSide(1));
      else if (position.x <= left + 27) navigate(physicalSide(-1));
      else if (document.body.classList.contains('fullscreen')) showChrome();
    }
  }
}

stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', event => release(event, true));
stage.addEventListener('lostpointercapture', event => release(event, true));
stage.addEventListener('pointerleave', () => { if (!gesture) stage.dataset.cursor = ''; });
stage.addEventListener('dblclick', event => {
  if (event.target === stage && !hitEdge(point(event))) setZoom(zoom > 1 ? 1 : 1.9, point(event));
});
stage.addEventListener('wheel', event => {
  if (!book || !event.deltaY) return;
  event.preventDefault();
  setZoom(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), point(event));
}, { passive: false });

function setDrawer(visible) {
  drawer.hidden = !visible;
  byId('thumb-toggle').setAttribute('aria-expanded', visible);
  thumbObserver?.disconnect();
  thumbList.replaceChildren();
  if (!visible || !book) return;
  const comic = book;
  thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const button = entry.target;
      button.querySelector('img').src = `/thumb/${comic.id}/${button.dataset.index}`;
      thumbObserver.unobserve(button);
    }
  }, { root: thumbList, rootMargin: '90px' });
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < book.count; index++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb';
    button.dataset.index = index;
    button.setAttribute('aria-label', `Ir a la página ${index + 1}`);
    const image = document.createElement('img');
    image.decoding = 'async';
    image.alt = '';
    const label = document.createElement('span');
    label.textContent = index + 1;
    button.append(image, label);
    button.addEventListener('click', () => showPage(index));
    fragment.append(button);
    thumbObserver.observe(button);
  }
  thumbList.append(fragment);
  markThumbnail();
  thumbList.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
}

function markThumbnail() {
  thumbList.querySelectorAll('[aria-current]').forEach(button => button.removeAttribute('aria-current'));
  for (const index of current?.indices || []) {
    thumbList.querySelector(`[data-index="${index}"]`)?.setAttribute('aria-current', 'page');
  }
}

function setPopover(id, button, visible) {
  byId(id).hidden = !visible;
  byId(button).setAttribute('aria-expanded', visible);
}

function closePopovers(returnFocus = false) {
  const hadFocus = !byId('options').hidden || !byId('jump').hidden;
  setPopover('options', 'settings', false);
  setPopover('jump', 'page-label', false);
  if (returnFocus && hadFocus && book) stage.focus({ preventScroll: true });
  if (hadFocus && !chromeOverControls && document.body.classList.contains('chrome-visible')) scheduleChromeHide();
}

function jump() {
  const show = byId('jump').hidden;
  closePopovers();
  setPopover('jump', 'page-label', show);
  if (show) {
    byId('page-number').value = pageIndex + 1;
    byId('page-number').focus();
    byId('page-number').select();
  }
}

function home() {
  if (!book || opening) return;
  cancelTurn();
  closePopovers();
  setDrawer(false);
  if (document.body.classList.contains('fullscreen')) window.pliego.fullscreen();
  book = null;
  current = null;
  signature = undefined;
  changing = false;
  neighbors.clear();
  scene.replaceChildren();
  byId('reading').hidden = true;
  pageTurnTip.hidden = true;
  byId('navigation').hidden = true;
  byId('tools').hidden = true;
  byId('title').textContent = '';
  byId('title').title = '';
  library.render();
  byId('welcome').hidden = false;
}

function showChrome(hold = false) {
  if (!book || !document.body.classList.contains('fullscreen')) return;
  document.body.classList.add('chrome-visible');
  if (hold) clearTimeout(chromeTimer);
  else scheduleChromeHide(850);
}

function hideChrome() {
  clearTimeout(chromeTimer);
  document.body.classList.remove('chrome-visible');
  if (document.activeElement?.closest(chromeControls)) stage.focus({ preventScroll: true });
}

function scheduleChromeHide(delay = 110) {
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => {
    if (byId('options').hidden && byId('jump').hidden) hideChrome();
  }, delay);
}

function trackChromePointer(overControls) {
  if (chromeOverControls === overControls) return;
  chromeOverControls = overControls;
  if (overControls) clearTimeout(chromeTimer);
  else if (document.body.classList.contains('chrome-visible')) scheduleChromeHide();
}

new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (!book || !current || opening) return;
    const nextDouble = doubleView();
    cancelTurn();
    if (previousDouble !== nextDouble) showPage(pageIndex);
    else reposition();
  });
}).observe(stage);

const library = createLibrary({ byId, icon, openComic, notice });
const choose = () => book ? openComic(() => window.pliego.choose(library.category())) : library.importFiles();
byId('home').addEventListener('click', home);
byId('page-turn-tip-close').addEventListener('click', () => {
  dismissPageTurnTip();
  stage.focus({ preventScroll: true });
});
byId('previous').addEventListener('click', () => navigate(-1));
byId('next').addEventListener('click', () => navigate(1));
byId('zoom-out').addEventListener('click', () => setZoom(zoom / 1.25));
byId('zoom-in').addEventListener('click', () => setZoom(zoom * 1.25));
byId('zoom-reset').addEventListener('click', () => setZoom(1));
byId('fullscreen').addEventListener('click', () => window.pliego.fullscreen());
byId('thumb-toggle').addEventListener('click', () => setDrawer(drawer.hidden));
byId('thumb-close').addEventListener('click', () => setDrawer(false));
byId('page-label').addEventListener('click', jump);
byId('settings').addEventListener('click', () => {
  const show = byId('options').hidden;
  closePopovers();
  setPopover('options', 'settings', show);
});
byId('jump').addEventListener('submit', event => {
  event.preventDefault();
  showPage(Number(byId('page-number').value) - 1);
  closePopovers();
  stage.focus();
});
scrubber.addEventListener('input', () => {
  byId('page-label').textContent = scrubber.value + ' / ' + book.count;
  updateScrubber();
});
scrubber.addEventListener('change', () => showPage(Number(scrubber.value) - 1));

function syncOptions() {
  byId('layout-option').value = settings.layout;
  byId('motion-option').checked = settings.motion;
  byId('sound-option').checked = settings.sound;
}

for (const [id, name] of [['layout-option', 'layout'], ['motion-option', 'motion'], ['sound-option', 'sound']]) {
  byId(id).addEventListener('change', event => {
    settings[name] = name === 'layout' ? event.target.value : event.target.checked;
    window.pliego.settings(settings).catch(console.error);
    if (name === 'layout') showPage(pageIndex);
    if (name === 'motion') pageTurnTip.hidden = pageTurnTipSeen || !settings.motion || !book || book.count < 2;
  });
}
byId('rtl-option').addEventListener('change', event => {
  if (!book) return;
  book.rtl = event.target.checked;
  showPage(pageIndex);
});

window.addEventListener('pointerdown', event => {
  if (!event.target.closest('#options, #settings, #jump, #page-label')) closePopovers();
});
window.addEventListener('pointermove', event => {
  if (!document.body.classList.contains('fullscreen')) return;
  const atEdge = event.clientY < 18 || event.clientY > innerHeight - 18;
  trackChromePointer(atEdge || Boolean(event.target.closest(chromeControls)));
  if (!atEdge) chromeEdgeArmed = true;
  if (atEdge && chromeEdgeArmed) {
    chromeEdgeArmed = false;
    showChrome(true);
  }
});
window.addEventListener('pointerout', event => {
  if (!event.relatedTarget && document.body.classList.contains('fullscreen')) {
    trackChromePointer(false);
    chromeEdgeArmed = true;
  }
});
window.addEventListener('focusin', event => {
  if (!document.body.classList.contains('chrome-visible')) return;
  if (event.target.closest(chromeControls) && event.target.matches(':focus-visible')) showChrome(true);
  else if (!chromeOverControls) scheduleChromeHide();
});
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.target.closest('dialog')) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    choose();
    return;
  }
  if (!book) return;
  if (event.key === 'F11') {
    event.preventDefault();
    if (!event.repeat) window.pliego.fullscreen();
    return;
  }
  if (event.key === 'Tab' && document.body.classList.contains('fullscreen')) showChrome();
  if (event.key === 'Escape') {
    if (!byId('options').hidden || !byId('jump').hidden) closePopovers(true);
    else if (!drawer.hidden) setDrawer(false);
    else if (document.body.classList.contains('fullscreen')) window.pliego.fullscreen();
    else if (pageTurnTip.contains(event.target)) {
      dismissPageTurnTip();
      stage.focus({ preventScroll: true });
    }
    else if (zoom > 1) setZoom(1);
    else cancelTurn();
    return;
  }
  if (event.target.matches('input, select, textarea') || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === ' ' && event.target.closest('button')) return;
  const action = {
    arrowright: () => navigate(physicalSide(1)), arrowleft: () => navigate(physicalSide(-1)),
    pagedown: () => navigate(1), pageup: () => navigate(-1), ' ': () => navigate(event.shiftKey ? -1 : 1),
    home: () => showPage(0), end: () => showPage(book.count - 1), g: jump,
    t: () => setDrawer(drawer.hidden),
    '+': () => setZoom(zoom * 1.25), '=': () => setZoom(zoom * 1.25), '-': () => setZoom(zoom / 1.25),
    '0': () => setZoom(1)
  }[key];
  if (action) {
    event.preventDefault();
    action();
  }
});

const dropHint = byId('drop-hint');
window.addEventListener('dragover', event => {
  event.preventDefault();
  if (event.dataTransfer.types.includes('Files')) {
    event.dataTransfer.dropEffect = 'copy';
    dropHint.querySelector('span').textContent = book ? 'Suelta el cómic para abrirlo' : 'Suelta los archivos para añadirlos';
    dropHint.hidden = false;
  }
});
window.addEventListener('dragleave', event => { if (!event.relatedTarget) dropHint.hidden = true; });
window.addEventListener('drop', event => {
  event.preventDefault();
  dropHint.hidden = true;
  const files = Array.from(event.dataTransfer.files);
  if (!files.length) return;
  if (book) openComic(() => window.pliego.drop(files[0], library.category()));
  else library.importFiles(files);
});

window.pliego.onFullscreen(value => {
  document.body.classList.toggle('fullscreen', value);
  byId('fullscreen').setAttribute('aria-pressed', value);
  closePopovers();
  hideChrome();
  chromeEdgeArmed = false;
  chromeOverControls = false;
  if (value) {
    setDrawer(false);
    stage.focus({ preventScroll: true });
  }
});
window.pliego.onExternalOpen(file => openComic(() => window.pliego.open(file)));

const initial = await window.pliego.initial();
Object.assign(settings, initial.settings);
pageTurnTipSeen = initial.pageTurnTipSeen;
syncOptions();
library.update(initial.library);
library.render();
window.pliego.onLibraryChanged(data => {
  library.update(data);
  if (!book && !document.querySelector('#library-dialog[open]')) library.render();
});
createDownloads(byId, library).catch(console.error);
if (initial.file) openComic(() => window.pliego.open(initial.file));
