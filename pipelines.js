/**
 * Pipeline serialiser + preset store.
 *
 * Adding a new node type: import the class and add it to NODE_CLASSES below.
 * Everything else (encode/load) is automatic.
 */

import { ImageUploader }        from './nodes/ImageUploader.js';
import { Grayscale }            from './nodes/Grayscale.js';
import { Contrast }             from './nodes/Contrast.js';
import { ShowPixelBuffer }      from './nodes/ShowPixelBuffer.js';
import { OptHillClimb }         from './nodes/OptHillClimb.js';
import { OptGenetic }           from './nodes/OptGenetic.js';
import { OptNeedle }            from './nodes/OptNeedle.js';
import { OptGreedySequential }  from './nodes/OptGreedySequential.js';
import { Rasterize }            from './nodes/Rasterize.js';
import { ImageDiff }            from './nodes/ImageDiff.js';
import { CanvasSetup }          from './nodes/CanvasSetup.js';
import { PixelToVector }        from './nodes/PixelToVector.js';
import { SobelGradient }        from './nodes/SobelGradient.js';
import { Blur }                 from './nodes/Blur.js';
import { InvertImage }          from './nodes/InvertImage.js';
import { OptStipple }           from './nodes/OptStipple.js';

// Registry: type-name string → class. Add new node classes here.
const NODE_CLASSES = {
  ImageUploader,
  Grayscale,
  Contrast,
  ShowPixelBuffer,
  OptHillClimb,
  OptGenetic,
  OptNeedle,
  OptGreedySequential,
  Rasterize,
  ImageDiff,
  CanvasSetup,
  PixelToVector,
  SobelGradient,
  Blur,
  InvertImage,
  OptStipple,
};

// ── Serialise ──────────────────────────────────────────────────────────────

export function encodePipeline(pipeline) {
  return {
    nodes: pipeline.nodes.map(node => {
      const widget = pipeline.getWidget(node);
      return {
        id:     node.id,
        type:   node.constructor.name,
        x:      Math.round(widget?.x ?? 0),
        y:      Math.round(widget?.y ?? 0),
        params: node.getParams(),
      };
    }),
    edges: pipeline.edges.map(e => ({
      from:     e.fromNode.id,
      fromPort: e.fromPort,
      to:       e.toNode.id,
      toPort:   e.toPort,
    })),
  };
}

// ── Load ───────────────────────────────────────────────────────────────────

/**
 * Clear the pipeline and reconstruct it from a preset/JSON object.
 * Returns the highest node counter number found, so main.js can advance nodeCounter.
 */
export function loadPreset(pipeline, preset) {
  pipeline.clear();

  const nodeMap = new Map();
  let   maxNum  = 0;

  for (const spec of preset.nodes) {
    const Cls = NODE_CLASSES[spec.type];
    if (!Cls) {
      console.warn(`[pipelines] Unknown node type: "${spec.type}" — skipping`);
      continue;
    }

    const node = new Cls(spec.id);
    node.setParams(spec.params ?? {});
    pipeline.addNode(node, spec.x, spec.y);
    nodeMap.set(spec.id, node);

    // Track max numeric suffix so the caller can advance nodeCounter safely.
    const suffix = parseInt(spec.id.split('-').pop(), 10);
    if (!isNaN(suffix)) maxNum = Math.max(maxNum, suffix);
  }

  for (const edge of preset.edges) {
    const fromNode = nodeMap.get(edge.from);
    const toNode   = nodeMap.get(edge.to);
    if (!fromNode || !toNode) {
      console.warn(`[pipelines] Edge references unknown node: "${edge.from}" → "${edge.to}"`);
      continue;
    }
    try {
      pipeline.connect(fromNode, edge.fromPort, toNode, edge.toPort);
    } catch (err) {
      console.warn(`[pipelines] Failed to connect edge: ${err.message}`);
    }
  }

  return maxNum;
}

// ── Presets ────────────────────────────────────────────────────────────────

// Shared node layout used by all opt presets — only the opt node type/params differ.
const _optPresetNodes = (optId, optType, optParams) => ([
  { id: 'canvassetup-0',   type: 'CanvasSetup',     x: 40,   y: 40,  params: { widthCm: 20, heightCm: 20, dpi: 96, penWidthMm: 0.7 } },
  { id: 'imageuploader-1', type: 'ImageUploader',   x: 40,   y: 260, params: { fitMode: 'fit' } },
  { id: 'contrast-2',      type: 'Contrast',        x: 310,  y: 260, params: { amount: 1.2 } },
  { id: 'grayscale-3',     type: 'Grayscale',       x: 580,  y: 260, params: {} },
  { id: 'showbuffer-4',    type: 'ShowPixelBuffer', x: 850,  y: 260, params: {} },
  { id: optId,             type: optType,            x: 580,  y: 480, params: optParams },
  { id: 'rasterize-6',     type: 'Rasterize',       x: 850,  y: 480, params: {} },
  { id: 'showbuffer-7',    type: 'ShowPixelBuffer', x: 1120, y: 480, params: {} },
]);

const _optPresetEdges = (optId) => ([
  { from: 'canvassetup-0',   fromPort: 'config', to: 'imageuploader-1', toPort: 'config' },
  { from: 'imageuploader-1', fromPort: 'image',  to: 'contrast-2',      toPort: 'image'  },
  { from: 'contrast-2',      fromPort: 'image',  to: 'grayscale-3',     toPort: 'image'  },
  { from: 'grayscale-3',     fromPort: 'image',  to: 'showbuffer-4',    toPort: 'image'  },
  { from: 'grayscale-3',     fromPort: 'image',  to: optId,             toPort: 'image'  },
  { from: optId,             fromPort: 'vector', to: 'rasterize-6',     toPort: 'vector' },
  { from: 'rasterize-6',     fromPort: 'image',  to: 'showbuffer-7',    toPort: 'image'  },
]);

const PRESET_HILL_CLIMB = {
  nodes: _optPresetNodes('opt-5', 'OptHillClimb', {
    rounds: 2000, penWidthPx: 2, lineCount: 200, maxAmplitude: 15,
  }),
  edges: _optPresetEdges('opt-5'),
};

const PRESET_GENETIC = {
  nodes: _optPresetNodes('opt-5', 'OptGenetic', {
    generations: 300, popSize: 30, lineCount: 100,
    penWidthPx: 2, mutationRate: 0.05, mutationAmp: 20,
    eliteCount: 2, tournamentK: 3, scoreScale: 0.5,
  }),
  edges: _optPresetEdges('opt-5'),
};

const PRESET_GREEDY = {
  nodes: _optPresetNodes('opt-5', 'OptGreedySequential', {
    lineCount: 150, candidates: 400, penWidthPx: 2,
    scoreScale: 0.5, maxLenFrac: 0.4,
    lineOpacity: 0.8, blurRadius: 8, blurMix: 0.4,
  }),
  edges: _optPresetEdges('opt-5'),
};

const PRESET_STIPPLE = {
  nodes: _optPresetNodes('opt-5', 'OptStipple', {
    dotCount: 300, iterations: 20, dotRadius: 3, varyRadius: 0.5, scoreScale: 0.2,
  }),
  edges: _optPresetEdges('opt-5'),
};

const PRESET_NEEDLE = {
  nodes: _optPresetNodes('opt-5', 'OptNeedle', {
    rounds: 5000, lineCount: 200, penWidthPx: 2, scoreScale: 0.5,
  }),
  edges: _optPresetEdges('opt-5'),
};

// ── Compare-all preset ──────────────────────────────────────────────────────
// Top row: full preprocessing chain (CanvasSetup → Grayscale → ShowPixelBuffer).
// Below it, one unconnected Opt → Rasterize → ShowPixelBuffer chain per algorithm,
// stacked vertically and x-aligned with the Grayscale node so the user can connect
// any one of them by drawing a single edge from Grayscale's image output.
const PRESET_COMPARE = (() => {
  const TOP_Y   = 40;
  const OPT_X   = 760;   // same x as Grayscale — easy to connect
  const RAS_X   = 1000;
  const SHOW_X  = 1240;
  const ROW_GAP = 300;   // vertical spacing between opt rows

  const optRow = (rowIdx, id, type, params) => {
    const y = TOP_Y + 280 + rowIdx * ROW_GAP;
    return [
      { id,              type,            x: OPT_X,  y, params },
      { id: `ras-${id}`, type: 'Rasterize',       x: RAS_X,  y, params: {} },
      { id: `sb-${id}`,  type: 'ShowPixelBuffer', x: SHOW_X, y, params: {} },
    ];
  };

  const optEdges = (id) => ([
    { from: id,          fromPort: 'vector', to: `ras-${id}`, toPort: 'vector' },
    { from: `ras-${id}`, fromPort: 'image',  to: `sb-${id}`,  toPort: 'image'  },
  ]);

  return {
    nodes: [
      // Top preprocessing chain
      { id: 'cs-0',  type: 'CanvasSetup',     x: 40,   y: TOP_Y, params: { widthCm: 4, heightCm: 4, dpi: 96, penWidthMm: 0.7 } },
      { id: 'up-1',  type: 'ImageUploader',   x: 280,  y: TOP_Y, params: { fitMode: 'fit' } },
      { id: 'co-2',  type: 'Contrast',        x: 520,  y: TOP_Y, params: { amount: 1.2 } },
      { id: 'gs-3',  type: 'Grayscale',       x: OPT_X,y: TOP_Y, params: {} },
      { id: 'sb-top',type: 'ShowPixelBuffer', x: 1000, y: TOP_Y, params: {} },
      // Opt chains (unconnected on input — user draws one edge from gs-3 to activate)
      ...optRow(0, 'hc',  'OptHillClimb',        { rounds: 2000, lineCount: 200, penWidthPx: 2, maxAmplitude: 15, scoreScale: 0.5 }),
      ...optRow(1, 'gen', 'OptGenetic',           { generations: 300, popSize: 30, lineCount: 100, penWidthPx: 2, mutationRate: 0.05, mutationAmp: 20, eliteCount: 2, tournamentK: 3, scoreScale: 0.5 }),
      ...optRow(2, 'gr',  'OptGreedySequential',  { lineCount: 150, candidates: 400, penWidthPx: 2, scoreScale: 0.5, maxLenFrac: 0.4, lineOpacity: 0.8, blurRadius: 8, blurMix: 0.4 }),
      ...optRow(3, 'st',  'OptStipple',           { dotCount: 300, iterations: 20, dotRadius: 3, varyRadius: 0.5, scoreScale: 0.2 }),
    ],
    edges: [
      // Top chain
      { from: 'cs-0',  fromPort: 'config', to: 'up-1',  toPort: 'config' },
      { from: 'up-1',  fromPort: 'image',  to: 'co-2',  toPort: 'image'  },
      { from: 'co-2',  fromPort: 'image',  to: 'gs-3',  toPort: 'image'  },
      { from: 'gs-3',  fromPort: 'image',  to: 'sb-top',toPort: 'image'  },
      // Within each opt chain
      ...optEdges('hc'),
      ...optEdges('gen'),
      ...optEdges('gr'),
      ...optEdges('st'),
    ],
  };
})();

export const PRESETS = [
  { name: 'Hill Climb',        pipeline: PRESET_HILL_CLIMB },
  { name: 'Genetic',           pipeline: PRESET_GENETIC    },
  { name: 'Greedy Sequential', pipeline: PRESET_GREEDY     },
  { name: 'Stipple',           pipeline: PRESET_STIPPLE    },
  { name: 'Needle',            pipeline: PRESET_NEEDLE     },
  { name: 'Compare All',       pipeline: PRESET_COMPARE    },
];
