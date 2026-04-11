import { Pipeline }        from './pipeline.js';
import { PRESETS, encodePipeline, loadPreset } from './pipelines.js';
import { ImageUploader }   from './nodes/ImageUploader.js';
import { Grayscale }       from './nodes/Grayscale.js';
import { Contrast }        from './nodes/Contrast.js';
import { ShowPixelBuffer } from './nodes/ShowPixelBuffer.js';
import { OptHillClimb }         from './nodes/OptHillClimb.js';
import { OptGenetic }           from './nodes/OptGenetic.js';
import { OptGreedySequential }  from './nodes/OptGreedySequential.js';
import { Rasterize }       from './nodes/Rasterize.js';
import { ImageDiff }       from './nodes/ImageDiff.js';
import { CanvasSetup }     from './nodes/CanvasSetup.js';
import { SobelGradient }   from './nodes/SobelGradient.js';
import { Blur }            from './nodes/Blur.js';

const NODE_REGISTRY = [
  { label: 'Canvas Setup',    cls: CanvasSetup     },
  { label: 'Image Uploader',  cls: ImageUploader   },
  { label: 'Grayscale',       cls: Grayscale        },
  { label: 'Contrast',        cls: Contrast         },
  { label: 'Show Buffer',     cls: ShowPixelBuffer  },
  { label: 'Opt: Hill Climb',        cls: OptHillClimb        },
  { label: 'Opt: Genetic',           cls: OptGenetic          },
  { label: 'Opt: Greedy Sequential', cls: OptGreedySequential },
  { label: 'Rasterize',       cls: Rasterize        },
  { label: 'Image Diff',      cls: ImageDiff        },
  { label: 'Sobel Gradient',  cls: SobelGradient    },
  { label: 'Blur',            cls: Blur             },
];

// DOM refs
const canvasEl   = document.getElementById('edges');
const graphEl    = document.getElementById('graph');
const paletteEl  = document.getElementById('node-palette');
const presetsEl  = document.getElementById('presets-list');
const runBtn     = document.getElementById('run-btn');
const exportBtn  = document.getElementById('export-btn');

const pipeline = new Pipeline(canvasEl, graphEl);

// ── Auto-run toggle ──────────────────────────────────────────────────────────
let autoRun = true;

const autoRunToggle = document.getElementById('auto-run-toggle');
const autoRunLabel  = document.getElementById('auto-run-label');

autoRunToggle.addEventListener('change', () => {
  autoRun = autoRunToggle.checked;
  autoRunLabel.textContent = autoRun ? 'Auto-run on' : 'Auto-run off';
});

function tryAutoRun() {
  if (!autoRun || pipeline.isRunning) return;
  pipeline.run().catch(err => console.error('Auto-run error:', err));
}

// ── Node counter (shared between manual add and preset load) ─────────────────
let nodeCounter = 0;

function nextPosition() {
  const cols = Math.max(1, Math.floor((graphEl.offsetWidth - 60) / 260));
  const col  = nodeCounter % cols;
  const row  = Math.floor(nodeCounter / cols);
  return { x: 40 + col * 260, y: 40 + row * 180 };
}

// ── Node palette ─────────────────────────────────────────────────────────────
for (const entry of NODE_REGISTRY) {
  const btn = document.createElement('button');
  btn.className = 'w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 text-gray-600 transition-colors flex items-center gap-2';
  btn.innerHTML = `<span class="text-gray-300 font-bold">+</span><span>${entry.label}</span>`;

  btn.addEventListener('click', () => {
    const { x, y } = nextPosition();
    const id   = entry.cls.name.toLowerCase() + '-' + nodeCounter;
    const node = new entry.cls(id);
    pipeline.addNode(node, x, y);
    nodeCounter++;
  });

  paletteEl.appendChild(btn);
}

// ── Presets ───────────────────────────────────────────────────────────────────
for (const preset of PRESETS) {
  const btn = document.createElement('button');
  btn.className = 'w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-violet-50 hover:text-violet-700 text-gray-500 transition-colors flex items-center gap-2';
  btn.innerHTML = `<span class="text-gray-300">↺</span><span>${preset.name}</span>`;

  btn.addEventListener('click', () => {
    const maxNum = loadPreset(pipeline, preset.pipeline);
    nodeCounter  = maxNum + 1;
    pipeline.drawEdges();
  });

  presetsEl.appendChild(btn);
}

// ── Export button ────────────────────────────────────────────────────────────
exportBtn.addEventListener('click', () => {
  const encoded = encodePipeline(pipeline);
  console.log(JSON.stringify(encoded, null, 2));
  showToast('Pipeline JSON logged to console', 'info');
});

// ── Run button ───────────────────────────────────────────────────────────────
runBtn.addEventListener('click', async () => {
  if (pipeline.isRunning) return;
  try {
    await pipeline.run();
    showToast('Pipeline complete', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
});

// ── Per-node run button ──────────────────────────────────────────────────────
graphEl.addEventListener('node-run-single', async (e) => {
  if (pipeline.isRunning) {
    showToast('Pipeline is already running', 'info');
    return;
  }
  try {
    await pipeline.runFrom(e.detail.node);
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
});

// ── Connection drag ──────────────────────────────────────────────────────────
let pendingConn = null;

graphEl.addEventListener('mousedown', (e) => {
  const dot = e.target.closest('.port-dot');
  if (!dot || dot.dataset.direction !== 'output') return;
  e.preventDefault();
  e.stopPropagation();

  const r  = graphEl.getBoundingClientRect();
  const dr = dot.getBoundingClientRect();

  pendingConn = {
    nodeId: dot.dataset.nodeId,
    port:   dot.dataset.port,
    type:   dot.dataset.type,
    x1: dr.left + dr.width  / 2 - r.left,
    y1: dr.top  + dr.height / 2 - r.top,
  };
});

document.addEventListener('mousemove', (e) => {
  if (!pendingConn) return;
  const r = graphEl.getBoundingClientRect();
  pipeline.drawEdges({
    x1: pendingConn.x1,
    y1: pendingConn.y1,
    x2: e.clientX - r.left,
    y2: e.clientY - r.top,
  });
});

document.addEventListener('mouseup', (e) => {
  if (!pendingConn) return;
  const prev  = pendingConn;
  pendingConn = null;

  const dot = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port-dot');
  if (dot && dot.dataset.direction === 'input') {
    const fromNode = pipeline.nodes.find(n => n.id === prev.nodeId);
    const toNode   = pipeline.nodes.find(n => n.id === dot.dataset.nodeId);

    if (fromNode && toNode) {
      try {
        pipeline.connect(fromNode, prev.port, toNode, dot.dataset.port);
        showToast(`Connected ${prev.port} → ${dot.dataset.port}`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
        pipeline.drawEdges();
      }
      return;
    }
  }

  pipeline.drawEdges();
});

// ── Pipeline events ──────────────────────────────────────────────────────────

graphEl.addEventListener('node-updated',      () => tryAutoRun());
graphEl.addEventListener('node-param-changed', () => tryAutoRun());
graphEl.addEventListener('node-remove', (e)   => pipeline.removeNode(e.detail.node));
graphEl.addEventListener('port-disconnect', (e) => {
  pipeline.disconnectPort(e.detail.node, e.detail.port, e.detail.direction);
});

window.addEventListener('resize', () => pipeline.drawEdges());

// ── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const toast    = document.getElementById('toast');
  const inner    = toast.querySelector('div');
  const colorMap = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-gray-700' };

  inner.classList.remove('bg-green-500', 'bg-red-500', 'bg-gray-700');
  inner.classList.add(colorMap[type] ?? 'bg-gray-700');
  inner.textContent = msg;
  toast.classList.remove('hidden');

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}
