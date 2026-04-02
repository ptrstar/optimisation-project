# Image Processing Pipeline — CLAUDE.md

## Project Overview

A browser-based node graph for building image processing pipelines. The end goal is an optimisation algorithm that takes a raster image and produces a generative line drawing by iteratively minimising the difference between the input and a rasterised vector image.

No build step. Plain HTML/CSS/JS (ES modules). Tailwind via CDN. No npm dependencies.

---

## File Structure

```
index.html          — entry point: dot-grid background, sidebar + graph area
main.js             — palette, run button, presets, drag-to-connect, event listeners
pipeline.js         — Pipeline: owns nodes/edges/widgets, topo-sort execution, edge drawing
pipelines.js        — encodePipeline(), loadPreset(), PRESETS array
widgets.js          — NodeWidget: DOM card per node, port dots, node-specific UI
types/
  PortTypes.js      — type constants, PORT_COLORS, validators, checkType/assertType/isCompatible/getValueType
nodes/
  BaseNode.js       — abstract base; also defines getParams()/setParams() stubs
  CanvasSetup.js    — physical canvas dimensions + pen config → canvas_config
  ImageUploader.js
  Grayscale.js
  Contrast.js
  ShowPixelBuffer.js
  PixelToVector.js  — hill-climbing optimisation: gs_rasterimage → vectorimage
  Rasterize.js      — vectorimage → rgba_rasterimage
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
| `CANVAS_CONFIG` | `'canvas_config'` | `{ widthCm, heightCm, dpi, ppcm, penWidthMm, penWidthPx, widthPx, heightPx }` |

**Compatibility:** `gs_rasterimage → rgba_rasterimage` is allowed one-way. All other type mismatches throw at connect time.

**Tagging raster images:** every node that produces an `ImageData` must set `._portType` before calling `_setOutput`.

**Exports:** `PortTypes`, `PORT_COLORS`, `checkType`, `assertType`, `isCompatible`, `getValueType`.

---

## Node Architecture

### `BaseNode`

- `inputSchema` / `outputSchema` — `{ portName: PortType }`, declared by each subclass constructor
- `inputs` / `outputs` — `{ portName: value | null }`, initialised by subclass
- `setInput(port, value)` — plain assignment, no type check (safety is at connect-time)
- `_setOutput(port, value)` — validates with `assertType` then assigns
- `run()` — throws; must be overridden. May be `async`.
- `getParams()` — returns a plain object of serialisable config; default `{}`
- `setParams(p)` — restores config from a plain object; default no-op

### Node Specifications

| Node | inputs | outputs | Notes |
|---|---|---|---|
| `CanvasSetup` | — | `config: canvas_config` | User sets `widthCm`, `heightCm`, `dpi`, `penWidthMm`. Derives `ppcm = dpi/2.54`, `penWidthPx`, `widthPx`, `heightPx`. |
| `ImageUploader` | — | `image: rgba_rasterimage` | `loadFile(file)` decodes via `OffscreenCanvas`, tags `._portType`. |
| `Grayscale` | `image: rgba_rasterimage` | `image: gs_rasterimage` | `lum = 0.299R + 0.587G + 0.114B`, R=G=B=lum, A=255. |
| `Contrast` | `image: rgba_rasterimage`, `amount: scalar` | `image: rgba_rasterimage` | `(px−128)×amount+128`, clamp. `amount` defaults to `1.0`. |
| `ShowPixelBuffer` | `image: rgba_rasterimage`, `config: canvas_config` | — | Writes `ImageData` to `this.previewCanvas`. If `config` connected, sets CSS `width/height` in `cm` for real-world size. |
| `PixelToVector` | `image: gs_rasterimage`, `config: canvas_config` | `vector: vectorimage` | Hill-climbing optimisation. See below. |
| `Rasterize` | `vector: vectorimage`, `config: canvas_config` | `image: rgba_rasterimage` | White canvas, black polylines. Uses `config.penWidthPx` as default stroke width. |
| `ImageDiff` | `imageA: rgba_rasterimage`, `imageB: rgba_rasterimage` | `diff: rgba_rasterimage`, `score: scalar` | Per-pixel MAE; `score` is the fitness value. |

### `PixelToVector` — optimisation

Hill-climbing over random line candidates. On each iteration a random line is proposed; if rasterising it reduces the MAE score against the target, it is kept.

- **`config` input (optional):** if connected, the target is resized to `config.widthPx × config.heightPx` before optimising, and `config.penWidthPx` is used as the fixed line width. This ensures the optimisation operates at physically-correct resolution with the actual pen nib size.
- **`this.iterations`** — number of hill-climbing attempts (default 300, exposed as a number input in the widget).
- **`this.onProgress(pct, score)`** — called every 20 iterations; wired by the widget to drive the progress bar.
- **`this.onPreview(gsPixels, w, h)`** — called every 100 iterations with a `Uint8Array` of single-channel luminance; wired by the widget to render a live preview canvas inside the card.
- Lines use a fixed width (`penWidthPx`), random angle/length (up to 40% of diagonal), and slightly varying opacity (0.6–1.0) to simulate ink pressure.
- Scores both sides as single-channel greyscale (R only) — no per-channel overhead.

---

## `formats/VectorImage`

```
VectorImage { width, height, lines: Array<{ points: Array<{x,y}>, style: { width?, color?, opacity? } }> }
```

- `addLine(points, style={})` — pushes a stroke
- `clone()` — deep copy

`point`, `line`, and `vectorimage` map directly to the port types of the same name.

---

## `widgets.js` — `NodeWidget`

Each node gets one `NodeWidget`. Key responsibilities:

- **Card DOM** — `position:absolute`, draggable via header.
- **Header** — amber pulsing dot (running indicator), node label, ▶ run-single button, 🗑 trash button.
  - ▶ fires `node-run-single` (bubbles)
  - 🗑 fires `node-remove` (bubbles)
- **Port dots** — coloured circles on card edges. Right-click fires `port-disconnect` (bubbles).
- **`setRunning(bool)`** — shows/hides pulsing dot; for `PixelToVector` also shows/hides the progress bar and live preview.
- **`update()`** — refreshes in-card displays after `run()` (uploader preview, diff canvas + score).
- **`_renderPreview(canvas, imageData, maxW, maxH)`** — aspect-correct display sizing.
- **`updateProgress(pct, score)`** — drives progress bar and score label on `PixelToVector`.
- **`updatePtvPreview(gsPixels, w, h)`** — converts single-channel `Uint8Array` to RGBA and paints the live preview canvas on `PixelToVector`.

Node-specific content:
- `CanvasSetup` — number inputs for `widthCm`, `heightCm`, `dpi`, `penWidthMm`; live derived info line (`WxH px · pen Xpx`).
- `ImageUploader` — file input + aspect-correct preview canvas.
- `Contrast` — range slider `[0–3]`, live label. Fires `node-param-changed` on input.
- `ShowPixelBuffer` — scrollable container (max 320×320px) with canvas. When `config` is wired, canvas CSS size is set to `Xcm × Ycm` for a physical-size preview.
- `PixelToVector` — iterations number input; progress bar + score (shown while running); live preview canvas (shown every 100 iterations, hidden when done).
- `ImageDiff` — score label + diff canvas.

---

## `pipeline.js` — `Pipeline`

- `addNode(node, x, y)` — creates widget, mounts to graph
- `connect(fromNode, fromPort, toNode, toPort)` — type-checks, replaces existing edge on same input port, redraws
- `removeNode(node)` — removes node, all its edges, and its widget DOM element
- `disconnectPort(node, port, direction)` — removes edges on that port; nulls input value for input ports
- `clear()` — removes all nodes, edges, and widgets
- `run()` — async, full topo-sort execution
- `runFrom(startNode)` — async; feeds cached upstream outputs into `startNode`, then runs `startNode` + all downstream nodes without re-running upstream
- `drawEdges(tempLine?)` — colour-coded cubic beziers; dashed drag-preview if `tempLine` given

---

## `pipelines.js` — Serialisation & Presets

### Adding a new node type

1. Import the class in `pipelines.js` and add it to `NODE_CLASSES`.
2. Implement `getParams()` / `setParams(p)` on the node class for any configurable state.
3. That's it — `encodePipeline` and `loadPreset` are fully generic.

### `encodePipeline(pipeline)`

Returns a plain JSON-safe object:
```js
{
  nodes: [{ id, type, x, y, params }],  // type = constructor.name
  edges: [{ from, fromPort, to, toPort }]
}
```

### `loadPreset(pipeline, preset)`

Calls `pipeline.clear()`, reconstructs nodes via `NODE_CLASSES[spec.type]`, calls `node.setParams(spec.params)`, then reconnects edges. Returns the highest numeric node-id suffix so `main.js` can advance `nodeCounter`.

### Sidebar

- **Export to Console** button — calls `encodePipeline`, logs JSON, shows toast. Copy-paste into `PRESETS` in `pipelines.js` to save a preset.
- **Presets** section — one button per entry in `PRESETS`; click loads that preset.

### Adding a preset

Add an entry to the `PRESETS` array in `pipelines.js`:
```js
{ name: 'My Preset', pipeline: { nodes: [...], edges: [...] } }
```
The easiest way to author one is to build the pipeline in the UI and click "Export to Console".

---

## `main.js` — Event wiring

- Palette buttons → `new cls(id)`, `pipeline.addNode`
- Run button → `pipeline.run()` (async, guarded by `isRunning`)
- Export button → `encodePipeline`, `console.log`
- Preset buttons → `loadPreset(pipeline, preset.pipeline)`
- `node-run-single` → `pipeline.runFrom(node)` (blocked while running)
- `node-updated` → `tryAutoRun()` (fired by ImageUploader after file load)
- `node-param-changed` → `tryAutoRun()` (fired by Contrast slider, CanvasSetup inputs)
- `node-remove` → `pipeline.removeNode(node)`
- `port-disconnect` → `pipeline.disconnectPort(node, port, direction)`
- Auto-run toggle (on by default) — `tryAutoRun()` skips if `pipeline.isRunning`
