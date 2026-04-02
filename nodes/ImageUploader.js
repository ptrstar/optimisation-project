import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class ImageUploader extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { config: PortTypes.CANVAS_CONFIG };
    this.outputSchema = { image: PortTypes.RGBA_RASTERIMAGE };
    this.inputs       = { config: null };
    this.outputs      = { image: null };

    this.fitMode   = 'fit'; // 'fit' | 'fill' | 'stretch' | 'crop'
    this._rawImage = null;  // decoded ImageData before any resizing
  }

  // Decode a File into this._rawImage, then call run() to apply config/fitMode.
  loadFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
          canvas.getContext('2d').drawImage(img, 0, 0);
          const raw      = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
          raw._portType  = 'rgba_rasterimage';
          this._rawImage = raw;
          this.run();
          URL.revokeObjectURL(url);
          resolve(this.outputs.image);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
      img.src = url;
    });
  }

  run() {
    if (!this._rawImage) return;
    const config = this.inputs.config;

    if (config) {
      const out      = this._resize(this._rawImage, config.widthPx, config.heightPx, this.fitMode);
      out._widthCm   = config.widthCm;
      out._heightCm  = config.heightCm;
      this._setOutput('image', out);
    } else {
      this._setOutput('image', this._rawImage);
    }
  }

  getParams() { return { fitMode: this.fitMode }; }
  setParams(p) { if (p.fitMode) this.fitMode = p.fitMode; }

  // ── Resize ────────────────────────────────────────────────────────────────

  _resize(src, targetW, targetH, mode) {
    const srcCanvas = new OffscreenCanvas(src.width, src.height);
    srcCanvas.getContext('2d').putImageData(src, 0, 0);

    const dst = new OffscreenCanvas(targetW, targetH);
    const ctx = dst.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);

    const sw = src.width, sh = src.height;

    if (mode === 'stretch') {
      ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);

    } else if (mode === 'fit') {
      // Contain: scale to fit within bounds, preserve aspect, white bars.
      const scale = Math.min(targetW / sw, targetH / sh);
      const dw = sw * scale, dh = sh * scale;
      ctx.drawImage(srcCanvas, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);

    } else if (mode === 'fill') {
      // Cover: scale to fill bounds, preserve aspect, crop overflow.
      const scale = Math.max(targetW / sw, targetH / sh);
      const dw = sw * scale, dh = sh * scale;
      ctx.drawImage(srcCanvas, (targetW - dw) / 2, (targetH - dh) / 2, dw, dh);

    } else if (mode === 'crop') {
      // Center-crop at 1:1 scale, no scaling.
      const sx = Math.max(0, (sw - targetW) / 2);
      const sy = Math.max(0, (sh - targetH) / 2);
      const cw = Math.min(sw, targetW);
      const ch = Math.min(sh, targetH);
      ctx.drawImage(srcCanvas, sx, sy, cw, ch, (targetW - cw) / 2, (targetH - ch) / 2, cw, ch);
    }

    const out      = ctx.getImageData(0, 0, targetW, targetH);
    out._portType  = 'rgba_rasterimage';
    return out;
  }
}
