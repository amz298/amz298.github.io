(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const dialog = $('viewer-dialog');
  const canvas = $('viewer-canvas');
  const context = canvas.getContext('2d');
  const previewCanvas = $('preview-canvas');
  const previewContext = previewCanvas.getContext('2d');
  const palette = ['#4d91d8', '#ed9565', '#34aa9b', '#a67dd3', '#d8af4d', '#dd748f', '#6984be', '#8ba85c'];
  const cubeFaces = [
    { vertices: [3, 0, 4, 7], normal: [-1, 0, 0], shade: 0.77 },
    { vertices: [1, 2, 6, 5], normal: [1, 0, 0], shade: 0.82 },
    { vertices: [0, 1, 5, 4], normal: [0, -1, 0], shade: 0.95 },
    { vertices: [3, 2, 6, 7], normal: [0, 1, 0], shade: 0.71 },
    { vertices: [3, 2, 1, 0], normal: [0, 0, -1], shade: 0.62 },
    { vertices: [4, 5, 6, 7], normal: [0, 0, 1], shade: 1.15 },
  ];
  const cubeEdges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const format = n => Number(n.toFixed(1)).toString();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  let current = null;
  let yaw = 0.65;
  let pitch = 0.52;
  let zoom = 1;
  let cutoff = 0;
  let selected = -1;
  let faceHits = [];
  let frame = 0;
  let drag = null;
  let previewCurrent = null;
  let previewFrame = 0;
  let rigidPlacements = [];
  let playbackProgress = 0;
  let playbackPlaying = false;
  let playbackStartedAt = 0;
  let playbackStepMs = 650;

  function corners(x, y, z, l, w, h) {
    return [
      [x,y,z], [x+l,y,z], [x+l,y+w,z], [x,y+w,z],
      [x,y,z+h], [x+l,y,z+h], [x+l,y+w,z+h], [x,y+w,z+h],
    ];
  }

  function geometry(width, height, box, view) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    const rotate = point => {
      const x = point[0] - box.il / 2;
      const y = point[1] - box.iw / 2;
      const z = point[2] - box.ih / 2;
      const rx = x * cy - y * sy;
      const ry = x * sy + y * cy;
      return { x: rx, depth: ry * cp - z * sp, up: ry * sp + z * cp };
    };
    const outer = corners(0, 0, 0, box.il, box.iw, box.ih).map(rotate);
    const minX = Math.min(...outer.map(p => p.x));
    const maxX = Math.max(...outer.map(p => p.x));
    const minUp = Math.min(...outer.map(p => p.up));
    const maxUp = Math.max(...outer.map(p => p.up));
    const scale = Math.min((width - 70) / Math.max(1, maxX - minX), (height - 70) / Math.max(1, maxUp - minUp)) * view.zoom;
    const centerX = (minX + maxX) / 2;
    const centerUp = (minUp + maxUp) / 2;
    const project = point => ({
      x: width / 2 + (point.x - centerX) * scale,
      y: height / 2 - (point.up - centerUp) * scale,
      depth: point.depth,
    });
    const normalDepth = normal => (normal[0] * sy + normal[1] * cy) * cp - normal[2] * sp;
    return { rotate, project, normalDepth, outer: outer.map(project) };
  }

  function fillColor(hex, light) {
    const parts = [1, 3, 5].map(i => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * light), 0, 255));
    return `rgb(${parts.join(',')})`;
  }

  function path(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function drawEdges(ctx, points, far) {
    ctx.save();
    ctx.strokeStyle = far ? '#94b8b6' : '#267d7b';
    ctx.lineWidth = far ? 1.15 : 2.2;
    ctx.setLineDash(far ? [5, 5] : []);
    for (const [a, b] of cubeEdges) {
      const depth = (points[a].depth + points[b].depth) / 2;
      if ((depth > 0) !== far) continue;
      ctx.beginPath();
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScene(targetCanvas, ctx, scene, view) {
    const bounds = targetCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    if (targetCanvas.width !== Math.round(width * dpr) || targetCanvas.height !== Math.round(height * dpr)) {
      targetCanvas.width = Math.round(width * dpr);
      targetCanvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#f8fcfb');
    background.addColorStop(1, '#eaf4f3');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const { rotate, project, normalDepth, outer } = geometry(width, height, scene.box, view);
    const floor = [outer[0], outer[1], outer[2], outer[3]];
    path(ctx, floor);
    ctx.fillStyle = '#dceae8';
    ctx.fill();
    drawEdges(ctx, outer, true);

    const faces = [];
    const progress = view.progress ?? Infinity;
    let rigidRank = 0;
    for (const [index, placed] of scene.carton.placements.entries()) {
      if (placed.approximate) continue;
      const rank = rigidRank++;
      if (rank >= progress) continue;
      const entering = Number.isFinite(progress) && rank === Math.floor(progress);
      const phase = entering ? progress - rank : 1;
      const lift = entering ? Math.min(14, Math.max(0, scene.box.ih - placed.h - placed.z)) * (1 - (1 - phase) ** 3) : 0;
      const animatedZ = placed.z + (entering ? Math.min(14, Math.max(0, scene.box.ih - placed.h - placed.z)) - lift : 0);
      if (animatedZ + placed.h > view.cutoff + 1e-7) continue;
      const vertices = corners(placed.x, placed.y, animatedZ, placed.l, placed.w, placed.h).map(rotate).map(project);
      const color = scene.colors.get(placed.sku) || palette[0];
      for (const face of cubeFaces) {
        if (normalDepth(face.normal) >= -1e-7) continue;
        const points = face.vertices.map(i => vertices[i]);
        faces.push({ index, points, depth: points.reduce((n, p) => n + p.depth, 0) / 4, color, shade: face.shade, alpha: entering ? 0.38 + 0.62 * phase : 1, entering });
      }
    }
    faces.sort((a, b) => a.entering === b.entering ? b.depth - a.depth : a.entering ? 1 : -1);
    for (const face of faces) {
      path(ctx, face.points);
      ctx.globalAlpha = face.alpha;
      ctx.fillStyle = fillColor(face.color, face.shade);
      ctx.fill();
      ctx.strokeStyle = face.index === view.selected || face.entering ? '#174f50' : 'rgba(255,255,255,.82)';
      ctx.lineWidth = face.index === view.selected || face.entering ? 2.2 : 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawEdges(ctx, outer, false);
    return faces;
  }

  function draw() {
    frame = 0;
    if (!current || !dialog.open) return;
    if (playbackPlaying) {
      playbackProgress = Math.min(rigidPlacements.length, (Date.now() - playbackStartedAt) / playbackStepMs);
      if (playbackProgress >= rigidPlacements.length) playbackPlaying = false;
      updatePlaybackControls();
    }
    faceHits = drawScene(canvas, context, current, { yaw, pitch, zoom, cutoff, selected, progress: playbackProgress });
    if (playbackPlaying) requestDraw();
  }

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function drawPreview() {
    previewFrame = 0;
    if (!previewCurrent) return;
    drawScene(previewCanvas, previewContext, previewCurrent, {
      yaw: 0.65, pitch: 0.52, zoom: 1, cutoff: previewCurrent.box.ih, selected: -1,
    });
  }

  function requestPreviewDraw() {
    if (!previewFrame) previewFrame = requestAnimationFrame(drawPreview);
  }

  function preview({ carton, box, products }) {
    const colors = new Map(products.map((p, i) => [p.sku, palette[i % palette.length]]));
    previewCurrent = { carton, box, products, colors };
    requestPreviewDraw();
  }

  function inside(points, x, y) {
    let result = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
  }

  function showSelected() {
    const element = $('viewer-selected');
    if (!current || selected < 0) {
      element.textContent = '点击图中的产品，查看 SKU、方向与坐标。';
      return;
    }
    const placed = current.carton.placements[selected];
    const product = current.products.find(p => p.sku === placed.sku);
    const support = placed.z > 1e-8 ? `<dt>底面支撑</dt><dd>${Math.round((placed.supportRatio || 0) * 100)}% · 第 ${placed.layer || '—'} 层</dd>` : '<dt>底面支撑</dt><dd>箱底 · 第 1 层</dd>';
    element.innerHTML = `<strong>${escapeHtml(placed.sku)}</strong><span>${escapeHtml(product?.name || '')}</span><dl><dt>实际摆放</dt><dd>${format(placed.l)} × ${format(placed.w)} × ${format(placed.h)} cm</dd><dt>左前下角</dt><dd>x ${format(placed.x)} · y ${format(placed.y)} · z ${format(placed.z)} cm</dd>${support}<dt>上方载荷</dt><dd>${format(placed.loadAbove || 0)} kg</dd></dl>`;
  }

  function updateHeight() {
    $('viewer-height-value').textContent = `${format(cutoff)} / ${format(current.box.ih)} cm`;
    if (selected >= 0) {
      const placed = current.carton.placements[selected];
      if (placed.z + placed.h > cutoff + 1e-7) selected = -1;
    }
    showSelected();
    requestDraw();
  }

  function updatePlaybackControls() {
    const total = rigidPlacements.length;
    const complete = Math.min(total, Math.floor(playbackProgress + 1e-6));
    const next = rigidPlacements[Math.min(complete, total - 1)];
    $('viewer-progress').value = playbackProgress;
    $('viewer-progress-count').textContent = `${complete} / ${total} 件`;
    $('viewer-play').textContent = playbackPlaying ? 'Ⅱ 暂停' : complete >= total ? '▶ 重播' : '▶ 播放装箱';
    $('viewer-prev').disabled = playbackProgress <= 0;
    $('viewer-next').disabled = playbackProgress >= total;
    $('viewer-play-status').textContent = total === 0
      ? '本箱没有可定位的固定产品；可压缩产品只做体积估算。'
      : playbackPlaying && next
        ? `正在装入第 ${complete + 1} 件 · ${next.placed.sku}`
        : complete >= total
          ? `演示完成：${total} 件固定产品已放入箱中。`
          : `已放入 ${complete} 件，下一件：${next.placed.sku}`;
  }

  function startPlayback(restart = false) {
    if (!current || !rigidPlacements.length) return;
    if (restart || playbackProgress >= rigidPlacements.length) playbackProgress = 0;
    cutoff = current.box.ih;
    $('viewer-height').value = cutoff;
    $('viewer-height-value').textContent = `${format(cutoff)} / ${format(cutoff)} cm`;
    selected = -1;
    showSelected();
    playbackPlaying = true;
    playbackStartedAt = Date.now() - playbackProgress * playbackStepMs;
    updatePlaybackControls();
    requestDraw();
  }

  function seekPlayback(progress) {
    if (!current) return;
    playbackPlaying = false;
    playbackProgress = clamp(progress, 0, rigidPlacements.length);
    selected = -1;
    showSelected();
    updatePlaybackControls();
    requestDraw();
  }

  function open({ carton, box, products }) {
    const colors = new Map(products.map((p, i) => [p.sku, palette[i % palette.length]]));
    current = { carton, box, products, colors };
    yaw = 0.65;
    pitch = 0.52;
    zoom = 1;
    cutoff = box.ih;
    selected = -1;
    rigidPlacements = carton.placements.map((placed, index) => ({ placed, index })).filter(({ placed }) => !placed.approximate);
    playbackProgress = rigidPlacements.length;
    playbackPlaying = false;
    playbackStepMs = Number($('viewer-speed').value) || 650;
    $('viewer-progress').max = rigidPlacements.length || 1;
    $('viewer-progress').disabled = rigidPlacements.length === 0;
    $('viewer-play').disabled = rigidPlacements.length === 0;
    $('viewer-replay').disabled = rigidPlacements.length === 0;
    updatePlaybackControls();
    $('viewer-title').textContent = `箱号 ${String(carton.number).padStart(2, '0')} · 3D 装箱`;
    $('viewer-subtitle').textContent = `${box.name} cm 外箱 · 可用内尺寸 ${format(box.il)} × ${format(box.iw)} × ${format(box.ih)} cm · ${carton.units} 件`;
    const slider = $('viewer-height');
    slider.max = box.ih;
    slider.step = 0.5;
    slider.value = box.ih;
    $('viewer-height-value').textContent = `${format(box.ih)} / ${format(box.ih)} cm`;
    $('viewer-legend').innerHTML = Object.entries(carton.counts).map(([sku, quantity]) => {
      const product = products.find(p => p.sku === sku);
      const approximate = carton.placements.some(p => p.sku === sku && p.approximate);
      const color = approximate ? '#9daeb1' : colors.get(sku);
      return `<div class="viewer-legend-row"><i style="background:${color}"></i><span><strong>${escapeHtml(sku)}</strong><small>${escapeHtml(product?.name || '')}${approximate ? ' · 位置估算' : ''}</small></span><b>× ${quantity}</b></div>`;
    }).join('');
    const soft = carton.placements.filter(p => p.approximate);
    const softNote = $('viewer-soft-note');
    softNote.hidden = soft.length === 0;
    if (soft.length) softNote.textContent = `${soft.length} 件可压缩产品只按有效体积估算，没有逐件坐标，因此未画入 3D 图。`;
    showSelected();
    dialog.showModal();
    requestDraw();
    $('viewer-close').focus();
  }

  function play(view) {
    open(view);
    startPlayback(true);
  }

  $('viewer-close').addEventListener('click', () => dialog.close());
  $('viewer-play').addEventListener('click', () => {
    if (playbackPlaying) {
      playbackPlaying = false;
      updatePlaybackControls();
    } else startPlayback();
  });
  $('viewer-replay').addEventListener('click', () => startPlayback(true));
  $('viewer-prev').addEventListener('click', () => seekPlayback(Math.ceil(playbackProgress) - 1));
  $('viewer-next').addEventListener('click', () => seekPlayback(Math.floor(playbackProgress) + 1));
  $('viewer-progress').addEventListener('input', e => seekPlayback(Number(e.target.value)));
  $('viewer-speed').addEventListener('change', e => {
    playbackStepMs = Number(e.target.value) || 650;
    if (playbackPlaying) playbackStartedAt = Date.now() - playbackProgress * playbackStepMs;
  });
  $('viewer-reset').addEventListener('click', () => {
    if (!current) return;
    yaw = 0.65; pitch = 0.52; zoom = 1; cutoff = current.box.ih; selected = -1;
    $('viewer-height').value = cutoff;
    updateHeight();
  });
  $('viewer-zoom-in').addEventListener('click', () => { zoom = clamp(zoom * 1.16, 0.45, 3); requestDraw(); });
  $('viewer-zoom-out').addEventListener('click', () => { zoom = clamp(zoom / 1.16, 0.45, 3); requestDraw(); });
  $('viewer-height').addEventListener('input', e => {
    playbackPlaying = false;
    cutoff = Number(e.target.value);
    updatePlaybackControls();
    updateHeight();
  });
  canvas.addEventListener('wheel', e => {
    if (!current) return;
    e.preventDefault();
    zoom = clamp(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), 0.45, 3);
    requestDraw();
  }, { passive: false });
  canvas.addEventListener('pointerdown', e => {
    if (!current) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    if (drag.moved) {
      yaw += dx * 0.009;
      pitch = clamp(pitch - dy * 0.009, -1.25, 1.25);
      requestDraw();
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (!drag.moved) {
      if (playbackPlaying) {
        playbackPlaying = false;
        updatePlaybackControls();
      }
      const bounds = canvas.getBoundingClientRect();
      const x = e.clientX - bounds.left, y = e.clientY - bounds.top;
      const hit = [...faceHits].reverse().find(face => inside(face.points, x, y));
      selected = hit?.index ?? -1;
      showSelected();
      requestDraw();
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  previewCanvas.addEventListener('click', () => { if (previewCurrent) open(previewCurrent); });
  dialog.addEventListener('close', () => { current = null; faceHits = []; selected = -1; playbackPlaying = false; });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (dialog.open) requestDraw();
      if (previewCurrent) requestPreviewDraw();
    });
    observer.observe(canvas);
    observer.observe(previewCanvas);
  }
  window.addEventListener('resize', () => {
    if (dialog.open) requestDraw();
    if (previewCurrent) requestPreviewDraw();
  });

  window.BoxwiseViewer = { open, play, preview };
})();
