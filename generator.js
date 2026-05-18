(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const DEFAULT_SIZE = { width: 2172, height: 724 };

  const canvas = document.querySelector('#signatureCanvas');
  const ctx = canvas.getContext('2d');
  const uploadInput = document.querySelector('[data-upload]');
  const importInput = document.querySelector('[data-import]');
  const output = document.querySelector('#projectOutput');
  const strokeSelect = document.querySelector('[data-stroke-select]');
  const countEl = document.querySelector('[data-count]');
  const regionCountEl = document.querySelector('[data-region-count]');
  const modeLabel = document.querySelector('[data-mode-label]');
  const stateEl = document.querySelector('[data-state]');
  const previewStages = {
    black: document.querySelector('[data-preview-stage="black"]'),
    gradient: document.querySelector('[data-preview-stage="gradient"]'),
  };

  const state = {
    mode: 'stroke',
    tool: 'lasso',
    selectedStrokeId: 1,
    showMarkers: false,
    currentStroke: null,
    currentRegion: null,
    replaying: false,
    size: { ...DEFAULT_SIZE },
    sourceName: 'signature-original.png',
    sourceDataUrl: './signature-original.png',
    inkDataUrl: './signature-original-transparent.png',
    gradientDataUrl: './signature-gradient.png',
    strokes: [],
    regions: [],
    previewVersion: 0,
    previewTimer: null,
    params: {
      speed: 0.82,
      overlap: 210,
      strokeWidth: 110,
      regionOverlap: 12,
      hold: 2600,
    },
    colors: {
      left: '#2563eb',
      mid1: '#7c3aed',
      mid2: '#ec4899',
      right: '#f97316',
    },
    players: [],
  };

  const guide = new Image();
  guide.onload = () => {
    state.size.width = guide.naturalWidth || DEFAULT_SIZE.width;
    state.size.height = guide.naturalHeight || DEFAULT_SIZE.height;
    resizeCanvas();
    draw();
  };
  guide.src = state.sourceDataUrl;

  function svgEl(name, attrs = {}) {
    const el = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'href') {
        el.setAttribute('href', String(value));
        el.setAttributeNS(XLINK_NS, 'xlink:href', String(value));
      } else {
        el.setAttribute(key, String(value));
      }
    });
    return el;
  }

  function round(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function setState(text) {
    stateEl.textContent = text;
  }

  function requestPreviewRender(message) {
    if (message) setState(message);
    if (state.previewTimer) clearTimeout(state.previewTimer);
    state.previewTimer = setTimeout(() => {
      state.previewTimer = null;
      renderPreviews();
    }, 220);
  }

  function resizeCanvas() {
    canvas.width = state.size.width;
    canvas.height = state.size.height;
    document.documentElement.style.setProperty('--signature-aspect', `${state.size.width} / ${state.size.height}`);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * state.size.width;
    const y = ((event.clientY - rect.top) / rect.height) * state.size.height;
    return {
      x: Math.max(0, Math.min(state.size.width, Number(x.toFixed(1)))),
      y: Math.max(0, Math.min(state.size.height, Number(y.toFixed(1)))),
      t: performance.now(),
      pressure: Number((event.pressure || 0.5).toFixed(3)),
    };
  }

  function colorForStroke(strokeId, alpha = 1) {
    const palette = ['#0f766e', '#2563eb', '#be123c', '#7c3aed', '#c2410c', '#047857', '#b45309', '#0369a1'];
    const hex = palette[(strokeId - 1) % palette.length];
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function drawGuide() {
    ctx.clearRect(0, 0, state.size.width, state.size.height);
    ctx.fillStyle = '#f7f8fb';
    ctx.fillRect(0, 0, state.size.width, state.size.height);
    if (guide.complete) {
      ctx.save();
      ctx.globalAlpha = 0.24;
      ctx.drawImage(guide, 0, 0, state.size.width, state.size.height);
      ctx.restore();
    }
  }

  function drawPath(points, color, width, showOrder, index) {
    if (points.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const p = points[i];
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + p.x) / 2, (prev.y + p.y) / 2);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
    if (showOrder) drawOrderMarker(points, index);
  }

  function drawOrderMarker(points, index) {
    const first = points[0];
    const second = points[Math.min(points.length - 1, 6)];
    const angle = Math.atan2(second.y - first.y, second.x - first.x);
    ctx.save();
    ctx.fillStyle = '#0f766e';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(first.x, first.y, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), first.x, first.y + 1);
    ctx.translate(second.x, second.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#be123c';
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.lineTo(-10, -13);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-10, 13);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPolygon(points, strokeId, operation, active = false) {
    if (points.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    if (!active) ctx.closePath();
    if (!active) {
      ctx.fillStyle = operation === 'erase' ? 'rgba(190, 18, 60, 0.22)' : colorForStroke(strokeId, 0.18);
      ctx.fill();
    }
    ctx.strokeStyle = operation === 'erase' ? '#be123c' : colorForStroke(strokeId, 0.95);
    ctx.lineWidth = active ? 7 : 5;
    ctx.setLineDash(operation === 'erase' ? [18, 12] : []);
    ctx.stroke();
    ctx.restore();
  }

  function drawRect(region, active = false) {
    const [start, end] = region.points;
    if (!start || !end) return;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    ctx.save();
    if (!active) {
      ctx.fillStyle = region.operation === 'erase' ? 'rgba(190, 18, 60, 0.22)' : colorForStroke(region.strokeId, 0.18);
      ctx.fillRect(x, y, width, height);
    }
    ctx.strokeStyle = region.operation === 'erase' ? '#be123c' : colorForStroke(region.strokeId, 0.95);
    ctx.lineWidth = active ? 7 : 5;
    ctx.setLineDash(region.operation === 'erase' ? [18, 12] : []);
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }

  function drawRegions() {
    state.regions.forEach((region) => {
      if (region.kind === 'rect') {
        drawRect({ ...region, points: [{ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y + region.height }] });
      } else {
        drawPolygon(region.points, region.strokeId, region.operation);
      }
    });
    if (state.currentRegion) {
      if (state.currentRegion.kind === 'rect') drawRect(state.currentRegion, true);
      else drawPolygon(state.currentRegion.points, state.currentRegion.strokeId, state.currentRegion.operation, true);
    }
  }

  function draw() {
    drawGuide();
    drawRegions();
    state.strokes.forEach((stroke, index) => {
      const active = stroke.id === state.selectedStrokeId && state.mode === 'region';
      drawPath(stroke.points, active ? '#0f766e' : '#111113', active ? 13 : 10, state.showMarkers, index);
    });
    if (state.currentStroke) drawPath(state.currentStroke.points, '#be123c', 10, false, 0);
  }

  function normalizeRegion(region) {
    if (region.kind === 'rect') {
      const [a, b] = region.points;
      return {
        id: state.regions.length + 1,
        strokeId: region.strokeId,
        kind: 'rect',
        operation: region.operation,
        x: round(Math.min(a.x, b.x)),
        y: round(Math.min(a.y, b.y)),
        width: round(Math.abs(b.x - a.x)),
        height: round(Math.abs(b.y - a.y)),
      };
    }
    return {
      id: state.regions.length + 1,
      strokeId: region.strokeId,
      kind: 'polygon',
      operation: region.operation,
      points: region.points.map((point) => ({ x: round(point.x), y: round(point.y) })),
    };
  }

  function updateControls() {
    countEl.textContent = String(state.strokes.length);
    regionCountEl.textContent = String(state.regions.length);
    modeLabel.textContent = state.mode === 'stroke' ? '笔顺' : '区域';
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    });
    document.querySelectorAll('[data-tool]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.tool === state.tool));
    });
    document.querySelector('[data-action="toggle-markers"]').setAttribute('aria-pressed', String(state.showMarkers));

    const previous = String(state.selectedStrokeId);
    strokeSelect.innerHTML = '';
    const maxId = Math.max(state.strokes.length, 1);
    for (let id = 1; id <= maxId; id += 1) {
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = `第 ${id} 笔`;
      strokeSelect.appendChild(option);
    }
    if (Number(previous) <= maxId) state.selectedStrokeId = Number(previous);
    state.selectedStrokeId = Math.max(1, Math.min(maxId, state.selectedStrokeId));
    strokeSelect.value = String(state.selectedStrokeId);

    Object.entries(state.params).forEach(([key, value]) => {
      const input = document.querySelector(`[data-param="${key}"]`);
      const out = document.querySelector(`[data-output="${key}"]`);
      if (input && Number(input.value) !== value) input.value = String(value);
      if (out) out.textContent = key === 'overlap' || key === 'hold' ? `${Math.round(value)}ms` : String(value);
    });
  }

  function beginStroke(event) {
    if (state.replaying || state.mode !== 'stroke') return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const start = canvasPoint(event);
    state.currentStroke = {
      id: state.strokes.length + 1,
      points: [{ ...start, t: 0 }],
      startedAt: performance.now(),
      pointerType: event.pointerType || 'unknown',
    };
    setState(`正在记录第 ${state.currentStroke.id} 笔`);
    draw();
  }

  function moveStroke(event) {
    if (!state.currentStroke || state.replaying || state.mode !== 'stroke') return;
    event.preventDefault();
    const p = canvasPoint(event);
    const last = state.currentStroke.points[state.currentStroke.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < 2.5) return;
    state.currentStroke.points.push({
      ...p,
      t: round(performance.now() - state.currentStroke.startedAt),
    });
    draw();
  }

  function endStroke(event) {
    if (!state.currentStroke || state.replaying || state.mode !== 'stroke') return;
    event.preventDefault();
    if (state.currentStroke.points.length >= 2) {
      state.currentStroke.duration = state.currentStroke.points[state.currentStroke.points.length - 1].t;
      state.strokes.push(state.currentStroke);
      state.selectedStrokeId = state.currentStroke.id;
      setState(`已保存第 ${state.currentStroke.id} 笔`);
      requestPreviewRender(`已保存第 ${state.currentStroke.id} 笔，正在刷新动态预览`);
    } else {
      setState('这一笔太短，已忽略');
    }
    state.currentStroke = null;
    updateControls();
    draw();
  }

  function beginRegion(event) {
    if (state.replaying || state.mode !== 'region') return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const p = canvasPoint(event);
    state.currentRegion = {
      id: Date.now(),
      strokeId: state.selectedStrokeId,
      kind: state.tool === 'rect' ? 'rect' : 'polygon',
      operation: state.tool === 'erase' ? 'erase' : 'include',
      points: state.tool === 'rect' ? [p, p] : [p],
    };
    setState(state.tool === 'erase' ? `正在擦除第 ${state.selectedStrokeId} 笔区域` : `正在标注第 ${state.selectedStrokeId} 笔区域`);
    draw();
  }

  function moveRegion(event) {
    if (!state.currentRegion || state.replaying || state.mode !== 'region') return;
    event.preventDefault();
    const p = canvasPoint(event);
    if (state.currentRegion.kind === 'rect') {
      state.currentRegion.points[1] = p;
    } else {
      const last = state.currentRegion.points[state.currentRegion.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 6) state.currentRegion.points.push(p);
    }
    draw();
  }

  function endRegion(event) {
    if (!state.currentRegion || state.replaying || state.mode !== 'region') return;
    event.preventDefault();
    const points = state.currentRegion.points;
    const validRect = state.currentRegion.kind === 'rect' && Math.abs(points[1].x - points[0].x) > 8 && Math.abs(points[1].y - points[0].y) > 8;
    const validPolygon = state.currentRegion.kind === 'polygon' && points.length >= 4;
    if (validRect || validPolygon) {
      state.regions.push(normalizeRegion(state.currentRegion));
      setState(`已保存第 ${state.selectedStrokeId} 笔的区域`);
      requestPreviewRender(`已保存第 ${state.selectedStrokeId} 笔区域，正在刷新动态预览`);
    } else {
      setState('区域太小，已忽略');
    }
    state.currentRegion = null;
    updateControls();
    draw();
  }

  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  function smoothstep(t) {
    return t * t * (3 - 2 * t);
  }

  function gradientColor(t) {
    const stops = [
      [0, hexToRgb(state.colors.left)],
      [0.38, hexToRgb(state.colors.mid1)],
      [0.68, hexToRgb(state.colors.mid2)],
      [1, hexToRgb(state.colors.right)],
    ];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [lt, lc] = stops[i];
      const [rt, rc] = stops[i + 1];
      if (t <= rt) {
        const q = smoothstep(Math.max(0, Math.min(1, (t - lt) / Math.max(0.0001, rt - lt))));
        return lc.map((v, index) => Math.round(v + (rc[index] - v) * q));
      }
    }
    return stops[stops.length - 1][1];
  }

  async function makeTransparentInk(source) {
    const bitmap = await createImageBitmap(source);
    state.size = { width: bitmap.width, height: bitmap.height };
    const work = document.createElement('canvas');
    work.width = bitmap.width;
    work.height = bitmap.height;
    const wctx = work.getContext('2d');
    wctx.drawImage(bitmap, 0, 0);
    const data = wctx.getImageData(0, 0, work.width, work.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const r = data.data[i];
      const g = data.data[i + 1];
      const b = data.data[i + 2];
      const a = data.data[i + 3];
      const darkness = Math.max(255 - r, 255 - g, 255 - b);
      const alpha = Math.min(a, darkness < 8 ? 0 : Math.min(255, Math.round(darkness * 1.08)));
      data.data[i] = 0;
      data.data[i + 1] = 0;
      data.data[i + 2] = 0;
      data.data[i + 3] = alpha;
    }
    wctx.putImageData(data, 0, 0);
    return work.toDataURL('image/png');
  }

  async function makeGradientInk(inkDataUrl) {
    const image = new Image();
    image.src = inkDataUrl;
    await image.decode();
    const work = document.createElement('canvas');
    work.width = image.naturalWidth;
    work.height = image.naturalHeight;
    const wctx = work.getContext('2d');
    wctx.drawImage(image, 0, 0);
    const data = wctx.getImageData(0, 0, work.width, work.height);
    for (let y = 0; y < work.height; y += 1) {
      for (let x = 0; x < work.width; x += 1) {
        const i = (y * work.width + x) * 4;
        const [r, g, b] = gradientColor(x / Math.max(1, work.width - 1));
        data.data[i] = r;
        data.data[i + 1] = g;
        data.data[i + 2] = b;
      }
    }
    wctx.putImageData(data, 0, 0);
    return work.toDataURL('image/png');
  }

  function isEmbeddedDataUrl(value) {
    return /^data:/i.test(String(value || ''));
  }

  async function toDataUrl(url) {
    if (!url || isEmbeddedDataUrl(url)) return url;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Cannot embed ${url}`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function buildExportData() {
    const inkDataUrl = await toDataUrl(state.inkDataUrl);
    const sourceDataUrl = await toDataUrl(state.sourceDataUrl).catch(() => inkDataUrl);
    const gradientDataUrl = isEmbeddedDataUrl(state.gradientDataUrl)
      ? state.gradientDataUrl
      : await makeGradientInk(inkDataUrl);
    return {
      version: 1,
      canvas: state.size,
      sourceName: state.sourceName,
      sourceDataUrl,
      inkDataUrl,
      gradientDataUrl,
      params: state.params,
      colors: state.colors,
      strokes: state.strokes.map((stroke, index) => ({
        id: index + 1,
        pointerType: stroke.pointerType,
        duration: stroke.duration,
        points: stroke.points,
      })),
      regions: state.regions,
    };
  }

  function importProject(project) {
    state.size = project.canvas || { ...DEFAULT_SIZE };
    state.sourceName = project.sourceName || 'signature.png';
    state.sourceDataUrl = project.sourceDataUrl || state.sourceDataUrl;
    state.inkDataUrl = project.inkDataUrl || state.inkDataUrl;
    state.gradientDataUrl = project.gradientDataUrl || state.gradientDataUrl;
    state.params = { ...state.params, ...(project.params || {}) };
    state.colors = { ...state.colors, ...(project.colors || {}) };
    state.strokes = (project.strokes || []).map((stroke, index) => ({
      id: index + 1,
      pointerType: stroke.pointerType || 'imported',
      duration: Number(stroke.duration || 0),
      points: (stroke.points || []).map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        t: Number(point.t || 0),
        pressure: Number(point.pressure || 0.5),
      })),
    })).filter((stroke) => stroke.points.length >= 2);
    state.regions = (project.regions || []).map((region, index) => ({ ...region, id: index + 1 }));
    resizeCanvas();
    guide.src = state.sourceDataUrl;
    Object.entries(state.colors).forEach(([key, value]) => {
      const input = document.querySelector(`[data-color="${key}"]`);
      if (input) input.value = value;
    });
    updateControls();
    renderPreviews();
    draw();
  }

  function pointsToPath(points) {
    if (!points.length) return '';
    const d = [`M ${round(points[0].x)} ${round(points[0].y)}`];
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const p = points[i];
      d.push(`Q ${round(prev.x)} ${round(prev.y)} ${round((prev.x + p.x) / 2)} ${round((prev.y + p.y) / 2)}`);
    }
    const last = points[points.length - 1];
    d.push(`L ${round(last.x)} ${round(last.y)}`);
    return d.join(' ');
  }

  function regionToPath(region) {
    if (region.kind === 'rect') {
      const x = round(region.x);
      const y = round(region.y);
      return `M ${x} ${y} H ${round(x + region.width)} V ${round(y + region.height)} H ${x} Z`;
    }
    return `M ${region.points.map((p) => `${round(p.x)} ${round(p.y)}`).join(' L ')} Z`;
  }

  class PreviewPlayer {
    constructor(container, variant) {
      this.container = container;
      this.variant = variant;
      this.timers = [];
      this.totalDuration = 0;
      this.prefix = `generated-${variant}-${Math.random().toString(36).slice(2)}`;
    }

    clearTimers() {
      this.timers.forEach((timer) => clearTimeout(timer));
      this.timers = [];
    }

    schedule(callback, delay) {
      const timer = setTimeout(() => {
        this.timers = this.timers.filter((item) => item !== timer);
        callback();
      }, delay);
      this.timers.push(timer);
    }

    destroy() {
      this.clearTimers();
      this.container.textContent = '';
    }

    imageHref() {
      return this.variant === 'gradient' ? state.gradientDataUrl : state.inkDataUrl;
    }

    build() {
      this.destroy();
      const svg = svgEl('svg', { viewBox: `0 0 ${state.size.width} ${state.size.height}`, role: 'img' });
      const defs = svgEl('defs');
      const group = svgEl('g');
      svg.append(defs, group);

      const finalLayer = svgEl('image', {
        class: 'final-layer',
        href: this.imageHref(),
        width: state.size.width,
        height: state.size.height,
        opacity: 0,
      });
      group.appendChild(finalLayer);

      const timeline = buildTimeline();
      this.totalDuration = timeline.reduce((max, stroke) => Math.max(max, stroke.delay + stroke.duration), 0) + 260;

      timeline.forEach((stroke) => {
        const maskId = `${this.prefix}-mask-${stroke.id}`;
        const regionMaskId = `${this.prefix}-region-${stroke.id}`;
        const mask = svgEl('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: state.size.width, height: state.size.height });
        mask.appendChild(svgEl('rect', { x: 0, y: 0, width: state.size.width, height: state.size.height, fill: 'black' }));
        const regionMask = svgEl('mask', { id: regionMaskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: state.size.width, height: state.size.height });
        regionMask.appendChild(svgEl('rect', { x: 0, y: 0, width: state.size.width, height: state.size.height, fill: 'black' }));
        const includeRegions = state.regions.filter((region) => region.strokeId === stroke.id && region.operation !== 'erase');
        const eraseRegions = state.regions.filter((region) => region.strokeId === stroke.id && region.operation === 'erase');
        if (includeRegions.length) {
          includeRegions.forEach((region) => {
            regionMask.appendChild(svgEl('path', {
              d: regionToPath(region),
              fill: 'white',
              stroke: 'white',
              'stroke-width': state.params.regionOverlap,
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
            }));
          });
          eraseRegions.forEach((region) => {
            regionMask.appendChild(svgEl('path', {
              d: regionToPath(region),
              fill: 'black',
              stroke: 'black',
              'stroke-width': state.params.regionOverlap,
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round',
            }));
          });
        } else {
          regionMask.appendChild(svgEl('rect', { x: 0, y: 0, width: state.size.width, height: state.size.height, fill: 'white' }));
        }
        defs.appendChild(regionMask);

        const clipped = svgEl('g', { mask: `url(#${regionMaskId})` });
        clipped.appendChild(svgEl('path', {
          class: 'mask-stroke',
          d: pointsToPath(stroke.points),
          fill: 'none',
          stroke: 'white',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'data-delay': round(stroke.delay),
          'data-duration': round(stroke.duration),
          'data-width': state.params.strokeWidth,
          'data-easing': 'cubic-bezier(.33,.18,.22,.92)',
        }));
        mask.appendChild(clipped);
        defs.appendChild(mask);
        group.appendChild(svgEl('image', {
          class: 'generated-write-layer',
          href: this.imageHref(),
          width: state.size.width,
          height: state.size.height,
          opacity: 1,
          mask: `url(#${maskId})`,
        }));
      });

      this.container.appendChild(svg);
      this.play();
    }

    play() {
      this.clearTimers();
      const finalLayer = this.container.querySelector('.final-layer');
      if (finalLayer) {
        finalLayer.style.transitionDuration = '0ms';
        finalLayer.style.opacity = '0';
        finalLayer.setAttribute('opacity', '0');
        finalLayer.getBoundingClientRect();
        finalLayer.style.transitionDuration = '';
      }
      this.container.querySelectorAll('.generated-write-layer').forEach((layer) => {
        layer.style.opacity = '1';
        layer.setAttribute('opacity', '1');
      });
      this.container.querySelectorAll('.mask-stroke').forEach((stroke) => {
        const length = stroke.getTotalLength();
        stroke.style.strokeWidth = stroke.dataset.width || state.params.strokeWidth;
        stroke.style.strokeDasharray = `${length}`;
        stroke.style.strokeDashoffset = `${length}`;
        stroke.style.animation = 'none';
        stroke.getBoundingClientRect();
        stroke.style.animation = `signature-write ${stroke.dataset.duration}ms ${stroke.dataset.easing} ${stroke.dataset.delay}ms forwards`;
      });
      this.schedule(() => {
        if (finalLayer) {
          finalLayer.style.opacity = '1';
          finalLayer.setAttribute('opacity', '1');
        }
        this.schedule(() => {
          this.container.querySelectorAll('.generated-write-layer').forEach((layer) => {
            layer.style.opacity = '0';
            layer.setAttribute('opacity', '0');
          });
        }, 220);
        this.schedule(() => {
          if (finalLayer) {
            finalLayer.style.transitionDuration = '900ms';
            finalLayer.style.opacity = '0';
            finalLayer.setAttribute('opacity', '0');
          }
          this.schedule(() => {
            if (finalLayer) finalLayer.style.transitionDuration = '';
            this.play();
          }, 900);
        }, 220 + state.params.hold);
      }, this.totalDuration);
    }
  }

  function buildTimeline() {
    let cursor = 0;
    return state.strokes.map((stroke, index) => {
      const base = Math.max(240, Math.min(1300, (stroke.duration || 900) * 0.18));
      const duration = base * state.params.speed;
      const overlap = index > 0 ? state.params.overlap * state.params.speed : 0;
      const delay = Math.max(0, cursor - overlap);
      cursor = Math.max(cursor, delay + duration);
      return { ...stroke, delay, duration };
    });
  }

  async function renderPreviews() {
    const version = state.previewVersion + 1;
    state.previewVersion = version;
    state.gradientDataUrl = await makeGradientInk(state.inkDataUrl);
    if (version !== state.previewVersion) return;
    state.players.forEach((player) => player.destroy());
    state.players = [
      new PreviewPlayer(previewStages.black, 'black'),
      new PreviewPlayer(previewStages.gradient, 'gradient'),
    ];
    state.players.forEach((player) => player.build());
    setState(state.strokes.length ? '动态预览已刷新并循环播放' : '预览为静态底图：请先描写笔顺');
  }

  async function exportJson() {
    setState('正在内嵌图片并生成工程 JSON');
    const project = await buildExportData();
    output.value = JSON.stringify(project, null, 2);
    output.focus();
    output.select();
    setState('工程 JSON 已生成，图片已内嵌');
  }

  function escapeScriptEnd(text) {
    return text.replace(/<\/script/gi, '<\\/script');
  }

  async function exportHtml() {
    setState('正在内嵌图片并导出网页');
    const project = JSON.stringify(await buildExportData());
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Dynamic Signature</title>
<style>${document.querySelector('style')?.textContent || ''}${inlineExportCss()}</style>
</head>
<body>
<main class="export-page">
  <section>
    <h1>黑色动态签名</h1>
    <div class="preview-stage" data-preview-stage="black"></div>
  </section>
  <section>
    <h1>彩色渐变动态签名</h1>
    <div class="preview-stage" data-preview-stage="gradient"></div>
  </section>
</main>
<script>window.SIGNATURE_PROJECT=${escapeScriptEnd(project)};<\\/script>
<script>${escapeScriptEnd(exportRuntime())}<\\/script>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dynamic-signature.html';
    a.click();
    URL.revokeObjectURL(url);
    setState('完整网页已导出，下载后可直接打开');
  }

  function inlineExportCss() {
    return `
body{margin:0;background:#f5f7fa;color:#1f2328;font-family:Inter,ui-sans-serif,system-ui,"Segoe UI","Noto Sans SC",sans-serif}.export-page{width:min(1080px,calc(100% - 28px));margin:0 auto;padding:28px 0;display:grid;gap:28px}h1{margin:0 0 10px;color:#64707d;font-size:16px;font-weight:500}.preview-stage{width:100%;aspect-ratio:${state.size.width}/${state.size.height}}.preview-stage svg{width:100%;height:100%;display:block;overflow:visible}.generated-write-layer{opacity:1;transition:opacity 220ms ease}.final-layer{opacity:0;transition:opacity 220ms ease}.mask-stroke{fill:none;stroke:white;stroke-linecap:round;stroke-linejoin:round}@keyframes signature-write{to{stroke-dashoffset:0}}`;
  }

  function exportRuntime() {
    return `(${exportRuntimeFactory.toString()})(window.SIGNATURE_PROJECT);`;
  }

  function exportRuntimeFactory(project) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const XLINK_NS = 'http://www.w3.org/1999/xlink';
    const round = (value) => Math.round(Number(value) * 10) / 10;
    function svgEl(name, attrs = {}) {
      const el = document.createElementNS(SVG_NS, name);
      Object.entries(attrs).forEach(([key, value]) => {
        if (key === 'href') {
          el.setAttribute('href', String(value));
          el.setAttributeNS(XLINK_NS, 'xlink:href', String(value));
        } else {
          el.setAttribute(key, String(value));
        }
      });
      return el;
    }
    function pointsToPath(points) {
      if (!points.length) return '';
      const d = ['M ' + round(points[0].x) + ' ' + round(points[0].y)];
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const p = points[i];
        d.push('Q ' + round(prev.x) + ' ' + round(prev.y) + ' ' + round((prev.x + p.x) / 2) + ' ' + round((prev.y + p.y) / 2));
      }
      const last = points[points.length - 1];
      d.push('L ' + round(last.x) + ' ' + round(last.y));
      return d.join(' ');
    }
    function regionToPath(region) {
      if (region.kind === 'rect') {
        const x = round(region.x);
        const y = round(region.y);
        return 'M ' + x + ' ' + y + ' H ' + round(x + region.width) + ' V ' + round(y + region.height) + ' H ' + x + ' Z';
      }
      return 'M ' + region.points.map((p) => round(p.x) + ' ' + round(p.y)).join(' L ') + ' Z';
    }
    function build(container, variant) {
      const size = project.canvas;
      const image = variant === 'gradient' ? project.gradientDataUrl : project.inkDataUrl;
      const svg = svgEl('svg', { viewBox: '0 0 ' + size.width + ' ' + size.height });
      const defs = svgEl('defs');
      const group = svgEl('g');
      svg.append(defs, group);
      const finalLayer = svgEl('image', { class: 'final-layer', href: image, width: size.width, height: size.height, opacity: 0 });
      group.appendChild(finalLayer);
      let cursor = 0;
      const timeline = project.strokes.map((stroke, index) => {
        const base = Math.max(240, Math.min(1300, (stroke.duration || 900) * 0.18));
        const duration = base * project.params.speed;
        const overlap = index > 0 ? project.params.overlap * project.params.speed : 0;
        const delay = Math.max(0, cursor - overlap);
        cursor = Math.max(cursor, delay + duration);
        return { ...stroke, delay, duration };
      });
      let totalDuration = 0;
      timeline.forEach((stroke) => {
        totalDuration = Math.max(totalDuration, stroke.delay + stroke.duration);
        const maskId = variant + '-mask-' + stroke.id;
        const regionMaskId = variant + '-region-' + stroke.id;
        const mask = svgEl('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: size.width, height: size.height });
        mask.appendChild(svgEl('rect', { x: 0, y: 0, width: size.width, height: size.height, fill: 'black' }));
        const regionMask = svgEl('mask', { id: regionMaskId, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: size.width, height: size.height });
        regionMask.appendChild(svgEl('rect', { x: 0, y: 0, width: size.width, height: size.height, fill: 'black' }));
        const includeRegions = project.regions.filter((region) => region.strokeId === stroke.id && region.operation !== 'erase');
        const eraseRegions = project.regions.filter((region) => region.strokeId === stroke.id && region.operation === 'erase');
        if (includeRegions.length) {
          includeRegions.forEach((region) => regionMask.appendChild(svgEl('path', { d: regionToPath(region), fill: 'white', stroke: 'white', 'stroke-width': project.params.regionOverlap, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })));
          eraseRegions.forEach((region) => regionMask.appendChild(svgEl('path', { d: regionToPath(region), fill: 'black', stroke: 'black', 'stroke-width': project.params.regionOverlap, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })));
        } else {
          regionMask.appendChild(svgEl('rect', { x: 0, y: 0, width: size.width, height: size.height, fill: 'white' }));
        }
        defs.appendChild(regionMask);
        const clipped = svgEl('g', { mask: 'url(#' + regionMaskId + ')' });
        clipped.appendChild(svgEl('path', { class: 'mask-stroke', d: pointsToPath(stroke.points), fill: 'none', stroke: 'white', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'data-delay': round(stroke.delay), 'data-duration': round(stroke.duration), 'data-width': project.params.strokeWidth, 'data-easing': 'cubic-bezier(.33,.18,.22,.92)' }));
        mask.appendChild(clipped);
        defs.appendChild(mask);
        group.appendChild(svgEl('image', { class: 'generated-write-layer', href: image, width: size.width, height: size.height, opacity: 1, mask: 'url(#' + maskId + ')' }));
      });
      container.appendChild(svg);
      function play() {
        finalLayer.style.transitionDuration = '0ms';
        finalLayer.style.opacity = '0';
        finalLayer.setAttribute('opacity', '0');
        finalLayer.getBoundingClientRect();
        finalLayer.style.transitionDuration = '';
        container.querySelectorAll('.generated-write-layer').forEach((layer) => { layer.style.opacity = '1'; layer.setAttribute('opacity', '1'); });
        container.querySelectorAll('.mask-stroke').forEach((stroke) => {
          const length = stroke.getTotalLength();
          stroke.style.strokeWidth = stroke.dataset.width;
          stroke.style.strokeDasharray = String(length);
          stroke.style.strokeDashoffset = String(length);
          stroke.style.animation = 'none';
          stroke.getBoundingClientRect();
          stroke.style.animation = 'signature-write ' + stroke.dataset.duration + 'ms ' + stroke.dataset.easing + ' ' + stroke.dataset.delay + 'ms forwards';
        });
        setTimeout(() => {
          finalLayer.style.opacity = '1';
          finalLayer.setAttribute('opacity', '1');
          setTimeout(() => container.querySelectorAll('.generated-write-layer').forEach((layer) => { layer.style.opacity = '0'; layer.setAttribute('opacity', '0'); }), 220);
          setTimeout(() => {
            finalLayer.style.transitionDuration = '900ms';
            finalLayer.style.opacity = '0';
            finalLayer.setAttribute('opacity', '0');
            setTimeout(() => {
              finalLayer.style.transitionDuration = '';
              play();
            }, 900);
          }, 220 + project.params.hold);
        }, totalDuration + 260);
      }
      play();
    }
    build(document.querySelector('[data-preview-stage="black"]'), 'black');
    build(document.querySelector('[data-preview-stage="gradient"]'), 'gradient');
  }

  function replayStrokePreview() {
    if (state.replaying || !state.strokes.length) return;
    state.replaying = true;
    setState('正在回放笔顺');
    let promise = Promise.resolve();
    state.strokes.forEach((stroke, index) => {
      promise = promise.then(() => new Promise((resolve) => {
        const partial = [];
        let i = 0;
        const tick = () => {
          partial.push(stroke.points[i]);
          drawGuide();
          drawRegions();
          for (let done = 0; done < index; done += 1) drawPath(state.strokes[done].points, '#111113', 10, state.showMarkers, done);
          drawPath(partial, '#be123c', 10, state.showMarkers, index);
          i += 1;
          if (i < stroke.points.length) setTimeout(tick, 8);
          else setTimeout(resolve, 110);
        };
        tick();
      }));
    });
    promise.then(() => {
      state.replaying = false;
      setState('回放结束');
      draw();
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (state.mode === 'stroke') beginStroke(event);
    else beginRegion(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (state.mode === 'stroke') moveStroke(event);
    else moveRegion(event);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (state.mode === 'stroke') endStroke(event);
    else endRegion(event);
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (state.mode === 'stroke') endStroke(event);
    else endRegion(event);
  });

  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      state.currentStroke = null;
      state.currentRegion = null;
      updateControls();
      setState(state.mode === 'stroke' ? '笔顺模式：按真实顺序描写' : '区域模式：选择笔画后圈定墨迹区域');
      draw();
    });
  });
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => {
      state.tool = button.dataset.tool;
      updateControls();
      setState(`当前区域工具：${button.textContent}`);
    });
  });
  strokeSelect.addEventListener('change', () => {
    state.selectedStrokeId = Number(strokeSelect.value);
    setState(`当前标注第 ${state.selectedStrokeId} 笔`);
    draw();
  });
  document.querySelectorAll('[data-param]').forEach((input) => {
    input.addEventListener('input', () => {
      state.params[input.dataset.param] = Number(input.value);
      updateControls();
    });
    input.addEventListener('change', renderPreviews);
  });
  document.querySelectorAll('[data-color]').forEach((input) => {
    input.addEventListener('input', () => {
      state.colors[input.dataset.color] = input.value;
    });
    input.addEventListener('change', renderPreviews);
  });

  document.querySelector('[data-action="toggle-markers"]').addEventListener('click', () => {
    state.showMarkers = !state.showMarkers;
    updateControls();
    draw();
  });
  document.querySelector('[data-action="replay-strokes"]').addEventListener('click', replayStrokePreview);
  document.querySelector('[data-action="undo-stroke"]').addEventListener('click', () => {
    const removed = state.strokes.pop();
    if (removed) state.regions = state.regions.filter((region) => region.strokeId !== removed.id);
    state.selectedStrokeId = Math.max(1, state.strokes.length);
    updateControls();
    draw();
    requestPreviewRender('已撤销笔顺，正在刷新动态预览');
  });
  document.querySelector('[data-action="undo-region"]').addEventListener('click', () => {
    for (let i = state.regions.length - 1; i >= 0; i -= 1) {
      if (state.regions[i].strokeId === state.selectedStrokeId) {
        state.regions.splice(i, 1);
        break;
      }
    }
    updateControls();
    draw();
    requestPreviewRender('已撤销区域，正在刷新动态预览');
  });
  document.querySelector('[data-action="clear-regions"]').addEventListener('click', () => {
    state.regions = [];
    updateControls();
    draw();
    requestPreviewRender('已清空区域，正在刷新动态预览');
  });
  document.querySelector('[data-action="clear-all"]').addEventListener('click', () => {
    state.strokes = [];
    state.regions = [];
    state.selectedStrokeId = 1;
    output.value = '';
    updateControls();
    draw();
    requestPreviewRender('已清空全部内容');
  });
  document.querySelector('[data-action="render-preview"]').addEventListener('click', renderPreviews);
  document.querySelector('[data-action="export-json"]').addEventListener('click', exportJson);
  document.querySelector('[data-action="download-html"]').addEventListener('click', exportHtml);
  document.querySelectorAll('[data-preview]').forEach((button) => {
    button.addEventListener('click', () => {
      const player = state.players.find((item) => item.variant === button.dataset.preview);
      if (player) player.play();
    });
  });

  uploadInput.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    state.sourceName = file.name;
    state.sourceDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    state.inkDataUrl = await makeTransparentInk(file);
    state.gradientDataUrl = await makeGradientInk(state.inkDataUrl);
    state.strokes = [];
    state.regions = [];
    state.selectedStrokeId = 1;
    guide.src = state.sourceDataUrl;
    resizeCanvas();
    updateControls();
    renderPreviews();
    setState('已上传签名，请开始描写笔顺');
  });

  importInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importProject(JSON.parse(String(reader.result)));
        setState('工程已导入');
      } catch {
        setState('导入失败：JSON 格式不正确');
      }
    };
    reader.readAsText(file);
  });

  async function bootstrapDemo() {
    const response = await fetch('./stroke-order.json');
    if (response.ok) {
      const project = await response.json();
      state.strokes = (project.strokes || []).map((stroke, index) => ({
        id: index + 1,
        pointerType: stroke.pointerType || 'imported',
        duration: Number(stroke.duration || 0),
        points: (stroke.points || []).map((point) => ({
          x: Number(point.x),
          y: Number(point.y),
          t: Number(point.t || 0),
          pressure: Number(point.pressure || 0.5),
        })),
      })).filter((stroke) => stroke.points.length >= 2);
      state.regions = (project.regions || []).map((region, index) => ({ ...region, id: index + 1 }));
    }
    updateControls();
    await renderPreviews();
    draw();
  }

  resizeCanvas();
  updateControls();
  bootstrapDemo();
})();
