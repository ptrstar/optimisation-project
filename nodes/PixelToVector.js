import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * PixelToVector — greedy sequential hill-climb (legacy node, predates OptBase).
 *
 * Each iteration proposes a random line, scores the full vector with that line
 * added via Rasterize.renderToGS, and keeps it if it improves the MAE.
 * This is kept for backwards compatibility with saved pipelines. For new work,
 * OptGreedySequential is faster (software rasterizer, score scale, blur mix).
 *
 * Migrated to extend OptBase:
 *   - _score / _rasterizeGS / _randomLine / buildContent all come from OptBase
 *   - Fixed a double-scoring bug: candidate score is now reused instead of
 *     re-scoring the vector a second time after accepting a line
 */
export class PixelToVector extends OptBase {
  constructor(id) {
    super(id);

    this.iterations    = 300;
    // OptBase line-shape defaults — preserve original 0.6–1.0 opacity jitter
    this.lineOpacity   = 0.8;
    this.opacityJitter = 0.2;
    this.minLenFrac    = 0.05;
    // maxLenFrac = 0.4, penWidthPx = 2 — OptBase defaults

    this.paramDefs = [
      { label: 'Iterations',     key: 'iterations', min: 10,  max: 10000, step: 10  },
      { label: 'Pen width (px)', key: 'penWidthPx', min: 0.5, max: 20,    step: 0.5 },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const W    = src.width, H = src.height;
    const diag = Math.sqrt(W * W + H * H);

    const vector       = new VectorImage(W, H);
    let   currentScore = this._score(vector, src);
    const total        = this.iterations;

    for (let i = 0; i < total; i++) {
      const { points, style } = this._randomLine(W, H, diag);
      const candidate         = vector.clone();
      candidate.addLine(points, style);

      const candidateScore = this._score(candidate, src);
      if (candidateScore < currentScore) {
        vector.addLine(points, style);
        currentScore = candidateScore;  // reuse — was scored twice before (bug)
      }

      if (i % 20 === 0) {
        this.onProgress?.(i / total, currentScore);
        if (i % 100 === 0) this.onPreview?.(this._rasterizeGS(vector), W, H);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, currentScore);
    this.onPreview?.(this._rasterizeGS(vector), W, H);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }
}
