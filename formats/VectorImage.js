export class VectorImage {
  constructor(width, height) {
    this.width  = width;
    this.height = height;
    this.lines  = []; // Array<{ points: Array<{x,y}>, style: object }>
  }

  // points: Array<{ x, y }>
  // style: { width?: Number, color?: Color, opacity?: Number }
  addLine(points, style = {}) {
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
