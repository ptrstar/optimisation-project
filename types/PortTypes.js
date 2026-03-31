export const PortTypes = {
  RGBA_RASTERIMAGE: 'rgba_rasterimage',
  GS_RASTERIMAGE:   'gs_rasterimage',
  POINT:            'point',
  LINE:             'line',
  VECTORIMAGE:      'vectorimage',
  SCALAR:           'scalar',
  BOOLEAN:          'boolean',
  COLOR:            'color',
  STROKE_STYLE:     'stroke_style',
};

export const PORT_COLORS = {
  rgba_rasterimage: '#3b82f6',
  gs_rasterimage:   '#6b7280',
  point:            '#22c55e',
  line:             '#f97316',
  vectorimage:      '#8b5cf6',
  scalar:           '#f59e0b',
  boolean:          '#ef4444',
  color:            '#ec4899',
  stroke_style:     '#14b8a6',
};

// Runtime validators — vectorimage uses duck-typing to avoid circular imports
const validators = {
  rgba_rasterimage: v => v instanceof ImageData && v._portType === 'rgba_rasterimage',
  gs_rasterimage:   v => v instanceof ImageData && v._portType === 'gs_rasterimage',
  point:            v => v != null && typeof v.x === 'number' && typeof v.y === 'number',
  line:             v => Array.isArray(v) && v.every(pt => pt != null && typeof pt.x === 'number' && typeof pt.y === 'number'),
  vectorimage:      v => v != null && Array.isArray(v.lines) && typeof v.width === 'number',
  scalar:           v => typeof v === 'number',
  boolean:          v => typeof v === 'boolean',
  color:            v => v != null && ['r', 'g', 'b', 'a'].every(k => typeof v[k] === 'number'),
  stroke_style:     v => v != null && v.color != null && ['r', 'g', 'b', 'a'].every(k => typeof v.color[k] === 'number')
                         && typeof v.width === 'number' && typeof v.opacity === 'number',
};

// One-directional implicit compatibility: gs_rasterimage can flow into rgba_rasterimage inputs
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

export function isCompatible(outType, inType) {
  if (outType === inType) return true;
  return (COMPATIBLE[outType] ?? []).includes(inType);
}

export function getValueType(value) {
  if (value == null) return null;
  if (value instanceof ImageData) return value._portType ?? null;
  if (value != null && Array.isArray(value.lines) && typeof value.width === 'number') return 'vectorimage';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'scalar';
  if (Array.isArray(value) && value.length > 0 && value[0] != null && typeof value[0].x === 'number') return 'line';
  if (value != null && typeof value.x === 'number' && typeof value.y === 'number') return 'point';
  if (value != null && typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number' && typeof value.a === 'number') return 'color';
  if (value != null && value.color != null && typeof value.width === 'number' && typeof value.opacity === 'number') return 'stroke_style';
  return null;
}
