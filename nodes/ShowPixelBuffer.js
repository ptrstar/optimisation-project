import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class ShowPixelBuffer extends BaseNode {
  constructor(id) {
    super(id);
    // Accepts gs_rasterimage too via the compatibility rule in Pipeline.connect
    this.inputSchema  = { image: PortTypes.RGBA_RASTERIMAGE };
    this.outputSchema = {};
    this.inputs       = { image: null };
    this.outputs      = {};
    this.previewCanvas = null; // set by NodeWidget
  }

  run() {
    const img = this.inputs.image;
    if (!img || !this.previewCanvas) return;

    this.previewCanvas.width  = img.width;
    this.previewCanvas.height = img.height;
    const ctx = this.previewCanvas.getContext('2d');
    ctx.putImageData(img, 0, 0);
  }
}
