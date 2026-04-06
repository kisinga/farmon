/**
 * Converts a NodeDescriptor's renderSvg() output into a data URI
 * suitable for X6's image shape attrs.
 */
import { NODE_REGISTRY } from '../../../core/models/entities.model';

export function svgDataUri(kind: string, data: Record<string, unknown>): string {
  const desc = NODE_REGISTRY.get(kind);
  if (!desc) return '';
  const svg = desc.renderSvg(data);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
