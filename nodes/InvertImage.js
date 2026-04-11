import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class InvertImage extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.RGBA_RASTERIMAGE };
    this.outputSchema = { image: PortTypes.RGBA_RASTERIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { image: null };
  }

  run() {
    const src = this.inputs.image;
    if (!src) return;

    const data = new Uint8ClampedArray(src.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
      // alpha unchanged
    }

    const out = new ImageData(data, src.width, src.height);
    out._portType = src._portType ?? PortTypes.RGBA_RASTERIMAGE;
    if (src._widthCm)  out._widthCm  = src._widthCm;
    if (src._heightCm) out._heightCm = src._heightCm;
    this._setOutput('image', out);
  }
}