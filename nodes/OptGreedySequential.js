import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGreedySequential — places one line at a time.
 *
 * For each new line, `candidates` random strokes are scored against the
 * current residual (error image). The one that most reduces the total MAE
 * is committed, the residual is updated, then the next line is chosen.
 *
 * Blur mix + line opacity
 * ───────────────────────
 * Two complemenary handles for representing shaded (mid-gray) areas:
 *
 *  lineOpacity  — a semi-transparent line darkens pixels to current*(1-opacity)
 *                 rather than hard-0. At 50% opacity a stroke over white renders
 *                 as ~128 (mid-gray), so the algorithm can represent any tone.
 *                 Without this, the score is marginally *worse* for painting on
 *                 any pixel lighter than 50% gray, so the algorithm ignores them.
 *
 *  blurRadius   — pre-blurs the target once (via OptBase._blurBuffer) to make a
 *                 "soft density field". blurMix controls how much of the total
 *                 delta comes from this soft target vs the sharp pixel target.
 *                 A line near (but not exactly on) dark pixels gets partial
 *                 credit, so the algorithm steers toward dark *neighborhoods*
 *                 rather than only exact pixel matches. This helps parallel
 *                 hatching strokes cluster in the right region.
 *
 * Efficiency notes:
 *   - Target and current state are flat Uint8Arrays at scoreScale resolution.
 *   - _pixelBuf is pre-allocated once and reused for every candidate eval.
 *   - _blurBuffer (from OptBase) runs once per run() call — O(sw*sh*r).
 *   - Per-candidate cost: one bounding-box rasterize + cheap arithmetic.
 */
export class OptGreedySequential extends OptBase {
  constructor(id) {
    super(id);

    this.lineCount    = 150;
    this.candidates   = 400;   // random strokes evaluated per line
    this.penWidthPx   = 2;
    this.scoreScale   = 0.5;   // resolution for candidate scoring (0.1–1.0)
    this.maxLenFrac   = 0.4;   // max stroke length as fraction of diagonal
    this.lineOpacity  = 1.0;   // 0.1 (faint) → 1.0 (solid black)
    this.blurRadius   = 8;     // full-res px; scaled by scoreScale internally
    this.blurMix      = 0.4;   // 0 = sharp only, 1 = blurred only

    this.paramDefs = [
      { label: 'Lines',           key: 'lineCount',   min: 10,   max: 1000, step: 10   },
      { label: 'Candidates/line', key: 'candidates',  min: 50,   max: 2000, step: 50   },
      { label: 'Pen width (px)',  key: 'penWidthPx',  min: 0.5,  max: 20,   step: 0.5  },
      { label: 'Score scale',     key: 'scoreScale',  min: 0.1,  max: 1,    step: 0.05 },
      { label: 'Max len (diag%)', key: 'maxLenFrac',  min: 0.02, max: 1,    step: 0.02 },
      { label: 'Line opacity',    key: 'lineOpacity', min: 0.05, max: 1,    step: 0.05 },
      { label: 'Blur radius (px)',key: 'blurRadius',  min: 0,    max: 50,   step: 1    },
      { label: 'Blur mix',        key: 'blurMix',     min: 0,    max: 1,    step: 0.05 },
    ];

    this._pixelBuf   = null;
    this._pixelCount = 0;
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
    const diag = Math.sqrt(sw * sw + sh * sh);

    // Pre-allocate pixel scratch buffer (worst case: whole canvas)
    this._pixelBuf = new Int32Array(N);

    // Sharp target at score resolution (0=black, 255=white)
    const target = this._downscaleTarget(src, sw, sh);

    // Blurred target — pre-computed once. blurRadius is in full-res px so scale it.
    const blurR         = Math.round(this.blurRadius * ss);
    const blurredTarget = this._blurBuffer(target, sw, sh, blurR);
    const blurMix       = Math.max(0, Math.min(1, this.blurMix));
    const opacity       = Math.max(0.05, Math.min(1, this.lineOpacity));

    // Current rendered state — starts all white (255)
    const current = new Uint8Array(N).fill(255);

    const vector = new VectorImage(W, H);

    for (let lineIdx = 0; lineIdx < this.lineCount; lineIdx++) {
      let bestDelta = 0;     // only keep lines that strictly improve the score
      let bestSx1 = 0, bestSy1 = 0, bestSx2 = 0, bestSy2 = 0;
      let found = false;

      for (let c = 0; c < this.candidates; c++) {
        const { sx1, sy1, sx2, sy2 } = this._randomLine(sw, sh, diag);
        const delta = this._evalDelta(
          current, target, blurredTarget,
          sx1, sy1, sx2, sy2,
          penW, sw, sh, opacity, blurMix,
        );
        if (delta > bestDelta) {
          bestDelta = delta;
          bestSx1 = sx1; bestSy1 = sy1;
          bestSx2 = sx2; bestSy2 = sy2;
          found = true;
        }
      }

      if (found) {
        this._applyLine(current, bestSx1, bestSy1, bestSx2, bestSy2, penW, sw, sh, opacity);
        vector.addLine(
          [
            { x: bestSx1 / scX, y: bestSy1 / scY },
            { x: bestSx2 / scX, y: bestSy2 / scY },
          ],
          { width: this.penWidthPx, opacity },
        );
      }

      if (lineIdx % 5 === 0) {
        this.onProgress?.(lineIdx / this.lineCount, this._bufferMAE(current, target, N));
        this.onPreview?.(current, sw, sh);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, this._bufferMAE(current, target, N));
    this.onPreview?.(current, sw, sh);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  _bufferMAE(current, target, N) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const d = current[i] - target[i];
      sum += d > 0 ? d : -d;
    }
    return sum / N;
  }

  /**
   * How much total error would decrease if this line were committed.
   * Returns positive = improvement.
   *
   * After drawing: pixel value becomes floor(current[i] * (1 - opacity)).
   * Sharp delta:   |cur - sharpTgt| - |afterVal - sharpTgt|
   * Blurred delta: |cur - blurTgt|  - |afterVal - blurTgt|
   * Total:         (1 - blurMix) * sharpDelta + blurMix * blurredDelta
   */
  _evalDelta(current, target, blurredTarget, x1, y1, x2, y2, r, W, H, opacity, blurMix) {
    this._fillPixelBuf(x1, y1, x2, y2, r, W, H);
    const buf       = this._pixelBuf;
    const n         = this._pixelCount;
    const sharpW    = 1 - blurMix;
    let   delta     = 0;

    for (let k = 0; k < n; k++) {
      const i        = buf[k];
      const cur      = current[i];
      const afterVal = cur * (1 - opacity);   // darkened but not necessarily 0

      // Sharp component
      const st       = target[i];
      const sErrB    = cur      > st ? cur      - st : st - cur;
      const sErrA    = afterVal > st ? afterVal - st : st - afterVal;
      delta += sharpW * (sErrB - sErrA);

      // Blurred component (skip entirely if blurMix is 0 to avoid wasted work)
      if (blurMix > 0) {
        const bt    = blurredTarget[i];
        const bErrB = cur      > bt ? cur      - bt : bt - cur;
        const bErrA = afterVal > bt ? afterVal - bt : bt - afterVal;
        delta += blurMix * (bErrB - bErrA);
      }
    }
    return delta;
  }

  // Darken covered pixels by opacity (supports fractional opacity)
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

  // ── Software rasterizer ────────────────────────────────────────────────────
  // Fills this._pixelBuf with flat indices of pixels within radius r of segment.
  // Iterates only the bounding box — O(segment_area) not O(canvas_area).
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  _randomLine(sw, sh, diag) {
    const sx1   = Math.random() * sw;
    const sy1   = Math.random() * sh;
    const len   = diag * (0.02 + Math.random() * (this.maxLenFrac - 0.02));
    const angle = Math.random() * Math.PI * 2;
    return {
      sx1, sy1,
      sx2: Math.max(0, Math.min(sw, sx1 + Math.cos(angle) * len)),
      sy2: Math.max(0, Math.min(sh, sy1 + Math.sin(angle) * len)),
    };
  }

  _downscaleTarget(src, sw, sh) {
    const tmp = new OffscreenCanvas(src.width, src.height);
    tmp.getContext('2d').putImageData(src, 0, 0);
    const small = new OffscreenCanvas(sw, sh);
    small.getContext('2d').drawImage(tmp, 0, 0, sw, sh);
    const data = small.getContext('2d').getImageData(0, 0, sw, sh).data;
    const gs   = new Uint8Array(sw * sh);
    for (let i = 0; i < gs.length; i++) gs[i] = data[i * 4];
    return gs;
  }
}
