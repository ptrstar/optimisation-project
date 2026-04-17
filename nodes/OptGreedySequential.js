import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGreedySequential — places one line at a time.
 *
 * For each new line, `candidates` random strokes are evaluated against the
 * current render. The one that most reduces the blur-MAE is committed,
 * then the next line is chosen.
 *
 * Scoring
 * ───────
 * After each candidate draw, the affected patch of `currentBlur` (the
 * box-blurred render) is updated locally and compared against `target`
 * (the raw downscaled input). This mimics perceptual distance: many thin
 * lines packed together blur into a gray that should match the target gray.
 *
 * The local blur update is O(patch × blurR) — no full-buffer re-blur per
 * candidate. The blur is mathematically exact for the affected region
 * because only pixels within blurR of the drawn line can change.
 *
 * Efficiency
 * ──────────
 *   - target/current/currentBlur are flat Uint8Arrays at scoreScale resolution.
 *   - save/restoreRegion copies only the line bbox (current) and blur halo
 *     (currentBlur) — O(patch) per candidate, no heap allocation in inner loop.
 *   - _fillPixelBuf / _applyLine unchanged: opacity darkening still supported.
 */
export class OptGreedySequential extends OptBase {
  constructor(id) {
    super(id);

    this.lineCount    = 150;
    this.candidates   = 400;
    this.penWidthPx   = 2;
    this.scoreScale   = 0.5;
    this.maxLenFrac   = 0.4;
    this.lineOpacity  = 1.0;
    this.blurRadius   = 8;
    this.gradBias     = 0.8;   // 0 = fully random angle, 1 = fully gradient-aligned

    this.paramDefs = [
      { label: 'Lines',           key: 'lineCount',   min: 10,   max: 1000, step: 10   },
      { label: 'Candidates/line', key: 'candidates',  min: 50,   max: 2000, step: 50   },
      { label: 'Pen width (px)',  key: 'penWidthPx',  min: 0.5,  max: 20,   step: 0.5  },
      { label: 'Score scale',     key: 'scoreScale',  min: 0.1,  max: 1,    step: 0.05 },
      { label: 'Max len (diag%)', key: 'maxLenFrac',  min: 0.02, max: 1,    step: 0.02 },
      { label: 'Line opacity',    key: 'lineOpacity', min: 0.05, max: 1,    step: 0.05 },
      { label: 'Blur radius (px)',key: 'blurRadius',  min: 0,    max: 50,   step: 1    },
      { label: 'Grad bias',       key: 'gradBias',    min: 0,    max: 1,    step: 0.05 },
    ];

    this._pixelBuf   = null;
    this._pixelCount = 0;
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

    const W = src.width, H = src.height;
    const ss   = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw   = Math.max(1, Math.round(W * ss));
    const sh   = Math.max(1, Math.round(H * ss));
    const scX  = sw / W, scY = sh / H;
    const N    = sw * sh;
    const penW = Math.max(0.5, this.penWidthPx * ss);
    const blurR = Math.max(0, Math.round(this.blurRadius * ss));

    this._pixelBuf = new Int32Array(N);

    const target      = this._downscaleTarget(src, sw, sh);
    const opacity     = Math.max(0.05, Math.min(1, this.lineOpacity));
    const gradBias    = Math.max(0, Math.min(1, this.gradBias));

    // ── Sobel gradient of target (same kernels as SobelGradient.js) ───────────
    // gx/gy store the signed gradient components at score resolution.
    // Used to bias candidate line angles toward the local gradient direction.
    const sobelGX = new Float32Array(N);
    const sobelGY = new Float32Array(N);
    {
      const at = (y, x) => target[y * sw + Math.max(0, Math.min(sw - 1, x))];
      for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
          sobelGX[y * sw + x] =
            -at(y-1,x-1) + at(y-1,x+1)
            - 2*at(y,x-1) + 2*at(y,x+1)
            - at(y+1,x-1) + at(y+1,x+1);
          sobelGY[y * sw + x] =
            -at(y-1,x-1) - 2*at(y-1,x) - at(y-1,x+1)
            + at(y+1,x-1) + 2*at(y+1,x) + at(y+1,x+1);
        }
      }
    }
    // Normalise by the actual max magnitude found in the image so strength ∈ [0,1].
    let maxMag = 1;
    for (let i = 0; i < N; i++) {
      const m = Math.sqrt(sobelGX[i] ** 2 + sobelGY[i] ** 2);
      if (m > maxMag) maxMag = m;
    }

    // Returns a gradient-biased random line in score space.
    // Centre is chosen uniformly; angle spread around the gradient direction
    // shrinks with gradient strength × gradBias (π = fully random, 0 = locked).
    // Rotate by π/2 inside to align strokes along contours instead of across them.
    const lenDiag = Math.sqrt(sw * sw + sh * sh);
    const randomLineGrad = () => {
      const cx = Math.random() * sw;
      const cy = Math.random() * sh;

      const xi  = Math.max(0, Math.min(sw - 1, Math.round(cx)));
      const yi  = Math.max(0, Math.min(sh - 1, Math.round(cy)));
      const gx  = sobelGX[yi * sw + xi];
      const gy  = sobelGY[yi * sw + xi];
      const mag = Math.sqrt(gx * gx + gy * gy);

      const strength   = (mag / maxMag) * gradBias;
      const spread     = (1 - strength) * Math.PI;         // full π = uniform half-circle
      const gradAngle  = Math.atan2(gy, gx) + Math.PI / 2; // +π/2 → along contour
      const angle      = gradAngle + (Math.random() - 0.5) * 2 * spread;

      const len  = lenDiag * (this.minLenFrac + Math.random() * (this.maxLenFrac - this.minLenFrac));
      const half = len / 2;
      return {
        sx1: Math.max(0, Math.min(sw - 1, cx - Math.cos(angle) * half)),
        sy1: Math.max(0, Math.min(sh - 1, cy - Math.sin(angle) * half)),
        sx2: Math.max(0, Math.min(sw - 1, cx + Math.cos(angle) * half)),
        sy2: Math.max(0, Math.min(sh - 1, cy + Math.sin(angle) * half)),
      };
    };

    // ── Buffers ───────────────────────────────────────────────────────────────
    const current     = new Uint8Array(N).fill(255);
    const currentBlur = new Uint8Array(N).fill(255);
    const scratch     = new Uint8Array(N);
    const scratchBlur = new Uint8Array(N);
    const blurTmp     = new Float32Array(N);

    // ── Region helpers (identical to OptNeedle) ───────────────────────────────
    const lineBBox = (x1, y1, x2, y2, r) => ({
      minX: Math.max(0,      Math.floor(Math.min(x1, x2) - r)),
      maxX: Math.min(sw - 1, Math.ceil( Math.max(x1, x2) + r)),
      minY: Math.max(0,      Math.floor(Math.min(y1, y2) - r)),
      maxY: Math.min(sh - 1, Math.ceil( Math.max(y1, y2) + r)),
    });

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

    const reblurLocal = ({ minX, maxX, minY, maxY }) => {
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      const hy0 = Math.max(0,      by0  - blurR), hy1 = Math.min(sh - 1, by1  + blurR);
      for (let y = hy0; y <= hy1; y++) {
        const base = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const x0 = Math.max(0,      x - blurR), x1 = Math.min(sw - 1, x + blurR);
          let sum = 0;
          for (let k = x0; k <= x1; k++) sum += current[base + k];
          blurTmp[base + x] = sum / (x1 - x0 + 1);
        }
      }
      for (let x = bx0; x <= bx1; x++) {
        for (let y = by0; y <= by1; y++) {
          const y0 = Math.max(0,      y - blurR), y1 = Math.min(sh - 1, y + blurR);
          let sum = 0;
          for (let k = y0; k <= y1; k++) sum += blurTmp[k * sw + x];
          currentBlur[y * sw + x] = Math.round(sum / (y1 - y0 + 1));
        }
      }
    };

    // MAE delta in the blur patch: scratchBlur = before, currentBlur = after.
    // Negative means improvement.
    const scoreDelta = ({ minX, maxX, minY, maxY }) => {
      const bx0 = Math.max(0,      minX - blurR), bx1 = Math.min(sw - 1, maxX + blurR);
      const by0 = Math.max(0,      minY - blurR), by1 = Math.min(sh - 1, maxY + blurR);
      let delta = 0;
      for (let y = by0; y <= by1; y++) {
        const row = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const i  = row + x;
          const t  = target[i];
          const dB = scratchBlur[i] - t;
          const dA = currentBlur[i] - t;
          delta += (dA > 0 ? dA : -dA) - (dB > 0 ? dB : -dB);
        }
      }
      return delta;
    };

    const vector = new VectorImage(W, H);

    for (let lineIdx = 0; lineIdx < this.lineCount; lineIdx++) {
      let bestImprovement = 0;
      let bestSx1 = 0, bestSy1 = 0, bestSx2 = 0, bestSy2 = 0;
      let found = false;

      for (let c = 0; c < this.candidates; c++) {
        const { sx1, sy1, sx2, sy2 } = randomLineGrad();

        const bbox = lineBBox(sx1, sy1, sx2, sy2, penW);
        saveRegion(bbox);
        this._applyLine(current, sx1, sy1, sx2, sy2, penW, sw, sh, opacity);
        reblurLocal(bbox);
        const improvement = -scoreDelta(bbox);   // positive = better
        restoreRegion(bbox);

        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          bestSx1 = sx1; bestSy1 = sy1;
          bestSx2 = sx2; bestSy2 = sy2;
          found = true;
        }
      }

      if (found) {
        this._applyLine(current, bestSx1, bestSy1, bestSx2, bestSy2, penW, sw, sh, opacity);
        reblurLocal(lineBBox(bestSx1, bestSy1, bestSx2, bestSy2, penW));
        vector.addLine(
          [
            { x: bestSx1 / scX, y: bestSy1 / scY },
            { x: bestSx2 / scX, y: bestSy2 / scY },
          ],
          { width: this.penWidthPx, opacity },
        );
      }

      if (lineIdx % 5 === 0) {
        this.onProgress?.(lineIdx / this.lineCount, this._bufferMAE(currentBlur, target, N));
        this.onPreview?.(current, sw, sh);
        this.onPreviewBlur?.(currentBlur.slice(), sw, sh);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, this._bufferMAE(currentBlur, target, N));
    this.onPreview?.(current, sw, sh);
    this.onPreviewBlur?.(currentBlur.slice(), sw, sh);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  _bufferMAE(a, b, N) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const d = a[i] - b[i];
      sum += d > 0 ? d : -d;
    }
    return sum / N;
  }

  _applyLine(current, x1, y1, x2, y2, r, W, H, opacity) {
    this._fillPixelBuf(x1, y1, x2, y2, r, W, H);
    const buf = this._pixelBuf;
    const n   = this._pixelCount;
    const mul = 1 - opacity;
    for (let k = 0; k < n; k++) {
      const i = buf[k];
      current[i] = Math.round(current[i] * mul);
    }
  }

  _fillPixelBuf(x1, y1, x2, y2, r, W, H) {
    const minX = Math.max(0,     Math.floor(Math.min(x1, x2) - r));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(x1, x2) + r));
    const minY = Math.max(0,     Math.floor(Math.min(y1, y2) - r));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(y1, y2) + r));

    const dx    = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    const r2    = r * r;
    const buf   = this._pixelBuf;
    let   count = 0;

    for (let y = minY; y <= maxY; y++) {
      const row = y * W;
      for (let x = minX; x <= maxX; x++) {
        let dist2;
        if (lenSq === 0) {
          const ex = x - x1, ey = y - y1;
          dist2 = ex * ex + ey * ey;
        } else {
          const t  = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
          const ex = x1 + t * dx - x;
          const ey = y1 + t * dy - y;
          dist2 = ex * ex + ey * ey;
        }
        if (dist2 <= r2) buf[count++] = row + x;
      }
    }
    this._pixelCount = count;
  }
}
