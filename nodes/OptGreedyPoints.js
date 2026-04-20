import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGreedyPoints — grows a single continuous polyline through dark regions.
 *
 * Starts at the darkest of `initCandidates` random pixels. At each step,
 * samples `candidates` next-points within `stepRadius` of the tail, biased
 * toward the current travel direction. Scores each candidate segment using
 * the local blur-MAE approach (same as OptGreedySequential). Commits the
 * best candidate unless the `acceptanceProb` roll fires, in which case a
 * random candidate is chosen instead (escape from local optima).
 */
export class OptGreedyPoints extends OptBase {
  constructor(id) {
    super(id);

    this.maxPoints      = 500;
    this.candidates     = 200;
    this.stepRadius     = 0.05;   // max step length as fraction of diagonal
    this.penWidthPx     = 2;
    this.lineOpacity    = 1.0;
    this.blurRadius     = 8;
    this.scoreScale     = 0.5;
    this.directionBias  = 0.6;    // 0 = random walk, 1 = always forward
    this.acceptanceProb = 0.1;    // probability of picking a random candidate instead of best
    this.initCandidates = 20;

    this.paramDefs = [
      { label: 'Max points',       key: 'maxPoints',      min: 10,   max: 5000,  step: 10   },
      { label: 'Candidates/step',  key: 'candidates',     min: 10,   max: 1000,  step: 10   },
      { label: 'Step radius (%)',  key: 'stepRadius',     min: 0.01, max: 0.5,   step: 0.01 },
      { label: 'Pen width (px)',   key: 'penWidthPx',     min: 0.5,  max: 20,    step: 0.5  },
      { label: 'Line opacity',     key: 'lineOpacity',    min: 0.05, max: 1,     step: 0.05 },
      { label: 'Blur radius (px)', key: 'blurRadius',     min: 0,    max: 50,    step: 1    },
      { label: 'Score scale',      key: 'scoreScale',     min: 0.1,  max: 1,     step: 0.05 },
      { label: 'Direction bias',   key: 'directionBias',  min: 0,    max: 1,     step: 0.05 },
      { label: 'Acceptance prob',  key: 'acceptanceProb', min: 0,    max: 1,     step: 0.05 },
      { label: 'Init candidates',  key: 'initCandidates', min: 5,    max: 200,   step: 5    },
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
    const ss      = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw      = Math.max(1, Math.round(W * ss));
    const sh      = Math.max(1, Math.round(H * ss));
    const scX     = sw / W, scY = sh / H;
    const N       = sw * sh;
    const penW    = Math.max(0.5, this.penWidthPx * ss);
    const blurR   = Math.max(0, Math.round(this.blurRadius * ss));
    const diagS   = Math.sqrt(sw * sw + sh * sh);
    const stepR   = diagS * Math.max(0.005, this.stepRadius);
    const opacity = Math.max(0.05, Math.min(1, this.lineOpacity));
    const K       = Math.max(1, Math.floor(this.candidates));

    this._pixelBuf = new Int32Array(N);

    // Pre-allocate candidate arrays — no per-step heap allocation
    const candX     = new Float32Array(K);
    const candY     = new Float32Array(K);
    const candDelta = new Float32Array(K);

    // ── Buffers ───────────────────────────────────────────────────────────────
    const target      = this._downscaleTarget(src, sw, sh);
    const current     = new Uint8Array(N).fill(255);
    const currentBlur = new Uint8Array(N).fill(255);
    const scratch     = new Uint8Array(N);
    const scratchBlur = new Uint8Array(N);
    const blurTmp     = new Float32Array(N);

    // ── Region helpers ────────────────────────────────────────────────────────
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
          const x0 = Math.max(0, x - blurR), x1 = Math.min(sw - 1, x + blurR);
          let sum = 0;
          for (let k = x0; k <= x1; k++) sum += current[base + k];
          blurTmp[base + x] = sum / (x1 - x0 + 1);
        }
      }
      for (let x = bx0; x <= bx1; x++) {
        for (let y = by0; y <= by1; y++) {
          const y0 = Math.max(0, y - blurR), y1 = Math.min(sh - 1, y + blurR);
          let sum = 0;
          for (let k = y0; k <= y1; k++) sum += blurTmp[k * sw + x];
          currentBlur[y * sw + x] = Math.round(sum / (y1 - y0 + 1));
        }
      }
    };

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
      return delta;  // negative = improvement
    };

    // ── Find start: darkest of initCandidates random pixels ───────────────────
    let tailX = Math.floor(Math.random() * sw);
    let tailY = Math.floor(Math.random() * sh);
    let darkest = target[tailY * sw + tailX];
    for (let i = 1; i < this.initCandidates; i++) {
      const cx = Math.floor(Math.random() * sw);
      const cy = Math.floor(Math.random() * sh);
      const v  = target[cy * sw + cx];
      if (v < darkest) { darkest = v; tailX = cx; tailY = cy; }
    }

    const points = [{ x: tailX, y: tailY }];
    let dirAngle = Math.random() * Math.PI * 2;

    // Wall penalty scale: going D px outside incurs D² × wallK penalty.
    // Derived from blur patch area so it stays in the same ballpark as score deltas.
    const wallK = (2 * blurR + 2 * penW + 1) ** 2 * 0.5;

    // ── Grow polyline ─────────────────────────────────────────────────────────
    for (let step = 0; step < this.maxPoints - 1; step++) {
      const spread = (1 - this.directionBias) * Math.PI;

      // Evaluate all candidates, storing results in pre-allocated arrays
      let bestIdx = 0;
      let bestDelta = Infinity;

      for (let c = 0; c < K; c++) {
        const angle = dirAngle + (Math.random() - 0.5) * 2 * spread;
        const cosA  = Math.cos(angle);
        const sinA  = Math.sin(angle);
        const dist  = Math.random() * stepR;

        // Generate candidate freely at full stepR, then clamp to canvas.
        // Candidates heading inward pay zero penalty; candidates heading
        // outward are penalised proportionally to how far outside they land.
        // This keeps the line mobile near walls while discouraging escape.
        const cxRaw = tailX + cosA * dist;
        const cyRaw = tailY + sinA * dist;
        const cx    = Math.max(0, Math.min(sw - 1, cxRaw));
        const cy    = Math.max(0, Math.min(sh - 1, cyRaw));
        const ox    = cxRaw - cx, oy = cyRaw - cy;
        const wallPenalty = (ox * ox + oy * oy) * wallK;

        const bbox = lineBBox(tailX, tailY, cx, cy, penW);
        saveRegion(bbox);
        this._applyLine(current, tailX, tailY, cx, cy, penW, sw, sh, opacity);
        reblurLocal(bbox);
        const delta = scoreDelta(bbox) + wallPenalty;
        restoreRegion(bbox);

        candX[c] = cx;
        candY[c] = cy;
        candDelta[c] = delta;
        if (delta < bestDelta) { bestDelta = delta; bestIdx = c; }
      }

      // Accept best, or random candidate with probability acceptanceProb
      const idx = Math.random() < this.acceptanceProb
        ? Math.floor(Math.random() * K)
        : bestIdx;
      const chosenX = candX[idx];
      const chosenY = candY[idx];

      // Commit chosen segment permanently
      const bbox = lineBBox(tailX, tailY, chosenX, chosenY, penW);
      this._applyLine(current, tailX, tailY, chosenX, chosenY, penW, sw, sh, opacity);
      reblurLocal(bbox);

      // Update direction and advance tail
      const dx = chosenX - tailX, dy = chosenY - tailY;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) dirAngle = Math.atan2(dy, dx);

      points.push({ x: chosenX, y: chosenY });
      tailX = chosenX;
      tailY = chosenY;

      if (step % 20 === 0) {
        this.onProgress?.(step / (this.maxPoints - 1), this._bufferMAE(currentBlur, target, N));
        this.onPreview?.(current.slice(), sw, sh);
        this.onPreviewBlur?.(currentBlur.slice(), sw, sh);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── Build output VectorImage ───────────────────────────────────────────────
    const vector = new VectorImage(W, H);
    vector.addLine(
      points.map(p => ({ x: p.x / scX, y: p.y / scY })),
      { width: this.penWidthPx, opacity },
    );

    this.onProgress?.(1, this._bufferMAE(currentBlur, target, N));
    this.onPreview?.(current.slice(), sw, sh);
    this.onPreviewBlur?.(currentBlur.slice(), sw, sh);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  // ── Utilities (same as OptGreedySequential) ───────────────────────────────

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
    const buf = this._pixelBuf, n = this._pixelCount, mul = 1 - opacity;
    for (let k = 0; k < n; k++) current[buf[k]] = Math.round(current[buf[k]] * mul);
  }

  _fillPixelBuf(x1, y1, x2, y2, r, W, H) {
    const minX = Math.max(0,     Math.floor(Math.min(x1, x2) - r));
    const maxX = Math.min(W - 1, Math.ceil( Math.max(x1, x2) + r));
    const minY = Math.max(0,     Math.floor(Math.min(y1, y2) - r));
    const maxY = Math.min(H - 1, Math.ceil( Math.max(y1, y2) + r));
    const dx = x2 - x1, dy = y2 - y1, lenSq = dx * dx + dy * dy, r2 = r * r;
    const buf = this._pixelBuf;
    let count = 0;
    for (let y = minY; y <= maxY; y++) {
      const row = y * W;
      for (let x = minX; x <= maxX; x++) {
        let dist2;
        if (lenSq === 0) {
          const ex = x - x1, ey = y - y1;
          dist2 = ex * ex + ey * ey;
        } else {
          const t  = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lenSq));
          const ex = x1 + t * dx - x, ey = y1 + t * dy - y;
          dist2 = ex * ex + ey * ey;
        }
        if (dist2 <= r2) buf[count++] = row + x;
      }
    }
    this._pixelCount = count;
  }
}