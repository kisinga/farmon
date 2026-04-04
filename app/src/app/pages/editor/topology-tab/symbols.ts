/**
 * JointJS shape factories using native shapes (no SVG data URIs).
 * Nodes → rectangles/circles with text labels.
 * Inline components → small colored shapes with labels.
 */
import * as joint from 'jointjs';
import type { NodeDescriptor, InlineComponentDescriptor } from '../../../core/models/entities.model';
import { UI_COLORS } from '../../../core/models/colors.model';

// --- Port groups ---
const portGroups: Record<string, joint.dia.Element.PortGroup> = {
  inlet: {
    position: { name: 'left' },
    attrs: {
      circle: {
        r: 6,
        fill: UI_COLORS.port,
        stroke: '#fff',
        strokeWidth: 2,
        magnet: 'passive',
      },
      text: { fontSize: 9, fill: UI_COLORS.text },
    },
    label: { position: { name: 'left' } },
  },
  outlet: {
    position: { name: 'right' },
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
    label: { position: { name: 'right' } },
  },
};

// --- Generic node element factory ---
export function createNodeElement(
  desc: NodeDescriptor,
  id: string,
  name: string,
  x: number,
  y: number,
  ports: Array<{ id: string; group: string }>,
): joint.dia.Element {
  const { width: w, height: h } = desc.size;

  // Pump is circular
  if (desc.kind === 'pump') {
    const r = Math.min(w, h) / 2;
    return new joint.shapes.standard.Circle({
      id: `node-${id}`,
      position: { x, y },
      size: { width: w, height: h },
      ports: { groups: portGroups, items: ports },
      attrs: {
        body: {
          fill: UI_COLORS.bg,
          stroke: desc.color,
          strokeWidth: 2.5,
        },
        label: {
          text: 'P',
          fontSize: 18,
          fontWeight: 'bold',
          fontFamily: 'ui-monospace, monospace',
          fill: desc.color,
        },
      },
      data: { nodeId: id, kind: desc.kind },
    });
  }

  // Endpoint has dashed border
  const strokeDasharray = desc.kind === 'endpoint' ? '6,3' : undefined;

  return new joint.shapes.standard.Rectangle({
    id: `node-${id}`,
    position: { x, y },
    size: { width: w, height: h },
    ports: { groups: portGroups, items: ports },
    attrs: {
      body: {
        fill: UI_COLORS.bg,
        stroke: desc.color,
        strokeWidth: 2.5,
        rx: desc.kind === 'endpoint' ? 6 : 3,
        ry: desc.kind === 'endpoint' ? 6 : 3,
        ...(strokeDasharray ? { strokeDasharray } : {}),
      },
      label: {
        text: name,
        fontSize: 12,
        fontWeight: '600',
        fontFamily: 'ui-monospace, monospace',
        fill: UI_COLORS.text,
      },
    },
    data: { nodeId: id, kind: desc.kind },
  });
}

// --- Generic inline component element factory ---
export function createInlineElement(
  desc: InlineComponentDescriptor,
  id: string,
  shortLabel: string,
  x: number,
  y: number,
): joint.dia.Element {
  const { width: w, height: h } = desc.size;

  return new joint.shapes.standard.Rectangle({
    id: `comp-${id}`,
    position: { x, y },
    size: { width: w, height: h },
    ports: {
      groups: portGroups,
      items: [
        { id: 'inlet', group: 'inlet' },
        { id: 'outlet', group: 'outlet' },
      ],
    },
    attrs: {
      body: {
        fill: UI_COLORS.bg,
        stroke: desc.color,
        strokeWidth: 2,
        rx: 4,
        ry: 4,
      },
      label: {
        text: shortLabel,
        fontSize: 10,
        fontWeight: '700',
        fontFamily: 'ui-monospace, monospace',
        fill: desc.color,
      },
    },
    data: { componentId: id, kind: desc.kind },
  });
}

// --- Pipe sub-link ---
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
        stroke: UI_COLORS.pipe, strokeWidth: 2.5,
        targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 z', fill: UI_COLORS.pipe },
      },
    },
    router: { name: routerName },
    connector: { name: 'rounded' },
  });
}

// --- Drag link ---
export function createDragLink() {
  return new joint.shapes.standard.Link({
    attrs: {
      line: {
        stroke: UI_COLORS.pipe, strokeWidth: 2.5, strokeDasharray: '8,4',
        targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 z', fill: UI_COLORS.pipe },
      },
    },
    router: { name: 'manhattan' },
    connector: { name: 'rounded' },
  });
}
