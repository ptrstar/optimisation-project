import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';
import { VectorImage } from '../formats/VectorImage.js';
import { Rasterize } from './Rasterize.js';

export class PixelToVector extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { vector: PortTypes.VECTORIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { vector: null };

    this.iterations  = 300;
    this.penWidthPx  = 2;   // line width in pixels; set to match CanvasSetup's derived penWidthPx
    this.onProgress  = null; // (fraction: 0–1, score: number) => void — set by widget
    this.onPreview   = null; // (gsPixels: Uint8Array, w, h) => void — set by widget
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const vector       = new VectorImage(src.width, src.height);
    let   currentScore = this._score(vector, src);
    const total        = this.iterations;

    for (let i = 0; i < total; i++) {
      const { points, style } = this._randomLine(src.width, src.height);
      const candidate         = vector.clone();
      candidate.addLine(points, style);

      if (this._score(candidate, src) < currentScore) {
        vector.addLine(points, style);
        currentScore = this._score(vector, src);
      }

      if (i % 20 === 0) {
        this.onProgress?.(i / total, currentScore);
        if (i % 100 === 0 && this.onPreview) {
          this.onPreview(this._rasterizeGS(vector), src.width, src.height);
        }
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, currentScore);
    if (this.onPreview) this.onPreview(this._rasterizeGS(vector), src.width, src.height);
    // Forward physical size tags if the input image carried them.
    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  getParams() { return { iterations: this.iterations, penWidthPx: this.penWidthPx }; }
  setParams(p) {
    if (p.iterations != null) this.iterations = p.iterations;
    if (p.penWidthPx != null) this.penWidthPx = p.penWidthPx;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  _rasterizeGS(vector) {
    return Rasterize.renderToGS(vector);
  }

  _score(vector, target) {
    const rendered  = Rasterize.renderToGS(vector);
    const targetLum = target.data;
    const n         = rendered.length;
    let total = 0;
    for (let i = 0; i < n; i++) total += Math.abs(rendered[i] - targetLum[i * 4]);
    return n > 0 ? total / n : 0;
  }

  _randomLine(width, height) {
    const x1     = Math.random() * width;
    const y1     = Math.random() * height;
    const maxLen = Math.sqrt(width * width + height * height) * 0.4;
    const len    = maxLen * (0.05 + Math.random() * 0.95);
    const angle  = Math.random() * Math.PI * 2;
    return {
      points: [
        { x: x1, y: y1 },
        { x: Math.max(0, Math.min(width,  x1 + Math.cos(angle) * len)),
          y: Math.max(0, Math.min(height, y1 + Math.sin(angle) * len)) },
      ],
      style: { width: this.penWidthPx, opacity: 0.6 + Math.random() * 0.4 },
    };
  }
}
