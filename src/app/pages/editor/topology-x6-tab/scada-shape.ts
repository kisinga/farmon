/**
 * Converts a NodeDescriptor's renderSvg() output into a data URI
 * suitable for X6's image shape attrs.
 */
import { NODE_REGISTRY } from '../../../core/models/entities.model';

export function svgDataUri(kind: string, data: Record<string, unknown>): string {
  const desc = NODE_REGISTRY.get(kind);
  if (!desc) return '';
  let svg = desc.renderSvg(data);
  if (data['disabled']) {
    // Wrap SVG content with reduced opacity for disabled entities
    svg = svg.replace(/^<svg([^>]*)>/, '<svg$1><g opacity="0.3">').replace(/<\/svg>\s*$/, '</g></svg>');
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
