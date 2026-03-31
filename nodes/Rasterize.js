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

    const canvas = new OffscreenCanvas(vector.width, vector.height);
    const ctx    = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw each line as a polyline
    ctx.strokeStyle = '#000000';
    for (const line of vector.lines) {
      const { points, style } = line;
      if (!points || points.length < 2) continue;

      ctx.lineWidth   = style.width   ?? 1;
      ctx.globalAlpha = style.opacity ?? 1;

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    }

    ctx.globalAlpha = 1;

    const imageData    = ctx.getImageData(0, 0, canvas.width, canvas.height);
    imageData._portType = 'rgba_rasterimage';
    this._setOutput('image', imageData);
  }
}
