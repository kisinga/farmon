/**
 * Custom JointJS shapes for SCADA/P&ID water system topology.
 * Each shape uses standard P&ID-inspired SVG markup with ports.
 */
import * as joint from 'jointjs';

// --- Color tokens ---
const COLORS = {
  tank: '#14b8a6',      // teal
  pump: '#dc2626',      // red
  endpoint: '#6366f1',  // indigo
  valve: '#e11d48',     // rose
  flow: '#16a34a',      // green
  pipe: '#64748b',      // slate
  port: '#94a3b8',      // slate-400
  text: '#1e293b',      // slate-800
  bg: '#f8fafc',        // slate-50
};

// --- Port definitions ---
const inletPort: joint.dia.Element.Port = {
  group: 'inlet',
  attrs: { circle: { magnet: true } },
};

const outletPort: joint.dia.Element.Port = {
  group: 'outlet',
  attrs: { circle: { magnet: true } },
};

const portGroups: Record<string, joint.dia.Element.PortGroup> = {
  inlet: {
    position: { name: 'left' },
    attrs: {
      circle: {
        r: 6,
        fill: COLORS.port,
        stroke: '#fff',
        strokeWidth: 2,
      },
      text: {
        fontSize: 9,
        fill: COLORS.text,
      },
    },
    label: { position: { name: 'left' } },
  },
  outlet: {
    position: { name: 'right' },
    attrs: {
      circle: {
        r: 6,
        fill: COLORS.port,
        stroke: '#fff',
        strokeWidth: 2,
      },
      text: {
        fontSize: 9,
        fill: COLORS.text,
      },
    },
    label: { position: { name: 'right' } },
  },
};

// --- Tank shape ---
export function createTankElement(id: string, name: string, x: number, y: number, ports: Array<{ id: string; group: string }>) {
  return new joint.shapes.standard.Rectangle({
    id: `node-${id}`,
    position: { x, y },
    size: { width: 120, height: 70 },
    ports: {
      groups: portGroups,
      items: ports,
    },
    attrs: {
      body: {
        fill: COLORS.bg,
        stroke: COLORS.tank,
        strokeWidth: 2.5,
        rx: 8,
        ry: 8,
      },
      label: {
        text: name,
        fontSize: 12,
        fontFamily: 'ui-monospace, monospace',
        fill: COLORS.text,
        fontWeight: 600,
      },
    },
    data: { nodeId: id, kind: 'tank' },
  });
}

// --- Pump shape ---
export function createPumpElement(id: string, x: number, y: number) {
  return new joint.shapes.standard.Circle({
    id: `node-${id}`,
    position: { x, y },
    size: { width: 60, height: 60 },
    ports: {
      groups: portGroups,
      items: [
        { id: 'in', group: 'inlet' },
        { id: 'out', group: 'outlet' },
      ],
    },
    attrs: {
      body: {
        fill: COLORS.bg,
        stroke: COLORS.pump,
        strokeWidth: 2.5,
      },
      label: {
        text: 'P',
        fontSize: 18,
        fontFamily: 'ui-monospace, monospace',
        fill: COLORS.pump,
        fontWeight: 700,
      },
    },
    data: { nodeId: id, kind: 'pump' },
  });
}

// --- Endpoint shape ---
export function createEndpointElement(id: string, name: string, x: number, y: number, ports: Array<{ id: string; group: string }>) {
  return new joint.shapes.standard.Rectangle({
    id: `node-${id}`,
    position: { x, y },
    size: { width: 120, height: 50 },
    ports: {
      groups: portGroups,
      items: ports,
    },
    attrs: {
      body: {
        fill: COLORS.bg,
        stroke: COLORS.endpoint,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
        strokeDasharray: '6,3',
      },
      label: {
        text: name,
        fontSize: 12,
        fontFamily: 'ui-monospace, monospace',
        fill: COLORS.text,
        fontWeight: 500,
      },
    },
    data: { nodeId: id, kind: 'endpoint' },
  });
}

// --- Valve shape ---
export function createValveElement(id: string, shortLabel: string, x: number, y: number) {
  return new joint.shapes.standard.Rectangle({
    id: `comp-${id}`,
    position: { x, y },
    size: { width: 50, height: 28 },
    ports: {
      groups: portGroups,
      items: [
        { id: 'inlet', group: 'inlet' },
        { id: 'outlet', group: 'outlet' },
      ],
    },
    attrs: {
      body: {
        fill: COLORS.bg,
        stroke: COLORS.valve,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
      },
      label: {
        text: shortLabel,
        fontSize: 9,
        fontFamily: 'ui-monospace, monospace',
        fill: COLORS.valve,
        fontWeight: 600,
      },
    },
    data: { componentId: id, kind: 'valve' },
  });
}

// --- Flow sensor shape ---
export function createFlowSensorElement(id: string, shortLabel: string, x: number, y: number) {
  return new joint.shapes.standard.Rectangle({
    id: `comp-${id}`,
    position: { x, y },
    size: { width: 50, height: 28 },
    ports: {
      groups: portGroups,
      items: [
        { id: 'inlet', group: 'inlet' },
        { id: 'outlet', group: 'outlet' },
      ],
    },
    attrs: {
      body: {
        fill: COLORS.bg,
        stroke: COLORS.flow,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
      },
      label: {
        text: shortLabel,
        fontSize: 9,
        fontFamily: 'ui-monospace, monospace',
        fill: COLORS.flow,
        fontWeight: 600,
      },
    },
    data: { componentId: id, kind: 'flow_sensor' },
  });
}

// --- Pipe sub-link (no labels) ---
export function createPipeSubLink(
  id: string,
  sourceElId: string,
  sourcePortId: string,
  targetElId: string,
  targetPortId: string,
  routerName: 'manhattan' | 'normal' = 'manhattan',
) {
  return new joint.shapes.standard.Link({
    id,
    source: { id: sourceElId, port: sourcePortId },
    target: { id: targetElId, port: targetPortId },
    attrs: {
      line: {
        stroke: COLORS.pipe,
        strokeWidth: 2.5,
        targetMarker: {
          type: 'path',
          d: 'M 10 -5 0 0 10 5 z',
          fill: COLORS.pipe,
        },
      },
    },
    router: { name: routerName },
    connector: { name: 'rounded' },
  });
}

export { COLORS };
