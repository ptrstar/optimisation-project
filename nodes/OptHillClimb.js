import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

export class OptHillClimb extends OptBase {
  constructor(id) {
    super(id);

    this.rounds       = 2000;
    this.lineCount    = 200;
    this.penWidthPx   = 2;
    this.maxAmplitude = 15;
    this.scoreScale   = 0.5;
    // minLenFrac / maxLenFrac / lineOpacity inherited from OptBase defaults

    this.paramDefs = [
      { label: 'Rounds',          key: 'rounds',       min: 10,   max: 20000, step: 10  },
      { label: 'Line count',      key: 'lineCount',    min: 10,   max: 1000,  step: 10  },
      { label: 'Pen width (px)',  key: 'penWidthPx',   min: 0.5,  max: 20,    step: 0.5 },
      { label: 'Max amplitude',   key: 'maxAmplitude', min: 0.1,  max: 200,   step: 0.1 },
      { label: 'Score scale',     key: 'scoreScale',   min: 0.1,  max: 1,     step: 0.05},
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

    // ── Initialise with random lines ──────────────────────────────────────────
    const vector = new VectorImage(W, H);
    for (let i = 0; i < this.lineCount; i++) {
      const { points, style } = this._randomLine(W, H, diag);
      vector.addLine(points, style);
    }
    let currentScore = evalScore(vector.lines);
    this._resetTrace();

    // ── Hill-climb ────────────────────────────────────────────────────────────
    for (let i = 0; i < this.rounds; i++) {
      const idx  = Math.floor(Math.random() * vector.lines.length);
      const line = vector.lines[idx];
      const p0old = { ...line.points[0] };
      const p1old = { ...line.points[1] };
      const amp   = this.maxAmplitude;

      line.points[0] = {
        x: p0old.x + (Math.random() - 0.5) * amp,
        y: p0old.y + (Math.random() - 0.5) * amp,
      };
      line.points[1] = {
        x: p1old.x + (Math.random() - 0.5) * amp,
        y: p1old.y + (Math.random() - 0.5) * amp,
      };

      const candidateScore = evalScore(vector.lines);
      if (candidateScore >= currentScore) {
        line.points[0] = p0old;   // revert
        line.points[1] = p1old;
      } else {
        currentScore = candidateScore;
      }

      if (i % 20 === 0) {
        this._recordTrace(i, currentScore);
        this.onProgress?.(i / this.rounds, currentScore);
        if (i % 100 === 0) this.onPreview?.(this._rasterizeGS(vector), W, H);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this._recordTrace(this.rounds, currentScore);
    this._dumpTraceCSV();
    this.onProgress?.(1, currentScore);
    this.onPreview?.(this._rasterizeGS(vector), W, H);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }
}
