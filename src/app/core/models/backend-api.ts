/**
 * Shared DTO types for the MajiFlow backend (PocketBase) API surface.
 *
 * Domain types (topology, board, validation, site payloads) are owned by
 * `@core` — the single source of truth — and re-exported here for
 * convenience. Backend-transport-specific DTOs are declared locally.
 */

import type { ValidationResult, RuleDiagnostic, NetworkConfig, DeploymentMode } from '@core';
import type {
  SiteListEntry, SiteFullPayload, SiteSavePayload,
  TemplateListEntry, Controller,
  BoardDef, Route, SiteTopology,
} from '@core';

export type { ValidationResult, RuleDiagnostic, NetworkConfig };
export type { SiteListEntry, SiteFullPayload, SiteSavePayload, TemplateListEntry, Controller };
export type { BoardDef, Route, SiteTopology };

// --- Devices (registered controllers) + global config ---

/**
 * A registered device: one `controllers` collection row — the provisioned
 * identity, distinct from a design-time topology controller. `deviceId` is the
 * load-bearing id (== topology controller id == MQTT username).
 */
export interface DeviceEntry {
  /** PocketBase record id (for update/delete). */
  id: string;
  deviceId: string;
  name: string;
  siteId: string;
  siteName: string;
  boardType: string;
  firmwareVersion: string;
  online: boolean;
  /** Last-seen timestamp (ISO) or '' if never seen. */
  lastSeen: string;
  /** When the device was first registered (ISO). */
  created: string;
}

/** Admin-tunable global settings, served by GET /api/farmon/config. */
export interface AppConfig {
  hostingDeviceCap: number;
}

/** The editable app_config singleton (carries the record id for updates). */
export interface AppConfigRecord {
  id: string;
  hostingDeviceCap: number;
}

/** The configuration a pricing-page visitor submitted alongside a lead. */
export interface LeadEstimate {
  controllers: number;
  oneTime: number;
  yearly: number;
  input: { pumps: number; valves: number; flow: number; tanks: number };
}

/** A captured sales enquiry from the public pricing estimator. */
export interface LeadEntry {
  id: string;
  name: string;
  phone: string;
  email: string;
  consent: boolean;
  source: string;
  /** '' (pre-status rows / fresh submissions) is treated as 'new'. */
  status: string;
  estimate: LeadEstimate | null;
  created: string;
}

// --- Documentation (the `docs` collection: product narrative + node-type docs) ---

/**
 * A row in the `docs` collection. `slug` is the single identifying key — for
 * category 'node' it IS the node kind (e.g. 'valve'). Board reference docs live
 * in the board def, not here.
 */
export interface DocEntry {
  id: string;
  slug: string;
  title: string;
  category: 'narrative' | 'node' | 'wiring' | 'glossary';
  order: number;
  body: string;
  updated: string;
}

/** Editable fields for creating/updating a doc. */
export interface DocDraft {
  slug: string;
  title: string;
  category: DocEntry['category'];
  order: number;
  body: string;
}

/**
 * Cached topology SVGs for a site's documentation: the composite site diagram
 * plus one per controller id. Rendered in the admin browser (X6) and stored on
 * the site so the customer dashboard renders docs without loading X6.
 */
export interface SiteDiagrams {
  composite: string;
  controllers: Record<string, string>;
  /** Hash of the topology these were rendered from — lets the customer path
   *  detect a stale cache (topology edited but diagrams not re-published). */
  topoHash?: string;
}

// --- Boards ---

export interface BoardListEntry {
  /** PocketBase record id. Controllers reference boards by `model`, not this. */
  id: string;
  model: string;
  label: string;
  kind: 'main' | 'expansion';
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
  | { kind: 'live'; topology: SiteTopology; board: BoardDef; controllerId: string; mode?: DeploymentMode }
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
