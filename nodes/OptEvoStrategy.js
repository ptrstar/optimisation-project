import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptEvoStrategy — Evolutionary Strategy optimisation (gs_rasterimage → vectorimage).
 *
 * Shares OptGenetic's representation (a fixed set of `lineCount` lines, i.e. a
 * point in ℝ^(4·lineCount)) and its scorer (full re-raster MAE at scoreScale),
 * so an ES-vs-GA comparison at a matched evaluation budget isolates the
 * difference in *search dynamics*:
 *
 *   GA  — drives search with crossover over a {coordinate} genome + small
 *         fixed-amplitude mutation.
 *   ES  — drives search with Gaussian mutation whose step size σ is itself
 *         evolved (self-adaptation): σ' = σ·exp(τ·N(0,1)), then each coordinate
 *         is perturbed by σ'·N(0,1). σ travels with the individual through
 *         selection, so the population auto-tunes its own step size — large
 *         while exploring, shrinking as it converges.
 *
 * Selection (toggle via `plusSelection`):
 *   (μ + λ)  elitist — select the μ best from parents ∪ offspring. Best never
 *            lost ⇒ monotone best-fitness curve. (default)
 *   (μ , λ)  non-elitist — select the μ best from offspring only; parents die
 *            each generation. Requires λ ≥ μ (clamped if not). Pairs with the
 *            GA-with/without-elitism story.
 *
 * Recombination (toggle via `recombine`): when on, each offspring is formed
 * from ρ = 2 random parents by discrete recombination of the line coordinates
 * and intermediate (average) recombination of σ, then mutated. When off, an
 * offspring is a mutated copy of one random parent (mutation-only ES).
 *
 * Unlike the GA, the genome here is real-valued, so no 0/1 ↔ ±1 bit mapping is
 * needed — mutation acts directly on the endpoint coordinates.
 */
export class OptEvoStrategy extends OptBase {
  constructor(id) {
    super(id);

    this.generations   = 200;
    this.mu            = 10;    // number of parents
    this.lambda        = 50;    // number of offspring per generation
    this.lineCount     = 100;
    this.penWidthPx    = 2;
    this.sigmaInit     = 20;    // initial mutation step size (full-res px)
    this.plusSelection = 1;     // 1 = (μ+λ) elitist, 0 = (μ,λ)
    this.recombine     = 1;     // 1 = recombine 2 parents, 0 = mutation-only
    this.scoreScale    = 0.5;
    this.minLenFrac    = 0.05;  // match OptGenetic's 5%–40% diagonal range
    // maxLenFrac = 0.4, lineOpacity = 1.0 — inherited OptBase defaults

    this.paramDefs = [
      { label: 'Generations',     key: 'generations',   min: 10,  max: 2000, step: 10  },
      { label: 'Parents μ',       key: 'mu',            min: 1,   max: 100,  step: 1   },
      { label: 'Offspring λ',     key: 'lambda',        min: 1,   max: 500,  step: 1   },
      { label: 'Line count',      key: 'lineCount',     min: 10,  max: 500,  step: 10  },
      { label: 'Pen width (px)',  key: 'penWidthPx',    min: 0.5, max: 20,   step: 0.5 },
      { label: 'Sigma init (px)', key: 'sigmaInit',     min: 0.5, max: 200,  step: 0.5 },
      { label: 'Plus sel (0/1)',  key: 'plusSelection', min: 0,   max: 1,    step: 1   },
      { label: 'Recombine (0/1)', key: 'recombine',     min: 0,   max: 1,    step: 1   },
      { label: 'Score scale',     key: 'scoreScale',    min: 0.1, max: 1,    step: 0.05},
    ];
  }

  // Standard normal sample via Box–Muller.
  _gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W    = src.width, H = src.height;
    const diag = Math.sqrt(W * W + H * H);

    // ── Scoring setup (identical to OptGenetic) ───────────────────────────────
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

    // ── Config ────────────────────────────────────────────────────────────────
    const lc        = this.lineCount;
    const mu        = Math.max(1, Math.floor(this.mu));
    let   lambda    = Math.max(1, Math.floor(this.lambda));
    const plus      = this.plusSelection >= 1;
    const recombine = this.recombine >= 1;
    if (!plus && lambda < mu) lambda = mu;   // (μ,λ) needs λ ≥ μ

    const n   = 4 * lc;               // number of object variables
    const tau = 1 / Math.sqrt(2 * n); // global self-adaptation learning rate

    // Deep-copy line coords (shared immutable style ref — same trick as OptGenetic).
    const cloneLines = (lines) => lines.map(l => ({
      points: [{ ...l.points[0] }, { ...l.points[1] }],
      style:  l.style,
    }));

    const randomInd = () => {
      const lines = new Array(lc);
      for (let i = 0; i < lc; i++) {
        const { points, style } = this._randomLine(W, H, diag);
        lines[i] = { points, style };
      }
      return { lines, sigma: this.sigmaInit, fit: 0 };
    };

    // ── Initialise μ parents ──────────────────────────────────────────────────
    let parents = new Array(mu);
    for (let i = 0; i < mu; i++) {
      const ind = randomInd();
      ind.fit   = evalScore(ind.lines);
      parents[i] = ind;
    }
    let evals = mu;

    this._resetTrace();
    const sampleTrace = (gen) => {
      let best = Infinity, sumFit = 0, sumSig = 0;
      for (const p of parents) {
        if (p.fit < best) best = p.fit;
        sumFit += p.fit;
        sumSig += p.sigma;
      }
      this._recordTrace(evals, best, {
        gen,
        mean:  sumFit / parents.length,
        sigma: sumSig / parents.length,
      });
    };

    const previewVec = new VectorImage(W, H);
    const showBest = () => {
      previewVec.lines = parents[0].lines;
      this.onPreview?.(this._rasterizeGS(previewVec), W, H);
    };

    // ── Evolution loop ──────────────────────────────────────────────────────
    for (let gen = 0; gen < this.generations; gen++) {
      const offspring = new Array(lambda);

      for (let k = 0; k < lambda; k++) {
        // --- Recombination ---
        let childLines, childSigma;
        if (recombine && mu >= 2) {
          const a = parents[Math.floor(Math.random() * mu)];
          const b = parents[Math.floor(Math.random() * mu)];
          childLines = new Array(lc);
          for (let i = 0; i < lc; i++) {                 // discrete on coords
            const l = (Math.random() < 0.5 ? a : b).lines[i];
            childLines[i] = { points: [{ ...l.points[0] }, { ...l.points[1] }], style: l.style };
          }
          childSigma = 0.5 * (a.sigma + b.sigma);         // intermediate on σ
        } else {
          const a    = parents[Math.floor(Math.random() * mu)];
          childLines = cloneLines(a.lines);
          childSigma = a.sigma;
        }

        // --- Self-adaptive mutation: evolve σ first, then mutate genes with it ---
        let sigma = childSigma * Math.exp(tau * this._gauss());
        sigma = Math.max(0.01, sigma);   // floor to stop σ collapsing to 0
        for (let i = 0; i < lc; i++) {
          const pts = childLines[i].points;
          pts[0] = {
            x: Math.max(0, Math.min(W, pts[0].x + sigma * this._gauss())),
            y: Math.max(0, Math.min(H, pts[0].y + sigma * this._gauss())),
          };
          pts[1] = {
            x: Math.max(0, Math.min(W, pts[1].x + sigma * this._gauss())),
            y: Math.max(0, Math.min(H, pts[1].y + sigma * this._gauss())),
          };
        }

        const child = { lines: childLines, sigma, fit: 0 };
        child.fit   = evalScore(child.lines);
        offspring[k] = child;
      }
      evals += lambda;

      // --- Selection: μ best from (parents ∪ offspring) or offspring only ---
      const pool = plus ? parents.concat(offspring) : offspring;
      pool.sort((x, y) => x.fit - y.fit);
      parents = pool.slice(0, mu);

      if (gen % 5 === 0) {
        sampleTrace(gen);
        this.onProgress?.(gen / this.generations, parents[0].fit);
        showBest();
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── Finalise ──────────────────────────────────────────────────────────────
    parents.sort((a, b) => a.fit - b.fit);
    const best = parents[0];

    sampleTrace(this.generations);
    this._dumpTraceCSV();

    this.onProgress?.(1, best.fit);

    const vector = new VectorImage(W, H);
    vector.lines = best.lines;
    this.onPreview?.(this._rasterizeGS(vector), W, H);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }
}