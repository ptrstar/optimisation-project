import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGreedySequential — places one line at a time.
 *
 * For each new line, `candidates` random strokes are scored against the
 * current residual (error image). The one that most reduces the total MAE
 * is committed, the residual is updated, then the next line is chosen.
 *
 * This avoids the global-search trap of hill-climbing / GA: each line
 * independently adds the most value it can, so the algorithm never fights
 * against a random starting configuration.
 *
 * Scoring uses a pure-JS software rasterizer (distance-to-segment) on a
 * downscaled buffer — no per-candidate OffscreenCanvas reads.
 *
 * Efficiency notes:
 *   - Target and current state are flat Uint8Arrays at scoreScale resolution.
 *   - _pixelBuf is pre-allocated once and reused for every candidate eval.
 *   - Delta formula simplifies to: sum(|cur[i]-tgt[i]| - tgt[i]) over covered px.
 *     (because the line draws pure black: afterValue = 0, so errAfter = tgt[i])
 */
export class OptGreedySequential extends OptBase {
  constructor(id) {
    super(id);

    this.lineCount   = 150;
    this.candidates  = 400;   // random strokes evaluated per line
    this.penWidthPx  = 2;
    this.scoreScale  = 0.5;   // resolution for candidate scoring (0.1–1.0)
    this.maxLenFrac  = 0.4;   // max stroke length as fraction of diagonal

    this.paramDefs = [
      { label: 'Lines',           key: 'lineCount',  min: 10,  max: 1000, step: 10   },
      { label: 'Candidates/line', key: 'candidates', min: 50,  max: 2000, step: 50   },
      { label: 'Pen width (px)',  key: 'penWidthPx', min: 0.5, max: 20,   step: 0.5  },
      { label: 'Score scale',     key: 'scoreScale', min: 0.1, max: 1,    step: 0.05 },
      { label: 'Max len (diag%)', key: 'maxLenFrac', min: 0.02,max: 1,    step: 0.02 },
    ];

    this._pixelBuf   = null;  // pre-allocated scratch buffer for pixel indices
    this._pixelCount = 0;
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W = src.width, H = src.height;
    const ss  = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw  = Math.max(1, Math.round(W * ss));
    const sh  = Math.max(1, Math.round(H * ss));
    const scX = sw / W, scY = sh / H;
    const N   = sw * sh;
    const penW = Math.max(0.5, this.penWidthPx * ss);   // pen radius at score scale
    const diag = Math.sqrt(sw * sw + sh * sh);

    // Pre-allocate pixel scratch buffer (worst case: whole canvas)
    this._pixelBuf = new Int32Array(N);

    // Target grayscale at score resolution (0=black, 255=white)
    const target  = this._downscaleTarget(src, sw, sh);
    // Current rendered state — starts all white
    const current = new Uint8Array(N).fill(255);

    const vector = new VectorImage(W, H);

    for (let lineIdx = 0; lineIdx < this.lineCount; lineIdx++) {
      let bestDelta = 0;       // only accept lines that improve the score
      let bestSx1 = 0, bestSy1 = 0, bestSx2 = 0, bestSy2 = 0;
      let found = false;

      for (let c = 0; c < this.candidates; c++) {
        const { sx1, sy1, sx2, sy2 } = this._randomLine(sw, sh, diag);
        const delta = this._evalDelta(current, target, sx1, sy1, sx2, sy2, penW, sw, sh);
        if (delta > bestDelta) {
          bestDelta = delta;
          bestSx1 = sx1; bestSy1 = sy1;
          bestSx2 = sx2; bestSy2 = sy2;
          found = true;
        }
      }

      if (found) {
        this._applyLine(current, bestSx1, bestSy1, bestSx2, bestSy2, penW, sw, sh);
        vector.addLine(
          [
            { x: bestSx1 / scX, y: bestSy1 / scY },
            { x: bestSx2 / scX, y: bestSy2 / scY },
          ],
          { width: this.penWidthPx, opacity: 1 },
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

  // MAE between current buffer and target
  _bufferMAE(current, target, N) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const d = current[i] - target[i];
      sum += d > 0 ? d : -d;
    }
    return sum / N;
  }

  // How much total MAE would decrease if this line were committed.
  // Lines draw pure black (value=0), so errAfter = target[i] for every covered pixel.
  // delta per pixel = |cur[i]-tgt[i]| - tgt[i]
  // Returns positive = improvement.
  _evalDelta(current, target, x1, y1, x2, y2, r, W, H) {
    this._fillPixelBuf(x1, y1, x2, y2, r, W, H);
    let delta = 0;
    const buf = this._pixelBuf;
    const n   = this._pixelCount;
    for (let k = 0; k < n; k++) {
      const i   = buf[k];
      const cur = current[i];
      const tgt = target[i];
      const errBefore = cur > tgt ? cur - tgt : tgt - cur;
      // errAfter = |0 - tgt| = tgt
      delta += errBefore - tgt;
    }
    return delta;
  }

  // Darken covered pixels to 0 (black line, no un-darkening)
  _applyLine(current, x1, y1, x2, y2, r, W, H) {
    this._fillPixelBuf(x1, y1, x2, y2, r, W, H);
    const buf = this._pixelBuf;
    const n   = this._pixelCount;
    for (let k = 0; k < n; k++) current[buf[k]] = 0;
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
