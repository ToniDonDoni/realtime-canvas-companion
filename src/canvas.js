export function createDrawingCanvas(canvas, onDraw) {
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111';

  let drawing = false;
  let changed = false;
  let mode = 'draw';

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

  return {
    hasChanged: () => changed,
    markSent: () => { changed = false; },
    capture: () => canvas.toDataURL('image/png'),
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
  };
}
