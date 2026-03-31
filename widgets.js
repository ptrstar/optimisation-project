import { PORT_COLORS } from './types/PortTypes.js';

export class NodeWidget {
  constructor(node, x, y) {
    this.node      = node;
    this.x         = x;
    this.y         = y;
    this._portDots = {};
    this.el        = null;
  }

  mount(container) {
    const card = document.createElement('div');
    card.style.cssText = `position:absolute; left:${this.x}px; top:${this.y}px; min-width:200px; z-index:10; overflow:visible;`;
    card.className = 'bg-white rounded-xl shadow-md border border-gray-200 select-none';

    // Header
    const header = document.createElement('div');
    header.className = 'px-3 py-2 bg-gray-100 rounded-t-xl border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wide cursor-move flex items-center justify-between';

    const headerLabel = document.createElement('span');
    headerLabel.textContent = this.node.constructor.name.replace(/([A-Z])/g, ' $1').trim();
    header.appendChild(headerLabel);

    const trashBtn = document.createElement('button');
    trashBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    trashBtn.className = 'text-gray-400 hover:text-red-500 transition-colors cursor-pointer ml-2 flex-shrink-0';
    trashBtn.title = 'Remove node';
    trashBtn.addEventListener('mousedown', e => e.stopPropagation()); // don't start drag
    trashBtn.addEventListener('click', e => {
      e.stopPropagation();
      card.dispatchEvent(new CustomEvent('node-remove', { bubbles: true, detail: { node: this.node } }));
    });
    header.appendChild(trashBtn);

    card.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'py-2';

    // Ports row
    const portsRow = document.createElement('div');
    portsRow.style.cssText = 'display:flex; flex-direction:row; justify-content:space-between; overflow:visible;';

    // Inputs column
    const inputsCol = document.createElement('div');
    inputsCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; overflow:visible;';

    const inputSchema  = this.node.inputSchema  || {};
    const outputSchema = this.node.outputSchema || {};

    for (const [portName, portType] of Object.entries(inputSchema)) {
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

    // Outputs column
    const outputsCol = document.createElement('div');
    outputsCol.style.cssText = 'display:flex; flex-direction:column; gap:4px; align-items:flex-end; overflow:visible;';

    for (const [portName, portType] of Object.entries(outputSchema)) {
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

    // Node-specific content
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

    // Right-click on any port disconnects all edges on that port
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
    const cls = this.node.constructor.name;

    if (cls === 'ImageUploader') {
      return this._buildImageUploaderContent();
    } else if (cls === 'Contrast') {
      return this._buildContrastContent();
    } else if (cls === 'ShowPixelBuffer') {
      return this._buildShowPixelBufferContent();
    } else if (cls === 'PixelToVector') {
      return this._buildPixelToVectorContent();
    } else if (cls === 'ImageDiff') {
      return this._buildImageDiffContent();
    }
    return null;
  }

  _buildImageUploaderContent() {
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-2';

    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = 'image/*';
    fileInput.className = 'text-xs text-gray-500 w-full';

    const preview = document.createElement('canvas');
    preview.style.cssText = 'display:none; border-radius:4px; border:1px solid #e5e7eb;';
    this._uploaderPreview = preview;

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const imageData = await this.node.loadFile(file);
        this._renderPreview(preview, imageData);
        fileInput.dispatchEvent(new CustomEvent('node-updated', { bubbles: true, detail: { node: this.node } }));
      } catch (err) {
        console.error('Failed to load file:', err);
      }
    });

    wrap.appendChild(fileInput);
    wrap.appendChild(preview);
    return wrap;
  }

  _buildContrastContent() {
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-1';

    const valueLabel = document.createElement('span');
    valueLabel.className = 'text-xs text-gray-500 font-mono';
    valueLabel.textContent = 'Amount: 1.00';

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '0';
    slider.max   = '3';
    slider.step  = '0.01';
    slider.value = '1';
    slider.className = 'w-full accent-blue-500';

    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      this.node.inputs.amount = val;
      valueLabel.textContent  = `Amount: ${val.toFixed(2)}`;
    });

    wrap.appendChild(valueLabel);
    wrap.appendChild(slider);
    return wrap;
  }

  _buildShowPixelBufferContent() {
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-width:100%; max-height:100px; border-radius:4px; display:block;';
    this.node.previewCanvas = canvas;

    wrap.appendChild(canvas);
    return wrap;
  }

  _buildPixelToVectorContent() {
    const div = document.createElement('div');
    div.className = 'text-xs text-gray-400 italic px-3 py-1';
    div.textContent = 'Optimisation stub';
    return div;
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

  // Renders imageData into a canvas element, fitting within maxW×maxH while preserving aspect ratio.
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
      const img = this.node.outputs.image;
      if (img && this._uploaderPreview) {
        this._renderPreview(this._uploaderPreview, img);
      }
    }

    if (cls === 'ImageDiff') {
      const diff  = this.node.outputs.diff;
      const score = this.node.outputs.score;

      if (this._diffScoreLabel && score != null) {
        this._diffScoreLabel.textContent = `Score: ${score.toFixed(2)}`;
      }
      if (this._diffCanvas && diff) {
        this._diffCanvas.width  = diff.width;
        this._diffCanvas.height = diff.height;
        this._diffCanvas.getContext('2d').putImageData(diff, 0, 0);
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
    let startMouseX = 0;
    let startMouseY = 0;
    let startX      = 0;
    let startY      = 0;

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
