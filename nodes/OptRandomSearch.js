import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptRandomSearch — Random Search baseline (gs_rasterimage → vectorimage).
 *
 * The reference floor for the whole comparison (the analogue of a Monte-Carlo
 * baseline). Each iteration draws a *complete* random configuration of
 * `lineCount` lines, scores it, and keeps the best ever seen. There is no
 * memory of structure and no local move — it is blind sampling. Any algorithm
 * worth its complexity must beat this; the gap between Random Search and
 * SA/GA/ES at a matched evaluation budget is precisely the value those methods
 * add.
 *
 * Fairness:
 *   - Same genome as OptHillClimb / OptSimAnneal (a point in ℝ^(4·lineCount)),
 *     sampled from the same line-shape prior via OptBase._randomLine().
 *   - Identical scorer (full re-raster MAE at scoreScale) to all other opt nodes.
 *   - One fitness evaluation per sample, so its convergence trace shares the
 *     cumulative-evaluations x-axis with the others and overlays directly.
 *
 * The best-so-far curve is monotone non-increasing and characteristically
 * improves fast at first, then plateaus far above what the directed searches
 * reach — which is exactly the picture that makes the baseline useful.
 */
export class OptRandomSearch extends OptBase {
  constructor(id) {
    super(id);

    this.rounds     = 2000;   // number of random samples (matches OptHillClimb's budget)
    this.lineCount  = 200;
    this.penWidthPx = 2;
    this.scoreScale = 0.5;
    // minLenFrac / maxLenFrac / lineOpacity inherited from OptBase defaults —
    // the same line-shape prior the other nodes initialise from.

    this.paramDefs = [
      { label: 'Rounds',         key: 'rounds',     min: 10,  max: 50000, step: 10  },
      { label: 'Line count',     key: 'lineCount',  min: 10,  max: 1000,  step: 10  },
      { label: 'Pen width (px)', key: 'penWidthPx', min: 0.5, max: 20,    step: 0.5 },
      { label: 'Score scale',    key: 'scoreScale', min: 0.1, max: 1,     step: 0.05},
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W    = src.width, H = src.height;
    const diag = Math.sqrt(W * W + H * H);

    // ── Scoring setup (identical to OptHillClimb / OptGenetic) ────────────────
    const ss     = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw     = Math.max(1, Math.round(W * ss));
    const sh     = Math.max(1, Math.round(H * ss));
    const scX    = sw / W, scY = sh / H;
    const scoreN = sw * sh;

    const targetGS = this._downscaleTarget(src, sw, sh);

    const sCanvas = new OffscreenCanvas(sw, sh);
    const sCtx    = sCanvas.getContext('2d');
    sCtx.strokeStyle = '#000000';
    sCtx.lineCap     = 'round';

    const evalScore = (lines) => {
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, sw, sh);
      for (const { points: [p0, p1], style } of lines) {
        sCtx.lineWidth   = (style.width   ?? 1) * scX;
        sCtx.globalAlpha = style.opacity  ?? 1;
        sCtx.beginPath();
        sCtx.moveTo(p0.x * scX, p0.y * scY);
        sCtx.lineTo(p1.x * scX, p1.y * scY);
        sCtx.stroke();
      }
      sCtx.globalAlpha = 1;
      const px = sCtx.getImageData(0, 0, sw, sh).data;
      let sum = 0;
      for (let i = 0, j = 0; i < scoreN; i++, j += 4) {
        const d = px[j] - targetGS[i];
        sum += d > 0 ? d : -d;
      }
      return sum / scoreN;
    };

    const lc = this.lineCount;

    // A complete random configuration of `lineCount` lines (one search point).
    const makeRandomConfig = () => {
      const lines = new Array(lc);
      for (let i = 0; i < lc; i++) {
        const { points, style } = this._randomLine(W, H, diag);
        lines[i] = { points, style };
      }
      return lines;
    };

    // ── Sample-and-keep-best ──────────────────────────────────────────────────
    // Each candidate is a fresh array we never mutate, so the winner can be kept
    // by reference — no cloning needed.
    let bestLines = makeRandomConfig();
    let bestScore = evalScore(bestLines);
    let evals     = 1;

    this._resetTrace();

    const previewVec = new VectorImage(W, H);
    const showBest = () => {
      previewVec.lines = bestLines;
      this.onPreview?.(this._rasterizeGS(previewVec), W, H);
    };

    for (let i = 0; i < this.rounds; i++) {
      const cand = makeRandomConfig();
      const s    = evalScore(cand);
      evals++;
      if (s < bestScore) { bestScore = s; bestLines = cand; }

      if (i % 20 === 0) {
        // `current` is this sample's score (the noisy sampling floor);
        // `best` is the kept envelope.
        this._recordTrace(evals, bestScore, { current: s });
        this.onProgress?.(i / this.rounds, bestScore);
        if (i % 100 === 0) showBest();
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this._recordTrace(evals, bestScore, { current: bestScore });
    this._dumpTraceCSV();

    this.onProgress?.(1, bestScore);

    const vector = new VectorImage(W, H);
    vector.lines = bestLines;
    this.onPreview?.(this._rasterizeGS(vector), W, H);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }
}