/**
 * X6 shape and port factories.
 * Mirrors symbols.ts but targets @antv/x6 instead of JointJS.
 */
import type { Edge } from '@antv/x6';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';

// --- Port group type (X6 doesn't export PortManager directly) ---

interface PortGroupDef {
  position: string | { name: string; args?: Record<string, unknown> };
  attrs?: Record<string, Record<string, unknown>>;
  label?: { position: string | { name: string; args?: Record<string, unknown> } };
}

// --- Port groups ---

export const portGroups: Record<string, PortGroupDef> = {
  inlet: {
    position: 'left',
    attrs: {
      circle: {
        r: 6,
        fill: UI_COLORS.port,
        stroke: '#fff',
        strokeWidth: 2,
        magnet: true,
      },
      text: { fontSize: 9, fill: UI_COLORS.text },
    },
    label: { position: 'left' },
  },
  outlet: {
    position: 'right',
    attrs: {
      circle: {
        r: 6,
        fill: UI_COLORS.port,
        stroke: '#fff',
        strokeWidth: 2,
        magnet: true,
      },
      text: { fontSize: 9, fill: UI_COLORS.text },
    },
    label: { position: 'right' },
  },
};

// --- Node config factory ---

export interface X6NodeConfig {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: { groups: Record<string, PortGroupDef>; items: Array<{ id: string; group: string }> };
  attrs: Record<string, Record<string, unknown>>;
  data: { nodeId: string; kind: string };
}

export function buildNodeConfig(
  desc: NodeDescriptor,
  id: string,
  name: string,
  x: number,
  y: number,
  ports: Array<{ id: string; group: string }>,
): X6NodeConfig {
  const { width: w, height: h } = desc.size;

  const isPump = desc.kind === 'pump';
  const isEndpoint = desc.kind === 'endpoint';
  const isPassthrough = desc.role === 'passthrough';

  const labelText = isPassthrough ? desc.label[0] : name;

  return {
    id: `node-${id}`,
    shape: 'rect',
    x,
    y,
    width: w,
    height: h,
    ports: { groups: portGroups, items: ports },
    attrs: {
      body: {
        fill: isPassthrough ? desc.color + '15' : UI_COLORS.bg,
        stroke: desc.color,
        strokeWidth: 2.5,
        rx: isPump ? w / 2 : isEndpoint ? 6 : 3,
        ry: isPump ? h / 2 : isEndpoint ? 6 : 3,
        ...(isEndpoint ? { strokeDasharray: '6,3' } : {}),
      },
      label: {
        text: labelText,
        fontSize: isPump ? 18 : 12,
        fontWeight: isPump ? 'bold' : '600',
        fontFamily: 'ui-monospace, monospace',
        fill: isPump ? desc.color : UI_COLORS.text,
      },
    },
    data: { nodeId: id, kind: desc.kind },
  };
}

// --- Edge config factory ---

export interface X6EdgeConfig {
  id: string;
  shape: string;
  source: { cell: string; port: string };
  target: { cell: string; port: string };
  attrs: Record<string, Record<string, unknown>>;
  router: { name: string; args?: Record<string, unknown> };
  connector: { name: string };
}

export function buildEdgeConfig(
  id: string,
  sourceCell: string,
  sourcePort: string,
  targetCell: string,
  targetPort: string,
): X6EdgeConfig {
  return {
    id,
    shape: 'edge',
    source: { cell: sourceCell, port: sourcePort },
    target: { cell: targetCell, port: targetPort },
    attrs: {
      line: {
        stroke: UI_COLORS.pipe,
        strokeWidth: 2.5,
        targetMarker: { name: 'classic', size: 8 },
      },
    },
    router: {
      name: 'manhattan',
      args: {
        step: 10,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        excludeTerminals: ['source', 'target'],
        startDirections: ['right'],
        endDirections: ['left'],
      },
    },
    connector: { name: 'rounded' },
  };
}

// --- Drag edge config (for in-progress connections) ---

export function buildDragEdgeAttrs(): Edge.Metadata {
  return {
    attrs: {
      line: {
        stroke: UI_COLORS.pipe,
        strokeWidth: 2.5,
        strokeDasharray: '8,4',
        targetMarker: { name: 'classic', size: 8 },
      },
    },
    router: {
      name: 'manhattan',
      args: {
        step: 10,
        padding: { top: 20, right: 20, bottom: 20, left: 20 },
        excludeTerminals: ['source', 'target'],
        startDirections: ['right'],
        endDirections: ['left'],
      },
    },
    connector: { name: 'rounded' },
  };
}
