# Image Pipeline

A browser-based node graph for building image processing pipelines. The main trick: an optimisation algorithm takes a raster image and produces a generative line drawing by iteratively minimising the difference between the input and a rasterised vector image.

![Example render](renders/optgreedyseq-11.png)

## Running it

No installation, no build step, no npm.

**Option 1 — Python (easiest)**

```bash
cd optimisation-project
python3 -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

**Option 2 — Node.js**

```bash
npx serve .
```

**Option 3 — VS Code**

Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension, right-click `index.html` → *Open with Live Server*.

> **Why not just double-click `index.html`?**
> The app uses ES modules (`import`/`export`), which browsers block over `file://`. Any local HTTP server works — it just needs to serve files over `http://`.

---

## How to use it

The UI is a node graph. Add nodes from the left sidebar and connect their ports by dragging from one coloured dot to another.

### Basic flow

```
ImageUploader → Grayscale → [opt node] → Rasterize → ShowPixelBuffer
```

1. Add an **ImageUploader** node and load a photo.
2. Add a **Grayscale** node and connect it to the uploader's output.
3. Add an optimisation node (see below) and connect it to the grayscale output.
4. Hit **Run** (top of sidebar) or press the ▶ button on any node to run from there.
5. Add **Rasterize → ShowPixelBuffer** to preview the output, or **ImageDiff** to see the error.

### Preset pipelines

Click any preset button at the bottom of the sidebar to load a ready-made pipeline. These are good starting points.

### Exporting

Click **Export to Console** — this prints the current pipeline as JSON to the browser's developer console. You can paste it back as a preset entry in `pipelines.js`.

---

## Optimisation nodes

All optimisation nodes show a live preview and progress bar while running. Parameters are tunable directly on the node card. **scoreScale** (default 0.5) controls the fraction of full resolution used for scoring — lower is faster, higher is sharper.

---

### OptStipple — weighted Voronoi stippling ✦ recommended

Off-the-shelf weighted Voronoi stippling via Lloyd's relaxation. Importance-samples initial dot positions from a darkness-weighted distribution, then iteratively moves each dot to the weighted centroid of its Voronoi cell. The results are consistently beautiful — dense stippling in dark areas, sparse in light ones. If you just want something that looks great with minimal fiddling, start here.

**Key params:** `dotCount` (how many dots), `iterations` (more = smoother convergence), `dotRadius`, `varyRadius` (scale dot size by local darkness).

---

### OptGreedySequential — greedy hatching

Places one short line segment at a time. For each new stroke it tests a batch of random candidates and commits whichever one reduces the error most. Scoring uses a blur-based metric: dense hatching blurs into a gray that should match the target — so the algorithm naturally packs lines into dark regions. Also uses Sobel gradients to bias new strokes along contours rather than across them.

Produces good hatching-style results. More lines and more candidates = better quality but slower.

**Key params:** `lineCount`, `candidates` (random strokes evaluated per step), `blurRadius`, `gradBias` (0 = random placement, 1 = fully contour-aligned).

---

### OptGreedyPoints — single continuous polyline ✦ good results, room to grow

Grows one long continuous polyline through the image rather than placing many independent segments. Starts at the darkest pixel it can find, then at each step samples candidate next-points within a step radius, biased toward the current direction of travel. Commits the best candidate (with occasional random escapes to avoid dead ends).

The single-polyline output is plottable in one pen-lift-free stroke, which is great for pen plotters. Results are already good, but the algorithm has a lot of room for further tuning — direction bias, acceptance probability, and step radius all interact in interesting ways.

**Key params:** `maxPoints`, `candidates` (per step), `stepRadius` (max step length as % of diagonal), `directionBias` (0 = random walk, 1 = always go straight), `acceptanceProb` (chance of picking a random candidate instead of the best — helps escape local minima).

---

### OptWiggle — polyline refinement

Takes an existing vector (typically from OptGreedyPoints) and refines it by wiggling interior polyline points. Each round picks a random interior vertex, tests candidate displaced positions, and commits any move that reduces blur-MAE. Pairs naturally with OptGreedyPoints as a two-stage pipeline: grow a rough polyline, then polish it.

Connect: `OptGreedyPoints → OptWiggle` (OptWiggle takes both a `vector` and a grayscale `image` input).

**Key params:** `rounds`, `candidates` (per wiggle), `wiggleRadius` (max displacement as % of diagonal).

---

### OptNeedle — experimental

Uses the same blur-MAE scoring infrastructure as OptGreedySequential (save/restore region, exact local re-blur, scoreDelta). The algorithm loop is a work-in-progress — think of it as a scratchpad for new ideas. Results are already reasonable for short runs.

**Key params:** `rounds`, `lineCount`, `minLenFrac` / `maxLenFrac` (stroke length range as % of diagonal).

---

### OptHillClimb — simple baseline

Initialises `lineCount` random lines, then each round picks one and nudges both endpoints. Keeps the move if it reduces error. Fast to run and easy to understand, but the greedy and stipple approaches generally produce better output.

---

### OptGenetic — search-space explorer

Tournament selection + uniform crossover + nudge/replace mutation + elitism. Useful when you want to explore a wider range of configurations than hill-climbing allows, at the cost of needing more tuning (population size, mutation rate, elite count all matter).

**Key params:** `generations`, `popSize`, `lineCount`, `mutationRate`, `mutationAmp`, `eliteCount`, `tournamentK`.

---

## File overview

```
index.html      — entry point
main.js         — palette, run button, presets, drag-to-connect
pipeline.js     — node graph engine (topo-sort, edge drawing)
pipelines.js    — presets + serialisation
widgets.js      — DOM card per node
nodes/          — one file per node type
types/          — port type constants and validators
formats/        — VectorImage class
renders/        — example output images
```

---

## Tips

- **Pan** the canvas by holding middle-mouse or using the pan controls.
- **Right-click** a port dot to disconnect it.
- Nodes run in topological order — upstream results are cached, so "Run from here" on a downstream node is fast.
- `scoreScale: 0.5` is a good default. Drop it lower (e.g. `0.25`) for a quick preview, raise it to `1.0` for final quality.
