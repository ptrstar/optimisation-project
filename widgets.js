import { PORT_COLORS } from './types/PortTypes.js';

export class NodeWidget {
  constructor(node, x, y) {
    this.node      = node;
    this.x         = x;
    this.y         = y;
    this._portDots = {};
    this.el        = null;
    this._runningIndicator = null;
  }

  mount(container) {
    const card = document.createElement('div');
    card.style.cssText = `position:absolute; left:${this.x}px; top:${this.y}px; min-width:200px; z-index:10; overflow:visible;`;
    card.className = 'bg-white rounded-xl shadow-md border border-gray-200 select-none';

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'px-3 py-2 bg-gray-100 rounded-t-xl border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-move flex items-center gap-2';

    // Running indicator dot (hidden by default)
    const runningDot = document.createElement('span');
    runningDot.className = 'w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 hidden';
    runningDot.style.animation = 'none';
    this._runningIndicator = runningDot;
    header.appendChild(runningDot);

    const headerLabel = document.createElement('span');
    headerLabel.className = 'flex-1 truncate';
    headerLabel.textContent = this.node.constructor.name.replace(/([A-Z])/g, ' $1').trim();
    header.appendChild(headerLabel);

    // Per-node run button
    const runBtn = document.createElement('button');
    runBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    runBtn.className = 'text-gray-400 hover:text-blue-500 transition-colors cursor-pointer flex-shrink-0';
    runBtn.title = 'Run from this node';
    runBtn.addEventListener('mousedown', e => e.stopPropagation());
    runBtn.addEventListener('click', e => {
      e.stopPropagation();
      card.dispatchEvent(new CustomEvent('node-run-single', { bubbles: true, detail: { node: this.node } }));
    });
    header.appendChild(runBtn);

    // Trash button
    const trashBtn = document.createElement('button');
    trashBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    trashBtn.className = 'text-gray-400 hover:text-red-500 transition-colors cursor-pointer flex-shrink-0';
    trashBtn.title = 'Remove node';
    trashBtn.addEventListener('mousedown', e => e.stopPropagation());
    trashBtn.addEventListener('click', e => {
      e.stopPropagation();
      card.dispatchEvent(new CustomEvent('node-remove', { bubbles: true, detail: { node: this.node } }));
    });
    header.appendChild(trashBtn);

    card.appendChild(header);

    // ── Body ────────────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'py-2';

    const portsRow = document.createElement('div');
    portsRow.style.cssText = 'display:flex; flex-direction:row; justify-content:space-between; overflow:visible;';

    const inputsCol = document.createElement('div');
    inputsCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; overflow:visible;';

    for (const [portName, portType] of Object.entries(this.node.inputSchema || {})) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:4px; overflow:visible;';

      const dot = this._makeDot('input', portName, portType);
      dot.style.marginLeft = '-6px';

      const label = document.createElement('span');
      label.className = 'text-xs text-gray-400';
      label.textContent = portName;

      row.appendChild(dot);
      row.appendChild(label);
      inputsCol.appendChild(row);
    }

    const outputsCol = document.createElement('div');
    outputsCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:flex-end; overflow:visible;';

    for (const [portName, portType] of Object.entries(this.node.outputSchema || {})) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:4px; flex-direction:row-reverse; overflow:visible;';

      const dot = this._makeDot('output', portName, portType);
      dot.style.marginRight = '-6px';

      const label = document.createElement('span');
      label.className = 'text-xs text-gray-400 text-right';
      label.textContent = portName;

      row.appendChild(dot);
      row.appendChild(label);
      outputsCol.appendChild(row);
    }

    portsRow.appendChild(inputsCol);
    portsRow.appendChild(outputsCol);
    body.appendChild(portsRow);

    const content = this._buildContent();
    if (content) body.appendChild(content);

    card.appendChild(body);
    this.el = card;
    container.appendChild(card);

    this._makeDraggable(header);
  }

  _makeDot(direction, portName, portType) {
    const dot = document.createElement('div');
    dot.className = 'port-dot w-3 h-3 rounded-full border-2 cursor-crosshair hover:scale-125 transition-transform';
    dot.style.backgroundColor = PORT_COLORS[portType] ?? '#94a3b8';
    dot.style.borderColor     = PORT_COLORS[portType] ?? '#94a3b8';
    dot.style.flexShrink      = '0';
    dot.dataset.direction = direction;
    dot.dataset.port      = portName;
    dot.dataset.type      = portType;
    dot.dataset.nodeId    = this.node.id;

    const key = `${direction}:${portName}`;
    this._portDots[key] = dot;

    dot.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      dot.dispatchEvent(new CustomEvent('port-disconnect', {
        bubbles: true,
        detail: { node: this.node, port: portName, direction },
      }));
    });

    return dot;
  }

  _buildContent() {
    switch (this.node.constructor.name) {
      case 'CanvasSetup':     return this._buildCanvasSetupContent();
      case 'ImageUploader':   return this._buildImageUploaderContent();
      case 'Contrast':        return this._buildContrastContent();
      case 'ShowPixelBuffer': return this._buildShowPixelBufferContent();
      case 'OptHillClimb':    return this._buildOptHillClimbContent();
      case 'ImageDiff':       return this._buildImageDiffContent();
      default:                return null;
    }
  }

  _buildCanvasSetupContent() {
    const node = this.node;
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-2 text-xs';

    const row = (label, input) => {
      const r = document.createElement('div');
      r.className = 'flex items-center justify-between gap-2';
      const l = document.createElement('span');
      l.className = 'text-gray-400 flex-1 truncate';
      l.textContent = label;
      r.appendChild(l);
      r.appendChild(input);
      return r;
    };

    const numInput = (value, min, max, step, onChange) => {
      const el = document.createElement('input');
      el.type      = 'number';
      el.min       = String(min);
      el.max       = String(max);
      el.step      = String(step);
      el.value     = String(value);
      el.className = 'w-20 text-right font-mono border border-gray-200 rounded px-1 py-0.5 text-gray-600';
      el.addEventListener('change', () => {
        onChange(parseFloat(el.value));
        el.dispatchEvent(new CustomEvent('node-param-changed', { bubbles: true, detail: { node } }));
      });
      return el;
    };

    this._csInfo = document.createElement('div');
    this._csInfo.className = 'text-gray-300 font-mono text-center text-xs';
    this._updateCanvasInfo();

    const wInput   = numInput(node.widthCm,    1, 200, 0.5, v => { node.widthCm    = v; this._updateCanvasInfo(); });
    const hInput   = numInput(node.heightCm,   1, 200, 0.5, v => { node.heightCm   = v; this._updateCanvasInfo(); });
    const dpiInput = numInput(node.dpi,        36, 600, 1,  v => { node.dpi        = v; this._updateCanvasInfo(); });
    const penInput = numInput(node.penWidthMm, 0.1, 5, 0.1, v => { node.penWidthMm = v; this._updateCanvasInfo(); });

    wrap.appendChild(row('Width (cm)',      wInput));
    wrap.appendChild(row('Height (cm)',     hInput));
    wrap.appendChild(row('DPI',             dpiInput));
    wrap.appendChild(row('Pen width (mm)',  penInput));
    wrap.appendChild(this._csInfo);
    return wrap;
  }

  _updateCanvasInfo() {
    if (!this._csInfo) return;
    const n    = this.node;
    const ppcm = n.dpi / 2.54;
    const pw   = (n.penWidthMm * ppcm / 10).toFixed(2);
    this._csInfo.textContent =
      `${Math.round(n.widthCm * ppcm)} × ${Math.round(n.heightCm * ppcm)} px · pen ${pw}px`;
  }

  _buildImageUploaderContent() {
    const node = this.node;
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-2';

    const fileInput = document.createElement('input');
    fileInput.type      = 'file';
    fileInput.accept    = 'image/*';
    fileInput.className = 'text-xs text-gray-500 w-full';

    // Fit mode selector
    const fitSelect = document.createElement('select');
    fitSelect.className = 'text-xs border border-gray-200 rounded px-1 py-0.5 text-gray-600 w-full';
    for (const [value, label] of [
      ['fit',     'Fit (letterbox)'],
      ['fill',    'Fill (crop overflow)'],
      ['stretch', 'Stretch'],
      ['crop',    'Crop (center, no scale)'],
    ]) {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      if (value === node.fitMode) opt.selected = true;
      fitSelect.appendChild(opt);
    }
    fitSelect.addEventListener('change', () => {
      node.fitMode = fitSelect.value;
      node.run();
      this._refreshUploaderPreview();
      fitSelect.dispatchEvent(new CustomEvent('node-param-changed', { bubbles: true, detail: { node } }));
    });

    const preview = document.createElement('canvas');
    preview.style.cssText = 'display:none; border-radius:4px; border:1px solid #e5e7eb;';
    this._uploaderPreview = preview;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await node.loadFile(file);
        this._refreshUploaderPreview();
        fileInput.dispatchEvent(new CustomEvent('node-updated', { bubbles: true, detail: { node } }));
      } catch (err) {
        console.error('Failed to load file:', err);
      }
    });

    wrap.appendChild(fileInput);
    wrap.appendChild(fitSelect);
    wrap.appendChild(preview);
    return wrap;
  }

  _refreshUploaderPreview() {
    const img = this.node.outputs.image;
    if (img && this._uploaderPreview) this._renderPreview(this._uploaderPreview, img);
  }

  _buildContrastContent() {
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-1';

    const valueLabel = document.createElement('span');
    valueLabel.className = 'text-xs text-gray-500 font-mono';
    valueLabel.textContent = 'Amount: 1.00';

    const slider = document.createElement('input');
    slider.type      = 'range';
    slider.min       = '0';
    slider.max       = '3';
    slider.step      = '0.01';
    slider.value     = '1';
    slider.className = 'w-full accent-blue-500';

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      this.node.inputs.amount = val;
      valueLabel.textContent  = `Amount: ${val.toFixed(2)}`;
      slider.dispatchEvent(new CustomEvent('node-param-changed', { bubbles: true, detail: { node: this.node } }));
    });

    wrap.appendChild(valueLabel);
    wrap.appendChild(slider);
    return wrap;
  }

  _buildShowPixelBufferContent() {
    const scroll = document.createElement('div');
    scroll.style.cssText = 'overflow:auto; max-width:300px; max-height:300px; margin:0 12px 8px; border-radius:4px; border:1px solid #e5e7eb;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block; image-rendering:pixelated;';
    this.node.previewCanvas = canvas;

    scroll.appendChild(canvas);
    return scroll;
  }

  _buildOptHillClimbContent() {
    const node = this.node;
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-2';

    const numRow = (label, value, min, max, step, onChange) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      const lbl = document.createElement('span');
      lbl.className = 'text-xs text-gray-400 flex-1';
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max);
      inp.step = String(step); inp.value = String(value);
      inp.className = 'w-20 text-xs text-right font-mono border border-gray-200 rounded px-1 py-0.5 text-gray-600';
      inp.addEventListener('change', () => onChange(parseFloat(inp.value)));
      row.appendChild(lbl); row.appendChild(inp);
      return row;
    };

    wrap.appendChild(numRow('Rounds', node.rounds, 10, 10000, 10,
      v => { node.rounds = Math.max(10, v); }));
    wrap.appendChild(numRow('Pen width (px)', node.penWidthPx, 0.5, 20, 0.5,
      v => { node.penWidthPx = Math.max(0.5, v); }));
    wrap.appendChild(numRow('Linecount', node.lineCount, 10, 1000, 10,
      v => { node.lineCount = Math.max(10, v); }))
    wrap.appendChild(numRow('MaxAmplitude', node.maxAmplitude, 0.1, 100, 0.1,
      v => { node.maxAmplitude = Math.max(0.1, v); }))

    // Progress bar (hidden until running)
    const progressWrap = document.createElement('div');
    progressWrap.className = 'hidden flex flex-col gap-1';
    this._progressWrap = progressWrap;

    const progressBg = document.createElement('div');
    progressBg.className = 'w-full h-1.5 bg-gray-100 rounded-full overflow-hidden';
    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-blue-500 rounded-full transition-all duration-100';
    progressBar.style.width = '0%';
    this._progressBar = progressBar;
    progressBg.appendChild(progressBar);
    progressWrap.appendChild(progressBg);

    const scoreLabel = document.createElement('span');
    scoreLabel.className = 'text-xs font-mono text-gray-400';
    scoreLabel.textContent = 'Score: —';
    this._ptv_scoreLabel = scoreLabel;
    progressWrap.appendChild(scoreLabel);
    wrap.appendChild(progressWrap);

    // Live preview canvas
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'overflow:auto; max-width:280px; max-height:200px; border-radius:4px; border:1px solid #e5e7eb; display:none;';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.style.cssText = 'display:block; image-rendering:pixelated;';
    this._ptvPreviewCanvas = previewCanvas;
    this._ptvPreviewWrap   = previewWrap;
    previewWrap.appendChild(previewCanvas);
    wrap.appendChild(previewWrap);

    node.onProgress = (pct, score) => this.updateProgress(pct, score);
    node.onPreview  = (pixels, w, h) => this.updatePtvPreview(pixels, w, h);

    return wrap;
  }

  // Called by OptHillClimb every 100 rounds with a greyscale Uint8Array.
  updatePtvPreview(pixels, w, h) {
    const canvas = this._ptvPreviewCanvas;
    const wrap   = this._ptvPreviewWrap;
    if (!canvas || !wrap) return;

    // Show the container on first call
    wrap.style.display = 'block';

    canvas.width  = w;
    canvas.height = h;

    // Build RGBA ImageData from single-channel greyscale
    const ctx  = canvas.getContext('2d');
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < pixels.length; i++) {
      const v    = pixels[i];
      const base = i * 4;
      rgba[base]     = v;
      rgba[base + 1] = v;
      rgba[base + 2] = v;
      rgba[base + 3] = 255;
    }
    ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  }

  _buildImageDiffContent() {
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-1';

    const scoreLabel = document.createElement('span');
    scoreLabel.className = 'text-xs font-mono text-gray-600';
    scoreLabel.textContent = 'Score: —';
    this._diffScoreLabel = scoreLabel;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-width:100%; max-height:80px; border-radius:4px; display:block;';
    this._diffCanvas = canvas;

    wrap.appendChild(scoreLabel);
    wrap.appendChild(canvas);
    return wrap;
  }

  // Show/hide the running indicator dot.
  setRunning(running) {
    if (!this._runningIndicator) return;
    if (running) {
      this._runningIndicator.classList.remove('hidden');
      this._runningIndicator.style.animation = 'pulse-dot 0.8s ease-in-out infinite';
    } else {
      this._runningIndicator.classList.add('hidden');
      this._runningIndicator.style.animation = 'none';
      this._progressWrap?.classList.add('hidden');
      // Hide live preview once done (final result is in the downstream ShowPixelBuffer)
      if (this._ptvPreviewWrap) this._ptvPreviewWrap.style.display = 'none';
    }

    // Show/hide progress bar for OptHillClimb
    if (this.node.constructor.name === 'OptHillClimb') {
      if (running) {
        this._progressWrap?.classList.remove('hidden');
        if (this._progressBar) this._progressBar.style.width = '0%';
      }
    }
  }

  // Called by PixelToVector's onProgress callback.
  updateProgress(pct, score) {
    if (this._progressBar) this._progressBar.style.width = `${(pct * 100).toFixed(1)}%`;
    if (this._ptv_scoreLabel) this._ptv_scoreLabel.textContent = `Score: ${score.toFixed(2)}`;
  }

  // Renders imageData into a canvas, fitting within maxW×maxH while preserving aspect ratio.
  _renderPreview(canvas, imageData, maxW = 180, maxH = 160) {
    const aspect = imageData.width / imageData.height;
    let dispW = maxW, dispH = maxW / aspect;
    if (dispH > maxH) { dispH = maxH; dispW = maxH * aspect; }
    dispW = Math.round(dispW); dispH = Math.round(dispH);

    canvas.width  = imageData.width;
    canvas.height = imageData.height;
    canvas.style.width   = `${dispW}px`;
    canvas.style.height  = `${dispH}px`;
    canvas.style.display = 'block';
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }

  update() {
    const cls = this.node.constructor.name;

    if (cls === 'ImageUploader') {
      this._refreshUploaderPreview();
    }

    if (cls === 'ImageDiff') {
      const diff  = this.node.outputs.diff;
      const score = this.node.outputs.score;
      if (this._diffScoreLabel && score != null) {
        this._diffScoreLabel.textContent = `Score: ${score.toFixed(2)}`;
      }
      if (this._diffCanvas && diff) {
        this._renderPreview(this._diffCanvas, diff, 180, 80);
      }
    }
  }

  getPortPosition(direction, portName) {
    const key = `${direction}:${portName}`;
    const dot = this._portDots[key];
    if (!dot) return null;

    const dotRect    = dot.getBoundingClientRect();
    const parentRect = this.el.parentElement.getBoundingClientRect();

    return {
      x: dotRect.left + dotRect.width  / 2 - parentRect.left,
      y: dotRect.top  + dotRect.height / 2 - parentRect.top,
    };
  }

  _makeDraggable(headerEl) {
    let startMouseX = 0, startMouseY = 0, startX = 0, startY = 0;

    const onMouseMove = (e) => {
      this.x = startX + (e.clientX - startMouseX);
      this.y = startY + (e.clientY - startMouseY);
      this.el.style.left = `${this.x}px`;
      this.el.style.top  = `${this.y}px`;
      this.el.dispatchEvent(new CustomEvent('widget-moved', { bubbles: true }));
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    headerEl.addEventListener('mousedown', (e) => {
      // Don't drag if clicking a button
      if (e.target.closest('button')) return;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      startX      = this.x;
      startY      = this.y;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
      e.preventDefault();
    });
  }
}
