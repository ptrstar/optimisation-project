import { BaseNode }  from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

/**
 * Blur — separable box blur on a greyscale image.
 *
 * Input:  gs_rasterimage
 * Output: gs_rasterimage
 *
 * Uses a two-pass (horizontal then vertical) box blur for O(n) performance
 * regardless of radius. Larger radius = smoother result.
 *
 * Useful for:
 *   - Pre-smoothing the target image to make opt nodes converge faster on
 *     large-scale structure before fine detail
 *   - Reducing noise before Sobel edge detection
 */
export class Blur extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = { image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { image: PortTypes.GS_RASTERIMAGE };
    this.inputs       = { image: null };
    this.outputs      = { image: null };

    this.radius = 3; // box blur radius in pixels
  }

  run() {
    const src = this.inputs.image;
    if (!src) return;

    const { width, height, data } = src;
    const r   = Math.max(0, Math.round(this.radius));
    const tmp = new Float32Array(width * height); // intermediate after H pass
    const out = new ImageData(width, height);

    // Horizontal pass (sliding window sum over R channel)
    for (let y = 0; y < height; y++) {
      let sum = 0;
      const base = y * width;
      // Initialise window
      for (let x = 0; x <= Math.min(r, width - 1); x++) sum += data[(base + x) * 4];
      for (let x = 0; x < width; x++) {
        const add    = x + r + 1 < width ? data[(base + x + r + 1) * 4] : 0;
        const remove = x - r - 1 >= 0    ? data[(base + x - r - 1) * 4] : 0;
        sum += add - remove;
        tmp[base + x] = sum / Math.min(2 * r + 1, width);
      }
    }

    // Vertical pass (sliding window sum over tmp)
    for (let x = 0; x < width; x++) {
      let sum = 0;
      // Initialise window
      for (let y = 0; y <= Math.min(r, height - 1); y++) sum += tmp[y * width + x];
      for (let y = 0; y < height; y++) {
        const add    = y + r + 1 < height ? tmp[(y + r + 1) * width + x] : 0;
        const remove = y - r - 1 >= 0     ? tmp[(y - r - 1) * width + x] : 0;
        sum += add - remove;
        const v = Math.round(sum / Math.min(2 * r + 1, height));
        const i = (y * width + x) * 4;
        out.data[i]     = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
      }
    }

    out._portType = PortTypes.GS_RASTERIMAGE;
    this._setOutput('image', out);
  }

  getParams() { return { radius: this.radius }; }
  setParams(p) { if (p.radius != null) this.radius = p.radius; }

  // Custom widget content — a simple radius slider
  buildContent(widget) {
    const node = this;
    const wrap = document.createElement('div');
    wrap.className = 'px-3 py-2 flex flex-col gap-1';

    const valueLabel = document.createElement('span');
    valueLabel.className = 'text-xs text-gray-500 font-mono';
    valueLabel.textContent = `Radius: ${node.radius}px`;

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = '0';
    slider.max   = '20';
    slider.step  = '1';
    slider.value = String(node.radius);
    slider.className = 'w-full accent-blue-500';

    slider.addEventListener('input', () => {
      node.radius = parseInt(slider.value, 10);
      valueLabel.textContent = `Radius: ${node.radius}px`;
      slider.dispatchEvent(new CustomEvent('node-param-changed', { bubbles: true, detail: { node } }));
    });

    wrap.appendChild(valueLabel);
    wrap.appendChild(slider);
    return wrap;
  }
}
