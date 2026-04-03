import { OptBase }     from './OptBase.js';
import { VectorImage } from '../formats/VectorImage.js';

/**
 * OptGenetic — genetic algorithm optimisation node.
 *
 * Inherits from OptBase:
 *   - this._score(vector, gsTarget)  → MAE score (lower is better)
 *   - this._rasterizeGS(vector)      → Uint8Array of luminance
 *   - this.onProgress(pct, score)    → drives the progress bar
 *   - this.onPreview(pixels, w, h)   → drives the live preview canvas
 *   - getParams() / setParams()      → auto-derived from this.paramDefs
 *   - buildContent(widget)           → auto-generated UI from paramDefs
 *
 * GA sketch:
 *   - Population: array of VectorImage (each is one candidate drawing)
 *   - Fitness: this._score() per individual (lower = better)
 *   - Selection: tournament or roulette-wheel on fitness
 *   - Crossover: swap random subsets of lines between two parents
 *   - Mutation: perturb a random line endpoint (like hill-climb does per round)
 *   - Elitism: always keep the best individual unchanged into next generation
 */
export class OptGenetic extends OptBase {
  constructor(id) {
    super(id);

    // ── Hyperparameters ────────────────────────────────────────────────────────
    this.generations   = 100;   // number of GA generations to run
    this.popSize       = 20;    // individuals per generation
    this.lineCount     = 100;   // lines per individual
    this.penWidthPx    = 2;     // stroke width in pixels
    this.mutationRate  = 0.1;   // fraction of lines mutated per individual per generation
    this.eliteCount    = 2;     // top-N individuals carried unchanged to next generation

    this.paramDefs = [
      { label: 'Generations',    key: 'generations',  min: 10,   max: 1000,  step: 10 },
      { label: 'Population',     key: 'popSize',      min: 2,    max: 100,   step: 1 },
      { label: 'Line count',     key: 'lineCount',    min: 10,   max: 500,   step: 10 },
      { label: 'Pen width (px)', key: 'penWidthPx',   min: 0.5,  max: 20,    step: 0.5 },
      { label: 'Mutation rate',  key: 'mutationRate', min: 0.01, max: 1,     step: 0.01 },
      { label: 'Elite count',    key: 'eliteCount',   min: 0,    max: 10,    step: 1 },
    ];
  }

  async run() {
    const src = this.inputs.image;
    if (!src) return;

    // ── 1. Initialise population ───────────────────────────────────────────────
    // Each individual is a VectorImage with this.lineCount random lines.
    // TODO: replace this._randomLine() stub with your own initialisation strategy.
    let population = Array.from({ length: this.popSize }, () => {
      const ind = new VectorImage(src.width, src.height);
      for (let i = 0; i < this.lineCount; i++) {
        const { points, style } = this._randomLine(src.width, src.height);
        ind.addLine(points, style);
      }
      return ind;
    });

    // ── 2. Evaluate initial fitness ────────────────────────────────────────────
    // fitness[i] is the MAE score for population[i] — lower is better.
    let fitness = population.map(ind => this._score(ind, src));

    for (let gen = 0; gen < this.generations; gen++) {

      // ── 3. Selection ──────────────────────────────────────────────────────────
      // TODO: implement tournament selection or roulette-wheel.
      // tournament(k): pick k individuals at random, return the one with lowest score.
      // For roulette: invert scores to make higher = better, then sample proportionally.
      const selected = this._tournamentSelect(population, fitness, 2);

      // ── 4. Crossover ──────────────────────────────────────────────────────────
      // TODO: implement crossover between pairs of selected parents.
      // Simple approach: for each child, take lines[0..k] from parent A and lines[k..] from parent B
      // where k is a random split point.
      const offspring = this._crossover(selected, src.width, src.height);

      // ── 5. Mutation ───────────────────────────────────────────────────────────
      // TODO: mutate each offspring by randomly perturbing a fraction of its lines.
      // Reuse or adapt _randomLine() and the hill-climb perturbation strategy.
      this._mutate(offspring, src.width, src.height);

      // ── 6. Evaluate offspring fitness ─────────────────────────────────────────
      const offspringFitness = offspring.map(ind => this._score(ind, src));

      // ── 7. Elitism + replacement ───────────────────────────────────────────────
      // TODO: merge population + offspring, keep elite individuals, fill rest from offspring.
      // Sort combined pool by fitness, take top this.popSize.
      const combined        = [...population, ...offspring];
      const combinedFitness = [...fitness, ...offspringFitness];
      const order           = combinedFitness.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0]);
      population = order.slice(0, this.popSize).map(([, i]) => combined[i]);
      fitness    = order.slice(0, this.popSize).map(([f])    => f);

      // ── 8. Progress reporting ──────────────────────────────────────────────────
      if (gen % 5 === 0) {
        this.onProgress?.(gen / this.generations, fitness[0]);
        this.onPreview?.(this._rasterizeGS(population[0]), src.width, src.height);
        await new Promise(r => setTimeout(r, 0)); // yield to UI thread
      }
    }

    this.onProgress?.(1, fitness[0]);
    this.onPreview?.(this._rasterizeGS(population[0]), src.width, src.height);

    const best = population[0];
    if (src._widthCm)  best._widthCm  = src._widthCm;
    if (src._heightCm) best._heightCm = src._heightCm;
    this._setOutput('vector', best);
  }

  // ── Stubs — fill these in ──────────────────────────────────────────────────

  /**
   * Tournament selection: pick `tournamentSize` individuals at random,
   * return the one with the lowest (best) fitness score.
   * Repeat popSize times to build a mating pool.
   */
  _tournamentSelect(population, fitness, tournamentSize) {
    // TODO: implement proper tournament selection.
    // For now just returns the whole population as the mating pool.
    return population.slice();
  }

  /**
   * Crossover: given a mating pool, produce this.popSize offspring.
   * Each offspring is produced by combining two random parents.
   */
  _crossover(matingPool, width, height) {
    // TODO: implement single-point crossover on the lines array.
    // Stub: offspring are clones of random parents (no actual crossover yet).
    return Array.from({ length: this.popSize }, () => {
      return matingPool[Math.floor(Math.random() * matingPool.length)].clone();
    });
  }

  /**
   * Mutation: perturb a random subset of lines in each individual in-place.
   * `this.mutationRate` controls what fraction of lines are mutated.
   */
  _mutate(offspring, width, height) {
    // TODO: for each individual, iterate lines, mutate with probability mutationRate.
    // Perturbation idea: slightly shift endpoints (like hill-climb's maxAmplitude nudge),
    // or replace the line entirely with a new random one.
    // Stub: no mutation yet.
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
