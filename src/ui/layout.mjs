const ratio = image => image?.naturalWidth / image?.naturalHeight || .68;
const wide = image => ratio(image) >= 1.12;

export function createLayout(loadImage) {
  async function groupFor(index, count, double) {
    if (!double || index === 0) return [index];
    const first = index % 2 === 0 ? index - 1 : index;
    if (first + 1 >= count) return [index];
    const [left, right] = await Promise.all([loadImage(first), loadImage(first + 1)]);
    // Keep even/odd pairing stable after a wide scan and after a direct jump.
    return left && right && !wide(left) && !wide(right) ? [first, first + 1] : [index];
  }

  return { groupFor };
}

export function positionSheets(indices, images, { width, height, zoom, pan, rtl }) {
  const order = rtl ? [...indices].reverse() : indices;
  const list = order.map(index => ({ index, image: images.get(index), aspect: ratio(images.get(index)) }));
  const usableWidth = Math.max(90, width - (width < 650 ? 20 : 54));
  const usableHeight = Math.max(100, height - (height < 520 ? 24 : 44));
  const sum = list.reduce((total, item) => total + item.aspect, 0);
  const baseHeight = Math.min(usableHeight, usableWidth / sum);
  const h = baseHeight * zoom;
  const wholeWidth = h * sum;
  const maxX = Math.max(0, (wholeWidth - width) / 2 + (zoom > 1 ? 14 : 0));
  const maxY = Math.max(0, (h - height) / 2 + (zoom > 1 ? 14 : 0));
  pan.x = Math.max(-maxX, Math.min(maxX, pan.x));
  pan.y = Math.max(-maxY, Math.min(maxY, pan.y));
  let x = (width - wholeWidth) / 2 + pan.x;
  const y = (height - h) / 2 + pan.y;
  return list.map((item, slot) => {
    const w = h * item.aspect;
    const sheet = { ...item, x, y, w, h, side: list.length === 1 ? 'single' : slot === 0 ? 'left' : 'right' };
    x += w;
    return sheet;
  });
}

export function turningLeaves(sheets) {
  const [paper] = sheets;
  if (sheets.length !== 1 || !wide(paper.image)) return sheets;
  // A wide scan stays one image for reading. Its halves are the visible faces
  // of the spread while a leaf is turning around the spine.
  const w = paper.w / 2;
  return [
    { ...paper, side: 'left', w, half: 0 },
    { ...paper, side: 'right', x: paper.x + w, w, half: 1 }
  ];
}
