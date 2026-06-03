/**
 * Shared DTO types for the MajiFlow backend (PocketBase) API surface.
 *
 * Domain types (topology, board, validation, site payloads) are owned by
 * `@far-mon/core` — the single source of truth — and re-exported here for
 * convenience. Backend-transport-specific DTOs are declared locally.
 */

import type { ValidationResult, RuleDiagnostic, NetworkConfig } from '@far-mon/core';
import type {
  SiteListEntry, SiteFullPayload, SiteSavePayload,
  TemplateListEntry, Controller,
  BoardDef, Route, SiteTopology,
} from '@far-mon/core';

export type { ValidationResult, RuleDiagnostic, NetworkConfig };
export type { SiteListEntry, SiteFullPayload, SiteSavePayload, TemplateListEntry, Controller };
export type { BoardDef, Route, SiteTopology };

// --- Boards ---

export interface BoardListEntry {
  id: string;
  model: string;
  label: string;
  library: boolean;
}

export interface BoardLoadResult {
  board: BoardDef;
  svg: string | null;
}

// --- Generation ---

export type GenerationType = 'esphome' | 'ha';

/**
 * Result of a client-side generation + commit. `files` is the human-readable
 * manifest of what was emitted; `downloadUrl` points at the stored bundle for
 * the committed `topology_versions` row.
 */
export interface GenerateResult {
  files: Array<{ path: string; description: string; lines: number }>;
  downloadUrl: string;
  version: string;
  generationId?: number;
}

export type ValidateRequest =
  | { kind: 'live'; topology: SiteTopology; board: BoardDef; controllerId: string }
  | { kind: 'saved'; siteId: string; controllerId: string };

// --- Versioning (topology_versions) ---

/** A committed, immutable site version. */
export interface VersionEntry {
  id: string;
  version: number;
  sourceHash: string;
  note: string;
  committedAt: string;
  /** URL to download the stored ESPHome bundle zip. */
  bundleUrl: string;
}

/** Outcome of a commit — `deduped` is true when the inputs matched the latest version. */
export interface CommitResult {
  id: string;
  version: number;
  deduped: boolean;
}
