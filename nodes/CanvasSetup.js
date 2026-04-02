import { BaseNode } from './BaseNode.js';
import { PortTypes } from '../types/PortTypes.js';

export class CanvasSetup extends BaseNode {
  constructor(id) {
    super(id);
    this.inputSchema  = {};
    this.outputSchema = { config: PortTypes.CANVAS_CONFIG };
    this.inputs       = {};
    this.outputs      = { config: null };

    this.widthCm    = 15;    // paper width in centimetres
    this.heightCm   = 10;    // paper height in centimetres
    this.dpi        = 96;    // output resolution in dots per inch
    this.penWidthMm = 0.7;   // pen nib width in millimetres
  }

  get ppcm() { return this.dpi / 2.54; }  // derived: pixels per cm

  run() {
    const ppcm       = this.ppcm;
    const penWidthPx = this.penWidthMm * ppcm / 10;
    const widthPx    = Math.round(this.widthCm  * ppcm);
    const heightPx   = Math.round(this.heightCm * ppcm);

    this._setOutput('config', {
      widthCm:    this.widthCm,
      heightCm:   this.heightCm,
      dpi:        this.dpi,
      ppcm,
      penWidthMm: this.penWidthMm,
      penWidthPx,
      widthPx,
      heightPx,
    });
  }

  getParams() {
    return {
      widthCm:    this.widthCm,
      heightCm:   this.heightCm,
      dpi:        this.dpi,
      penWidthMm: this.penWidthMm,
    };
  }

  setParams(p) {
    if (p.widthCm    != null) this.widthCm    = p.widthCm;
    if (p.heightCm   != null) this.heightCm   = p.heightCm;
    if (p.dpi        != null) this.dpi        = p.dpi;
    if (p.penWidthMm != null) this.penWidthMm = p.penWidthMm;
    // Legacy: accept ppcm from old presets by converting back to dpi
    if (p.ppcm       != null && p.dpi == null) this.dpi = Math.round(p.ppcm * 2.54);
  }
}
