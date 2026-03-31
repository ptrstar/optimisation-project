import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class ImageUploader extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = {};
    this.outputSchema = { image: PortTypes.RGBA_RASTERIMAGE };
    this.inputs       = {};
    this.outputs      = { image: null };
  }

  run() {
    // Data is loaded via loadFile(); nothing to do on run.
  }

  loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
          const ctx    = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const imageData      = ctx.getImageData(0, 0, canvas.width, canvas.height);
          imageData._portType  = 'rgba_rasterimage';
          this._setOutput('image', imageData);
          URL.revokeObjectURL(url);
          resolve(imageData);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };
      img.src = url;
    });
  }
}
