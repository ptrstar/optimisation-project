import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class ImageDiff extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { imageA: PortTypes.RGBA_RASTERIMAGE, imageB: PortTypes.RGBA_RASTERIMAGE };
    this.outputSchema = { diff: PortTypes.RGBA_RASTERIMAGE, score: PortTypes.SCALAR };
    this.inputs       = { imageA: null, imageB: null };
    this.outputs      = { diff: null, score: null };
  }

  run() {
    const a = this.inputs.imageA;
    const b = this.inputs.imageB;
    if (!a || !b) return;

    const width  = Math.min(a.width,  b.width);
    const height = Math.min(a.height, b.height);
    const diffData = new Uint8ClampedArray(width * height * 4);

    let total = 0;
    let count = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;

        // Per-pixel absolute difference across R/G/B channels
        const dr = Math.abs(a.data[i]     - b.data[i]);
        const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
        const db = Math.abs(a.data[i + 2] - b.data[i + 2]);

        diffData[i]     = dr;
        diffData[i + 1] = dg;
        diffData[i + 2] = db;
        diffData[i + 3] = 255;

        total += dr + dg + db;
        count += 3;
      }
    }

    const score = count > 0 ? total / count : 0;

    const diff    = new ImageData(diffData, width, height);
    diff._portType = 'rgba_rasterimage';

    this._setOutput('diff',  diff);
    this._setOutput('score', score);
  }
}
