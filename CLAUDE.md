# Image Processing Pipeline — CLAUDE.md

## Project Overview

A browser-based node graph for building image processing pipelines. The end goal is an optimisation algorithm that takes a raster image and produces a generative line drawing by iteratively minimising the difference between the input and a rasterised vector image. All boilerplate should be built first; the optimisation algorithm comes later.

No build step. Plain HTML/CSS/JS (ES modules). No frameworks other than tailwind for styling.

---

## File Structure

```
index.html          — entry point, canvas + HTML overlay for the node graph
style.css           — layout and node card styling
widgets.js          — NodeWidget class: renders a node as a card on screen, handles UI
pipeline.js         — Pipeline class: owns nodes, manages execution order
types/
  PortTypes.js      — type constants, validators, assertType(), compatibility map
nodes/
  BaseNode.js       — abstract base class all nodes extend
  ImageUploader.js
  Grayscale.js
  Contrast.js
  ShowPixelBuffer.js
  PixelToVector.js  — raster → custom VectorImage format
  Rasterize.js      — VectorImage → raster (black lines, white canvas)
  ImageDiff.js      — pixel-wise absolute difference between two images
formats/
  VectorImage.js    — VectorImage class definition
```

---

## Node Architecture

### `nodes/BaseNode.js`

All nodes extend `BaseNode`. Each subclass declares its port schemas and initialises input/output value maps to `null` in its constructor.

### Port Schema & Type Checking

Each node declares two schema objects alongside its value stores. Type checking is enforced at connection time (in `Pipeline.connect`) and on every `setInput` / `_setOutput` call.

```js
class BaseNode {
  constructor(id) {
    this.id = id;
    this.inputSchema  = {}; // { portName: PortType }  — declared by subclass
    this.outputSchema = {}; // { portName: PortType }  — declared by subclass
    this.inputs  = {};      // { portName: value | null }
    this.outputs = {};      // { portName: value | null }
    this.widget  = null;
  }

  run() { throw new Error('run() not implemented'); }

  setInput(portName, value) {
    const type = this.inputSchema[portName];
    if (type && value !== null) assertType(value, type, `${this.id}.inputs.${portName}`);
    this.inputs[portName] = value;
  }

  // Subclasses write outputs through this, not directly.
  _setOutput(portName, value) {
    const type = this.outputSchema[portName];
    if (type && value !== null) assertType(value, type, `${this.id}.outputs.${portName}`);
    this.outputs[portName] = value;
  }

  getOutput(portName) { return this.outputs[portName]; }
}
```

---

## `types/PortTypes.js`

Single source of truth for all port types. Import `PortTypes`, `checkType`, `assertType`, and `isCompatible` wherever type logic is needed.

```js
export const PortTypes = {
  RGBA_RASTERIMAGE: 'rgba_rasterimage', // ImageData tagged ._portType = 'rgba_rasterimage'
  GS_RASTERIMAGE:   'gs_rasterimage',   // ImageData tagged ._portType = 'gs_rasterimage'
  POINT:            'point',            // { x: Number, y: Number }
  LINE:             'line',             // Array<point>  — ordered polyline
  VECTORIMAGE:      'vectorimage',      // VectorImage instance
  SCALAR:           'scalar',           // Number
  BOOLEAN:          'boolean',          // Boolean
  COLOR:            'color',            // { r, g, b, a }  each 0–255
  STROKE_STYLE:     'stroke_style',     // { color: Color, width: Number, opacity: Number 0–1 }
};

// Runtime validators
const validators = {
  rgba_rasterimage: v => v instanceof ImageData && v._portType === 'rgba_rasterimage',
  gs_rasterimage:   v => v instanceof ImageData && v._portType === 'gs_rasterimage',
  point:            v => v != null && typeof v.x === 'number' && typeof v.y === 'number',
  line:             v => Array.isArray(v) && v.every(validators.point),
  vectorimage:      v => v instanceof VectorImage,
  scalar:           v => typeof v === 'number',
  boolean:          v => typeof v === 'boolean',
  color:            v => v != null && ['r','g','b','a'].every(k => typeof v[k] === 'number'),
  stroke_style:     v => v != null && validators.color(v.color)
                         && typeof v.width === 'number'
                         && typeof v.opacity === 'number',
};

// One-directional implicit compatibility: key type is accepted by value type ports.
// gs_rasterimage can flow into rgba_rasterimage inputs (grayscale → colour is lossless).
const COMPATIBLE = {
  gs_rasterimage: ['rgba_rasterimage'],
};

export function checkType(value, type) {
  const fn = validators[type];
  if (!fn) throw new Error(`Unknown port type: "${type}"`);
  return fn(value);
}

export function assertType(value, type, context = '') {
  if (!checkType(value, type)) {
    const preview = JSON.stringify(value)?.slice(0, 80) ?? String(value);
    throw new TypeError(
      `Type error${context ? ` [${context}]` : ''}: expected "${type}", got: ${preview}`
    );
  }
}

// Returns true if outType can feed into inType.
export function isCompatible(outType, inType) {
  if (outType === inType) return true;
  return (COMPATIBLE[outType] ?? []).includes(inType);
}
```

**Tagging raster images:** when any node produces an `ImageData`, it must set `._portType` before calling `_setOutput`:

```js
const img = new ImageData(data, width, height);
img._portType = 'rgba_rasterimage'; // or 'gs_rasterimage'
this._setOutput('image', img);
```

---

## Node Specifications

### `ImageUploader`
- inputs: none
- outputs: `{ image: rgba_rasterimage }`
- UI: file `<input>` rendered inside the widget card; on change, decodes the image into an `ImageData`, tags `._portType = 'rgba_rasterimage'`, and stores it

### `Grayscale`
- inputs:  `{ image: rgba_rasterimage }`
- outputs: `{ image: gs_rasterimage }`
- run(): average R/G/B channels per pixel into a single luminance value; store as RGBA `ImageData` (R=G=B=lum, A=255); tag `._portType = 'gs_rasterimage'`

### `Contrast`
- inputs:  `{ image: rgba_rasterimage, amount: scalar }`
- outputs: `{ image: rgba_rasterimage }`
- run(): apply `(pixel - 128) * amount + 128`, clamp to [0, 255] per R/G/B channel
- `amount` defaults to `1.0` if the port has no incoming connection; expose a range slider in the widget

### `ShowPixelBuffer`
- inputs:  `{ image: rgba_rasterimage }` — accepts `gs_rasterimage` too via the compatibility rule
- outputs: none
- run(): renders the `ImageData` into a small `<canvas>` inside the widget card

### `PixelToVector`
- inputs:  `{ image: gs_rasterimage }`
- outputs: `{ vector: vectorimage }`
- run(): **stub only** — this is where the optimisation algorithm will live. Return an empty `VectorImage` with correct dimensions and leave a clearly marked `// TODO: implement optimisation` comment. Contract: given `this.inputs.image` (grayscale), produce a `VectorImage` whose rasterisation minimises the score returned by `ImageDiff`.

### `Rasterize`
- inputs:  `{ vector: vectorimage }`
- outputs: `{ image: rgba_rasterimage }`
- run(): draw all lines from `vector.lines` onto an offscreen `<canvas>` (white background, black strokes, each line rendered as a polyline); export as `ImageData` tagged `rgba_rasterimage`

### `ImageDiff`
- inputs:  `{ imageA: rgba_rasterimage, imageB: rgba_rasterimage }`
- outputs: `{ diff: rgba_rasterimage, score: scalar }`
- run(): per-pixel absolute difference across R/G/B; `score` is the mean absolute error. `diff` is a new `ImageData` visualising the error (tagged `rgba_rasterimage`). This node is the fitness function.

---

## `formats/VectorImage.js`

Aligns with the port type primitives: a `VectorImage` is a container of `line` values, where each `line` is an `Array<point>` and each `point` is `{ x, y }`.

```js
// point:  { x: Number, y: Number }
// line:   Array<point>  — ordered sequence of connected points (polyline)
// VectorImage: container of lines with canvas dimensions

class VectorImage {
  constructor(width, height) {
    this.width  = width;
    this.height = height;
    this.lines  = []; // Array<line>
  }

  // points: Array<{ x, y }>
  addLine(points, style = {}) {
    // style: { width?: Number, color?: Color, opacity?: Number }
    this.lines.push({ points, style });
  }

  clone() {
    const v = new VectorImage(this.width, this.height);
    v.lines = this.lines.map(l => ({
      points: l.points.map(p => ({ ...p })),
      style:  { ...l.style },
    }));
    return v;
  }
}
```

Note: `VectorImage` is the `vectorimage` port type. Individual `line` entries (i.e. `{ points, style }.points`) match the `line` port type. Individual `{ x, y }` objects match the `point` port type. These three types can also be used as standalone port types on future nodes that operate on sub-components of a vector image.

---

## `widgets.js` — `NodeWidget`

`NodeWidget` wraps a `BaseNode` instance and owns its DOM card. It is not a node itself; it is a view.

```js
class NodeWidget {
  constructor(node, x, y) {
    this.node = node;   // the BaseNode instance
    this.el = null;     // root DOM element of the card
    this.x = x;
    this.y = y;
  }

  mount(container) { /* create card el, append to container, position absolutely */ }
  renderPorts() { /* render input/output port dots on card edges */ }
  makeDraggable() { /* mousedown/mousemove/mouseup drag on the card header */ }
  update() { /* called after node.run() to refresh any display inside the card */ }
}
```

Port dots are small circles on the left (inputs) and right (outputs) edges of the card. They are used for drawing connection lines on the background canvas.

---

## `pipeline.js` — `Pipeline`

```js
class Pipeline {
  constructor(canvas) {
    this.canvas = canvas; // the background <canvas> for drawing edges
    this.nodes = [];
    this.edges = []; // { fromNode, fromPort, toNode, toPort }
    this.widgets = []; // parallel array of NodeWidget
  }

  addNode(node, x, y) { /* creates widget, mounts it */ }

  connect(fromNode, fromPort, toNode, toPort) {
    const outType = fromNode.outputSchema[fromPort];
    const inType  = toNode.inputSchema[toPort];
    if (outType && inType && !isCompatible(outType, inType)) {
      throw new TypeError(
        `Cannot connect ${fromNode.id}.${fromPort} [${outType}] → ${toNode.id}.${toPort} [${inType}]`
      );
    }
    this.edges.push({ fromNode, fromPort, toNode, toPort });
    this.drawEdges();
  }

  run(startNode) { /* topological traversal from startNode, propagate outputs to next inputs, call run() */ }
  drawEdges() { /* clear canvas, draw bezier curves between port dots */ }
}
```

---

## `index.html` Layout

- Full-page layout: left sidebar (~220px) + main canvas area
- Sidebar: list of available node types; clicking one adds it to the pipeline at a default position
- Main area: a `<canvas id="edges">` fills the background (for drawing connection beziers), `<div id="graph">` overlays it with `position: absolute` and holds all `NodeWidget` card elements
- Cards are positioned absolutely inside `#graph` and are draggable
- A **Run** button triggers `pipeline.run()`

---

## Implementation Notes

- Use ES modules (`type="module"` on script tags); import with relative paths
- `ImageData` objects are created via `new ImageData(data, width, height)` or from an offscreen canvas context
- For the optimisation algorithm stub in `PixelToVector`, leave a clearly marked `// TODO: implement optimisation` comment with a description of the expected contract: given `this.inputs.image`, produce a `VectorImage` that minimises the score returned by `ImageDiff`
- Do not add a bundler, TypeScript, or any npm dependencies
