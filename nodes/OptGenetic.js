import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGenetic — genetic algorithm optimisation (gs_rasterimage → vectorimage).
 *
 * Efficiency notes:
 *   - One OffscreenCanvas is allocated per run() and reused every score call.
 *   - Scoring happens at `scoreScale` resolution (default 0.5 = 4× fewer pixels).
 *   - Target image is downscaled + R-channel extracted into a flat Uint8Array once.
 *   - Crossover builds child.lines directly without VectorImage.clone().
 *   - Style objects are immutable (positions only change), so they are shared by ref.
 *   - Fitness is stored in Float32Array (no boxing).
 *   - MAE inner loop uses a manual abs (sign branch) to avoid Math.abs call overhead.
 */
export class OptGenetic extends OptBase {
  constructor(id) {
    super(id);

    this.generations  = 200;
    this.popSize      = 30;
    this.lineCount    = 100;
    this.penWidthPx   = 2;
    this.mutationRate = 0.05;
    this.mutationAmp  = 20;
    this.eliteCount   = 2;
    this.tournamentK  = 3;
    this.scoreScale   = 0.5;
    this.minLenFrac   = 0.05;  // preserve original 5%–40% diagonal range
    // maxLenFrac = 0.4, lineOpacity = 1.0 — inherited OptBase defaults

    this.paramDefs = [
      { label: 'Generations',    key: 'generations',  min: 10,   max: 2000, step: 10 },
      { label: 'Population',     key: 'popSize',      min: 4,    max: 100,  step: 2 },
      { label: 'Line count',     key: 'lineCount',    min: 10,   max: 500,  step: 10 },
      { label: 'Pen width (px)', key: 'penWidthPx',   min: 0.5,  max: 20,   step: 0.5 },
      { label: 'Mut. rate',      key: 'mutationRate', min: 0.01, max: 1,    step: 0.01 },
      { label: 'Mut. amplitude', key: 'mutationAmp',  min: 1,    max: 200,  step: 1 },
      { label: 'Elite count',    key: 'eliteCount',   min: 0,    max: 10,   step: 1 },
      { label: 'Tournament K',   key: 'tournamentK',  min: 2,    max: 10,   step: 1 },
      { label: 'Score scale',    key: 'scoreScale',   min: 0.1,  max: 1,    step: 0.05 },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W = src.width, H = src.height;
    const diag = Math.sqrt(W * W + H * H);

    // ── Scoring setup ──────────────────────────────────────────────────────────
    // Downscale both the canvas and target for fast scoring.
    const ss  = Math.max(0.1, Math.min(1, this.scoreScale));
    const sw  = Math.max(1, Math.round(W * ss));
    const sh  = Math.max(1, Math.round(H * ss));
    const scX = sw / W;   // coordinate scale factors
    const scY = sh / H;
    const scoreN = sw * sh;

    // Downscale + extract target GS once
    const targetGS = this._downscaleTarget(src, sw, sh);

    // Allocate scoring canvas once per run; clear + redraw each eval
    const sCanvas = new OffscreenCanvas(sw, sh);
    const sCtx    = sCanvas.getContext('2d');
    sCtx.strokeStyle = '#000000';
    sCtx.lineCap     = 'round';

    // Inner scorer — closure captures all scoring state
    const evalScore = (ind) => {
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, sw, sh);
      for (const { points: [p0, p1], style } of ind.lines) {
        sCtx.lineWidth   = (style.width ?? 1) * scX;
        sCtx.globalAlpha = style.opacity ?? 1;
        sCtx.beginPath();
        sCtx.moveTo(p0.x * scX, p0.y * scY);
        sCtx.lineTo(p1.x * scX, p1.y * scY);
        sCtx.stroke();
      }
      sCtx.globalAlpha = 1;
      const px = sCtx.getImageData(0, 0, sw, sh).data;
      let sum = 0;
      // Manual abs on byte-range integers is marginally faster than Math.abs
      for (let i = 0, j = 0; i < scoreN; i++, j += 4) {
        const d = px[j] - targetGS[i];
        sum += d > 0 ? d : -d;
      }
      return sum / scoreN;
    };

    // ── Initialise population ──────────────────────────────────────────────────
    let pop  = Array.from({ length: this.popSize }, () => this._randomInd(W, H, diag));
    let fits = new Float32Array(this.popSize);
    for (let i = 0; i < this.popSize; i++) fits[i] = evalScore(pop[i]);
    let evals = this.popSize;
    this._resetTrace();

    // ── Main loop ──────────────────────────────────────────────────────────────
    const lc = this.lineCount;

    for (let gen = 0; gen < this.generations; gen++) {
      // Sort indices by ascending fitness (lower = better)
      const order = Array.from({ length: this.popSize }, (_, i) => i)
        .sort((a, b) => fits[a] - fits[b]);

      const elite = Math.min(this.eliteCount, this.popSize);
      const K     = Math.max(2, this.tournamentK);
      const mr    = this.mutationRate;
      const amp   = this.mutationAmp;

      const nextPop  = new Array(this.popSize);
      const nextFits = new Float32Array(this.popSize);

      // Carry elites unchanged (no re-scoring)
      for (let i = 0; i < elite; i++) {
        nextPop[i]  = pop[order[i]];
        nextFits[i] = fits[order[i]];
      }

      // Generate offspring
      for (let c = elite; c < this.popSize; c++) {
        // Tournament selection: two parents
        const pA = pop[this._tournament(fits, K)];
        const pB = pop[this._tournament(fits, K)];

        // Uniform crossover: each line independently from pA or pB
        // Build child.lines directly — no clone() overhead, share immutable style refs
        const child = new VectorImage(W, H);
        child.lines = new Array(lc);
        for (let i = 0; i < lc; i++) {
          const src = Math.random() < 0.5 ? pA : pB;
          const l   = src.lines[i];
          child.lines[i] = {
            points: [
              { x: l.points[0].x, y: l.points[0].y },
              { x: l.points[1].x, y: l.points[1].y },
            ],
            style: l.style,  // immutable — safe to share reference across individuals
          };
        }

        // Mutation
        for (let i = 0; i < lc; i++) {
          if (Math.random() < mr) {
            if (Math.random() < 0.2) {
              // Replace line entirely (20% of mutations) — maintains diversity
              const { points, style } = this._randomLine(W, H, diag);
              child.lines[i] = { points, style };
            } else {
              // Nudge endpoints (80% of mutations) — fine-grained local search
              const pts = child.lines[i].points;
              pts[0] = {
                x: Math.max(0, Math.min(W, pts[0].x + (Math.random() - 0.5) * 2 * amp)),
                y: Math.max(0, Math.min(H, pts[0].y + (Math.random() - 0.5) * 2 * amp)),
              };
              pts[1] = {
                x: Math.max(0, Math.min(W, pts[1].x + (Math.random() - 0.5) * 2 * amp)),
                y: Math.max(0, Math.min(H, pts[1].y + (Math.random() - 0.5) * 2 * amp)),
              };
            }
          }
        }

        nextPop[c]  = child;
        nextFits[c] = evalScore(child);
      }

      pop  = nextPop;
      fits = nextFits;

      evals += (this.popSize - elite);

      // Progress + preview every 5 generations
      if (gen % 5 === 0) {
        let bestIdx = 0;
        for (let i = 1; i < this.popSize; i++) if (fits[i] < fits[bestIdx]) bestIdx = i;
        this._recordTrace(evals, fits[bestIdx], { gen });
        this.onProgress?.(gen / this.generations, fits[bestIdx]);
        this.onPreview?.(this._rasterizeGS(pop[bestIdx]), W, H);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Final best
    let bestIdx = 0;
    for (let i = 1; i < this.popSize; i++) if (fits[i] < fits[bestIdx]) bestIdx = i;
    this._recordTrace(evals, fits[bestIdx], { gen: this.generations });
    this._dumpTraceCSV();
    this.onProgress?.(1, fits[bestIdx]);
    this.onPreview?.(this._rasterizeGS(pop[bestIdx]), W, H);

    const best = pop[bestIdx];
    if (src._widthCm)  best._widthCm  = src._widthCm;
    if (src._heightCm) best._heightCm = src._heightCm;
    this._setOutput('vector', best);
  }

  // ── Tournament selection ───────────────────────────────────────────────────
  // Samples k random indices, returns the one with lowest fitness.
  _tournament(fits, k) {
    let best = Math.floor(Math.random() * fits.length);
    for (let i = 1; i < k; i++) {
      const c = Math.floor(Math.random() * fits.length);
      if (fits[c] < fits[best]) best = c;
    }
    return best;
  }

  // ── Random individual ──────────────────────────────────────────────────────
  _randomInd(W, H, diag) {
    const ind = new VectorImage(W, H);
    for (let i = 0; i < this.lineCount; i++) {
      const { points, style } = this._randomLine(W, H, diag);
      ind.addLine(points, style);
    }
    return ind;
  }
}
