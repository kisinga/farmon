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
  if (data['remote']) {
    // Remote node — dashed border + satellite badge
    const { width, height } = desc.size;
    svg = svg.replace(/^<svg([^>]*)>/, `<svg$1><g><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="4" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="4,3"/><text x="${width - 4}" y="10" text-anchor="end" font-size="8" fill="#6366f1" font-family="ui-monospace, monospace">&#x1F6F0;</text></g>`);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
