import { isCompatible, PORT_COLORS } from './types/PortTypes.js';
import { NodeWidget } from './widgets.js';

export class Pipeline {
  constructor(canvasEl, graphEl) {
    this.canvas  = canvasEl;
    this.graph   = graphEl;
    this.ctx     = canvasEl.getContext('2d');
    this.nodes   = [];
    this.edges   = []; // { fromNode, fromPort, toNode, toPort }
    this.widgets = [];

    graphEl.addEventListener('widget-moved', () => this.drawEdges());
  }

  addNode(node, x, y) {
    this.nodes.push(node);
    const widget = new NodeWidget(node, x, y);
    widget.mount(this.graph);
    this.widgets.push(widget);
    return widget;
  }

  getWidget(node) {
    return this.widgets.find(w => w.node === node) ?? null;
  }

  removeNode(node) {
    this.edges = this.edges.filter(e => e.fromNode !== node && e.toNode !== node);
    const widget = this.getWidget(node);
    if (widget?.el) widget.el.remove();
    this.widgets = this.widgets.filter(w => w.node !== node);
    this.nodes   = this.nodes.filter(n => n !== node);
    this.drawEdges();
  }

  disconnectPort(node, portName, direction) {
    if (direction === 'input') {
      this.edges = this.edges.filter(e => !(e.toNode === node && e.toPort === portName));
      node.inputs[portName] = null;
    } else {
      this.edges = this.edges.filter(e => !(e.fromNode === node && e.fromPort === portName));
    }
    this.drawEdges();
  }

  connect(fromNode, fromPort, toNode, toPort) {
    const outType = fromNode.outputSchema[fromPort];
    const inType  = toNode.inputSchema[toPort];

    if (outType && inType && !isCompatible(outType, inType)) {
      throw new TypeError(
        `Cannot connect ${fromNode.id}.${fromPort} [${outType}] → ${toNode.id}.${toPort} [${inType}]`
      );
    }

    // Remove any existing edge feeding this same input port
    this.edges = this.edges.filter(e => !(e.toNode === toNode && e.toPort === toPort));

    this.edges.push({ fromNode, fromPort, toNode, toPort });
    this.drawEdges();
  }

  run() {
    const sorted = this._topoSort();

    for (const node of sorted) {
      // Propagate outputs from incoming edges into this node's inputs
      for (const edge of this.edges) {
        if (edge.toNode === node) {
          const value = edge.fromNode.getOutput(edge.fromPort);
          node.setInput(edge.toPort, value);
        }
      }

      try {
        node.run();
      } catch (err) {
        throw new Error(`Node "${node.id}" failed: ${err.message}`);
      }

      const widget = this.getWidget(node);
      if (widget) widget.update();
    }
  }

  _topoSort() {
    const visited = new Set();
    const result  = [];

    const visit = (node) => {
      if (visited.has(node)) return;
      visited.add(node);

      // Visit all nodes that feed into this node first
      for (const edge of this.edges) {
        if (edge.toNode === node) {
          visit(edge.fromNode);
        }
      }

      result.push(node);
    };

    for (const node of this.nodes) {
      visit(node);
    }

    return result;
  }

  drawEdges(tempLine = null) {
    // Resize canvas to match graph container
    this.canvas.width  = this.graph.offsetWidth;
    this.canvas.height = this.graph.offsetHeight;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw established edges
    for (const edge of this.edges) {
      const fromWidget = this.getWidget(edge.fromNode);
      const toWidget   = this.getWidget(edge.toNode);
      if (!fromWidget || !toWidget) continue;

      const from = fromWidget.getPortPosition('output', edge.fromPort);
      const to   = toWidget.getPortPosition('input',  edge.toPort);
      if (!from || !to) continue;

      const outType = edge.fromNode.outputSchema[edge.fromPort];
      const color   = PORT_COLORS[outType] ?? '#94a3b8';

      const dx = Math.abs(to.x - from.x) * 0.5;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.bezierCurveTo(from.x + dx, from.y, to.x - dx, to.y, to.x, to.y);
      ctx.strokeStyle  = color;
      ctx.lineWidth    = 2;
      ctx.globalAlpha  = 0.75;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Draw temporary drag line if present
    if (tempLine) {
      const { x1, y1, x2, y2 } = tempLine;
      const dx = Math.abs(x2 - x1) * 0.5;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth   = 2;
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
}
