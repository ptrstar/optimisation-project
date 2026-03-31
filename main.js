import { Pipeline }        from './pipeline.js';
import { ImageUploader }   from './nodes/ImageUploader.js';
import { Grayscale }       from './nodes/Grayscale.js';
import { Contrast }        from './nodes/Contrast.js';
import { ShowPixelBuffer } from './nodes/ShowPixelBuffer.js';
import { PixelToVector }   from './nodes/PixelToVector.js';
import { Rasterize }       from './nodes/Rasterize.js';
import { ImageDiff }       from './nodes/ImageDiff.js';

const NODE_REGISTRY = [
  { label: 'Image Uploader',   cls: ImageUploader,   icon: '+'  },
  { label: 'Grayscale',        cls: Grayscale,        icon: '+'  },
  { label: 'Contrast',         cls: Contrast,         icon: '+' },
  { label: 'Show Buffer',      cls: ShowPixelBuffer,  icon: '+' },
  { label: 'Pixel to Vector',  cls: PixelToVector,    icon: '+'  },
  { label: 'Rasterize',        cls: Rasterize,        icon: '+' },
  { label: 'Image Diff',       cls: ImageDiff,        icon: '+'  },
];

// DOM refs
const canvasEl  = document.getElementById('edges');
const graphEl   = document.getElementById('graph');
const paletteEl = document.getElementById('node-palette');
const runBtn    = document.getElementById('run-btn');

const pipeline = new Pipeline(canvasEl, graphEl);

let nodeCounter = 0;

function nextPosition() {
  const cols = Math.max(1, Math.floor((graphEl.offsetWidth - 60) / 260));
  const col  = nodeCounter % cols;
  const row  = Math.floor(nodeCounter / cols);
  return { x: 40 + col * 260, y: 40 + row * 180 };
}

// Build sidebar palette
for (const entry of NODE_REGISTRY) {
  const btn = document.createElement('button');
  btn.className = 'w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 text-gray-600 transition-colors flex items-center gap-2';
  btn.innerHTML = `<span>${entry.icon}</span><span>${entry.label}</span>`;

  btn.addEventListener('click', () => {
    const { x, y } = nextPosition();
    const id   = entry.cls.name.toLowerCase() + '-' + nodeCounter;
    const node = new entry.cls(id);
    pipeline.addNode(node, x, y);
    nodeCounter++;
  });

  paletteEl.appendChild(btn);
}

// Run button
runBtn.addEventListener('click', () => {
  try {
    pipeline.run();
    showToast('Pipeline ran successfully', 'success');
  } catch (err) {
    console.error(err);
    showToast(err.message, 'error');
  }
});

// Connection drag state
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
  const prev     = pendingConn;
  pendingConn    = null;

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

// Auto-run pipeline when a node updates (e.g. image loaded)
graphEl.addEventListener('node-updated', () => {
  try {
    pipeline.run();
  } catch (e) {
    // Silent — user can manually run or check errors via run button
  }
});

// Remove node when trash icon is clicked
graphEl.addEventListener('node-remove', (e) => {
  pipeline.removeNode(e.detail.node);
});

// Right-click on a port dot disconnects it
graphEl.addEventListener('port-disconnect', (e) => {
  const { node, port, direction } = e.detail;
  pipeline.disconnectPort(node, port, direction);
});

window.addEventListener('resize', () => pipeline.drawEdges());

// Toast notification
function showToast(msg, type = 'info') {
  const toast    = document.getElementById('toast');
  const inner    = toast.querySelector('div');
  const colorMap = {
    success: 'bg-green-500',
    error:   'bg-red-500',
    info:    'bg-gray-700',
  };

  // Remove old color classes
  inner.classList.remove('bg-green-500', 'bg-red-500', 'bg-gray-700');
  inner.classList.add(colorMap[type] ?? 'bg-gray-700');
  inner.textContent = msg;

  toast.classList.remove('hidden');

  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
