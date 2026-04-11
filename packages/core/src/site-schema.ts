/**
 * SiteSchema — Zod validation for site documents.
 */
import { z } from 'zod';
import type { Site } from './site.types';

const SiteLinkRefPattern = /^[^/]+\/[^:]+:[^:]+$/;

const SystemPlacementSchema = z.object({
  config: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  checksum: z.string().min(1),
});

const SiteLinkSchema = z.object({
  id: z.string().min(1),
  from: z.string().regex(SiteLinkRefPattern, 'Must be "config/nodeId:portId" format'),
  to: z.string().regex(SiteLinkRefPattern, 'Must be "config/nodeId:portId" format'),
  label: z.string().optional(),
});

export const SiteSchema = z.object({
  schema: z.literal(1),
  name: z.string().min(1),
  friendly_name: z.string().min(1),
  systems: z.array(SystemPlacementSchema).default([]),
  links: z.array(SiteLinkSchema).default([]),
});

/**
 * Parse and validate a raw site document.
 */
export function parseSite(data: unknown): Site {
  return SiteSchema.parse(data) as Site;
}
