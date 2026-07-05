import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptSimAnneal — Simulated Annealing optimisation (gs_rasterimage → vectorimage).
 *
 * Deliberately a near-clone of OptHillClimb. The ONLY differences are:
 *   1. Acceptance rule:   hill-climb keeps a move iff it improves the score.
 *                         SA also keeps *worsening* moves with probability
 *                         exp(-ΔE / T), where T (temperature) starts high and
 *                         is cooled towards zero. High T ⇒ almost any move is
 *                         accepted (exploration); low T ⇒ only improvements are
 *                         accepted (exploitation, = hill-climb in the limit).
 *   2. Best-ever tracking: because SA may wander away from a good state, the
 *                         best solution seen is stored and returned at the end,
 *                         not whatever state the walk happens to finish in.
 *
 * The move proposal (perturb one random line's two endpoints by up to
 * maxAmplitude px) and the scoring (full re-raster MAE at scoreScale) are
 * identical to OptHillClimb, so a like-for-like comparison at the same
 * `rounds` budget isolates the effect of the acceptance rule alone.
 *
 * Cooling schedule: geometric interpolation T_i = T0 · (Tend/T0)^(i/rounds),
 * so the temperature reaches exactly `finalTemp` on the last iteration
 * regardless of how many rounds are run.
 */
export class OptSimAnneal extends OptBase {
  constructor(id) {
    super(id);

    this.rounds       = 8000;
    this.lineCount    = 200;
    this.penWidthPx   = 2;
    this.maxAmplitude = 15;     // identical move size to OptHillClimb
    this.initialTemp  = 2.0;    // T0 — used only if autoInitTemp is off
    this.finalTemp    = 0.01;   // Tend — cooled to here by the last round
    this.autoInitTemp = 1;      // 1 = estimate T0 from the data (recommended), 0 = use initialTemp
    this.scoreScale   = 0.5;
    this.maxAmplitude = 15;     // identical move size to OptHillClimb
    this.blurRadius   = 0;      // 0 = plain pixel MAE (original); >0 = blur-MAE objective
    // minLenFrac / maxLenFrac / lineOpacity inherited from OptBase defaults

    this.paramDefs = [
      { label: 'Rounds',          key: 'rounds',       min: 10,    max: 50000, step: 10    },
      { label: 'Line count',      key: 'lineCount',    min: 10,    max: 1000,  step: 10    },
      { label: 'Pen width (px)',  key: 'penWidthPx',   min: 0.5,   max: 20,    step: 0.5   },
      { label: 'Max amplitude',   key: 'maxAmplitude', min: 0.1,   max: 200,   step: 0.1   },
      { label: 'Blur radius (px)',key: 'blurRadius',   min: 0,     max: 50,    step: 1     },
      { label: 'Initial temp',    key: 'initialTemp',  min: 0.001, max: 20,    step: 0.01  },
      { label: 'Final temp',      key: 'finalTemp',    min: 0.0001,max: 5,     step: 0.001 },
      { label: 'Auto T0 (0/1)',   key: 'autoInitTemp', min: 0,     max: 1,     step: 1     },
      { label: 'Score scale',     key: 'scoreScale',   min: 0.1,   max: 1,     step: 0.05  },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W    = src.width, H = src.height;
    const diag = Math.sqrt(W * W + H * H);

    // ── Scoring setup (pre-allocated canvas at reduced resolution) ────────────
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

    /*// Identical scorer to OptHillClimb: MAE of the full render vs target.
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
    }; */
    // Optional blur-MAE objective. Blurring makes many thin strokes merge into a
    // tone that should match the target's local darkness, turning the spiky/flat
    // crisp-MAE landscape into a smooth, informative one — which is what local
    // search (SA) needs. blurRadius = 0 keeps the original plain-MAE behaviour
    // exactly (and pays zero extra cost). The target is blurred once up front.
    const blurR     = Math.max(0, Math.round(this.blurRadius));
    const targetCmp = blurR > 0 ? this._blurBuffer(targetGS, sw, sh, blurR) : targetGS;
    const rgBuf     = new Uint8Array(scoreN);   // reused render-grayscale buffer

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

      // Plain path: compare crisp render's R channel directly (no extra alloc).
      if (blurR === 0) {
        let sum = 0;
        for (let i = 0, j = 0; i < scoreN; i++, j += 4) {
          const d = px[j] - targetGS[i];
          sum += d > 0 ? d : -d;
        }
        return sum / scoreN;
      }

      // Blur path: extract R channel, box-blur it, compare to the blurred target.
      for (let i = 0, j = 0; i < scoreN; i++, j += 4) rgBuf[i] = px[j];
      const rendered = this._blurBuffer(rgBuf, sw, sh, blurR);
      let sum = 0;
      for (let i = 0; i < scoreN; i++) {
        const d = rendered[i] - targetCmp[i];
        sum += d > 0 ? d : -d;
      }
      return sum / scoreN;
    };

    // ── Initialise with random lines (identical to OptHillClimb) ──────────────
    const vector = new VectorImage(W, H);
    for (let i = 0; i < this.lineCount; i++) {
      const { points, style } = this._randomLine(W, H, diag);
      vector.addLine(points, style);
    }
    let currentScore = evalScore(vector.lines);
    this._resetTrace();

    // Snapshot of the best state ever visited (SA can drift, so we keep this).
    let bestScore = currentScore;
    let bestLines = vector.lines.map(l => ({
      points: [{ ...l.points[0] }, { ...l.points[1] }],
      style:  l.style,
    }));

    // Amplitude is annealed alongside temperature: large exploratory moves when
    // hot, fine adjustments when cold. `amp` is updated each iteration in the
    // loop below (see ampFor). maxAmplitude is the hot/initial amplitude in px.
    let amp = this.maxAmplitude;
    const minAmp = Math.max(0.5, this.maxAmplitude * 0.05);   // floor: 5% of hot, ≥0.5px
    const ampFor = (T) => {
      // Linear in the geometric cooling fraction: at T=T0 → maxAmplitude, at T=Tend → minAmp.
      // frac01 goes 1→0 as the run cools (since T0 ≥ T ≥ Tend, all > 0).
      const frac01 = (Math.log(T) - Math.log(Tend)) / (Math.log(T0) - Math.log(Tend) || 1);
      return minAmp + (this.maxAmplitude - minAmp) * Math.max(0, Math.min(1, frac01));
    };

    // Propose: perturb one random line; return an undo token. (Same as hill-climb.)
    const propose = () => {
      const idx   = Math.floor(Math.random() * vector.lines.length);
      const line  = vector.lines[idx];
      const p0old = { ...line.points[0] };
      const p1old = { ...line.points[1] };
      line.points[0] = {
        x: p0old.x + (Math.random() - 0.5) * amp,
        y: p0old.y + (Math.random() - 0.5) * amp,
      };
      line.points[1] = {
        x: p1old.x + (Math.random() - 0.5) * amp,
        y: p1old.y + (Math.random() - 0.5) * amp,
      };
      return { line, p0old, p1old };
    };
    const undo = ({ line, p0old, p1old }) => {
      line.points[0] = p0old;
      line.points[1] = p1old;
    };

    // ── Temperature schedule ──────────────────────────────────────────────────
    let   T0   = Math.max(1e-6, this.initialTemp);
    const Tend = Math.max(1e-6, this.finalTemp);

    // Optional auto-calibration of T0. The right temperature scale depends on the
    // image (ΔE is in MAE units and tiny), so guessing T0 is fragile. Instead we
    // sample some random moves from the start state, measure the average *uphill*
    // ΔE, and pick T0 so such a move is accepted with ~80% probability:
    //     exp(-avgUphill / T0) = 0.8  ⇒  T0 = avgUphill / ln(1/0.8).
    // These calibration evals are reverted (never committed) and are extra to
    // `rounds`, so they add a small fixed overhead to the runtime.
    if (this.autoInitTemp >= 1) {
      const samples = Math.min(200, Math.max(20, Math.floor(this.rounds / 10)));
      let sumUphill = 0, count = 0;
      for (let s = 0; s < samples; s++) {
        const mv   = propose();
        const cand = evalScore(vector.lines);
        const d    = cand - currentScore;
        if (d > 0) { sumUphill += d; count++; }
        undo(mv);
      }
      if (count > 0) {
        const avgUphill   = sumUphill / count;
        const targetAccept = 0.35;
        T0 = avgUphill / Math.log(1 / targetAccept);
      }
    }

    const coolRatio = Tend / T0;   // geometric interpolation base
    let   accepted  = 0;           // bookkeeping for the acceptance rate

    // ── Anneal ──────────────────────────────────────────────────────────────
    for (let i = 0; i < this.rounds; i++) {
      const frac = this.rounds > 1 ? i / (this.rounds - 1) : 1;
      const T    = T0 * Math.pow(coolRatio, frac);   // T0 → Tend across the run
      amp        = ampFor(T);                         // shrink the move as we cool

      const mv             = propose();
      const candidateScore = evalScore(vector.lines);
      const dE             = candidateScore - currentScore;

      // Metropolis criterion: always accept improvements (dE < 0); accept a
      // worsening move with probability exp(-dE / T).
      if (dE < 0 || Math.random() < Math.exp(-dE / T)) {
        currentScore = candidateScore;
        accepted++;
        if (currentScore < bestScore) {
          bestScore = currentScore;
          bestLines = vector.lines.map(l => ({
            points: [{ ...l.points[0] }, { ...l.points[1] }],
            style:  l.style,
          }));
        }
      } else {
        undo(mv);   // reject → roll the move back
      }

      if (i % 20 === 0) {
        // Report the *current* (wandering) score so the live preview shows SA
        // exploring; the final result below is the best-ever state.
        this.onProgress?.(i / this.rounds, currentScore);
        this._recordTrace(i, bestScore, { current: currentScore, T });
        if (i % 100 === 0) this.onPreview?.(this._rasterizeGS(vector), W, H);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // Return the best state visited, not the final walk position.
    vector.lines = bestLines;

    // Acceptance rate is handy when tuning the temperature schedule.
    console.debug(`[${this.id}] SA accepted ${accepted}/${this.rounds} ` +
                  `(${(100 * accepted / this.rounds).toFixed(1)}%), ` +
                  `T0=${T0.toFixed(4)}, best MAE=${bestScore.toFixed(3)}`);

    this._dumpTraceCSV();
    this.onProgress?.(1, bestScore);
    this.onPreview?.(this._rasterizeGS(vector), W, H);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }
}