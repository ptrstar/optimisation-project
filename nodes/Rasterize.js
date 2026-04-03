import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class Rasterize extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { vector: PortTypes.VECTORIMAGE };
    this.outputSchema = { image: PortTypes.RGBA_RASTERIMAGE };
    this.inputs       = { vector: null };
    this.outputs      = { image: null };
  }

  run() {
    const vector = this.inputs.vector;
    if (!vector) return;
    const imageData = Rasterize.renderToRGBA(vector);
    imageData._portType = 'rgba_rasterimage';
    if (vector._widthCm)  imageData._widthCm  = vector._widthCm;
    if (vector._heightCm) imageData._heightCm = vector._heightCm;
    this._setOutput('image', imageData);
  }

  // ── Static helpers — call these from opt nodes instead of reimplementing ────

  // Renders a VectorImage to an OffscreenCanvas and returns RGBA ImageData.
  static renderToRGBA(vector) {
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
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  // Returns a Uint8Array of single-channel luminance (R channel of white-canvas render).
  // This is the fast path used by all optimisation nodes in their inner scoring loop.
  static renderToGS(vector) {
    const rgba   = Rasterize.renderToRGBA(vector);
    const pixels = new Uint8Array(vector.width * vector.height);
    for (let i = 0; i < pixels.length; i++) pixels[i] = rgba.data[i * 4];
    return pixels;
  }
}
