/**
 * Generate a standalone SVG rendering of the topology diagram.
 * Uses the same renderSvg() from entity descriptors — identical visuals to the canvas.
 * No DOM required — runs in both Node and browser.
 */
import type { SystemTopology, TopologyNode } from "../topology.types";
import { NODE_REGISTRY } from "../entity-registry";

const PADDING = 40;
const PIPE_COLOR = '#6b7280';

function parsePortRef(ref: string): { nodeId: string; portId: string } {
  const [nodeId, portId] = ref.split(":");
  return { nodeId, portId };
}

function getPortPosition(node: TopologyNode, portId: string): { x: number; y: number } {
  const desc = NODE_REGISTRY.get(node.kind);
  if (!desc) return { x: node.position.x, y: node.position.y };

  const port = node.ports.find(p => p.id === portId);
  const { width, height } = desc.size;

  // Use portLayout if available, otherwise infer from direction
  if (desc.portLayout?.[portId]) {
    const isInlet = port?.direction === 'inlet';
    return {
      x: node.position.x + (isInlet ? 0 : width),
      y: node.position.y + desc.portLayout[portId].y,
    };
  }

  // Default: inlet on left, outlet on right, centered vertically
  if (port?.direction === 'inlet') {
    return { x: node.position.x, y: node.position.y + height / 2 };
  }
  return { x: node.position.x + width, y: node.position.y + height / 2 };
}

export function generateTopologySvg(topology: SystemTopology): string {
  const nodes = topology.nodes.filter(n => !n.disabled);
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Compute bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const desc = NODE_REGISTRY.get(node.kind);
    const w = desc?.size.width ?? 60;
    const h = desc?.size.height ?? 60;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const width = (maxX - minX) + PADDING * 2;
  const height = (maxY - minY) + PADDING * 2;
  const offsetX = -minX + PADDING;
  const offsetY = -minY + PADDING;

  // Render pipes as lines
  const pipeLines = topology.pipes
    .filter(p => {
      const from = parsePortRef(p.from);
      const to = parsePortRef(p.to);
      return nodeMap.has(from.nodeId) && nodeMap.has(to.nodeId);
    })
    .map(p => {
      const from = parsePortRef(p.from);
      const to = parsePortRef(p.to);
      const fromNode = nodeMap.get(from.nodeId)!;
      const toNode = nodeMap.get(to.nodeId)!;
      const fp = getPortPosition(fromNode, from.portId);
      const tp = getPortPosition(toNode, to.portId);
      return `<line x1="${fp.x + offsetX}" y1="${fp.y + offsetY}" x2="${tp.x + offsetX}" y2="${tp.y + offsetY}" stroke="${PIPE_COLOR}" stroke-width="2" stroke-linecap="round"/>`;
    })
    .join('\n    ');

  // Render nodes using entity renderSvg
  const nodeElements = nodes.map(node => {
    const desc = NODE_REGISTRY.get(node.kind);
    if (!desc) return '';
    const { ports: _, position: __, ...data } = node;
    const innerSvg = desc.renderSvg(data)
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '');
    const x = node.position.x + offsetX;
    const y = node.position.y + offsetY;
    return `<g transform="translate(${x},${y})">${innerSvg}</g>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>text { font-family: ui-monospace, monospace; }</style>
  <g>
    ${pipeLines}
    ${nodeElements}
  </g>
</svg>`;
}
