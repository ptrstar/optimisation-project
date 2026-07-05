import { BaseNode }    from './BaseNode.js';
import { PortTypes }   from '../types/PortTypes.js';
import { Rasterize }   from './Rasterize.js';

/**
 * OptBase — abstract base class for all vector-optimisation nodes.
 *
 * Subclasses get for free:
 *   - Standard gs_rasterimage → vectorimage I/O schema
 *   - onProgress / onPreview hooks (wired by buildContent)
 *   - _rasterizeGS(vector) and _score(vector, target) backed by Rasterize.renderToGS
 *   - _blurBuffer(src, w, h, radius) — O(n) box blur on flat Uint8Array
 *   - _downscaleTarget(src, sw, sh) — shrink a gs_rasterimage to a flat Uint8Array
 *   - _randomLine(W, H, diag) — random stroke using shared line-shape properties
 *   - Auto getParams / setParams derived from this.paramDefs
 *   - buildContent(widget) — standard UI: param inputs + progress bar + live preview
 *
 * Shared line-shape properties (set defaults here, override in subclass constructor):
 *   penWidthPx    — stroke width in full-resolution pixels
 *   minLenFrac    — minimum stroke length as a fraction of the image diagonal
 *   maxLenFrac    — maximum stroke length as a fraction of the image diagonal
 *   lineOpacity   — centre opacity (0–1); jittered by ±opacityJitter
 *   opacityJitter — half-range of random opacity variation (0 = fixed opacity)
 *
 * To create a new opt node:
 *   1. Extend OptBase
 *   2. Declare this.paramDefs in constructor (array of {label, key, min, max, step})
 *   3. Set default values for each param key on `this`
 *   4. Implement async run() — use this._score() / this._rasterizeGS() / this.onProgress / this.onPreview
 *   5. Register in pipelines.js NODE_CLASSES and main.js NODE_REGISTRY
 *   That's it — no widgets.js changes needed.
 */
export class OptBase extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { vector: PortTypes.VECTORIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { vector: null };

    // Callbacks wired by buildContent — call these from run() to report progress.
    this.onProgress = null; // (fraction: 0–1, score: number) => void
    this.onPreview  = null; // (gsPixels: Uint8Array, w: number, h: number) => void

    // Declare UI-exposed params as an array of descriptors.
    // buildContent() and getParams()/setParams() are derived from this automatically.
    // Example: { label: 'Rounds', key: 'rounds', min: 10, max: 10000, step: 10 }
    this.paramDefs = [];

    // Shared line-shape defaults — subclasses override these in their constructor.
    this.penWidthPx    = 2;
    this.minLenFrac    = 0.02;   // 2% of diagonal
    this.maxLenFrac    = 0.4;    // 40% of diagonal
    this.lineOpacity   = 1.0;
    this.opacityJitter = 0.0;    // half-range; 0 = fixed opacity

    this.trace = [];   // convergence samples for plotting
  }

  // ── Shared utilities ────────────────────────────────────────────────────────

  // Render vector to single-channel Uint8Array (delegates to Rasterize static).
  _rasterizeGS(vector) {
    return Rasterize.renderToGS(vector);
  }

  /**
   * Produce a random line using the shared line-shape properties.
   * Returns { points: [{x,y},{x,y}], style: {width, opacity} }.
   * Coordinates are in full-resolution pixels (W × H space).
   *
   * @param {number} W    – canvas width in pixels
   * @param {number} H    – canvas height in pixels
   * @param {number} diag – Math.sqrt(W*W + H*H), pre-computed by caller
   */
  _randomLine(W, H, diag) {
    const x1    = Math.random() * W;
    const y1    = Math.random() * H;
    const len   = diag * (this.minLenFrac + Math.random() * (this.maxLenFrac - this.minLenFrac));
    const angle = Math.random() * Math.PI * 2;
    const jitter  = this.opacityJitter * 2 * (Math.random() - 0.5);
    const opacity = Math.max(0.05, Math.min(1, this.lineOpacity + jitter));
    return {
      points: [
        { x: x1, y: y1 },
        { x: Math.max(0, Math.min(W, x1 + Math.cos(angle) * len)),
          y: Math.max(0, Math.min(H, y1 + Math.sin(angle) * len)) },
      ],
      style: { width: this.penWidthPx, opacity },
    };
  }

  /**
   * Downscale a gs_rasterimage to a flat Uint8Array at the given pixel dimensions.
   * Uses the browser's bilinear downscale via OffscreenCanvas.
   * Result contains one byte per pixel (R channel = luminance, 0=black 255=white).
   */
  _downscaleTarget(src, sw, sh) {
    const tmp = new OffscreenCanvas(src.width, src.height);
    tmp.getContext('2d').putImageData(src, 0, 0);
    const small = new OffscreenCanvas(sw, sh);
    small.getContext('2d').drawImage(tmp, 0, 0, sw, sh);
    const data = small.getContext('2d').getImageData(0, 0, sw, sh).data;
    const gs   = new Uint8Array(sw * sh);
    for (let i = 0; i < gs.length; i++) gs[i] = data[i * 4];
    return gs;
  }

  /**
   * Separable box blur on a flat Uint8Array (same algorithm as Blur.js).
   * Works directly on greyscale pixel buffers — no ImageData wrapper needed.
   * Portable: any opt subclass can call this to pre-blur a scoring target.
   *
   * @param {Uint8Array} src   – source buffer (length = w*h, 0=black 255=white)
   * @param {number}     w     – buffer width in pixels
   * @param {number}     h     – buffer height in pixels
   * @param {number}     radius – box half-width in pixels (0 = no-op, returns src)
   * @returns {Uint8Array} new blurred buffer (src is never mutated)
   */
  _blurBuffer(src, w, h, radius) {
    const r = Math.max(0, Math.round(radius));
    if (r === 0) return src;

    const N   = w * h;
    const tmp = new Float32Array(N);
    const dst = new Uint8Array(N);

    // Horizontal pass (sliding window — O(w*h) regardless of radius)
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let sum = 0;
      for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[base + x];
      for (let x = 0; x < w; x++) {
        const add = x + r + 1 < w ? src[base + x + r + 1] : 0;
        const rem = x - r - 1 >= 0 ? src[base + x - r - 1] : 0;
        sum += add - rem;
        tmp[base + x] = sum / Math.min(2 * r + 1, w);
      }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        const add = y + r + 1 < h ? tmp[(y + r + 1) * w + x] : 0;
        const rem = y - r - 1 >= 0 ? tmp[(y - r - 1) * w + x] : 0;
        sum += add - rem;
        dst[y * w + x] = Math.round(sum / Math.min(2 * r + 1, h));
      }
    }

    return dst;
  }

  // Mean-absolute-error between a VectorImage and a gs_rasterimage target.
  _score(vector, target) {
    const rendered = Rasterize.renderToGS(vector);
    const n        = rendered.length;
    let   total    = 0;
    for (let i = 0; i < n; i++) total += Math.abs(rendered[i] - target.data[i * 4]);
    return n > 0 ? total / n : 0;
  }

  // ── Convergence tracking (for plots) ────────────────────────────────────────
// Usage in run(): _resetTrace() at the start, _recordTrace(evals, best, extra)
// at each sample, _dumpTraceCSV() at the end. `evals` = cumulative fitness
// evaluations so curves from per-round (SA) and per-generation (GA/ES)
// algorithms share a comparable x-axis.
_resetTrace() {
  this.trace = [];
}

_recordTrace(evals, best, extra = {}) {
  this.trace.push({ evals, best, ...extra });
}

_dumpTraceCSV(label = this.id) {
  if (!this.trace || this.trace.length === 0) return '';
  const cols = Object.keys(this.trace[0]);
  const csv  = [cols.join(','), ...this.trace.map(r => cols.map(c => r[c]).join(','))].join('\n');
  console.log(`#TRACE ${label}\n${csv}`);
  return csv;
}

  // ── Serialisation — auto-derived from paramDefs ─────────────────────────────

  getParams() {
    const p = {};
    for (const { key } of this.paramDefs) p[key] = this[key];
    return p;
  }

  setParams(p) {
    for (const { key } of this.paramDefs) {
      if (p[key] != null) this[key] = p[key];
    }
  }

  // ── Widget content — called by NodeWidget._buildContent() ───────────────────

  /**
   * Builds the node card body and wires onProgress/onPreview callbacks.
   * Stores refs on the widget instance so setRunning() can show/hide them.
   * @param {NodeWidget} widget
   * @returns {HTMLElement}
   */
  buildContent(widget) {
    const node = this;
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-2';

    // Auto-generated param inputs from paramDefs
    for (const def of this.paramDefs) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';

      const lbl = document.createElement('span');
      lbl.className = 'text-xs text-gray-400 flex-1';
      lbl.textContent = def.label;

      const inp = document.createElement('input');
      inp.type      = 'number';
      inp.min       = String(def.min);
      inp.max       = String(def.max);
      inp.step      = String(def.step);
      inp.value     = String(node[def.key]);
      inp.className = 'w-20 text-xs text-right font-mono border border-gray-200 rounded px-1 py-0.5 text-gray-600';
      inp.addEventListener('change', () => { node[def.key] = parseFloat(inp.value); });

      row.appendChild(lbl);
      row.appendChild(inp);
      wrap.appendChild(row);
    }

    // Progress bar (hidden until running — shown/hidden by setRunning)
    const progressWrap = document.createElement('div');
    progressWrap.className = 'hidden flex flex-col gap-1';
    widget._progressWrap = progressWrap;

    const progressBg = document.createElement('div');
    progressBg.className = 'w-full h-1.5 bg-gray-100 rounded-full overflow-hidden';
    const progressBar = document.createElement('div');
    progressBar.className = 'h-full bg-blue-500 rounded-full transition-all duration-100';
    progressBar.style.width = '0%';
    widget._progressBar = progressBar;
    progressBg.appendChild(progressBar);
    progressWrap.appendChild(progressBg);

    const scoreLabel = document.createElement('span');
    scoreLabel.className = 'text-xs font-mono text-gray-400';
    scoreLabel.textContent = 'Score: —';
    widget._optScoreLabel = scoreLabel;
    progressWrap.appendChild(scoreLabel);
    wrap.appendChild(progressWrap);

    // Live preview canvas (hidden until first onPreview call)
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'overflow:auto; max-width:280px; max-height:200px; border-radius:4px; border:1px solid #e5e7eb; display:none;';
    const previewCanvas = document.createElement('canvas');
    previewCanvas.style.cssText = 'display:block; image-rendering:pixelated;';
    widget._optPreviewCanvas = previewCanvas;
    widget._optPreviewWrap   = previewWrap;
    previewWrap.appendChild(previewCanvas);
    wrap.appendChild(previewWrap);

    // Wire progress/preview callbacks into closures on the node
    node.onProgress = (pct, score) => {
      if (widget._progressBar)   widget._progressBar.style.width = `${(pct * 100).toFixed(1)}%`;
      if (widget._optScoreLabel) widget._optScoreLabel.textContent = `Score: ${score.toFixed(2)}`;
    };

    node.onPreview = (pixels, w, h) => {
      const canvas = widget._optPreviewCanvas;
      const wrap   = widget._optPreviewWrap;
      if (!canvas || !wrap) return;
      wrap.style.display = 'block';
      canvas.width  = w;
      canvas.height = h;
      const ctx  = canvas.getContext('2d');
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < pixels.length; i++) {
        const v = pixels[i], b = i * 4;
        rgba[b] = rgba[b + 1] = rgba[b + 2] = v;
        rgba[b + 3] = 255;
      }
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    };

    return wrap;
  }
}
