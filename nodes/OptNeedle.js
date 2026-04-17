import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

export class OptNeedle extends OptBase {
  constructor(id) {
    super(id);

    this.rounds      = 5000;
    this.lineCount   = 50;
    this.penWidthPx  = 2;
    this.blurRadius  = 5;
    this.scoreScale  = 0.5;

    this.minLenFrac  = 0.01;
    this.maxLenFrac  = 0.06;

    this.paramDefs = [
      { label: 'Rounds',          key: 'rounds',      min: 100,  max: 50000, step: 100   },
      { label: 'Line count',      key: 'lineCount',   min: 5,    max: 500,   step: 5     },
      { label: 'Pen width (px)',  key: 'penWidthPx',  min: 0.5,  max: 20,    step: 0.5   },
      { label: 'Blur radius',     key: 'blurRadius',  min: 0,    max: 30,    step: 1     },
      { label: 'Score scale',     key: 'scoreScale',  min: 0.1,  max: 1,     step: 0.05  },
      { label: 'Min len (diag%)', key: 'minLenFrac',  min: 0.005,max: 0.5,   step: 0.005 },
      { label: 'Max len (diag%)', key: 'maxLenFrac',  min: 0.01, max: 0.5,   step: 0.01  },
    ];

    this.onPreviewBlur = null;
  }

  buildContent(widget) {
    const wrap = super.buildContent(widget);

    const blurWrap = document.createElement('div');
    blurWrap.style.cssText = 'overflow:auto; max-width:280px; max-height:200px; border-radius:4px; border:1px solid #93c5fd; display:none;';
    const blurCanvas = document.createElement('canvas');
    blurCanvas.style.cssText = 'display:block; image-rendering:pixelated;';
    blurWrap.appendChild(blurCanvas);
    wrap.appendChild(blurWrap);

    this.onPreviewBlur = (pixels, w, h) => {
      blurWrap.style.display = 'block';
      blurCanvas.width  = w;
      blurCanvas.height = h;
      const ctx  = blurCanvas.getContext('2d');
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < pixels.length; i++) {
        const v = pixels[i], j = i * 4;
        rgba[j] = rgba[j + 1] = rgba[j + 2] = v;
        rgba[j + 3] = 255;
      }
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    };

    return wrap;
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W    = src.width;
    const H    = src.height;
    const diag = Math.sqrt(W * W + H * H);

    // ── Score-resolution setup ────────────────────────────────────────────────
    const ss     = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw     = Math.max(1, Math.round(W * ss));
    const sh     = Math.max(1, Math.round(H * ss));
    const scX    = sw / W;
    const scY    = sh / H;
    const scoreN = sw * sh;
    const penW   = Math.max(0.5, this.penWidthPx * ss);
    const blurR  = Math.max(0, Math.round(this.blurRadius));

    // ── Buffers ───────────────────────────────────────────────────────────────
    // targetGS    — fixed downscaled reference, never mutated
    // current     — crisp rendering of committed lines at score resolution
    // currentBlur — box-blurred view of current; compared against targetGS for scoring
    // scratch     — region save/restore for current (line bbox)
    // scratchBlur — region save/restore for currentBlur (line bbox + blurR halo)
    // blurTmp     — H-pass scratch for reblurLocal; pre-allocated, never grows
    const targetGS    = this._downscaleTarget(src, sw, sh);
    const current     = new Uint8Array(scoreN).fill(255);
    const currentBlur = new Uint8Array(scoreN).fill(255);
    const scratch     = new Uint8Array(scoreN);
    const scratchBlur = new Uint8Array(scoreN);
    const blurTmp     = new Float32Array(scoreN);

    // ── Region helpers ────────────────────────────────────────────────────────
    // Bounding box of a score-space segment with half-width r
    const lineBBox = (x1, y1, x2, y2, r) => ({
      minX: Math.max(0,      Math.floor(Math.min(x1, x2) - r)),
      maxX: Math.min(sw - 1, Math.ceil( Math.max(x1, x2) + r)),
      minY: Math.max(0,      Math.floor(Math.min(y1, y2) - r)),
      maxY: Math.min(sh - 1, Math.ceil( Math.max(y1, y2) + r)),
    });

    // Save line bbox of current → scratch; blur bbox (expanded by blurR) of currentBlur → scratchBlur.
    const saveRegion = ({ minX, maxX, minY, maxY }) => {
      for (let y = minY; y <= maxY; y++) {
        const row = y * sw;
        for (let x = minX; x <= maxX; x++) scratch[row + x] = current[row + x];
      }
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      for (let y = by0; y <= by1; y++) {
        const row = y * sw;
        for (let x = bx0; x <= bx1; x++) scratchBlur[row + x] = currentBlur[row + x];
      }
    };

    // Restore current and currentBlur from scratch (undo a rejected candidate draw).
    const restoreRegion = ({ minX, maxX, minY, maxY }) => {
      for (let y = minY; y <= maxY; y++) {
        const row = y * sw;
        for (let x = minX; x <= maxX; x++) current[row + x] = scratch[row + x];
      }
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      for (let y = by0; y <= by1; y++) {
        const row = y * sw;
        for (let x = bx0; x <= bx1; x++) currentBlur[row + x] = scratchBlur[row + x];
      }
    };

    // Update only the affected patch of currentBlur after a draw into current.
    //
    // The local separable blur is mathematically exact (not an approximation):
    // only pixels within blurR of the drawn line can change in currentBlur, and
    // computing their new values reads from the unchanged parts of current correctly.
    //
    // H-pass rows must extend blurR beyond the output region so the V-pass has
    // a full kernel at the top/bottom edges.
    const reblurLocal = ({ minX, maxX, minY, maxY }) => {
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      const hy0 = Math.max(0,      by0  - blurR), hy1 = Math.min(sh - 1, by1  + blurR);

      // H-pass: box-blur current horizontally into blurTmp for rows [hy0..hy1]
      for (let y = hy0; y <= hy1; y++) {
        const base = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const x0 = Math.max(0,      x - blurR);
          const x1 = Math.min(sw - 1, x + blurR);
          let sum = 0;
          for (let k = x0; k <= x1; k++) sum += current[base + k];
          blurTmp[base + x] = sum / (x1 - x0 + 1);
        }
      }

      // V-pass: box-blur blurTmp vertically into currentBlur for the output region
      for (let x = bx0; x <= bx1; x++) {
        for (let y = by0; y <= by1; y++) {
          const y0 = Math.max(0,      y - blurR);
          const y1 = Math.min(sh - 1, y + blurR);
          let sum = 0;
          for (let k = y0; k <= y1; k++) sum += blurTmp[k * sw + x];
          currentBlur[y * sw + x] = Math.round(sum / (y1 - y0 + 1));
        }
      }
    };

    // MAE delta over the blur patch: compares currentBlur (after draw) and
    // scratchBlur (before draw) against targetGS. Negative = improvement.
    // Call after reblurLocal, while scratchBlur still holds the pre-draw state.
    const scoreDelta = ({ minX, maxX, minY, maxY }) => {
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      let delta = 0;
      for (let y = by0; y <= by1; y++) {
        const row = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const i  = row + x;
          const t  = targetGS[i];
          const dB = scratchBlur[i] - t;
          const dA = currentBlur[i] - t;
          delta += (dA > 0 ? dA : -dA) - (dB > 0 ? dB : -dB);
        }
      }
      return delta;
    };

    // ── Seed: place lineCount short random needles ────────────────────────────
    const vector = new VectorImage(W, H);
    for (let i = 0; i < this.lineCount; i++) {
      const { points, style } = this._randomLine(W, H, diag);
      vector.addLine(points, style);
      const sx1 = points[0].x * scX, sy1 = points[0].y * scY;
      const sx2 = points[1].x * scX, sy2 = points[1].y * scY;
      this._drawLine(sx1, sy1, sx2, sy2, penW, current, sw, sh);
    }
    currentBlur.set(this._blurBuffer(current, sw, sh, blurR));

    this.onProgress?.(0, 0);
    this.onPreview?.(current.slice(), sw, sh);
    this.onPreviewBlur?.(currentBlur.slice(), sw, sh);
    await new Promise(r => setTimeout(r, 0));

    // ── TODO: implement algorithm here ───────────────────────────────────────
    //
    // Per-iteration pattern:
    //   const sx1 = ..., sy1 = ..., sx2 = ..., sy2 = ...;  // score-space coords
    //   const bbox = lineBBox(sx1, sy1, sx2, sy2, penW);
    //   saveRegion(bbox);
    //   this._drawLine(sx1, sy1, sx2, sy2, penW, current, sw, sh);
    //   reblurLocal(bbox);
    //   const delta = scoreDelta(bbox);   // < 0 means improvement
    //   if (/* reject */) restoreRegion(bbox);
    //
    // Preview every ~100 iterations:
    //   this.onProgress?.(i / this.rounds, score);
    //   this.onPreview?.(current.slice(), sw, sh);
    //   this.onPreviewBlur?.(currentBlur.slice(), sw, sh);
    //   await new Promise(r => setTimeout(r, 0));

    // ── Finalise ──────────────────────────────────────────────────────────────
    this.onProgress?.(1, 0);
    this.onPreview?.(current.slice(), sw, sh);
    this.onPreviewBlur?.(currentBlur.slice(), sw, sh);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  // ── Software line rasterizer ──────────────────────────────────────────────
  // Sets all pixels within distance r of segment (x1,y1)→(x2,y2) to 0 in buf.
  _drawLine(x1, y1, x2, y2, r, buf, W, H) {
    const minX = Math.max(0,     Math.floor(Math.min(x1, x2) - r));
    const maxX = Math.min(W - 1, Math.ceil( Math.max(x1, x2) + r));
    const minY = Math.max(0,     Math.floor(Math.min(y1, y2) - r));
    const maxY = Math.min(H - 1, Math.ceil( Math.max(y1, y2) + r));

    const dx    = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const r2    = r * r;

    for (let y = minY; y <= maxY; y++) {
      const row = y * W;
      for (let x = minX; x <= maxX; x++) {
        let dist2;
        if (lenSq === 0) {
          const ex = x - x1, ey = y - y1;
          dist2 = ex * ex + ey * ey;
        } else {
          const t  = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
          const ex = x - (x1 + t * dx);
          const ey = y - (y1 + t * dy);
          dist2 = ex * ex + ey * ey;
        }
        if (dist2 <= r2) buf[row + x] = 0;
      }
    }
  }
}
