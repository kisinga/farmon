/**
 * X6 shape and port configuration factories.
 * Nodes use the built-in 'image' shape with SVG data URIs from NodeDescriptor.renderSvg().
 */
import { Shape } from '@antv/x6';
import type { Node, Edge } from '@antv/x6';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import { svgDataUri } from './scada-shape';

// --- Register a boundary shape (excluded from manhattan obstacle map) ---

export const BOUNDARY_SHAPE = 'boundary';
Shape.Rect.define({ shape: BOUNDARY_SHAPE });

// --- Shared router config (used by edges and drag connections) ---

export const MANHATTAN_ROUTER = {
  name: 'manhattan' as const,
  args: {
    step: 10,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    excludeTerminals: ['source', 'target'],
    excludeShapes: [BOUNDARY_SHAPE],
    startDirections: ['right'],
    endDirections: ['left'],
  },
};

// --- Port groups ---

const portGroup = (side: 'left' | 'right') => ({
  position: side,
  attrs: {
    circle: { r: 6, fill: UI_COLORS.port, stroke: '#fff', strokeWidth: 2, magnet: true },
    text: { fontSize: 9, fill: UI_COLORS.text },
  },
  label: { position: side },
});

const PORT_GROUPS = {
  inlet: portGroup('left'),
  outlet: portGroup('right'),
  'inlet-abs': { ...portGroup('left'), position: 'absolute' as const },
  'outlet-abs': { ...portGroup('right'), position: 'absolute' as const },
};

// --- Port spacing ---

export type PortItem = { id: string; group: string; args?: { x?: number; y?: number } };

function spacePorts(ports: PortItem[], nodeHeight: number): PortItem[] {
  const byGroup = new Map<string, PortItem[]>();
  for (const p of ports) {
    const list = byGroup.get(p.group) ?? [];
    list.push(p);
    byGroup.set(p.group, list);
  }

  const result: PortItem[] = [];
  for (const [, items] of byGroup) {
    if (items.length <= 1) {
      result.push(...items);
    } else {
      items.forEach((p, i) => {
        if (p.args?.y != null) {
          result.push(p);
        } else {
          result.push({ ...p, args: { y: ((i + 1) / (items.length + 1)) * nodeHeight } });
        }
      });
    }
  }
  return result;
}

// --- Node config ---

export function buildNodeConfig(
  desc: NodeDescriptor,
  id: string,
  nodeData: Record<string, unknown>,
  x: number,
  y: number,
  ports: PortItem[],
): Node.Metadata {
  const { width, height } = desc.size;
  return {
    id: `node-${id}`,
    shape: 'image',
    x,
    y,
    width,
    height,
    imageUrl: svgDataUri(desc.kind, nodeData),
    ports: { groups: PORT_GROUPS, items: spacePorts(ports, height) },
    data: { nodeId: id, kind: desc.kind, ...nodeData },
  };
}

// --- Edge config ---

export function buildEdgeConfig(
  id: string,
  sourceCell: string,
  sourcePort: string,
  targetCell: string,
  targetPort: string,
): Edge.Metadata {
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
    router: MANHATTAN_ROUTER,
    connector: { name: 'rounded' },
  };
}

// --- Drag edge (in-progress connections) ---

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
    router: MANHATTAN_ROUTER,
    connector: { name: 'rounded' },
  };
}
