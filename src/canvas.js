export function createDrawingCanvas(canvas, onDraw, options = {}) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';

  let drawing = false;
  let changed = false;
  let mode = 'draw';
  let companionCursor = {
    x: canvas.width / 2,
    y: canvas.height / 2,
  };

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function markChanged() {
    changed = true;
    onDraw?.();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeDistance(distancePx) {
    const parsed = Number(distancePx);
    if (!Number.isFinite(parsed)) return 50;
    return clamp(Math.abs(parsed), 0, Math.max(canvas.width, canvas.height));
  }

  function directionDelta(direction, distancePx) {
    const distance = normalizeDistance(distancePx);
    if (direction === 'up') return { dx: 0, dy: -distance };
    if (direction === 'down') return { dx: 0, dy: distance };
    if (direction === 'left') return { dx: -distance, dy: 0 };
    if (direction === 'right') return { dx: distance, dy: 0 };
    throw new Error(`Unsupported companion cursor direction: ${direction}`);
  }

  function pointFromDirection(direction, distancePx) {
    const delta = directionDelta(direction, distancePx);
    return {
      x: clamp(companionCursor.x + delta.dx, 0, canvas.width),
      y: clamp(companionCursor.y + delta.dy, 0, canvas.height),
    };
  }

  function notifyCompanionCursorChanged() {
    options.onCompanionCursorChange?.({ ...companionCursor });
  }

  function setCompanionCursor(nextPoint) {
    companionCursor = {
      x: clamp(nextPoint.x, 0, canvas.width),
      y: clamp(nextPoint.y, 0, canvas.height),
    };
    notifyCompanionCursorChanged();
    return { ...companionCursor };
  }

  function normalizeLineWidth(lineWidthPx, fallback) {
    const parsed = Number(lineWidthPx);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return clamp(parsed, 1, 80);
  }

  function normalizeColor(color) {
    const candidate = typeof color === 'string' && color.trim() ? color.trim() : '#ff66aa';
    if (window.CSS?.supports?.('color', candidate)) return candidate;
    return '#ff66aa';
  }

  function drawCompanionSegment(toPoint, { color = '#ff66aa', lineWidthPx = 7, erase = false } = {}) {
    const from = { ...companionCursor };
    const to = setCompanionCursor(toPoint);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = normalizeLineWidth(lineWidthPx, 28);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = normalizeColor(color);
      ctx.lineWidth = normalizeLineWidth(lineWidthPx, 7);
    }
    ctx.stroke();
    ctx.restore();
    markChanged();
    return { from, to };
  }

  function drawImageAspectFit(image) {
    const canvasRatio = canvas.width / canvas.height;
    const imageRatio = image.width / image.height;
    let drawWidth;
    let drawHeight;
    if (imageRatio > canvasRatio) {
      drawWidth = canvas.width;
      drawHeight = canvas.width / imageRatio;
    } else {
      drawHeight = canvas.height;
      drawWidth = canvas.height * imageRatio;
    }
    const drawX = (canvas.width - drawWidth) / 2;
    const drawY = (canvas.height - drawHeight) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();
    markChanged();
  }

  async function pasteImage(blob) {
    if (!blob || !blob.type?.startsWith('image/')) {
      throw new Error('Clipboard item is not an image.');
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = 'async';
      const loaded = new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Could not load pasted image.'));
      });
      image.src = url;
      await loaded;
      drawImageAspectFit(image);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function strokeTo(p) {
    if (mode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 28;
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#111';
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }
    markChanged();
  }

  canvas.addEventListener('pointerdown', (event) => {
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    const p = point(event);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    strokeTo(p);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    strokeTo(point(event));
  });

  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });

  notifyCompanionCursorChanged();

  function captureScaledImage({ maxWidth = 768, maxHeight = 768, targetMaxBytes = 180000 } = {}) {
    // Realtime image mode is bounded by RTCDataChannel.send() message limits.
    // The caller passes a target derived from the live SCTP maxMessageSize, so
    // this function adapts both JPEG quality and dimensions until the data URL is
    // small enough for the current peer connection instead of relying on one
    // hard-coded image size.
    const safeTargetMaxBytes = Number.isFinite(Number(targetMaxBytes)) && Number(targetMaxBytes) > 0
      ? Number(targetMaxBytes)
      : 180000;
    const baseScale = Math.min(1, maxWidth / canvas.width, maxHeight / canvas.height);
    const baseWidth = Math.max(1, Math.round(canvas.width * baseScale));
    const baseHeight = Math.max(1, Math.round(canvas.height * baseScale));
    const scratch = document.createElement('canvas');

    function render(width, height, quality) {
      scratch.width = width;
      scratch.height = height;
      const scratchCtx = scratch.getContext('2d');
      scratchCtx.fillStyle = '#fff';
      scratchCtx.fillRect(0, 0, width, height);
      scratchCtx.drawImage(canvas, 0, 0, width, height);
      return scratch.toDataURL('image/jpeg', quality);
    }

    let best = render(baseWidth, baseHeight, 0.72);
    const scales = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24];
    const qualities = [0.82, 0.72, 0.62, 0.52, 0.42, 0.34, 0.28];

    for (const scale of scales) {
      const width = Math.max(1, Math.round(baseWidth * scale));
      const height = Math.max(1, Math.round(baseHeight * scale));
      for (const quality of qualities) {
        const candidate = render(width, height, quality);
        best = candidate;
        if (candidate.length <= safeTargetMaxBytes) return candidate;
      }
    }
    return best;
  }

  return {
    hasChanged: () => changed,
    markSent: () => { changed = false; },
    capture: () => canvas.toDataURL('image/png'),
    captureRealtimeImage: captureScaledImage,
    setMode: (nextMode) => {
      if (nextMode !== 'draw' && nextMode !== 'erase') {
        throw new Error(`Unsupported canvas mode: ${nextMode}`);
      }
      mode = nextMode;
    },
    getMode: () => mode,
    clear: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      markChanged();
    },
    pasteImage,
    getCompanionCursor: () => ({ ...companionCursor }),
    moveCompanionCursor: ({ direction, distance_px: distancePx = 50 } = {}) => {
      const to = pointFromDirection(direction, distancePx);
      return setCompanionCursor(to);
    },
    drawCompanionLine: ({ direction, distance_px: distancePx = 50, color = '#ff66aa', line_width_px: lineWidthPx = 7 } = {}) => {
      const to = pointFromDirection(direction, distancePx);
      return drawCompanionSegment(to, { color, lineWidthPx });
    },
    eraseCompanionLine: ({ direction, distance_px: distancePx = 50, line_width_px: lineWidthPx = 28 } = {}) => {
      const to = pointFromDirection(direction, distancePx);
      return drawCompanionSegment(to, { erase: true, lineWidthPx });
    },
  };
}
