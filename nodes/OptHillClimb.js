import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

export class OptHillClimb extends OptBase {
  constructor(id) {
    super(id);

    this.rounds       = 300;
    this.penWidthPx   = 2;
    this.lineCount    = 200;
    this.maxAmplitude = 5;

    this.paramDefs = [
      { label: 'Rounds',         key: 'rounds',       min: 10,  max: 10000, step: 10 },
      { label: 'Pen width (px)', key: 'penWidthPx',   min: 0.5, max: 20,    step: 0.5 },
      { label: 'Line count',     key: 'lineCount',    min: 10,  max: 1000,  step: 10 },
      { label: 'Max amplitude',  key: 'maxAmplitude', min: 0.1, max: 100,   step: 0.1 },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    const vector = new VectorImage(src.width, src.height);
    for (let i = 0; i < this.lineCount; i++) {
      const line = this._randomLine(src.width, src.height);
      vector.addLine(line.points, line.style);
    }
    let currentScore = this._score(vector, src);

    for (let i = 0; i < this.rounds; i++) {
      const l_idx = Math.floor(vector.lines.length * Math.random());
      const p_1   = vector.lines[l_idx].points[0];
      const p_2   = vector.lines[l_idx].points[1];

      vector.lines[l_idx].points[0] = {
        x: p_1.x + (Math.random() - 0.5) * this.maxAmplitude,
        y: p_1.y + (Math.random() - 0.5) * this.maxAmplitude,
      };
      vector.lines[l_idx].points[1] = {
        x: p_2.x + (Math.random() - 0.5) * this.maxAmplitude,
        y: p_2.y + (Math.random() - 0.5) * this.maxAmplitude,
      };

      const candidateScore = this._score(vector, src);
      if (candidateScore > currentScore) {
        vector.lines[l_idx].points[0] = p_1;
        vector.lines[l_idx].points[1] = p_2;
      } else {
        currentScore = candidateScore;
      }

      if (i % 20 === 0) {
        this.onProgress?.(i / this.rounds, currentScore);
        if (i % 100 === 0) this.onPreview?.(this._rasterizeGS(vector), src.width, src.height);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.onProgress?.(1, currentScore);
    this.onPreview?.(this._rasterizeGS(vector), src.width, src.height);

    if (src._widthCm)  vector._widthCm  = src._widthCm;
    if (src._heightCm) vector._heightCm = src._heightCm;
    this._setOutput('vector', vector);
  }

  _randomLine(width, height) {
    const x1     = Math.random() * width;
    const y1     = Math.random() * height;
    const maxLen = Math.sqrt(width * width + height * height) * 0.4;
    const len    = maxLen * (0.05 + Math.random() * 0.95);
    const angle  = Math.random() * Math.PI * 2;
    return {
      points: [
        { x: x1, y: y1 },
        { x: Math.max(0, Math.min(width,  x1 + Math.cos(angle) * len)),
          y: Math.max(0, Math.min(height, y1 + Math.sin(angle) * len)) },
      ],
      style: { width: this.penWidthPx, opacity: 1 },
    };
  }
}
