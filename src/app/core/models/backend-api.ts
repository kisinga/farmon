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
  BoardDef, Route, SiteTopology, EasyModeProfile,
} from '@core';

export type { ValidationResult, RuleDiagnostic, NetworkConfig };
export type { SiteListEntry, SiteFullPayload, SiteSavePayload, TemplateListEntry, Controller };
export type { BoardDef, Route, SiteTopology };

/** Server-side site catalog item: everything the overview cards and alert bell need
 *  without the full topology JSON blob. */
export interface SiteCatalogItem {
  id: string;
  friendlyName: string;
  owners: string[];
  controllerCount: number;
  nodeCount: number;
  mode: string;
  deviceCount: number;
  liveCount: number;
  commenceDate: string;
  tankLowPct: number;
  tankHighPct: number;
  offlineTimeoutS: number;
}

// --- Devices (registered controllers) + global config ---

/**
 * A registered device: one `controllers` collection row — the provisioned
 * identity, distinct from a design-time topology controller. `deviceId` is the
 * load-bearing id (== topology controller id == MQTT username).
 */
export interface DeviceEntry {
  /** PocketBase record id (== deviceId — the device_id is the primary key). */
  id: string;
  deviceId: string;
  name: string;
  siteId: string;
  siteName: string;
  boardType: string;
  firmwareVersion: string;
  /** false == deregistered/decommissioned: cannot connect, frees a cap slot. */
  active: boolean;
  online: boolean;
  /** Last-seen timestamp (ISO) or '' if never seen. */
  lastSeen: string;
  /** When the device was first registered (ISO). */
  created: string;
  /** true when a second board has connected under this identity reporting a
   *  different chip MAC than the bound one — the same firmware flashed to two
   *  boards. Detection only; cleared by an admin rebind. */
  macConflict: boolean;
  /** The conflicting board's MAC, when `macConflict` is set (else ''). */
  conflictMac: string;
}

/** A customer account (users with role=customer) — assignable as a site owner
 *  and managed from the admin Customers page. */
export interface CustomerEntry {
  id: string;
  name: string;
  email: string;
  phone: string;
  /** Email verified (also set when they complete the invite/reset flow). */
  verified: boolean;
  /** When the account was created (ISO). */
  created: string;
}

/** The signed-in user's editable account profile. */
export interface AccountProfile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: 'admin' | 'partner' | 'customer';
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

/** The configuration a pricing-page visitor submitted alongside a lead. `tier` and
 *  `monthly` are absent on snapshots captured before the platform-first pricing change.
 *  `topology` is the composed design (when the visitor described their site), absent
 *  on snapshots captured before Easy Mode.
 *
 *  `profile` is the raw Easy Mode answers (the input SSOT); `topology` is the
 *  snapshot derived from them (what the visitor saw and got in their PDF). Both
 *  are kept: the snapshot stays faithful even if the composer later changes,
 *  while the profile lets lead conversion re-run the composer with a real board
 *  to produce a pin-wired site. Absent on pre-conversion snapshots. */
export interface LeadEstimate {
  controllers: number;
  oneTime: number;
  monthly?: number;
  tier?: string;
  input: { pumps: number; valves: number; flow: number; tanks: number };
  topology?: SiteTopology | null;
  profile?: EasyModeProfile | null;
  /** Set when this lead has been converted to a site, so the leads view can link
   *  to it and hide the Convert action. Rides the JSON blob (no schema field). */
  convertedSiteId?: string;
  /** Set when the described site exceeded Easy Mode: the visitor asked our team to
   *  design it. `designReason` is the plain trigger (custom_tanks / many_areas /
   *  big_system); `note` is their optional free-text. */
  designRequest?: boolean;
  designReason?: string;
  note?: string;
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
/** A board definition paired with its SVG diagram as raw markup (the catalog
 *  stores the SVG as a protected file, fetched and inlined for rendering). */
export interface BoardBundle {
  def: BoardDef;
  /** Raw `<svg>` markup, or '' when the board has no diagram. */
  svg: string;
}

export interface SiteDiagrams {
  composite: string;
  controllers: Record<string, string>;
  /** Per-controller board pinout SVGs: the physical board with connected-pin
   *  callout labels baked in. Keyed by controller id. */
  boardPinouts: Record<string, string>;
  /** Hash of the topology these were rendered from — lets the customer path
   *  detect a stale cache (topology edited but diagrams not re-published). */
  topoHash?: string;
  /** ISO timestamp of the last generation/publish — shown on the deploy page so
   *  the admin knows how fresh the customer-visible docs are. */
  generatedAt?: string;
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

export type GenerationType = 'esphome';

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
