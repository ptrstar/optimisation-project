import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class Grayscale extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.RGBA_RASTERIMAGE };
    this.outputSchema = { image: PortTypes.GS_RASTERIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { image: null };
  }

  run() {
    const src = this.inputs.image;
    if (!src) return;

    const data = new Uint8ClampedArray(src.data);
    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      data[i]     = lum;
      data[i + 1] = lum;
      data[i + 2] = lum;
      data[i + 3] = 255;
    }

    const out       = new ImageData(data, src.width, src.height);
    out._portType   = 'gs_rasterimage';
    this._setOutput('image', out);
  }
}
