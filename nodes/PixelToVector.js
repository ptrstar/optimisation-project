import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';
import { VectorImage } from '../formats/VectorImage.js';

export class PixelToVector extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { vector: PortTypes.VECTORIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { vector: null };

    this.iterations = 300;   // hill-climbing attempts
    this.onProgress = null;  // (fraction: 0–1, score: number) => void — set by widget
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const vector       = new VectorImage(src.width, src.height);
    let   currentScore = this._score(vector, src);

    const total = this.iterations;

    for (let i = 0; i < total; i++) {
      // Generate a random candidate line across the image
      const { points, style } = this._randomLine(src.width, src.height);
      const candidate = vector.clone();
      candidate.addLine(points, style);

      const candidateScore = this._score(candidate, src);

      if (candidateScore < currentScore) {
        vector.addLine(points, style);
        currentScore = candidateScore;
      }

      // Yield to the browser every 20 iterations so the UI stays responsive
      if (i % 20 === 0) {
        this.onProgress?.(i / total, currentScore);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, currentScore);
    this._setOutput('vector', vector);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  // Rasterize a VectorImage to a greyscale ImageData (white bg, black strokes).
  // Returns a Uint8Array of luminance values, one byte per pixel.
  _rasterizeGS(vector) {
    const canvas = new OffscreenCanvas(vector.width, vector.height);
    const ctx    = canvas.getContext('2d');

    ctx.fillStyle   = '#ffffff';
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

    // Extract single-channel greyscale (R === G === B for black/white canvas)
    const rgba   = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = new Uint8Array(vector.width * vector.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rgba[i * 4]; // R channel
    return pixels;
  }

  // Mean absolute error between rasterised vector and target greyscale image.
  // Both sides are single-channel luminance — clean greyscale comparison.
  _score(vector, target) {
    const rendered  = this._rasterizeGS(vector);
    const targetLum = target.data; // gs_rasterimage: R=G=B=lum, stride 4
    const n         = rendered.length;

    let total = 0;
    for (let i = 0; i < n; i++) {
      total += Math.abs(rendered[i] - targetLum[i * 4]);
    }

    return n > 0 ? total / n : 0;
  }

  // Generate a random line segment within the image bounds.
  _randomLine(width, height) {
    // Random start point
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;

    // Random angle and length (up to ~40% of the diagonal)
    const maxLen = Math.sqrt(width * width + height * height) * 0.4;
    const len    = maxLen * (0.05 + Math.random() * 0.95);
    const angle  = Math.random() * Math.PI * 2;

    const x2 = Math.max(0, Math.min(width,  x1 + Math.cos(angle) * len));
    const y2 = Math.max(0, Math.min(height, y1 + Math.sin(angle) * len));

    return {
      points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
      style:  {
        width:   0.5 + Math.random() * 2,
        opacity: 0.4 + Math.random() * 0.6,
      },
    };
  }
}
