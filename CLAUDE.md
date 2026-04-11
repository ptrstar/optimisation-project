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
  BaseNode.js       — abstract base; defines getParams()/setParams() stubs
  OptBase.js        — abstract base for all optimisation nodes (extends BaseNode)
  CanvasSetup.js    — physical canvas dimensions + pen config → canvas_config
  ImageUploader.js
  Grayscale.js
  Contrast.js
  Blur.js           — separable box blur: gs_rasterimage → gs_rasterimage
  SobelGradient.js  — Sobel edge magnitude: gs_rasterimage → gs_rasterimage
  ShowPixelBuffer.js
  PixelToVector.js  — legacy stochastic hill-climb: gs_rasterimage → vectorimage
  OptHillClimb.js   — hill-climb optimisation (extends OptBase)
  OptGenetic.js     — genetic algorithm optimisation (extends OptBase)
  Rasterize.js      — vectorimage → rgba_rasterimage; also exposes static render helpers
  ImageDiff.js      — per-pixel MAE fitness node
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
- `buildContent(widget)` — optional; if defined, `NodeWidget` calls this instead of its built-in switch to build the card body. Return an `HTMLElement`.

### `OptBase` — abstract base for optimisation nodes

Extends `BaseNode`. All opt nodes should extend this instead of `BaseNode` directly.

**Provided for free:**
- Standard `{ image: gs_rasterimage }` → `{ vector: vectorimage }` I/O schema
- `this.onProgress` / `this.onPreview` callbacks — wired by `buildContent`, call from `run()`
- `this._rasterizeGS(vector)` → `Uint8Array` — delegates to `Rasterize.renderToGS`
- `this._score(vector, gsTarget)` → MAE number — delegates to `Rasterize.renderToGS`
- `getParams()` / `setParams(p)` — auto-derived from `this.paramDefs`
- `buildContent(widget)` — generates number inputs from `paramDefs`, progress bar, live preview canvas, and wires `onProgress`/`onPreview` callbacks

**To add a new optimisation node:**
1. Extend `OptBase`
2. Set default param values and declare `this.paramDefs` in the constructor:
   ```js
   this.myParam = 100;
   this.paramDefs = [
     { label: 'My param', key: 'myParam', min: 10, max: 500, step: 10 },
   ];
   ```
3. Implement `async run()` — use `this._score()`, `this._rasterizeGS()`, `this.onProgress?.()`, `this.onPreview?.()`
4. Register in `pipelines.js` `NODE_CLASSES` and `main.js` `NODE_REGISTRY`
5. **No changes to `widgets.js` needed.**

### Node Specifications

| Node | inputs | outputs | Notes |
|---|---|---|---|
| `CanvasSetup` | — | `config: canvas_config` | User sets `widthCm`, `heightCm`, `dpi`, `penWidthMm`. Derives `ppcm = dpi/2.54`, `penWidthPx`, `widthPx`, `heightPx`. |
| `ImageUploader` | — | `image: rgba_rasterimage` | `loadFile(file)` decodes via `OffscreenCanvas`, tags `._portType`. |
| `Grayscale` | `image: rgba_rasterimage` | `image: gs_rasterimage` | `lum = 0.299R + 0.587G + 0.114B`, R=G=B=lum, A=255. |
| `Contrast` | `image: rgba_rasterimage`, `amount: scalar` | `image: rgba_rasterimage` | `(px−128)×amount+128`, clamp. `amount` defaults to `1.0`. |
| `Blur` | `image: gs_rasterimage` | `image: gs_rasterimage` | Separable two-pass box blur. `radius` param (slider, default 3px). |
| `SobelGradient` | `image: gs_rasterimage` | `image: gs_rasterimage` | Sobel 3×3 kernels on R channel; output brightness = gradient magnitude. |
| `ShowPixelBuffer` | `image: rgba_rasterimage`, `config: canvas_config` | — | Writes `ImageData` to `this.previewCanvas`. If `config` connected, sets CSS `width/height` in `cm`. |
| `OptHillClimb` | `image: gs_rasterimage` | `vector: vectorimage` | Stochastic hill-climb. Starts with `lineCount` random lines, nudges endpoints each round. Extends `OptBase`. |
| `OptGenetic` | `image: gs_rasterimage` | `vector: vectorimage` | Genetic algorithm. See below. Extends `OptBase`. |
| `PixelToVector` | `image: gs_rasterimage` | `vector: vectorimage` | Legacy random-candidate hill-climb. Superseded by `OptHillClimb`. |
| `Rasterize` | `vector: vectorimage` | `image: rgba_rasterimage` | White canvas, black polylines at `style.width` / `style.opacity`. |
| `ImageDiff` | `imageA: rgba_rasterimage`, `imageB: rgba_rasterimage` | `diff: rgba_rasterimage`, `score: scalar` | Per-pixel MAE; `score` is the fitness value. |

### `OptHillClimb` — hill-climb optimisation

Initialises `lineCount` random lines, then each round picks a random line and nudges both endpoints by up to `maxAmplitude` pixels. Keeps the move if it reduces MAE score.

Params exposed via `paramDefs`: `rounds`, `penWidthPx`, `lineCount`, `maxAmplitude`.

### `OptGenetic` — genetic algorithm optimisation

Tournament selection + uniform crossover + nudge/replace mutation + elitism.

**Key efficiency choices:**
- Scoring canvas is allocated once per `run()` and cleared between evals (not reallocated per call).
- `scoreScale` param (default 0.5) scores at reduced resolution — at 0.5 each `getImageData` readback covers 4× fewer pixels, giving roughly 4× speedup with minimal quality loss for line placement.
- Target is downscaled once to a flat `Uint8Array` at score resolution; inner MAE loop has no stride multiply.
- Crossover builds `child.lines` directly without `VectorImage.clone()`. Style objects are immutable and shared by reference across individuals.
- Fitness stored in `Float32Array`.

Params: `generations`, `popSize`, `lineCount`, `penWidthPx`, `mutationRate`, `mutationAmp`, `eliteCount`, `tournamentK`, `scoreScale`.

---

## `Rasterize` — static render helpers

`Rasterize.js` exposes two static methods for use by opt nodes. **Do not reimplement rendering in opt nodes — call these instead.**

- `Rasterize.renderToRGBA(vector)` → `ImageData` — renders vector to white OffscreenCanvas, returns RGBA `ImageData` (untagged).
- `Rasterize.renderToGS(vector)` → `Uint8Array` — same render, extracts R channel as flat single-channel array. This is the fast path for opt node scoring.

The instance `run()` method calls `renderToRGBA` internally.

---

## `formats/VectorImage`

```
VectorImage { width, height, lines: Array<{ points: Array<{x,y}>, style: { width?, color?, opacity? } }> }
```

- `addLine(points, style={})` — pushes a stroke
- `clone()` — deep copy (allocates new point and style objects per line)

`point`, `line`, and `vectorimage` map directly to the port types of the same name.

**Note:** In opt node crossover, avoid `clone()` in the inner loop. Build `child.lines` directly and share immutable style refs to avoid allocation overhead.

---

## `widgets.js` — `NodeWidget`

Each node gets one `NodeWidget`. Key responsibilities:

- **Card DOM** — `position:absolute`, draggable via header.
- **Header** — amber pulsing dot (running indicator), node label, ▶ run-single button, 🗑 trash button.
  - ▶ fires `node-run-single` (bubbles)
  - 🗑 fires `node-remove` (bubbles)
- **Port dots** — coloured circles on card edges. Right-click fires `port-disconnect` (bubbles).
- **`setRunning(bool)`** — shows/hides pulsing dot; generically shows/hides `_progressWrap` and `_optPreviewWrap` (set by `OptBase.buildContent`).
- **`update()`** — refreshes in-card displays after `run()` (uploader preview, diff canvas + score).
- **`_renderPreview(canvas, imageData, maxW, maxH)`** — aspect-correct display sizing.

**Content building:** `_buildContent()` first checks if `this.node.buildContent` is a function and calls it with the widget instance. If not, falls back to a switch on `constructor.name` for legacy nodes (`CanvasSetup`, `ImageUploader`, `Contrast`, `ShowPixelBuffer`, `ImageDiff`).

**`OptBase.buildContent(widget)`** sets these refs on the widget during content building:
- `widget._progressWrap` — progress bar container (shown/hidden by `setRunning`)
- `widget._progressBar` — the bar fill element
- `widget._optScoreLabel` — score text
- `widget._optPreviewCanvas` / `widget._optPreviewWrap` — live preview (hidden until first `onPreview` call)

Node-specific content:
- `CanvasSetup` — number inputs for `widthCm`, `heightCm`, `dpi`, `penWidthMm`; live derived info line.
- `ImageUploader` — file input + fit-mode selector + aspect-correct preview canvas.
- `Contrast` — range slider `[0–3]`, live label. Fires `node-param-changed` on input.
- `ShowPixelBuffer` — scrollable container (max 300×300px) with canvas.
- `Blur` — radius slider `[0–20]` via `buildContent` on the node class itself.
- `OptHillClimb` / `OptGenetic` — auto-generated from `paramDefs` via `OptBase.buildContent`: number inputs + progress bar + live preview.
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
2. Add it to `NODE_REGISTRY` in `main.js`.
3. For opt nodes extending `OptBase`: `getParams`/`setParams` are auto-derived from `paramDefs` — nothing extra needed.
4. For other nodes: implement `getParams()` / `setParams(p)` manually.
5. That's it — `encodePipeline` and `loadPreset` are fully generic.

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
- `node-param-changed` → `tryAutoRun()` (fired by Contrast slider, CanvasSetup inputs, Blur slider)
- `node-remove` → `pipeline.removeNode(node)`
- `port-disconnect` → `pipeline.disconnectPort(node, port, direction)`
- Auto-run toggle (on by default) — `tryAutoRun()` skips if `pipeline.isRunning`