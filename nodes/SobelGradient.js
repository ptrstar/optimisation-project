import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

/**
 * SobelGradient — computes edge-gradient magnitude from a greyscale image.
 *
 * Input:  gs_rasterimage
 * Output: gs_rasterimage  (brightness = gradient magnitude, white = strong edge)
 *
 * Useful for:
 *   - Feeding gradient maps into opt nodes to bias strokes toward edges
 *   - Visualising structure in the source image before optimisation
 */
export class SobelGradient extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { image: PortTypes.GS_RASTERIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { image: null };
  }

  run() {
    const src = this.inputs.image;
    if (!src) return;

    const { width, height, data } = src;
    const out = new ImageData(width, height);

    // Sobel kernels applied to R channel (R = G = B in greyscale images)
    // Gx = [[-1,0,1],[-2,0,2],[-1,0,1]]
    // Gy = [[-1,-2,-1],[0,0,0],[1,2,1]]
    const px = (row, col) => data[((row * width) + col) * 4]; // R channel

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = (
          -px(y - 1, x - 1) + px(y - 1, x + 1)
          - 2 * px(y, x - 1) + 2 * px(y, x + 1)
          - px(y + 1, x - 1) + px(y + 1, x + 1)
        );
        const gy = (
          -px(y - 1, x - 1) - 2 * px(y - 1, x) - px(y - 1, x + 1)
          + px(y + 1, x - 1) + 2 * px(y + 1, x) + px(y + 1, x + 1)
        );
        const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        const i   = (y * width + x) * 4;
        out.data[i]     = mag;
        out.data[i + 1] = mag;
        out.data[i + 2] = mag;
        out.data[i + 3] = 255;
      }
    }

    // Border pixels: copy source (gradient is undefined at boundary)
    for (let x = 0; x < width; x++) {
      for (const y of [0, height - 1]) {
        const i = (y * width + x) * 4;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = data[i];
        out.data[i + 3] = 255;
      }
    }
    for (let y = 0; y < height; y++) {
      for (const x of [0, width - 1]) {
        const i = (y * width + x) * 4;
        out.data[i] = out.data[i + 1] = out.data[i + 2] = data[i];
        out.data[i + 3] = 255;
      }
    }

    out._portType = PortTypes.GS_RASTERIMAGE;
    this._setOutput('image', out);
  }
}
