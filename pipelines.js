/**
 * Pipeline serialiser + preset store.
 *
 * Adding a new node type: import the class and add it to NODE_CLASSES below.
 * Everything else (encode/load) is automatic.
 */

import { ImageUploader }   from './nodes/ImageUploader.js';
import { Grayscale }       from './nodes/Grayscale.js';
import { Contrast }        from './nodes/Contrast.js';
import { ShowPixelBuffer } from './nodes/ShowPixelBuffer.js';
import { OptHillClimb }    from './nodes/OptHillClimb.js';
import { Rasterize }       from './nodes/Rasterize.js';
import { ImageDiff }       from './nodes/ImageDiff.js';
import { CanvasSetup }     from './nodes/CanvasSetup.js';

// Registry: type-name string → class. Add new node classes here.
const NODE_CLASSES = {
  ImageUploader,
  Grayscale,
  Contrast,
  ShowPixelBuffer,
  OptHillClimb,
  Rasterize,
  ImageDiff,
  CanvasSetup,
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

/**
 * Layout:
 *
 *   CanvasSetup → ImageUploader → Contrast → Grayscale → ShowBuffer[input]
 *                                                └──→ PixelToVector → Rasterize → ShowBuffer[output]
 *
 * CanvasSetup feeds only ImageUploader. ImageUploader resizes the image to the
 * configured canvas dimensions before it enters the pipeline.
 */
const PRESET_BASIC_TRACING = {
  nodes: [
    { id: 'canvassetup-0',   type: 'CanvasSetup',     x: 40,   y: 40,  params: { widthCm: 15, heightCm: 10, dpi: 96, penWidthMm: 0.7 } },
    { id: 'imageuploader-1', type: 'ImageUploader',   x: 40,   y: 260, params: { fitMode: 'fit' } },
    { id: 'contrast-2',      type: 'Contrast',        x: 310,  y: 260, params: { amount: 1.2 } },
    { id: 'grayscale-3',     type: 'Grayscale',       x: 580,  y: 260, params: {} },
    { id: 'showbuffer-4',    type: 'ShowPixelBuffer', x: 850,  y: 260, params: {} },
    { id: 'ptv-5',           type: 'OptHillClimb',    x: 580,  y: 480, params: { rounds: 300, penWidthPx: 2 } },
    { id: 'rasterize-6',     type: 'Rasterize',       x: 850,  y: 480, params: {} },
    { id: 'showbuffer-7',    type: 'ShowPixelBuffer', x: 1120, y: 480, params: {} },
  ],
  edges: [
    { from: 'canvassetup-0',   fromPort: 'config', to: 'imageuploader-1', toPort: 'config' },
    { from: 'imageuploader-1', fromPort: 'image',  to: 'contrast-2',      toPort: 'image'  },
    { from: 'contrast-2',      fromPort: 'image',  to: 'grayscale-3',     toPort: 'image'  },
    { from: 'grayscale-3',     fromPort: 'image',  to: 'showbuffer-4',    toPort: 'image'  },
    { from: 'grayscale-3',     fromPort: 'image',  to: 'ptv-5',           toPort: 'image'  },
    { from: 'ptv-5',           fromPort: 'vector', to: 'rasterize-6',     toPort: 'vector' },
    { from: 'rasterize-6',     fromPort: 'image',  to: 'showbuffer-7',    toPort: 'image'  },
  ],
};

export const PRESETS = [
  { name: 'Basic Tracing', pipeline: PRESET_BASIC_TRACING },
];
