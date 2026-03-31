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
  }

  run() {
    const src = this.inputs.image;
    if (!src) return;

    const vector = new VectorImage(src.width, src.height);

    // TODO: implement optimisation
    // Contract: given this.inputs.image (grayscale ImageData), produce a VectorImage
    // whose rasterisation (via Rasterize node) minimises the score returned by ImageDiff.
    // Strategy: iteratively add lines to `vector`, each time checking whether the new
    // rasterisation reduces the mean absolute error versus the target image.

    this._setOutput('vector', vector);
  }
}
