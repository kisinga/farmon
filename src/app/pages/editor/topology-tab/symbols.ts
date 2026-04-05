/**
 * JointJS shape factories using native shapes (no SVG data URIs).
 * All topology entities are nodes — valves/sensors included.
 */
import * as joint from '@joint/core';
import type { NodeDescriptor } from '../../../core/models/entities.model';
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

  const isPump = desc.kind === 'pump';
  const isEndpoint = desc.kind === 'endpoint';
  const isPassthrough = desc.role === 'passthrough';

  const labelText = isPassthrough ? desc.label[0] : name;

  return new joint.shapes.standard.Rectangle({
    id: `node-${id}`,
    position: { x, y },
    size: { width: w, height: h },
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
  });
}

// --- Pipe link ---
export function createPipeLink(
  id: string,
  sourceElId: string,
  sourcePortId: string,
  targetElId: string,
  targetPortId: string,
) {
  return new joint.shapes.standard.Link({
    id,
    source: { id: sourceElId, port: sourcePortId, anchor: { name: 'right' }, connectionPoint: { name: 'anchor' } },
    target: { id: targetElId, port: targetPortId, anchor: { name: 'left' }, connectionPoint: { name: 'anchor' } },
    attrs: {
      line: {
        stroke: UI_COLORS.pipe, strokeWidth: 2.5,
        targetMarker: { type: 'path', d: 'M 10 -5 0 0 10 5 z', fill: UI_COLORS.pipe },
      },
    },
    router: { name: 'rightAngle', args: { margin: 20 } },
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
    router: { name: 'rightAngle', args: { margin: 20 } },
    connector: { name: 'rounded' },
  });
}
