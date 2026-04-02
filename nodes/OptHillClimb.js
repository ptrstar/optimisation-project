import { BaseNode }    from './BaseNode.js';
import { PortTypes }   from '../types/PortTypes.js';
import { VectorImage } from '../formats/VectorImage.js';

export class OptHillClimb extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { vector: PortTypes.VECTORIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { vector: null };

    this.rounds      = 300;
    this.penWidthPx  = 2;
    this.onProgress  = null; // (fraction: 0–1, score: number) => void
    this.onPreview   = null; // (gsPixels: Uint8Array, w, h) => void
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const vector       = new VectorImage(src.width, src.height);
    let   currentScore = this._score(vector, src);

    for (let i = 0; i < this.rounds; i++) {
      const line      = this._randomLine(src.width, src.height);
      const candidate = vector.clone();
      candidate.addLine(line.points, line.style);

      if (this._score(candidate, src) < currentScore) {
        vector.addLine(line.points, line.style);
        currentScore = this._score(vector, src);
      }

      if (i % 20 === 0) {
        this.onProgress?.(i / this.rounds, currentScore);
        if (i % 100 === 0) this.onPreview?.(this._rasterizeGS(vector), src.width, src.height);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, currentScore);
    this.onPreview?.(this._rasterizeGS(vector), src.width, src.height);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  getParams() { return { rounds: this.rounds, penWidthPx: this.penWidthPx }; }
  setParams(p) {
    if (p.rounds      != null) this.rounds      = p.rounds;
    if (p.penWidthPx  != null) this.penWidthPx  = p.penWidthPx;
    if (p.iterations  != null && p.rounds == null) this.rounds = p.iterations; // legacy
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  _rasterizeGS(vector) {
    const canvas = new OffscreenCanvas(vector.width, vector.height);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000';
    for (const { points, style } of vector.lines) {
      if (!points || points.length < 2) continue;
      ctx.lineWidth   = style.width   ?? 1;
      ctx.globalAlpha = style.opacity ?? 1;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let k = 1; k < points.length; k++) ctx.lineTo(points[k].x, points[k].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const rgba   = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(vector.width * vector.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4];
    return pixels;
  }

  _score(vector, target) {
    const rendered = this._rasterizeGS(vector);
    const n        = rendered.length;
    let   total    = 0;
    for (let i = 0; i < n; i++) total += Math.abs(rendered[i] - target.data[i * 4]);
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
