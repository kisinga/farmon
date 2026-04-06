/**
 * X6 shape and port configuration factories.
 * Nodes use the built-in 'image' shape with SVG data URIs from NodeDescriptor.renderSvg().
 */
import type { Node, Edge } from '@antv/x6';
import type { NodeDescriptor } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';
import { svgDataUri } from './scada-shape';

// --- Shared router config (used by edges and drag connections) ---

export const MANHATTAN_ROUTER = {
  name: 'manhattan' as const,
  args: {
    step: 10,
    padding: { top: 20, right: 20, bottom: 20, left: 20 },
    excludeTerminals: ['source', 'target'],
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

const PORT_GROUPS = { inlet: portGroup('left'), outlet: portGroup('right') };

// --- Port spacing ---

type PortItem = { id: string; group: string };
type SpacedPort = PortItem & { args?: { y: number } };

function spacePorts(ports: PortItem[], nodeHeight: number): SpacedPort[] {
  const byGroup = new Map<string, PortItem[]>();
  for (const p of ports) {
    const list = byGroup.get(p.group) ?? [];
    list.push(p);
    byGroup.set(p.group, list);
  }

  const result: SpacedPort[] = [];
  for (const [, items] of byGroup) {
    if (items.length <= 1) {
      result.push(...items);
    } else {
      items.forEach((p, i) => {
        result.push({ ...p, args: { y: ((i + 1) / (items.length + 1)) * nodeHeight } });
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
  ports: Array<{ id: string; group: string }>,
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
