import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class Contrast extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.RGBA_RASTERIMAGE, amount: PortTypes.SCALAR };
    this.outputSchema = { image: PortTypes.RGBA_RASTERIMAGE };
    this.inputs       = { image: null, amount: 1.0 };
    this.outputs      = { image: null };
  }

  run() {
    const src    = this.inputs.image;
    const amount = this.inputs.amount ?? 1.0;
    if (!src) return;

    const data = new Uint8ClampedArray(src.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.min(255, Math.max(0, (data[i]     - 128) * amount + 128));
      data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * amount + 128));
      data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * amount + 128));
      // Alpha unchanged
    }

    const out     = new ImageData(data, src.width, src.height);
    out._portType = 'rgba_rasterimage';
    this._setOutput('image', out);
  }
}
