# Image Processing Pipeline — CLAUDE.md

## Project Overview

A browser-based node graph for building image processing pipelines. The end goal is an optimisation algorithm that takes a raster image and produces a generative line drawing by iteratively minimising the difference between the input and a rasterised vector image.

No build step. Plain HTML/CSS/JS (ES modules). Tailwind via CDN. No npm dependencies.

---

## File Structure

```
index.html          — entry point: dot-grid background, sidebar + graph area
main.js             — wires up palette, run button, drag-to-connect, event listeners
pipeline.js         — Pipeline: owns nodes/edges/widgets, topo-sort execution, edge drawing
widgets.js          — NodeWidget: DOM card per node, port dots, node-specific UI
types/
  PortTypes.js      — type constants, PORT_COLORS, validators, checkType/assertType/isCompatible/getValueType
nodes/
  BaseNode.js       — abstract base (inputSchema, outputSchema, setInput, _setOutput, run)
  ImageUploader.js
  Grayscale.js
  Contrast.js
  ShowPixelBuffer.js
  PixelToVector.js  — raster → VectorImage (optimisation stub)
  Rasterize.js      — VectorImage → raster
  ImageDiff.js      — fitness function
formats/
  VectorImage.js    — VectorImage class
```

---

## Port Type System

Defined in `types/PortTypes.js`. All type strings are constants on `PortTypes`.

| Constant | String | JS value |
|---|---|---|
| `RGBA_RASTERIMAGE` | `'rgba_rasterimage'` | `ImageData` tagged `._portType = 'rgba_rasterimage'` |
| `GS_RASTERIMAGE` | `'gs_rasterimage'` | `ImageData` tagged `._portType = 'gs_rasterimage'` |
| `POINT` | `'point'` | `{ x: Number, y: Number }` |
| `LINE` | `'line'` | `Array<point>` — ordered polyline |
| `VECTORIMAGE` | `'vectorimage'` | `VectorImage` instance (duck-typed: has `.lines`, `.width`) |
| `SCALAR` | `'scalar'` | `Number` |
| `BOOLEAN` | `'boolean'` | `Boolean` |
| `COLOR` | `'color'` | `{ r, g, b, a }` each 0–255 |
| `STROKE_STYLE` | `'stroke_style'` | `{ color: Color, width: Number, opacity: Number }` |

**Compatibility:** `gs_rasterimage → rgba_rasterimage` is allowed one-way (checked via `isCompatible`). All other type mismatches throw at connect time.

**Tagging raster images:** every node that produces an `ImageData` must set `._portType` before calling `_setOutput`.

**Exports:** `PortTypes`, `PORT_COLORS`, `checkType`, `assertType`, `isCompatible`, `getValueType`.

---

## Node Architecture

### `BaseNode`

- `inputSchema` / `outputSchema` — `{ portName: PortType }`, declared by each subclass constructor
- `inputs` / `outputs` — `{ portName: value | null }`, initialised to `null` by subclass
- `setInput(port, value)` — assigns directly, no type check (type safety is at connect-time)
- `_setOutput(port, value)` — validates with `assertType` then assigns; subclasses always use this
- `run()` — throws; must be overridden

### Node Specifications

| Node | inputs | outputs | Notes |
|---|---|---|---|
| `ImageUploader` | — | `image: rgba_rasterimage` | `loadFile(file)` decodes via `OffscreenCanvas`, tags and `_setOutput`s |
| `Grayscale` | `image: rgba_rasterimage` | `image: gs_rasterimage` | `lum = 0.299R + 0.587G + 0.114B`, stores as RGBA with R=G=B=lum |
| `Contrast` | `image: rgba_rasterimage`, `amount: scalar` | `image: rgba_rasterimage` | `(px−128)×amount+128`, clamp; `amount` defaults to `1.0` |
| `ShowPixelBuffer` | `image: rgba_rasterimage` | — | Writes to `this.previewCanvas` (set by widget); accepts `gs_rasterimage` via compat |
| `PixelToVector` | `image: gs_rasterimage` | `vector: vectorimage` | **Stub** — returns empty `VectorImage`. See optimisation contract below. |
| `Rasterize` | `vector: vectorimage` | `image: rgba_rasterimage` | White canvas, black polyline strokes, exports `ImageData` |
| `ImageDiff` | `imageA/imageB: rgba_rasterimage` | `diff: rgba_rasterimage`, `score: scalar` | Per-pixel MAE; `score` is the fitness function value |

### `PixelToVector` optimisation contract

```js
// TODO: implement optimisation
// Given: this.inputs.image (gs_rasterimage)
// Produce: a VectorImage whose rasterisation minimises the score from ImageDiff
// Return via: this._setOutput('vector', vector)
```

---

## `formats/VectorImage`

```
VectorImage { width, height, lines: Array<{ points: Array<{x,y}>, style: { width?, color?, opacity? } }> }
```

- `addLine(points, style={})` — pushes a stroke
- `clone()` — deep copy

`point`, `line` (= `Array<point>`), and `vectorimage` map directly to the port types of the same name.

---

## `widgets.js` — `NodeWidget`

Each node gets one `NodeWidget`. Key responsibilities:

- **Card DOM** — `position:absolute`, draggable via header. Header has a trash icon (top-right) that fires `node-remove` (bubbles).
- **Port dots** — coloured circles on left (inputs) / right (outputs) edges. Attributes: `data-direction`, `data-port`, `data-type`, `data-node-id`. Right-click fires `port-disconnect` (bubbles).
- **`getPortPosition(direction, port)`** — returns `{x, y}` of dot centre relative to the graph container (used by `pipeline.drawEdges`).
- **`update()`** — called after `run()` to refresh in-card displays (uploader preview, diff canvas + score).
- **`_renderPreview(canvas, imageData, maxW=180, maxH=160)`** — sets canvas pixel dims to image size, then sets CSS `width`/`height` to an aspect-ratio-correct display size capped at `maxW×maxH`.

Node-specific content:
- `ImageUploader` — file input + preview canvas (shown after load)
- `Contrast` — range slider `[0–3]`, live label
- `ShowPixelBuffer` — canvas element wired to `node.previewCanvas`
- `ImageDiff` — score label + diff canvas
- `PixelToVector` — italic "Optimisation stub" label

---

## `pipeline.js` — `Pipeline`

- `addNode(node, x, y)` — creates widget, mounts to graph
- `connect(fromNode, fromPort, toNode, toPort)` — type-checks with `isCompatible`, replaces any existing edge on the same input port, redraws
- `removeNode(node)` — removes node, all edges touching it, and the widget DOM element
- `disconnectPort(node, port, direction)` — removes edges on that port; nulls `node.inputs[port]` for input ports
- `run()` — DFS topological sort, propagates outputs → inputs along edges, calls `node.run()`, calls `widget.update()`
- `drawEdges(tempLine?)` — resizes canvas to graph size, draws colour-coded cubic beziers per edge (colour from `PORT_COLORS[outType]`); if `tempLine` is given draws a dashed drag preview

---

## `main.js` — Event wiring

- Sidebar palette: one button per node type; click → `new cls(id)`, `pipeline.addNode`
- Run button → `pipeline.run()`, toast on error
- **Drag-to-connect:** `mousedown` on `.port-dot[data-direction=output]` → track `pendingConn`; `mousemove` → `pipeline.drawEdges(tempLine)`; `mouseup` → `elementFromPoint` to find target input dot → `pipeline.connect`, toast result
- `node-remove` on graphEl → `pipeline.removeNode(e.detail.node)`
- `port-disconnect` on graphEl → `pipeline.disconnectPort(e.detail.node, e.detail.port, e.detail.direction)`
- `node-updated` on graphEl → auto-run pipeline (fired by ImageUploader after file load)
- `resize` → `pipeline.drawEdges()`
