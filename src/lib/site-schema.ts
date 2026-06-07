/**
 * Zod validation for the site-import envelope (`{ site, topology }`), so
 * `BackendService.siteImport` validates instead of casting raw JSON. The
 * topology half is delegated to `parseTopology`, which both validates and
 * migrates legacy schemas — an import now fails loudly on a malformed graph
 * rather than persisting garbage.
 */

import { z } from 'zod';
import { parseTopology } from './topology-schema';
import type { SiteTopology } from './topology.types';

const SiteImportEnvelopeSchema = z.object({
  site: z.object({
    id: z.string().optional(),
    friendlyName: z.string().optional(),
  }).optional(),
  topology: z.unknown().nullable().optional(),
});

export interface ParsedSiteImport {
  friendlyName: string;
  topology: SiteTopology | null;
}

/** Validate + normalize an imported site payload (already JSON-parsed). */
export function parseSiteImport(data: unknown): ParsedSiteImport {
  const env = SiteImportEnvelopeSchema.parse(data);
  return {
    friendlyName: env.site?.friendlyName ?? 'Imported Site',
    topology: env.topology != null ? parseTopology(env.topology) : null,
  };
}
