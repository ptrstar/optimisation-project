/**
 * sweep.js — parameter-tuning harness for the optimisation nodes.
 *
 * Place this file and sweep.html at the project ROOT (next to index.html).
 * Open sweep.html, pick an image, click "Run sweep". It will:
 *   1. Build a small grayscale target from the image (matching the app's
 *      Contrast → Grayscale preprocessing).
 *   2. For each method, sweep one parameter at a time (OAT), repeating each
 *      setting REPEATS times and scoring every result on a COMMON metric
 *      (full-resolution MAE of the final drawing vs the target).
 *   3. Pick the best value found on each axis, combine them into a recommended
 *      parameter set, and verify that set with REPEATS runs.
 *   4. Offer four downloads:
 *        sweep_long.csv     — one row per (method, axis, variant, repeat); for
 *                             scatter/box plots and recomputing stats.
 *        sweep_summary.csv  — aggregated mean/std per setting; the main file for
 *                             "error vs parameter" line plots.
 *        best_params.json   — recommended parameters per method (re-runnable).
 *        best_summary.csv   — per-method best-config mean/std MAE + runtime; the
 *                             cross-method comparison-of-best-results table.
 *
 * Everything compares on the SAME metric and (by default) the SAME line count,
 * so differences reflect the algorithms, not the objective or the line budget.
 *
 * NOTE: runs are NOT seeded (the nodes use Math.random), which is why each
 * setting is repeated and averaged. Treat single numbers as noisy; trust means.
 */

import { OptHillClimb }        from './nodes/OptHillClimb.js';
import { OptGenetic }          from './nodes/OptGenetic.js';
import { OptSimAnneal }        from './nodes/OptSimAnneal.js';
import { OptEvoStrategy }      from './nodes/OptEvoStrategy.js';
import { OptGreedySequential } from './nodes/OptGreedySequential.js';
import { VectorImage }         from './formats/VectorImage.js';
import { Rasterize }           from './nodes/Rasterize.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — edit freely. For a fast dry-run, set REPEATS = 1 and trim the arrays.
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  MAX_DIM:        180,   // working image is downscaled so max(w,h) ≤ this (↑ = slower, more detail)
  CONTRAST:       1.2,   // matches the app's Contrast node default
  REPEATS:        3,     // runs per setting (averaged); ↑ = less noise, slower
  SCORE_SCALE:    0.5,   // internal scoring resolution used by every method during the sweep
  LOCK_LINECOUNT: 100,   // force this lineCount on all methods (fair comparison). null = tune it.
};

// Reduced budgets for tuning (the best params can be re-run at higher budgets
// afterwards for final figures — see notes in the chat).
const BUDGET = {
  hc_rounds:  3000,
  ga_gens:    120,
  sa_rounds:  6000,
  es_gens:    120,
};

// ─────────────────────────────────────────────────────────────────────────────
// Method definitions: base params + the axes to sweep one at a time.
// An "axis" is a named list of variants; each variant is a label + a param patch.
// ─────────────────────────────────────────────────────────────────────────────
const axis = (name, key, values) => ({
  name,
  variants: values.map(v => ({ label: String(v), x: v, patch: { [key]: v } })),
});

function buildMethods() {
  const SS = CONFIG.SCORE_SCALE;

  const methods = {
    HillClimb: {
      Cls: OptHillClimb,
      base: { rounds: BUDGET.hc_rounds, lineCount: 100, penWidthPx: 2, maxAmplitude: 15, scoreScale: SS },
      axes: [
        axis('maxAmplitude', 'maxAmplitude', [5, 10, 20, 40]),
        axis('rounds',       'rounds',       [1000, 3000, 6000]),
      ],
    },

    Genetic: {
      Cls: OptGenetic,
      base: { generations: BUDGET.ga_gens, popSize: 30, lineCount: 100, penWidthPx: 2,
              mutationRate: 0.05, mutationAmp: 20, eliteCount: 2, tournamentK: 3, scoreScale: SS },
      axes: [
        axis('mutationRate', 'mutationRate', [0.02, 0.05, 0.1, 0.2]),
        axis('mutationAmp',  'mutationAmp',  [10, 20, 40]),
        axis('popSize',      'popSize',      [20, 30, 50]),
        axis('tournamentK',  'tournamentK',  [2, 3, 5]),
        axis('eliteCount',   'eliteCount',   [0, 2, 5]),
      ],
    },

    SimAnneal: {
      Cls: OptSimAnneal,
      base: { rounds: BUDGET.sa_rounds, lineCount: 100, penWidthPx: 2, maxAmplitude: 12,
              initialTemp: 1.0, finalTemp: 0.01, autoInitTemp: 1, scoreScale: SS },
      axes: [
        axis('maxAmplitude', 'maxAmplitude', [5, 10, 20, 40]),
        axis('rounds',       'rounds',       [3000, 6000, 12000]),
        { name: 'initialTemp', variants: [
          { label: 'auto', x: '',  patch: { autoInitTemp: 1 } },
          { label: '0.2',  x: 0.2, patch: { autoInitTemp: 0, initialTemp: 0.2 } },
          { label: '0.5',  x: 0.5, patch: { autoInitTemp: 0, initialTemp: 0.5 } },
          { label: '1.0',  x: 1.0, patch: { autoInitTemp: 0, initialTemp: 1.0 } },
          { label: '2.0',  x: 2.0, patch: { autoInitTemp: 0, initialTemp: 2.0 } },
        ]},
      ],
    },

    EvoStrategy: {
      Cls: OptEvoStrategy,
      base: { generations: BUDGET.es_gens, mu: 10, lambda: 50, lineCount: 100, penWidthPx: 2,
              sigmaInit: 20, plusSelection: 1, recombine: 1, scoreScale: SS },
      axes: [
        axis('sigmaInit', 'sigmaInit', [5, 10, 20, 40]),
        axis('lambda',    'lambda',    [30, 50, 100]),
        axis('mu',        'mu',        [5, 10, 20]),
        { name: 'selection', variants: [
          { label: 'plus',  x: 1, patch: { plusSelection: 1 } },
          { label: 'comma', x: 0, patch: { plusSelection: 0 } },
        ]},
        { name: 'recombine', variants: [
          { label: 'on',  x: 1, patch: { recombine: 1 } },
          { label: 'off', x: 0, patch: { recombine: 0 } },
        ]},
      ],
    },

    GreedySeq: {
      Cls: OptGreedySequential,
      base: { lineCount: 100, candidates: 300, penWidthPx: 2, scoreScale: SS,
              maxLenFrac: 0.4, lineOpacity: 0.8, blurRadius: 8, gradBias: 0.8 },
      axes: [
        axis('candidates',  'candidates',  [100, 200, 400, 800]),
        axis('blurRadius',  'blurRadius',  [2, 4, 8, 16]),
        axis('gradBias',    'gradBias',    [0, 0.4, 0.8, 1.0]),
        axis('maxLenFrac',  'maxLenFrac',  [0.2, 0.4, 0.6]),
        axis('lineOpacity', 'lineOpacity', [0.5, 0.8, 1.0]),
      ],
    },
  };

  // Apply the line-count lock: force base.lineCount and drop any lineCount axis.
  if (CONFIG.LOCK_LINECOUNT != null) {
    for (const m of Object.values(methods)) {
      m.base.lineCount = CONFIG.LOCK_LINECOUNT;
      m.axes = m.axes.filter(a => a.name !== 'lineCount');
    }
  }
  return methods;
}

// ─────────────────────────────────────────────────────────────────────────────
// Target construction + common scorer
// ─────────────────────────────────────────────────────────────────────────────
async function buildTarget(file) {
  const bitmap = await createImageBitmap(file);
  const scale  = Math.min(1, CONFIG.MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const W = Math.max(1, Math.round(bitmap.width  * scale));
  const H = Math.max(1, Math.round(bitmap.height * scale));

  const cv  = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d   = img.data;

  // Contrast (per channel) then luminance grayscale, in place.
  const c = CONFIG.CONTRAST;
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.max(0, Math.min(255, (d[i]     - 128) * c + 128));
    const g = Math.max(0, Math.min(255, (d[i + 1] - 128) * c + 128));
    const b = Math.max(0, Math.min(255, (d[i + 2] - 128) * c + 128));
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    d[i] = d[i + 1] = d[i + 2] = lum;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // The opt nodes expect a real ImageData on inputs.image.
  const target = new ImageData(new Uint8ClampedArray(d), W, H);
  target._portType = 'gs_rasterimage';

  // Flat R-channel buffer for the common scorer.
  const targetFlat = new Uint8Array(W * H);
  for (let i = 0; i < targetFlat.length; i++) targetFlat[i] = d[i * 4];

  return { target, targetFlat, W, H };
}

// Common metric: full-resolution MAE of the final rendered drawing vs target.
function commonScore(vector, targetFlat) {
  const r = Rasterize.renderToGS(vector);
  const n = Math.min(r.length, targetFlat.length);
  let s = 0;
  for (let i = 0; i < n; i++) { const dd = r[i] - targetFlat[i]; s += dd > 0 ? dd : -dd; }
  return n > 0 ? s / n : NaN;
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a single configuration once: returns { mae, ms }.
// ─────────────────────────────────────────────────────────────────────────────
async function runOnce(Cls, params, target, targetFlat) {
  const node = new Cls('sweep');
  // Silence per-run trace/log machinery (no-ops shadow the prototype methods).
  node._recordTrace  = () => {};
  node._dumpTraceCSV = () => {};
  node.setParams(params);
  node.inputs.image = target;

  const t0 = performance.now();
  try {
    await node.run();
  } catch (err) {
    console.warn('run failed', params, err);
    return { mae: NaN, ms: performance.now() - t0 };
  }
  const ms  = performance.now() - t0;
  const out = node.outputs.vector;
  return { mae: out ? commonScore(out, targetFlat) : NaN, ms };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats helpers
// ─────────────────────────────────────────────────────────────────────────────
const finite = a => a.filter(Number.isFinite);
const mean   = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const std    = a => { const m = mean(a); return a.length ? Math.sqrt(mean(a.map(x => (x - m) ** 2))) : NaN; };

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────
async function runSweep(target, targetFlat, W, H, onStatus) {
  const methods = buildMethods();
  const K = CONFIG.REPEATS;

  // Pre-count total runs for progress/ETA.
  let totalRuns = 0;
  for (const m of Object.values(methods)) {
    for (const a of m.axes) totalRuns += a.variants.length * K;
    totalRuns += K; // verification run of the recommended set
  }

  const longRows    = [['method', 'axis', 'variant', 'x', 'repeat', 'common_mae', 'runtime_ms']];
  const summaryRows = [['method', 'axis', 'variant', 'x', 'k', 'mean_mae', 'std_mae', 'mean_runtime_ms']];
  const bestLongRows = [['method', 'repeat', 'common_mae', 'runtime_ms']];
  const bestSummary  = [['method', 'lineCount', 'k', 'mean_mae', 'std_mae', 'mean_runtime_ms']];
  const bestParams   = {};

  let done = 0;
  const times = [];
  const tick = (label) => {
    const avg = times.length ? mean(times) : 0;
    const etaMs = avg * (totalRuns - done);
    const eta = etaMs > 0 ? `~${Math.ceil(etaMs / 1000)}s left` : '';
    onStatus(`${done}/${totalRuns} runs (${(100 * done / totalRuns).toFixed(0)}%) · ${label} · ${eta}`);
  };

  for (const [methodName, m] of Object.entries(methods)) {
    const winners = {};   // axisName → best variant patch

    for (const ax of m.axes) {
      let bestMean = Infinity, bestVariant = null;

      for (const v of ax.variants) {
        const params = { ...m.base, ...v.patch };
        const maes = [], mss = [];

        for (let rep = 0; rep < K; rep++) {
          const t0 = performance.now();
          const { mae, ms } = await runOnce(m.Cls, params, target, targetFlat);
          times.push(performance.now() - t0);
          done++;
          maes.push(mae); mss.push(ms);
          longRows.push([methodName, ax.name, v.label, v.x, rep, fmt(mae), fmt(ms)]);
          tick(`${methodName} · ${ax.name}=${v.label}`);
          await yieldUI();
        }

        const mMae = mean(finite(maes));
        summaryRows.push([methodName, ax.name, v.label, v.x, K, fmt(mMae), fmt(std(finite(maes))), fmt(mean(mss))]);
        if (Number.isFinite(mMae) && mMae < bestMean) { bestMean = mMae; bestVariant = v; }
      }

      if (bestVariant) winners[ax.name] = bestVariant.patch;
    }

    // Assemble recommended params = base + best variant from each axis.
    const recommended = Object.assign({}, m.base, ...Object.values(winners));
    bestParams[methodName] = recommended;

    // Verify the recommended set.
    const vMaes = [], vMss = [];
    for (let rep = 0; rep < K; rep++) {
      const t0 = performance.now();
      const { mae, ms } = await runOnce(m.Cls, recommended, target, targetFlat);
      times.push(performance.now() - t0);
      done++;
      vMaes.push(mae); vMss.push(ms);
      bestLongRows.push([methodName, rep, fmt(mae), fmt(ms)]);
      tick(`${methodName} · verify best`);
      await yieldUI();
    }
    bestSummary.push([methodName, recommended.lineCount ?? '', K,
      fmt(mean(finite(vMaes))), fmt(std(finite(vMaes))), fmt(mean(vMss))]);
  }

  return {
    meta: { width: W, height: H, repeats: K, scoreScale: CONFIG.SCORE_SCALE,
            lockLineCount: CONFIG.LOCK_LINECOUNT, contrast: CONFIG.CONTRAST,
            date: new Date().toISOString() },
    files: {
      'sweep_long.csv':    toCSV(longRows),
      'sweep_summary.csv': toCSV(summaryRows),
      'best_verify.csv':   toCSV(bestLongRows),
      'best_summary.csv':  toCSV(bestSummary),
      'best_params.json':  JSON.stringify({ meta: { repeats: K, lockLineCount: CONFIG.LOCK_LINECOUNT }, params: bestParams }, null, 2),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────
const fmt = x => (Number.isFinite(x) ? (+x).toFixed(4) : '');
const toCSV = rows => rows.map(r => r.join(',')).join('\n');
const yieldUI = () => new Promise(r => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────
// UI wiring
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file');
  const runBtn    = document.getElementById('run');
  const statusEl  = document.getElementById('status');
  const dlEl      = document.getElementById('downloads');
  const setStatus = (t) => { statusEl.textContent = t; };

  let prepared = null; // { target, targetFlat, W, H }

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    setStatus('Preparing target…');
    dlEl.innerHTML = '';
    prepared = await buildTarget(f);
    setStatus(`Target ready: ${prepared.W}×${prepared.H}px. Click "Run sweep".`);
    runBtn.disabled = false;
  });

  runBtn.addEventListener('click', async () => {
    if (!prepared) return;
    runBtn.disabled = true;
    dlEl.innerHTML = '';
    const t0 = performance.now();
    const out = await runSweep(prepared.target, prepared.targetFlat, prepared.W, prepared.H, setStatus);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    setStatus(`Done in ${secs}s. Download the files below.`);

    for (const [name, text] of Object.entries(out.files)) {
      const mime = name.endsWith('.json') ? 'application/json' : 'text/csv';
      const blob = new Blob([text], { type: mime });
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.textContent = `⬇ ${name}`;
      a.className = 'dl';
      dlEl.appendChild(a);
    }
    runBtn.disabled = false;
  });
});