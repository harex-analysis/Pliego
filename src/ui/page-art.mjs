const rasters = new Map();

export function pageScale(width, height) {
  return Math.min(window.devicePixelRatio, 3072 / width, 2160 / height, Math.sqrt(4_500_000 / (width * height)));
}

export function pageRaster({ image, w, h, half }, scale) {
  const { naturalWidth, naturalHeight } = image;
  const displayWidth = w * (half === undefined ? 1 : 2);
  const limit = Math.min(1,
    4096 / Math.max(naturalWidth, naturalHeight), Math.sqrt(6_000_000 / (naturalWidth * naturalHeight)));
  const width = Math.max(1, Math.round(Math.min(naturalWidth * limit, displayWidth * scale)));
  const height = Math.max(1, Math.round(Math.min(naturalHeight * limit, h * scale)));
  if (width === naturalWidth && height === naturalHeight) return { source: image, width, height };

  const previous = rasters.get(image);
  rasters.delete(image);
  if (previous?.width === width && previous.height === height) {
    rasters.set(image, previous);
    return previous;
  }

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const ctx = source.getContext('2d');
  if (!ctx) return { source: image, width: naturalWidth, height: naturalHeight };
  // Filter the original before it becomes a texture or is painted on a stationary page.
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  const raster = { source, width, height };
  rasters.set(image, raster);
  if (rasters.size > 4) rasters.delete(rasters.keys().next().value);
  return raster;
}
