import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptStipple — Weighted Voronoi Stippling via Lloyd's relaxation.
 *
 * Approximates the target greyscale image with N filled circular dots.
 * Because each dot's effect is purely local, the optimisation converges fast
 * (typically 15–30 iterations) and produces clean, expressive stipple drawings.
 *
 * Algorithm
 * ─────────
 * 1. Downscale target to scoreScale resolution. Build darkness weights[].
 * 2. Importance-sample initial dot positions from the weight CDF so dots
 *    start in dark areas (halves iterations vs uniform random).
 * 3. Each Lloyd iteration:
 *    a. Voronoi assignment: assign each score-pixel to its nearest dot (brute-force
 *       NN — fast at low resolution; O(N × dotCount) per iteration).
 *    b. Weighted centroid: move each dot to the centre-of-mass of its Voronoi
 *       cell, weighted by pixel darkness. Dark pixels pull harder.
 *    c. Report average centroid displacement as the convergence metric.
 * 4. Build VectorImage: each dot → tiny horizontal segment rendered with
 *    lineCap:'round' by Rasterize → filled circle. Radius optionally scales
 *    with per-cell darkness (varyRadius).
 *
 * Performance (defaults: 300 dots, scoreScale 0.2, 20 iterations)
 * ────────────────────────────────────────────────────────────────
 *   400×400 input → 80×80 = 6,400 score pixels
 *   6,400 × 300 × 20 iterations ≈ 38M inner-loop ops → ~0.2 s
 */
export class OptStipple extends OptBase {
  constructor(id) {
    super(id);

    this.dotCount   = 300;
    this.iterations = 20;
    this.dotRadius  = 3;    // base dot radius in full-res pixels
    this.varyRadius = 0.5;  // 0 = uniform size, 1 = fully proportional to local darkness
    this.scoreScale = 0.2;  // Voronoi computation resolution

    this.paramDefs = [
      { label: 'Dot count',       key: 'dotCount',   min: 10,   max: 5000, step: 10   },
      { label: 'Iterations',      key: 'iterations', min: 1,    max: 100,  step: 1    },
      { label: 'Dot radius (px)', key: 'dotRadius',  min: 0.5,  max: 30,   step: 0.5  },
      { label: 'Vary radius',     key: 'varyRadius', min: 0,    max: 1,    step: 0.05 },
      { label: 'Score scale',     key: 'scoreScale', min: 0.05, max: 1,    step: 0.05 },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W = src.width, H = src.height;
    const ss  = Math.max(0.05, Math.min(1, this.scoreScale));
    const sw  = Math.max(1, Math.round(W * ss));
    const sh  = Math.max(1, Math.round(H * ss));
    const N   = sw * sh;
    const scX = sw / W, scY = sh / H;
    const DC  = this.dotCount;

    // ── Darkness weights (0 = white = no pull, 255 = black = full pull) ────────
    const target  = this._downscaleTarget(src, sw, sh);
    const weights = new Float32Array(N);
    let   totalW  = 0;
    for (let i = 0; i < N; i++) {
      weights[i] = 255 - target[i];
      totalW    += weights[i];
    }

    // ── Dot positions (score-space) ─────────────────────────────────────────────
    const dotX = new Float32Array(DC);
    const dotY = new Float32Array(DC);

    if (totalW > 0) {
      // Importance sampling via binary search on the CDF
      const cdf = new Float32Array(N);
      cdf[0] = weights[0];
      for (let i = 1; i < N; i++) cdf[i] = cdf[i - 1] + weights[i];

      for (let d = 0; d < DC; d++) {
        const r = Math.random() * totalW;
        let lo = 0, hi = N - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf[mid] < r) lo = mid + 1; else hi = mid;
        }
        // Sub-pixel jitter so two dots don't start at the exact same position
        dotX[d] = (lo % sw) + Math.random();
        dotY[d] = ((lo / sw) | 0) + Math.random();
      }
    } else {
      // All-white image — scatter uniformly
      for (let d = 0; d < DC; d++) {
        dotX[d] = Math.random() * sw;
        dotY[d] = Math.random() * sh;
      }
    }

    // ── Lloyd's relaxation ──────────────────────────────────────────────────────
    const assignment = new Int32Array(N);
    const sumX       = new Float64Array(DC);
    const sumY       = new Float64Array(DC);
    const sumW       = new Float64Array(DC);  // per-cell total weight (kept after last iter)

    for (let iter = 0; iter < this.iterations; iter++) {

      // 1. Voronoi assignment — brute-force NN
      for (let i = 0; i < N; i++) {
        const px = i % sw, py = (i / sw) | 0;
        let minD2 = Infinity, nearest = 0;
        for (let d = 0; d < DC; d++) {
          const dx = dotX[d] - px, dy = dotY[d] - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < minD2) { minD2 = d2; nearest = d; }
        }
        assignment[i] = nearest;
      }

      // 2. Weighted centroids
      sumX.fill(0); sumY.fill(0); sumW.fill(0);
      for (let i = 0; i < N; i++) {
        const w = weights[i];
        if (w <= 0) continue;
        const d  = assignment[i];
        const px = i % sw, py = (i / sw) | 0;
        sumX[d] += w * px;
        sumY[d] += w * py;
        sumW[d] += w;
      }

      // 3. Move dots + measure average displacement (convergence metric)
      let totalDisp = 0;
      for (let d = 0; d < DC; d++) {
        if (sumW[d] > 0) {
          const nx = sumX[d] / sumW[d];
          const ny = sumY[d] / sumW[d];
          const dx = nx - dotX[d], dy = ny - dotY[d];
          totalDisp += Math.sqrt(dx * dx + dy * dy);
          dotX[d] = nx;
          dotY[d] = ny;
        }
        // If sumW[d] == 0 the dot landed in pure-white space; leave it in place.
      }
      const avgDisp = totalDisp / DC;

      this.onProgress?.((iter + 1) / this.iterations, avgDisp);
      this.onPreview?.(this._dotsToPixels(dotX, dotY, DC, sw, sh), sw, sh);
      await new Promise(r => setTimeout(r, 0));
    }

    // ── Build VectorImage ───────────────────────────────────────────────────────
    // Each dot → tiny horizontal segment with lineCap:'round' → filled circle.
    const vector  = new VectorImage(W, H);
    const baseR   = this.dotRadius;
    const vary    = this.varyRadius;
    let   maxCellW = 0;
    for (let d = 0; d < DC; d++) if (sumW[d] > maxCellW) maxCellW = sumW[d];

    for (let d = 0; d < DC; d++) {
      const fx       = dotX[d] / scX;
      const fy       = dotY[d] / scY;
      const darkness = maxCellW > 0 ? sumW[d] / maxCellW : 1;
      const r        = baseR * (1 - vary + vary * darkness);
      const HALF     = Math.max(0.01, r * 0.05); // tiny segment → round cap = circle

      vector.addLine(
        [{ x: fx - HALF, y: fy }, { x: fx + HALF, y: fy }],
        { width: r * 2, opacity: 1, lineCap: 'round' },
      );
    }

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  // ── Preview helper ────────────────────────────────────────────────────────────
  // Rasterises dot positions directly into a Uint8Array for onPreview callbacks.
  // Uses the software circle rasterizer (bounding-box + distance check) from
  // the same family as OptGreedySequential's _fillPixelBuf.
  _dotsToPixels(dotX, dotY, DC, sw, sh) {
    const pixels = new Uint8Array(sw * sh).fill(255);
    const r      = Math.max(0.5, this.dotRadius * this.scoreScale);
    const r2     = r * r;

    for (let d = 0; d < DC; d++) {
      const cx   = dotX[d], cy = dotY[d];
      const minX = Math.max(0,      Math.floor(cx - r));
      const maxX = Math.min(sw - 1, Math.ceil(cx  + r));
      const minY = Math.max(0,      Math.floor(cy - r));
      const maxY = Math.min(sh - 1, Math.ceil(cy  + r));

      for (let y = minY; y <= maxY; y++) {
        const row = y * sw;
        for (let x = minX; x <= maxX; x++) {
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy <= r2) pixels[row + x] = 0;
        }
      }
    }
    return pixels;
  }
}
