import { OptBase }     from './OptBase.js';
import { PortTypes }   from '../types/PortTypes.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptWiggle — refines an existing VectorImage by wiggling interior polyline points.
 *
 * Takes a vector (e.g. from OptGreedyPoints) and a grayscale target image.
 * Each round picks a random interior point, tests `candidates` perturbed positions
 * within `wiggleRadius` of the current position, and commits the best move if it
 * reduces the blur-MAE score.
 *
 * Scoring uses the same local blur-MAE approach as OptGreedySequential/Points:
 *   - `base` = full render of all segments except the two touching the chosen point
 *   - For each candidate: copy base locally, draw two new segments, reblur, compare
 *     against the current blur state (`currentBlur`) which serves as the baseline
 *   - Improvement = Σ(|currentBlur - target| - |workBlur - target|) in scoring region
 */
export class OptWiggle extends OptBase {
  constructor(id) {
    super(id);

    // Override I/O: takes both a vector and a grayscale target
    this.inputSchema  = { vector: PortTypes.VECTORIMAGE, image: PortTypes.GS_RASTERIMAGE };
    this.outputSchema = { vector: PortTypes.VECTORIMAGE };
    this.inputs       = { vector: null, image: null };
    this.outputs      = { vector: null };

    this.rounds        = 2000;
    this.candidates    = 100;
    this.wiggleRadius  = 0.05;  // max displacement as fraction of diagonal
    this.penWidthPx    = 2;
    this.lineOpacity   = 1.0;
    this.blurRadius    = 8;
    this.scoreScale    = 0.5;

    this.paramDefs = [
      { label: 'Rounds',            key: 'rounds',       min: 100,  max: 20000, step: 100  },
      { label: 'Candidates/wiggle', key: 'candidates',   min: 10,   max: 500,   step: 10   },
      { label: 'Wiggle radius (%)', key: 'wiggleRadius', min: 0.01, max: 0.5,   step: 0.01 },
      { label: 'Pen width (px)',    key: 'penWidthPx',   min: 0.5,  max: 20,    step: 0.5  },
      { label: 'Line opacity',      key: 'lineOpacity',  min: 0.05, max: 1,     step: 0.05 },
      { label: 'Blur radius (px)',  key: 'blurRadius',   min: 0,    max: 50,    step: 1    },
      { label: 'Score scale',       key: 'scoreScale',   min: 0.1,  max: 1,     step: 0.05 },
    ];

    this._pixelBuf   = null;
    this._pixelCount = 0;
  }

  async run() {
    const vec = this.inputs.vector;
    const src = this.inputs.image;
    if (!vec || !src) return;

    const W = src.width, H = src.height;
    const ss    = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw    = Math.max(1, Math.round(W * ss));
    const sh    = Math.max(1, Math.round(H * ss));
    const scX   = sw / W, scY = sh / H;
    const N     = sw * sh;
    const penW  = Math.max(0.5, this.penWidthPx * ss);
    const blurR = Math.max(0, Math.round(this.blurRadius * ss));
    const diagS = Math.sqrt(sw * sw + sh * sh);
    const wigR  = diagS * Math.max(0.005, this.wiggleRadius);
    const opacity = Math.max(0.05, Math.min(1, this.lineOpacity));
    const K     = Math.max(1, this.candidates);

    this._pixelBuf = new Int32Array(N);

    // ── Mutable score-space copy of all polylines ─────────────────────────────
    // Each line: { pts: [{sx,sy}...], style }
    const lines = vec.lines.map(l => ({
      pts:   l.points.map(p => ({ sx: p.x * scX, sy: p.y * scY })),
      style: l.style,
    }));

    // Collect all wiggleable interior points: {li, pi}
    const wiggleable = [];
    for (let li = 0; li < lines.length; li++) {
      for (let pi = 1; pi < lines[li].pts.length - 1; pi++) {
        wiggleable.push({ li, pi });
      }
    }

    if (wiggleable.length === 0) {
      // Nothing to wiggle — pass through unchanged
      this._setOutput('vector', vec);
      return;
    }

    // ── Buffers ───────────────────────────────────────────────────────────────
    const target      = this._downscaleTarget(src, sw, sh);
    const current     = new Uint8Array(N).fill(255);
    const currentBlur = new Uint8Array(N).fill(255);
    const base        = new Uint8Array(N).fill(255);  // render without the two old segments
    const work        = new Uint8Array(N);             // scratch for candidate testing
    const workBlur    = new Uint8Array(N);
    const blurTmp     = new Float32Array(N);

    // ── Initial render from input vector ──────────────────────────────────────
    for (const line of lines) {
      for (let s = 0; s < line.pts.length - 1; s++) {
        this._applyLine(current,
          line.pts[s].sx,   line.pts[s].sy,
          line.pts[s+1].sx, line.pts[s+1].sy,
          penW, sw, sh, opacity);
      }
    }
    const initBlurred = this._blurBuffer(current, sw, sh, blurR);
    currentBlur.set(initBlurred);

    // ── Geometry helpers ──────────────────────────────────────────────────────
    const lineBBox = (x1, y1, x2, y2, r) => ({
      minX: Math.max(0,      Math.floor(Math.min(x1, x2) - r)),
      maxX: Math.min(sw - 1, Math.ceil( Math.max(x1, x2) + r)),
      minY: Math.max(0,      Math.floor(Math.min(y1, y2) - r)),
      maxY: Math.min(sh - 1, Math.ceil( Math.max(y1, y2) + r)),
    });

    const unionBBox = (a, b) => ({
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
      minY: Math.min(a.minY, b.minY),
      maxY: Math.max(a.maxY, b.maxY),
    });

    const expandBBox = (b, r) => ({
      minX: Math.max(0,      b.minX - r),
      maxX: Math.min(sw - 1, b.maxX + r),
      minY: Math.max(0,      b.minY - r),
      maxY: Math.min(sh - 1, b.maxY + r),
    });

    const bboxOverlaps = (a, b) =>
      a.minX <= b.maxX && a.maxX >= b.minX &&
      a.minY <= b.maxY && a.maxY >= b.minY;

    // Separable box blur of `src` → `dst` in `bbox`, using `tmp` for H-pass.
    // Only pixels in expandBBox(bbox, blurR) are written to dst.
    // src must be valid in expandBBox(bbox, 2*blurR) for exact results.
    const reblurBuf = (src, dst, tmp, bbox) => {
      const bx0 = Math.max(0,      bbox.minX - blurR), bx1 = Math.min(sw - 1, bbox.maxX + blurR);
      const by0 = Math.max(0,      bbox.minY - blurR), by1 = Math.min(sh - 1, bbox.maxY + blurR);
      const hy0 = Math.max(0,      by0 - blurR),       hy1 = Math.min(sh - 1, by1 + blurR);
      for (let y = hy0; y <= hy1; y++) {
        const base = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const x0 = Math.max(0, x - blurR), x1 = Math.min(sw - 1, x + blurR);
          let sum = 0;
          for (let k = x0; k <= x1; k++) sum += src[base + k];
          tmp[base + x] = sum / (x1 - x0 + 1);
        }
      }
      for (let x = bx0; x <= bx1; x++) {
        for (let y = by0; y <= by1; y++) {
          const y0 = Math.max(0, y - blurR), y1 = Math.min(sh - 1, y + blurR);
          let sum = 0;
          for (let k = y0; k <= y1; k++) sum += tmp[k * sw + x];
          dst[y * sw + x] = Math.round(sum / (y1 - y0 + 1));
        }
      }
    };

    // Score improvement: Σ(|currentBlur - target| - |workBlur - target|) in scoringBbox.
    // Positive = workBlur is better than currentBlur.
    const scoreImprovement = (afterBlur, scoringBbox) => {
      const bx0 = Math.max(0,      scoringBbox.minX - blurR);
      const bx1 = Math.min(sw - 1, scoringBbox.maxX + blurR);
      const by0 = Math.max(0,      scoringBbox.minY - blurR);
      const by1 = Math.min(sh - 1, scoringBbox.maxY + blurR);
      let imp = 0;
      for (let y = by0; y <= by1; y++) {
        const row = y * sw;
        for (let x = bx0; x <= bx1; x++) {
          const i = row + x;
          const t = target[i];
          const dB = currentBlur[i] - t;
          const dA = afterBlur[i] - t;
          imp += (dB > 0 ? dB : -dB) - (dA > 0 ? dA : -dA);
        }
      }
      return imp;
    };

    // ── Main loop ─────────────────────────────────────────────────────────────
    for (let round = 0; round < this.rounds; round++) {
      const { li, pi } = wiggleable[Math.floor(Math.random() * wiggleable.length)];
      const pts  = lines[li].pts;
      const prev = pts[pi - 1], cur = pts[pi], next = pts[pi + 1];

      // Old segment bounding boxes
      const oldB1   = lineBBox(prev.sx, prev.sy, cur.sx, cur.sy, penW);
      const oldB2   = lineBBox(cur.sx, cur.sy, next.sx, next.sy, penW);
      const oldBbox = unionBBox(oldB1, oldB2);

      // ── Render base: all segments except the two touching pts[pi] ────────────
      base.fill(255);
      for (let l = 0; l < lines.length; l++) {
        const lpts = lines[l].pts;
        for (let s = 0; s < lpts.length - 1; s++) {
          if (l === li && (s === pi - 1 || s === pi)) continue;
          this._applyLine(base,
            lpts[s].sx, lpts[s].sy, lpts[s + 1].sx, lpts[s + 1].sy,
            penW, sw, sh, opacity);
        }
      }

      // ── Evaluate candidates ───────────────────────────────────────────────────
      let bestImp = 0, bestCX = cur.sx, bestCY = cur.sy;

      for (let c = 0; c < K; c++) {
        const angle = Math.random() * 2 * Math.PI;
        const dist  = Math.random() * wigR;
        const cx = Math.max(0, Math.min(sw - 1, cur.sx + Math.cos(angle) * dist));
        const cy = Math.max(0, Math.min(sh - 1, cur.sy + Math.sin(angle) * dist));

        const newB1   = lineBBox(prev.sx, prev.sy, cx, cy, penW);
        const newB2   = lineBBox(cx, cy, next.sx, next.sy, penW);
        const newBbox = unionBBox(newB1, newB2);

        // Region where `base` must be copied so both new segs and their blur halos are covered.
        // +2*blurR extra to give reblurBuf's H-pass enough valid pixels to read.
        const copyRegion = expandBBox(unionBBox(oldBbox, newBbox), 2 * blurR);

        for (let y = copyRegion.minY; y <= copyRegion.maxY; y++) {
          const row = y * sw;
          for (let x = copyRegion.minX; x <= copyRegion.maxX; x++) work[row + x] = base[row + x];
        }

        this._applyLine(work, prev.sx, prev.sy, cx, cy, penW, sw, sh, opacity);
        this._applyLine(work, cx, cy, next.sx, next.sy, penW, sw, sh, opacity);

        reblurBuf(work, workBlur, blurTmp, newBbox);

        const imp = scoreImprovement(workBlur, newBbox);
        if (imp > bestImp) { bestImp = imp; bestCX = cx; bestCY = cy; }
      }

      // ── Commit best move ──────────────────────────────────────────────────────
      if (bestImp > 0) {
        pts[pi] = { sx: bestCX, sy: bestCY };

        const newB1   = lineBBox(prev.sx, prev.sy, bestCX, bestCY, penW);
        const newB2   = lineBBox(bestCX, bestCY, next.sx, next.sy, penW);
        const allBbox = unionBBox(oldBbox, unionBBox(newB1, newB2));

        // Patch `current` from base + new segs, wide enough for reblurBuf's H-pass
        const patchRegion = expandBBox(allBbox, 2 * blurR);
        for (let y = patchRegion.minY; y <= patchRegion.maxY; y++) {
          const row = y * sw;
          for (let x = patchRegion.minX; x <= patchRegion.maxX; x++) current[row + x] = base[row + x];
        }
        this._applyLine(current, prev.sx, prev.sy, bestCX, bestCY, penW, sw, sh, opacity);
        this._applyLine(current, bestCX, bestCY, next.sx, next.sy, penW, sw, sh, opacity);

        reblurBuf(current, currentBlur, blurTmp, allBbox);
      }

      if (round % 20 === 0) {
        this.onProgress?.(round / this.rounds, this._bufferMAE(currentBlur, target, N));
        this.onPreview?.(current.slice(), sw, sh);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, this._bufferMAE(currentBlur, target, N));
    this.onPreview?.(current.slice(), sw, sh);

    // ── Build output VectorImage ──────────────────────────────────────────────
    const outVec = new VectorImage(W, H);
    for (const line of lines) {
      outVec.addLine(
        line.pts.map(p => ({ x: p.sx / scX, y: p.sy / scY })),
        line.style,
      );
    }

    if (src._widthCm)  outVec._widthCm  = src._widthCm;
    if (src._heightCm) outVec._heightCm = src._heightCm;
    this._setOutput('vector', outVec);
  }

  // ── Utilities (same as OptGreedyPoints) ──────────────────────────────────

  _bufferMAE(a, b, N) {
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const d = a[i] - b[i];
      sum += d > 0 ? d : -d;
    }
    return sum / N;
  }

  _applyLine(buf, x1, y1, x2, y2, r, W, H, opacity) {
    this._fillPixelBuf(x1, y1, x2, y2, r, W, H);
    const pixBuf = this._pixelBuf, n = this._pixelCount, mul = 1 - opacity;
    for (let k = 0; k < n; k++) buf[pixBuf[k]] = Math.round(buf[pixBuf[k]] * mul);
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
