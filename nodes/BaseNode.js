import { assertType } from '../types/PortTypes.js';

export class BaseNode {
  constructor(id) {
    this.id           = id;
    this.inputSchema  = {}; // { portName: PortType }  — declared by subclass
    this.outputSchema = {}; // { portName: PortType }  — declared by subclass
    this.inputs       = {}; // { portName: value | null }
    this.outputs      = {}; // { portName: value | null }
    this.widget       = null;
  }

  run() {
    throw new Error('run() not implemented');
  }

  // Type safety is enforced at connect-time in Pipeline; setInput is a plain assignment.
  setInput(portName, value) {
    this.inputs[portName] = value;
  }

  // Subclasses write outputs through this, not directly.
  _setOutput(portName, value) {
    const type = this.outputSchema[portName];
    if (type && value !== null) assertType(value, type, `${this.id}.outputs.${portName}`);
    this.outputs[portName] = value;
  }

  getOutput(portName) {
    return this.outputs[portName];
  }

  // Subclasses with configurable params implement these for serialisation.
  getParams() { return {}; }
  setParams(/* params */) {}
}
