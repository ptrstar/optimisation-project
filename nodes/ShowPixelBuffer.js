import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class ShowPixelBuffer extends BaseNode {
  constructor(id) {
    super(id);
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
    this.previewCanvas.getContext('2d').putImageData(img, 0, 0);

    // If physical dimensions were tagged upstream, display at real-world CSS cm size.
    // CSS 1cm = 96px/2.54 by spec — matches the browser reference pixel.
    if (img._widthCm && img._heightCm) {
      this.previewCanvas.style.width  = `${img._widthCm}cm`;
      this.previewCanvas.style.height = `${img._heightCm}cm`;
    } else {
      this.previewCanvas.style.width  = '';
      this.previewCanvas.style.height = '';
    }
  }
}
